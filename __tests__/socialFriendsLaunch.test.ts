import { describe, expect, it } from "vitest";

import {
  decideFriendsLaunchSocialAccess,
} from "@/lib/socialAccess";
import {
  accountIsAdult,
  isAdultDateOfBirth,
  isRecordedAdultAssertion,
  isSocialFriendsLaunchEnabled,
  needsAdultSelfAssertion,
  socialDocumentRobots,
  socialListedInSitemap,
} from "@/lib/socialLaunch";

const NOW = "2026-08-05T20:00:00.000Z";

describe("friends-launch Social access policy", () => {
  it("keeps the launch flag off at preview", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: false,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "1990-01-01",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("preview");
  });

  it("requires a Supabase session when the launch flag is on", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: null,
        claimedHandle: null,
        dateOfBirth: null,
        ownershipState: null,
        now: NOW,
      }),
    ).toBe("sign_in_required");
  });

  it("requires a claimed handle and adult date of birth", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: null,
        dateOfBirth: "1990-01-01",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("age_verification_required");

    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: null,
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("age_verification_required");

    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "2015-02-03",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("age_verification_required");
  });

  it("grants verified access for an adult with a claimed handle", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "1990-01-01",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("verified");
  });

  it("grants verified access on a recorded assertion with no date of birth", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: null,
        adultSelfAssertedAt: "2026-08-10T18:00:00.000Z",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("verified");
  });

  it("lets a stored under-18 date of birth outrank an assertion", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "2015-02-03",
        adultSelfAssertedAt: "2026-08-10T18:00:00.000Z",
        ownershipState: "active",
        now: NOW,
      }),
    ).toBe("age_verification_required");
  });

  it("keeps suspended accounts closed", () => {
    expect(
      decideFriendsLaunchSocialAccess({
        friendsLaunchEnabled: true,
        supabaseUserId: "user-1",
        claimedHandle: "alice",
        dateOfBirth: "1990-01-01",
        ownershipState: "suspended",
        now: NOW,
      }),
    ).toBe("suspended");
  });
});

describe("friends-launch flag parser", () => {
  it("keeps Social live unless an explicit zero rolls it back", () => {
    expect(isSocialFriendsLaunchEnabled("1")).toBe(true);
    expect(isSocialFriendsLaunchEnabled(undefined)).toBe(true);
    expect(isSocialFriendsLaunchEnabled("")).toBe(true);
    expect(isSocialFriendsLaunchEnabled("true")).toBe(true);
    expect(isSocialFriendsLaunchEnabled("0")).toBe(false);
  });
});

describe("adult date of birth", () => {
  it("treats 18-year-olds as adults on their birthday", () => {
    expect(isAdultDateOfBirth("2008-08-05", Date.parse(NOW))).toBe(true);
    expect(isAdultDateOfBirth("2008-08-06", Date.parse(NOW))).toBe(false);
  });
});

describe("the one adult gate", () => {
  const now = Date.parse(NOW);

  it("passes a recorded self-assertion with no date of birth", () => {
    expect(
      accountIsAdult(
        { dateOfBirth: null, adultSelfAssertedAt: "2026-08-10T18:00:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("passes a stored adult date of birth with no assertion", () => {
    expect(
      accountIsAdult({ dateOfBirth: "1990-01-01", adultSelfAssertedAt: null }, now),
    ).toBe(true);
  });

  it("asks for the one tap when neither answer exists", () => {
    expect(accountIsAdult({}, now)).toBe(false);
    expect(accountIsAdult({ dateOfBirth: "  ", adultSelfAssertedAt: "" }, now)).toBe(
      false,
    );
    expect(needsAdultSelfAssertion({})).toBe(true);
    expect(
      needsAdultSelfAssertion({ dateOfBirth: null, adultSelfAssertedAt: null }),
    ).toBe(true);
  });

  it("never offers the tap once either answer exists", () => {
    // A recorded assertion is answered, so nobody is asked twice.
    expect(
      needsAdultSelfAssertion({ adultSelfAssertedAt: "2026-08-10T18:00:00.000Z" }),
    ).toBe(false);
    // A stored under-18 date of birth is answered too. Offering a tap that
    // would not be honoured is worse than the plain refusal.
    expect(needsAdultSelfAssertion({ dateOfBirth: "2015-02-03" })).toBe(false);
    expect(
      accountIsAdult(
        { dateOfBirth: "2015-02-03", adultSelfAssertedAt: "2026-08-10T18:00:00.000Z" },
        now,
      ),
    ).toBe(false);
  });

  it("counts only a real instant as a recorded assertion", () => {
    expect(isRecordedAdultAssertion("2026-08-10T18:00:00.000Z")).toBe(true);
    for (const value of [null, undefined, "", "   ", "yes", "true"]) {
      expect(isRecordedAdultAssertion(value)).toBe(false);
    }
  });
});

describe("Social indexing", () => {
  it("noindexes Social while the friends launch flag is off", () => {
    expect(socialDocumentRobots(false)).toEqual({ index: false, follow: true });
    expect(socialListedInSitemap(false)).toBe(false);
  });

  it("indexes Social once the friends launch flag is on", () => {
    expect(socialDocumentRobots(true)).toEqual({ index: true, follow: true });
    expect(socialListedInSitemap(true)).toBe(true);
  });

  it("reads the same env the nav already uses", () => {
    expect(isSocialFriendsLaunchEnabled(undefined)).toBe(true);
    expect(isSocialFriendsLaunchEnabled("1")).toBe(true);
    expect(socialListedInSitemap(isSocialFriendsLaunchEnabled(undefined))).toBe(true);
    expect(socialListedInSitemap(isSocialFriendsLaunchEnabled("1"))).toBe(true);
  });
});
