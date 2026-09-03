// The remembered-account lane: which accounts a device holds, and nothing about
// which one is active.
//
// THE DEFECT IT EXISTS FOR: the browser Supabase client holds exactly one
// session, so a person running two accounts had to sign out and wait for an
// email link every time they hopped. THE DEFECT IT MUST NOT CAUSE: a stored row
// standing in for the signed-in account. Every rule below is one of those two.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEVICE_IDENTITY_LOCAL_KEYS,
  DEVICE_IDENTITY_SESSION_KEYS,
} from "@/lib/deviceAccountIdentity";
import {
  deviceAccountLabel,
  deviceAccountSwitchTargets,
  deviceAccountsSnapshot,
  deviceSignOutScopeOffered,
  DEVICE_ACCOUNT_SESSIONS_KEY,
  forgetAllDeviceAccounts,
  forgetDeviceAccount,
  markDeviceAccountNeedsSignIn,
  MAX_DEVICE_ACCOUNTS,
  nextSignedInDeviceAccount,
  parseDeviceAccounts,
  readDeviceAccounts,
  rememberDeviceAccount,
} from "@/lib/deviceAccountSessions";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const TOKEN_A = "refresh-token-for-account-a";
const TOKEN_B = "refresh-token-for-account-b";

describe("the remembered-account lane", () => {
  let local: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    local = fakeStorage();
  });

  it("remembers one refresh token per account, newest active first", () => {
    rememberDeviceAccount(
      local,
      { userId: "a", refreshToken: TOKEN_A, email: "a@example.test", handle: "karan" },
      1_000,
    );
    rememberDeviceAccount(
      local,
      { userId: "b", refreshToken: TOKEN_B, handle: "karansznx" },
      2_000,
    );

    const rows = readDeviceAccounts(local);
    expect(rows.map((row) => row.userId)).toEqual(["b", "a"]);
    expect(rows[1]).toMatchObject({
      userId: "a",
      refreshToken: TOKEN_A,
      email: "a@example.test",
      handle: "karan",
    });
  });

  it("stores the refresh token and nothing shorter-lived", () => {
    rememberDeviceAccount(local, { userId: "a", refreshToken: TOKEN_A }, 1_000);
    const raw = local.values.get(DEVICE_ACCOUNT_SESSIONS_KEY) ?? "";

    // An access token is minutes long and a switch has no use for one, so the
    // lane must never be a place one could come to rest.
    expect(raw).toContain(TOKEN_A);
    expect(raw).not.toContain("access_token");
    expect(raw).not.toContain("accessToken");
  });

  it("updates a row without erasing what another writer put there", () => {
    // The session write knows the token, the canonical identity read knows the
    // handle, and they land at different moments. Either erasing the other is
    // how a switcher ends up listing an email address for a named account.
    rememberDeviceAccount(local, { userId: "a", refreshToken: TOKEN_A }, 1_000);
    rememberDeviceAccount(local, { userId: "a", handle: "karan" }, 1_100);

    expect(readDeviceAccounts(local)[0]).toMatchObject({
      refreshToken: TOKEN_A,
      handle: "karan",
    });

    rememberDeviceAccount(local, { userId: "a", refreshToken: TOKEN_B }, 1_200);
    expect(readDeviceAccounts(local)[0]).toMatchObject({
      refreshToken: TOKEN_B,
      handle: "karan",
    });
  });

  it("keeps the row and drops the token when GoTrue refuses it", () => {
    rememberDeviceAccount(
      local,
      { userId: "a", refreshToken: TOKEN_A, handle: "karan" },
      1_000,
    );

    markDeviceAccountNeedsSignIn(local, "a");

    // "We cannot let you back in silently" and "you were never here" are two
    // findings. Only the second may hide an account from its owner.
    const [row] = readDeviceAccounts(local);
    expect(row?.handle).toBe("karan");
    expect(row?.refreshToken).toBeNull();
    expect(local.values.get(DEVICE_ACCOUNT_SESSIONS_KEY)).not.toContain(TOKEN_A);
  });

  it("takes one account off the device, or all of them", () => {
    rememberDeviceAccount(local, { userId: "a", refreshToken: TOKEN_A }, 1_000);
    rememberDeviceAccount(local, { userId: "b", refreshToken: TOKEN_B }, 2_000);

    forgetDeviceAccount(local, "a");
    expect(readDeviceAccounts(local).map((row) => row.userId)).toEqual(["b"]);
    expect(local.values.get(DEVICE_ACCOUNT_SESSIONS_KEY)).not.toContain(TOKEN_A);

    forgetAllDeviceAccounts(local);
    expect(readDeviceAccounts(local)).toEqual([]);
    expect(local.values.has(DEVICE_ACCOUNT_SESSIONS_KEY)).toBe(false);
  });

  it("caps the device and drops the least recently active row", () => {
    for (let index = 0; index <= MAX_DEVICE_ACCOUNTS; index++) {
      rememberDeviceAccount(
        local,
        { userId: `user-${index}`, refreshToken: `${TOKEN_A}-${index}` },
        1_000 + index,
      );
    }

    const rows = readDeviceAccounts(local);
    expect(rows).toHaveLength(MAX_DEVICE_ACCOUNTS);
    expect(rows.map((row) => row.userId)).not.toContain("user-0");
  });

  it("reads a malformed or blocked lane as no accounts at all", () => {
    expect(parseDeviceAccounts("not json")).toEqual([]);
    expect(parseDeviceAccounts(null)).toEqual([]);
    expect(readDeviceAccounts(null)).toEqual([]);
    // A row with no account id names nobody, and a token shaped wrong is not a
    // token: both are dropped rather than repaired.
    expect(parseDeviceAccounts(JSON.stringify([{ refreshToken: TOKEN_A }]))).toEqual([]);
    expect(
      parseDeviceAccounts(JSON.stringify([{ userId: "a", refreshToken: 42 }]))[0]
        ?.refreshToken,
    ).toBeNull();
  });

  it("hands the switcher every account except the active one", () => {
    rememberDeviceAccount(local, { userId: "a", refreshToken: TOKEN_A }, 1_000);
    rememberDeviceAccount(local, { userId: "b", refreshToken: TOKEN_B }, 2_000);
    const rows = readDeviceAccounts(local);

    expect(deviceAccountSwitchTargets(rows, "b").map((row) => row.userId)).toEqual([
      "a",
    ]);
    // A device with one account offers no swap and no scope on the way out:
    // "this account" and "all accounts" would be the same act.
    expect(deviceSignOutScopeOffered(rows, "b")).toBe(true);
    expect(deviceSignOutScopeOffered([rows[0]!], rows[0]!.userId)).toBe(false);
  });

  it("hands the device to the next account that can still be signed in", () => {
    rememberDeviceAccount(local, { userId: "a", refreshToken: TOKEN_A }, 1_000);
    rememberDeviceAccount(local, { userId: "b", refreshToken: TOKEN_B }, 2_000);
    rememberDeviceAccount(local, { userId: "c", refreshToken: null }, 3_000);
    const rows = readDeviceAccounts(local);

    // "c" is the most recent but holds no token, so it cannot take a device.
    expect(nextSignedInDeviceAccount(rows, "a")?.userId).toBe("b");
    expect(nextSignedInDeviceAccount([rows[0]!], rows[0]!.userId)).toBeNull();
  });

  it("names a row by its handle, and by its address only when it has none", () => {
    expect(
      deviceAccountLabel({
        userId: "a",
        refreshToken: null,
        email: "a@example.test",
        handle: "karan",
        lastActiveAt: 1,
      }),
    ).toBe("karan");
    expect(
      deviceAccountLabel({
        userId: "a",
        refreshToken: null,
        email: "a@example.test",
        handle: null,
        lastActiveAt: 1,
      }),
    ).toBe("a@example.test");
  });

  it("is not one of the artifacts that claim to BE the signed-in account", () => {
    // THE LAW. The identity set is dropped whole the moment a different account
    // owns the device; this lane is deliberately outside it, because dropping it
    // on a switch would delete the other accounts, which is the feature. It is
    // safe outside only because every row names its own account id and nothing
    // reads "who is signed in" from here.
    expect([...DEVICE_IDENTITY_LOCAL_KEYS]).not.toContain(
      DEVICE_ACCOUNT_SESSIONS_KEY,
    );
    expect([...DEVICE_IDENTITY_SESSION_KEYS]).not.toContain(
      DEVICE_ACCOUNT_SESSIONS_KEY,
    );

    // And it may never write one of those artifacts itself: a second writer of
    // `pubmax_handle` is a second chance to name the wrong person.
    const source = readFileSync(
      join(process.cwd(), "lib/deviceAccountSessions.ts"),
      "utf8",
    );
    for (const key of DEVICE_IDENTITY_LOCAL_KEYS) {
      expect(source).not.toContain(`"${key}"`);
    }
  });

  it("hands a reader a snapshot it can compare", () => {
    rememberDeviceAccount(local, { userId: "a", refreshToken: TOKEN_A }, 1_000);
    const first = deviceAccountsSnapshot(local);

    // `useSyncExternalStore` refuses an unstable snapshot, and a fresh array
    // every call is one. The string is the snapshot; the parse is derived.
    expect(deviceAccountsSnapshot(local)).toBe(first);
    expect(deviceAccountsSnapshot(null)).toBe("");
    expect(parseDeviceAccounts(first).map((row) => row.userId)).toEqual(["a"]);
  });
});
