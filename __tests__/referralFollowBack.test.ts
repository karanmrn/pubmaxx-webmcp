// WP7 invite follow-back: session-scoped inviter handle + You-page affordance.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  REFERRAL_FOLLOW_HANDLE_KEY,
  clearReferralFollowHandle,
  readReferralFollowHandle,
  storeReferralFollowHandle,
} from "@/lib/referralFollowBack";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
});

describe("referralFollowBack session key", () => {
  it("stores a normalized handle and clears it", () => {
    storeReferralFollowHandle("@Host_Mate");
    expect(readReferralFollowHandle()).toBe("host_mate");
    expect(storage.get(REFERRAL_FOLLOW_HANDLE_KEY)).toBe("host_mate");
    clearReferralFollowHandle();
    expect(readReferralFollowHandle()).toBeNull();
  });

  it("ignores empty junk", () => {
    storeReferralFollowHandle("@@@");
    expect(readReferralFollowHandle()).toBeNull();
  });
});

describe("ReferralFollowBack surface", () => {
  const tsx = readFileSync(
    join(process.cwd(), "components/social/ReferralFollowBack.tsx"),
    "utf8",
  );
  const claimClient = readFileSync(
    join(process.cwd(), "lib/referralClaimClient.ts"),
    "utf8",
  );
  const hub = readFileSync(
    join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
    "utf8",
  );

  it("offers Follow via /add/[handle] and mounts on the You hub", () => {
    expect(tsx).toContain("Follow {displayHandle(inviterHandle)}");
    expect(tsx).toContain("`/add/${encodeURIComponent(inviterHandle)}`");
    expect(tsx).toMatch(/Not now/);
    expect(hub).toMatch(/ReferralFollowBack/);
  });

  it("claim success stores the inviter handle for follow-back", () => {
    expect(claimClient).toMatch(/storeReferralFollowHandle/);
    expect(claimClient).toMatch(/inviterHandle/);
  });
});
