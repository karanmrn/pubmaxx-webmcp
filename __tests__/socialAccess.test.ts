import { describe, expect, it } from "vitest";

import { decideFriendsLaunchSocialAccess } from "@/lib/socialAccess";

const NOW = "2026-08-29T20:00:00.000Z";

describe("Social access policy", () => {
  it("requires sign-in before a Social account can open", () => {
    expect(decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: true,
      supabaseUserId: null,
      claimedHandle: null,
      dateOfBirth: null,
      ownershipState: null,
      now: NOW,
    })).toBe("sign_in_required");
  });

  it("requires a claimed handle and adult evidence", () => {
    expect(decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: true,
      supabaseUserId: "user-1",
      claimedHandle: null,
      dateOfBirth: "1990-01-01",
      ownershipState: "active",
      now: NOW,
    })).toBe("age_verification_required");
    expect(decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: true,
      supabaseUserId: "user-1",
      claimedHandle: "alice",
      dateOfBirth: "2015-02-03",
      ownershipState: "active",
      now: NOW,
    })).toBe("age_verification_required");
  });

  it("grants access for an adult account with a claimed handle", () => {
    expect(decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: true,
      supabaseUserId: "user-1",
      claimedHandle: "alice",
      dateOfBirth: "1990-01-01",
      ownershipState: "active",
      now: NOW,
    })).toBe("verified");
  });

  it("accepts one recorded adult assertion without a DOB", () => {
    expect(decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: true,
      supabaseUserId: "user-1",
      claimedHandle: "alice",
      dateOfBirth: null,
      adultSelfAssertedAt: "2026-08-10T18:00:00.000Z",
      ownershipState: "active",
      now: NOW,
    })).toBe("verified");
  });

  it("keeps explicit rollback mode at preview", () => {
    expect(decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: false,
      supabaseUserId: "user-1",
      claimedHandle: "alice",
      dateOfBirth: "1990-01-01",
      ownershipState: "active",
      now: NOW,
    })).toBe("preview");
  });
});
