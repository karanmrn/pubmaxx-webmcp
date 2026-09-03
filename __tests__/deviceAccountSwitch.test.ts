// Making a remembered account the active one.
//
// THE LAW UNDER TEST: the switcher changes WHICH session is active and never how
// identity binds. So the swap is a token exchange plus `setSession`, and the one
// atomic device-identity pass stays where it already lives
// (`AuthProvider.updateSession`). A second binder here would be a second chance
// to name the wrong person.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEVICE_IDENTITY_LOCAL_KEYS } from "@/lib/deviceAccountIdentity";
import {
  readDeviceAccounts,
  rememberDeviceAccount,
} from "@/lib/deviceAccountSessions";
import {
  activateDeviceAccount,
  mintSessionFromRefreshToken,
  parseMintedSession,
  type DeviceAccountSwitchDeps,
} from "@/lib/deviceAccountSwitch";

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

const STORED_TOKEN = "stored-refresh-token-for-b";
const ROTATED_TOKEN = "rotated-refresh-token-for-b";

const AUTH_CONFIG = {
  url: "https://project.supabase.co",
  key: "publishable-key",
};

function mintedBody(refreshToken = ROTATED_TOKEN) {
  return {
    access_token: "fresh-access-token",
    refresh_token: refreshToken,
    expires_in: 3600,
    token_type: "bearer",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deps(
  overrides: Partial<DeviceAccountSwitchDeps> & {
    storage: DeviceAccountSwitchDeps["storage"];
  },
): DeviceAccountSwitchDeps {
  return {
    fetchImpl: vi.fn(async () => jsonResponse(mintedBody())) as typeof fetch,
    authConfig: AUTH_CONFIG,
    setSession: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("minting a session from a stored refresh token", () => {
  it("asks GoTrue's own token endpoint, with the publishable key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(mintedBody()));
    const outcome = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      authConfig: AUTH_CONFIG,
    });

    expect(outcome).toEqual({ status: "minted", session: mintedBody() });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://project.supabase.co/auth/v1/token?grant_type=refresh_token",
    );
    expect((init.headers as Record<string, string>).apikey).toBe("publishable-key");
    expect(init.body).toBe(JSON.stringify({ refresh_token: STORED_TOKEN }));
  });

  it("separates a refused token from a question we could not ask", async () => {
    const refused = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => jsonResponse({ error: "invalid" }, 400)) as typeof fetch,
      authConfig: AUTH_CONFIG,
    });
    expect(refused.status).toBe("refused");

    const server = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => jsonResponse({}, 503)) as typeof fetch,
      authConfig: AUTH_CONFIG,
    });
    expect(server.status).toBe("unavailable");

    const offline = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
      authConfig: AUTH_CONFIG,
    });
    expect(offline.status).toBe("unavailable");

    const keyless = await mintSessionFromRefreshToken(STORED_TOKEN, {
      fetchImpl: (async () => jsonResponse(mintedBody())) as typeof fetch,
      authConfig: null,
    });
    expect(keyless.status).toBe("unavailable");
  });

  it("refuses an answer carrying no way to renew", () => {
    expect(parseMintedSession({ access_token: "only-this" })).toBeNull();
    expect(parseMintedSession({ refresh_token: "only-this" })).toBeNull();
    expect(parseMintedSession(null)).toBeNull();
    expect(parseMintedSession(mintedBody())).toEqual(mintedBody());
  });
});

