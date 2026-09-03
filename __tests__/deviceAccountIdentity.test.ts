import { beforeEach, describe, expect, it } from "vitest";

import {
  bindDeviceAccountOwner,
  clearDeviceAccountArtifacts,
  deviceAccountOwner,
  DEVICE_ACCOUNT_OWNER_KEY,
  DEVICE_IDENTITY_LOCAL_KEYS,
  DEVICE_IDENTITY_SESSION_KEYS,
  releaseDeviceAccountOwner,
} from "@/lib/deviceAccountIdentity";
import { NIGHT_PROFILE_DEVICE_KEY } from "@/lib/nightProfileDeviceProvenance";

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

/** What account A leaves behind on a device it was signed into. */
function deviceAfterAccountA() {
  const local = fakeStorage({
    pubmax_handle: "karan",
    "pubmax:comment:handle": "karan",
    pubmax_round_anonymous_identity_v1: JSON.stringify({
      owner: "anonymous",
      handle: "karan",
    }),
    "pubmax:identityNudge:pending:v1": "plan",
    "pubmax:identityNudge:pendingAt:v1": "1",
    "pubmax:identityNudge:dismissedAt:v1": "1",
    "pubmax-badge-event-opt-ins": "some-event",
    [DEVICE_ACCOUNT_OWNER_KEY]: "user-a",
  });
  const session = fakeStorage({
    "pubmax:referral-follow-handle": "karan",
    "pubmax:arrival-welcome:v1": '{"intent":"signin","at":1}',
  });
  return { local, session };
}

describe("device account identity", () => {
  let device: ReturnType<typeof deviceAfterAccountA>;

  beforeEach(() => {
    device = deviceAfterAccountA();
  });

  it("names every artifact it is responsible for", () => {
    // A key added to either list without a home here would be cleared without
    // anyone knowing why, and a key MISSING from them is the whole defect.
    expect(DEVICE_IDENTITY_LOCAL_KEYS).toContain("pubmax_handle");
    expect(new Set(DEVICE_IDENTITY_LOCAL_KEYS).size).toBe(
      DEVICE_IDENTITY_LOCAL_KEYS.length,
    );
    expect(new Set(DEVICE_IDENTITY_SESSION_KEYS).size).toBe(
      DEVICE_IDENTITY_SESSION_KEYS.length,
    );
    expect(DEVICE_IDENTITY_LOCAL_KEYS).not.toContain(DEVICE_ACCOUNT_OWNER_KEY);
  });

  it("clears the previous account's whole set when a second account signs in", () => {
    expect(bindDeviceAccountOwner("user-b", device.local, device.session)).toBe(
      true,
    );
    for (const key of DEVICE_IDENTITY_LOCAL_KEYS) {
      expect(device.local.getItem(key)).toBeNull();
    }
    for (const key of DEVICE_IDENTITY_SESSION_KEYS) {
      expect(device.session.getItem(key)).toBeNull();
    }
    expect(deviceAccountOwner(device.local)).toBe("user-b");
  });

  it("leaves the set alone when the same account signs in again", () => {
    expect(bindDeviceAccountOwner("user-a", device.local, device.session)).toBe(
      false,
    );
    expect(device.local.getItem("pubmax_handle")).toBe("karan");
  });

  it("treats an unstamped device as somebody else's", () => {
    // The live browser on the day this ships: a cached handle nobody vouched
    // for. It may not act as this account; the canonical read re-establishes it.
    const local = fakeStorage({ pubmax_handle: "karan" });
    expect(bindDeviceAccountOwner("user-b", local)).toBe(true);
    expect(local.getItem("pubmax_handle")).toBeNull();
    expect(deviceAccountOwner(local)).toBe("user-b");
  });

  it("takes a MIRRORED Night Profile with the account, and leaves a typed one", () => {
    const mirrored = fakeStorage({
      [NIGHT_PROFILE_DEVICE_KEY]: JSON.stringify({
        version: 1,
        profile: {},
        source: "account",
      }),
    });
    clearDeviceAccountArtifacts(mirrored);
    expect(mirrored.getItem(NIGHT_PROFILE_DEVICE_KEY)).toBeNull();

    const typedHere = fakeStorage({
      [NIGHT_PROFILE_DEVICE_KEY]: JSON.stringify({
        version: 1,
        profile: {},
        source: "device",
      }),
    });
    clearDeviceAccountArtifacts(typedHere);
    expect(typedHere.getItem(NIGHT_PROFILE_DEVICE_KEY)).not.toBeNull();

    // "Saved on this device" predates the stamp: it stays device-scoped.
    const legacy = fakeStorage({
      [NIGHT_PROFILE_DEVICE_KEY]: JSON.stringify({ version: 1, profile: {} }),
    });
    clearDeviceAccountArtifacts(legacy);
    expect(legacy.getItem(NIGHT_PROFILE_DEVICE_KEY)).not.toBeNull();
  });

  it("sign-out drops the set AND the claim that anyone owns it", () => {
    releaseDeviceAccountOwner(device.local, device.session);
    expect(device.local.getItem("pubmax_handle")).toBeNull();
    expect(deviceAccountOwner(device.local)).toBeNull();
    // A sign-out followed by a fresh sign-in must not re-clear on a clean slate
    // and must stamp the arriving account.
    expect(bindDeviceAccountOwner("user-b", device.local, device.session)).toBe(
      true,
    );
    expect(deviceAccountOwner(device.local)).toBe("user-b");
  });

  it("survives blocked storage without throwing", () => {
    const blocked = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => bindDeviceAccountOwner("user-b", blocked)).not.toThrow();
    expect(() => releaseDeviceAccountOwner(blocked)).not.toThrow();
    expect(deviceAccountOwner(blocked)).toBeNull();
    expect(bindDeviceAccountOwner("", fakeStorage())).toBe(false);
  });
});
