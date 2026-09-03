import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/profile/PubmaxxAccountHub", () => ({
  default: () => createElement("div", null, "account hub"),
}));
vi.mock("@/components/wanted/WantedList", () => ({
  default: () => createElement("div", null, "wanted list"),
}));

import {
  ProfileFollowBoundary,
  profileSocialDataForLaunch,
  profileSurfaceFor,
  YouSignedOutSurface,
} from "@/app/u/[handle]/ProfilePageClient";

describe("signed-out /u/you surface", () => {
  it("shows a sign-in boundary instead of an unusable Follow button", () => {
    const html = renderToStaticMarkup(createElement(ProfileFollowBoundary, {
      friendsLaunchEnabled: true,
      isAnonymous: true,
      routeHandle: "alice",
      viewerHandle: "",
      following: false,
      followsViewer: false,
      onCountsChange: () => undefined,
    }));

    expect(html).toContain("Sign in to follow");
    expect(html).toContain("/login?mode=signin&amp;from=%2Fu%2Falice");
    expect(html).not.toContain("followBtn");
  });

  it("removes cached Social state during rollback", () => {
    const data = {
      socialLinks: [{
        provider: "website" as const,
        label: "Website",
        mark: "WW",
        username: "example.test",
        profileUrl: "https://example.test/",
      }],
      counts: { followers: 4, following: 2 },
      following: true,
      followsViewer: true,
    };

    expect(profileSocialDataForLaunch(false, data)).toEqual({
      socialLinks: [],
      counts: null,
      following: false,
      followsViewer: false,
    });
    expect(profileSocialDataForLaunch(true, data)).toBe(data);
  });

  it("keeps the account invitation ahead of a failed public read", () => {
    const surface = profileSurfaceFor({
      routeHandle: "you",
      identityResolved: true,
      hasUser: false,
      viewerHandle: "",
      state: "error",
    });
    const html = renderToStaticMarkup(
      createElement(YouSignedOutSurface, { nightMemoriesInvite: false }),
    );

    expect(surface).toBe("you-invitation");
    expect(html).toContain("Make the night yours.");
    expect(html).toContain("Claim your @handle");
    expect(html).not.toContain("@you");
    expect(html).not.toContain("Couldn&#x27;t load pints");
    expect(html).not.toContain("profileErrorState");
  });
});
