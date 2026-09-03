import { describe, expect, it } from "vitest";

import {
  parseSocialShellSearch,
  socialFeedRequestHref,
  socialShellHref,
} from "@/lib/socialShell";

describe("Social shell URL state", () => {
  it("defaults to chronological Following posts", () => {
    expect(parseSocialShellSearch("")).toEqual({
      valid: true,
      tab: "posts",
      feed: "following",
      area: null,
    });
    expect(
      socialShellHref({ tab: "posts", feed: "following", area: null }),
    ).toBe("/social");
  });

  it("round-trips each canonical surface without cursor or identity state", () => {
    expect(parseSocialShellSearch("feed=discover")).toEqual({
      valid: true,
      tab: "posts",
      feed: "discover",
      area: null,
    });
    expect(parseSocialShellSearch("feed=nearby&area=camden")).toEqual({
      valid: true,
      tab: "posts",
      feed: "nearby",
      area: "camden",
    });
    expect(parseSocialShellSearch("tab=discover")).toEqual({
      valid: true,
      tab: "discover",
      feed: null,
      area: null,
    });

    expect(
      socialShellHref({ tab: "posts", feed: "discover", area: null }),
    ).toBe("/social?feed=discover");
    expect(
      socialShellHref({ tab: "posts", feed: "nearby", area: "camden" }),
    ).toBe("/social?feed=nearby&area=camden");
    expect(socialShellHref({ tab: "discover", feed: null, area: null })).toBe(
      "/social?tab=discover",
    );
  });

  it("allows Nearby to wait for a listed area without authorising a read", () => {
    expect(parseSocialShellSearch("feed=nearby")).toEqual({
      valid: true,
      tab: "posts",
      feed: "nearby",
      area: null,
    });
    expect(
      socialFeedRequestHref({
        valid: true,
        tab: "posts",
        feed: "nearby",
        area: null,
      }),
    ).toBeNull();
  });

  it("keeps the viewer-bound cursor in the API request and out of shell URLs", () => {
    expect(
      socialFeedRequestHref(
        {
          valid: true,
          tab: "posts",
          feed: "nearby",
          area: "camden",
        },
        "viewer-bound-cursor",
      ),
    ).toBe(
      "/api/social/posts?lane=nearby&area=camden&limit=20&cursor=viewer-bound-cursor",
    );
    expect(
      socialFeedRequestHref({
        valid: true,
        tab: "discover",
        feed: null,
        area: null,
      }),
    ).toBeNull();
    expect(
      socialShellHref({ tab: "posts", feed: "nearby", area: "camden" }),
    ).not.toContain("cursor");
  });

  it.each([
    "tab=unknown",
    "feed=ranked",
    "area=camden",
    "feed=nearby&area=not-a-listed-area",
    "tab=discover&feed=following",
    "tab=discover&area=camden",
    "feed=nearby&feed=discover",
    "tab=discover&tab=discover",
    "cursor=private-cursor",
    "handle=alice",
    "lat=51.5&lng=-0.1",
  ])("fails closed for %s", (search) => {
    expect(parseSocialShellSearch(search)).toEqual({
      valid: false,
      tab: "posts",
      feed: "following",
      area: null,
    });
  });
});