describe("activating a remembered account", () => {
  let local: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    local = fakeStorage();
    rememberDeviceAccount(local, { userId: "b", refreshToken: STORED_TOKEN }, 2_000);
  });

  it("installs the minted session and lets the auth event do the rest", async () => {
    const setSession = vi.fn(async () => ({ ok: true }));
    const outcome = await activateDeviceAccount("b", deps({ storage: local, setSession }));

    expect(outcome).toEqual({ status: "switched", userId: "b" });
    expect(setSession).toHaveBeenCalledWith(mintedBody());
  });

  it("writes the rotated token before installing it", async () => {
    // GoTrue spends a refresh token on use. A crash between the exchange and the
    // install would otherwise leave this device holding a token that can never
    // work again, so the row is updated first: a minted-but-uninstalled token is
    // still good for the next attempt.
    let tokenAtInstall: string | null = null;
    await activateDeviceAccount(
      "b",
      deps({
        storage: local,
        setSession: async () => {
          tokenAtInstall = readDeviceAccounts(local)[0]?.refreshToken ?? null;
          return { ok: true };
        },
      }),
    );

    expect(tokenAtInstall).toBe(ROTATED_TOKEN);
    expect(local.values.get("pubmax_device_sessions_v1")).not.toContain(STORED_TOKEN);
  });

  it("retires a refused token and asks its owner to sign in", async () => {
    const outcome = await activateDeviceAccount(
      "b",
      deps({
        storage: local,
        fetchImpl: (async () => jsonResponse({ error: "invalid" }, 400)) as typeof fetch,
      }),
    );

    expect(outcome).toEqual({ status: "needs_sign_in", userId: "b" });
    const [row] = readDeviceAccounts(local);
    expect(row?.userId).toBe("b");
    expect(row?.refreshToken).toBeNull();
  });

  it("keeps a token it could not ask about, and installs nothing", async () => {
    const setSession = vi.fn(async () => ({ ok: true }));
    const outcome = await activateDeviceAccount(
      "b",
      deps({
        storage: local,
        setSession,
        fetchImpl: (async () => jsonResponse({}, 503)) as typeof fetch,
      }),
    );

    // A network fault is not evidence a credential died, and the live session is
    // untouched either way: only a successful mint ever reaches `setSession`.
    expect(outcome).toEqual({ status: "unavailable" });
    expect(setSession).not.toHaveBeenCalled();
    expect(readDeviceAccounts(local)[0]?.refreshToken).toBe(STORED_TOKEN);
  });

  it("answers needs-sign-in for an account this device does not hold", async () => {
    expect(await activateDeviceAccount("nobody", deps({ storage: local }))).toEqual({
      status: "needs_sign_in",
      userId: "nobody",
    });

    rememberDeviceAccount(local, { userId: "c", refreshToken: null }, 3_000);
    expect(await activateDeviceAccount("c", deps({ storage: local }))).toEqual({
      status: "needs_sign_in",
      userId: "c",
    });
  });

  it("reports a refused install rather than claiming a switch", async () => {
    const outcome = await activateDeviceAccount(
      "b",
      deps({ storage: local, setSession: async () => ({ ok: false }) }),
    );

    expect(outcome).toEqual({ status: "unavailable" });
  });
});

/**
 * The module with its comments removed. The header explains at length what this
 * code deliberately does NOT call, so a fence reading raw source would fail on
 * the very sentence that documents the rule.
 */
function codeOnly(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("the switch never binds identity itself", () => {
  const source = codeOnly("lib/deviceAccountSwitch.ts");

  it("writes no device identity artifact and stamps no owner", () => {
    for (const key of DEVICE_IDENTITY_LOCAL_KEYS) {
      expect(source).not.toContain(`"${key}"`);
    }
    expect(source).not.toContain("bindDeviceAccountOwner");
    expect(source).not.toContain("releaseDeviceAccountOwner");
    expect(source).not.toContain("pubmax_account_owner");
  });

  it("touches neither the durable resume cookie nor its route", () => {
    // The cookie mirrors the ACTIVE account only, and it follows a switch the
    // same way it follows every other sign-in: `setSession` fires SIGNED_IN and
    // AuthProvider re-persists. A second writer here could mirror the account
    // being left behind.
    expect(source).not.toContain("/api/auth/session");
    expect(source).not.toContain("persistSessionForResume");
    expect(source).not.toContain("clearPersistedSession");
  });

  it("leaves the one binder where it already was", () => {
    const provider = codeOnly("components/auth/AuthProvider.tsx");

    // `updateSession` is THE boundary: it binds the device owner before any
    // child re-renders on the new session. A switch reaches it the ordinary way,
    // through the auth event, so this call must stay exactly one call.
    expect(provider.match(/bindDeviceAccountOwner\(/g) ?? []).toHaveLength(1);
    // The lane is written where the durable cookie is written, on the same
    // events, because both mirror the same refresh token.
    expect(provider).toContain("rememberDeviceAccount(");
    expect(provider).toContain("persistSessionWithRetry(");
  });

  it("finishes the cookie delete before handing the device on", () => {
    const provider = codeOnly("components/auth/AuthProvider.tsx");

    // An account sign-out may activate the next remembered account, whose
    // SIGNED_IN persists a new cookie. A DELETE still in flight would land after
    // that persist and leave the device with no durable session at all.
    expect(provider).toContain("await clearPersistedSession()");
    expect(provider).not.toContain("void clearPersistedSession()");

    const signedOutAt = provider.indexOf("await supabase.auth.signOut()");
    const activatedAt = provider.indexOf("await activateDeviceAccount(");
    expect(signedOutAt).toBeGreaterThan(-1);
    expect(activatedAt).toBeGreaterThan(signedOutAt);
  });

  it("scopes the way out to this account or to the whole device", () => {
    const provider = codeOnly("components/auth/AuthProvider.tsx");

    expect(provider).toContain("forgetAllDeviceAccounts(");
    expect(provider).toContain("forgetDeviceAccount(");
    // A device-wide sign-out empties the lane and stops there: activating a next
    // account would undo the very thing that was asked for.
    expect(provider).toContain('if (scope === "device") return;');
  });

  it("does not refresh through the live client, which could tear it down", () => {
    // `auth.refreshSession` removes the stored session when a refresh fails and
    // the access token has already expired, so a dead token on the account being
    // switched TO would sign the person out of the account they are switching
    // FROM. A bare exchange cannot reach the live session at all.
    expect(source).not.toContain("refreshSession");
  });
});
