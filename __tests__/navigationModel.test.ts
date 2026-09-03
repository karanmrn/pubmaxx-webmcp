import { describe, expect, it } from "vitest";

import {
  MOMENT_NAV_ACTION,
  PRIMARY_NAV_ITEMS,
  momentHref,
  navPathMatches,
  primaryNavKeyForPath,
  safeMomentReturnTo,
} from "@/components/nav/navigationModel";

describe("PUBMAXX primary navigation", () => {
  it("keeps five destinations and models Moment separately", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ label }) => label)).toEqual([
      "Now",
      "Map",
      "Out",
      "Social",
      "You",
    ]);
    expect(MOMENT_NAV_ACTION).toMatchObject({ label: "Moment", href: "/moment" });
  });

  it("keeps capture separate from the map and sends Social to its canonical shell", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ href }) => href)).toEqual([
      "/today",
      "/map",
      "/out",
      "/social",
      "/u/you",
    ]);
    expect(PRIMARY_NAV_ITEMS.find((item) => item.key === "now")?.match).toEqual([
      "/today",
      "/tonight",
    ]);
  });

  it("lights Social for its canonical route and aliases, not for borough pages", () => {
    const social = PRIMARY_NAV_ITEMS.find((item) => item.key === "social");
    expect(social?.match).toEqual([
      "/social",
      "/discover",
      "/drinks",
      "/feed",
      "/stories",
      "/crawls",
    ]);
    expect(primaryNavKeyForPath("/social")).toBe("social");
    expect(primaryNavKeyForPath("/feed")).toBe("social");
    expect(primaryNavKeyForPath("/feed/friends")).toBe("social");
    expect(primaryNavKeyForPath("/stories")).toBe("social");
    expect(primaryNavKeyForPath("/discover")).toBe("social");
    expect(primaryNavKeyForPath("/drinks")).toBe("social");
    expect(primaryNavKeyForPath("/crawls/soho")).toBe("social");
    expect(primaryNavKeyForPath("/borough")).toBeUndefined();
    expect(primaryNavKeyForPath("/borough/soho")).toBeUndefined();
    expect(navPathMatches("/social", social!.match)).toBe(true);
  });

  it("accepts only safe Moment return destinations", () => {
    expect(momentHref("/social")).toBe("/moment?returnTo=%2Fsocial");
    expect(safeMomentReturnTo("https://example.com/steal")).toBe("/map");
    expect(safeMomentReturnTo("/u/you?tab=moments")).toBe("/u/you?tab=moments");
    expect(safeMomentReturnTo("/map/manchester?sel=pub-1#sheet")).toBe("/map/manchester?sel=pub-1#sheet");
    expect(safeMomentReturnTo("/moment?returnTo=/admin")).toBe("/map");
  });
});
