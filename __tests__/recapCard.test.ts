import { describe, expect, it } from "vitest";

import {
  RECAP_OG_CACHE_HEADERS,
  endingLabel,
  formatNightDate,
  isApprovedShared,
  recapOgCacheHeaders,
  selectRecapCardData,
  type RecapCardStats,
} from "@/lib/recapCard";
import type { NightStory, NightStoryStatus, NightStoryVisibility } from "@/lib/nightMemory";

function story(
  status: NightStoryStatus,
  visibility: NightStoryVisibility,
  title = "The Bermondsey Loop",
): Pick<NightStory, "id" | "title" | "status" | "visibility"> {
  return { id: "s1", title, status, visibility };
}

const fullStats: RecapCardStats = {
  stopCount: 5,
  pintsLogged: 9,
  boroughsCrossed: 3,
  ending: "get_home",
  cheapestPintGbp: 4.2,
  crew: ["Sam", "Priya"],
  nightDateIso: "2026-07-12T23:30:00.000Z",
};

describe("recap card privacy gate — selectRecapCardData", () => {
  it("renders the FALLBACK for a missing story", () => {
    expect(selectRecapCardData({ story: null, stats: fullStats, nightDate: null })).toEqual({
      variant: "fallback",
    });
  });

  it("renders the FALLBACK for a private draft even with full stats present", () => {
    const result = selectRecapCardData({
      story: story("draft", "private") as NightStory,
      stats: fullStats,
      nightDate: fullStats.nightDateIso ?? null,
    });
    expect(result.variant).toBe("fallback");
  });

  it("renders the FALLBACK for a published-but-private story (no leak)", () => {
    const result = selectRecapCardData({
      story: story("published", "private") as NightStory,
      stats: fullStats,
      nightDate: null,
    });
    expect(result.variant).toBe("fallback");
  });

  it("renders the FALLBACK for an unlisted-but-unpublished (draft) story", () => {
    const result = selectRecapCardData({
      story: story("draft", "unlisted") as NightStory,
      stats: fullStats,
      nightDate: null,
    });
    expect(result.variant).toBe("fallback");
  });

  it("renders the RICH card for an approved-shared (published + public) story", () => {
    const result = selectRecapCardData({
      story: story("published", "public") as NightStory,
      stats: fullStats,
      nightDate: fullStats.nightDateIso ?? null,
    });
    expect(result.variant).toBe("rich");
    if (result.variant !== "rich") return;
    expect(result.title).toBe("The Bermondsey Loop");
    expect(result.stopCount).toBe(5);
    expect(result.pintsLogged).toBe(9);
    expect(result.boroughsCrossed).toBe(3);
    expect(result.endingLabel).toBe("Got home");
    expect(result.cheapestPint).toBe("£4.20");
    expect(result.crew).toEqual(["Sam", "Priya"]);
    expect(result.dateLabel).toBeTruthy();
  });

  it("renders the RICH card for a published + unlisted story", () => {
    const result = selectRecapCardData({
      story: story("published", "unlisted") as NightStory,
      stats: fullStats,
      nightDate: null,
    });
    expect(result.variant).toBe("rich");
  });

  it("renders a degraded RICH card (title only) when approved but no stats composed", () => {
    const result = selectRecapCardData({
      story: story("published", "public") as NightStory,
      stats: null,
      nightDate: null,
    });
    expect(result.variant).toBe("rich");
    if (result.variant !== "rich") return;
    expect(result.title).toBe("The Bermondsey Loop");
    expect(result.stopCount).toBeNull();
    expect(result.pintsLogged).toBeNull();
    expect(result.boroughsCrossed).toBeNull();
    expect(result.endingLabel).toBeNull();
    expect(result.cheapestPint).toBeNull();
    expect(result.crew).toEqual([]);
  });

  it("hides the ending (null label) when the public path could not source it", () => {
    const result = selectRecapCardData({
      story: story("published", "public") as NightStory,
      stats: { ...fullStats, ending: null },
      nightDate: null,
    });
    if (result.variant !== "rich") throw new Error("expected rich");
    expect(result.endingLabel).toBeNull();
    // Other stats still flow through.
    expect(result.pintsLogged).toBe(9);
  });
});

describe("recap card — untrusted stat hardening", () => {
  it("drops a non-positive cheapest pint to null (no bogus plaque)", () => {
    const result = selectRecapCardData({
      story: story("published", "public") as NightStory,
      stats: { ...fullStats, cheapestPintGbp: 0 },
      nightDate: null,
    });
    if (result.variant !== "rich") throw new Error("expected rich");
    expect(result.cheapestPint).toBeNull();
  });

  it("floors and caps insane counts instead of trusting them", () => {
    const result = selectRecapCardData({
      story: story("published", "public") as NightStory,
      stats: { ...fullStats, stopCount: 9999, boroughsCrossed: -4, pintsLogged: 7.8 },
      nightDate: null,
    });
    if (result.variant !== "rich") throw new Error("expected rich");
    expect(result.stopCount).toBe(20); // capped
    expect(result.boroughsCrossed).toBeNull(); // negative → dropped
    expect(result.pintsLogged).toBe(7); // floored
  });

  it("caps crew to 4 names and drops blanks (never leaks an unbounded roster)", () => {
    const result = selectRecapCardData({
      story: story("published", "public") as NightStory,
      stats: { ...fullStats, crew: ["A", "  ", "B", "C", "D", "E"] },
      nightDate: null,
    });
    if (result.variant !== "rich") throw new Error("expected rich");
    expect(result.crew).toEqual(["A", "B", "C", "D"]);
  });

  it("clamps an over-long title", () => {
    const long = "x".repeat(200);
    const result = selectRecapCardData({
      story: story("published", "public", long) as NightStory,
      stats: null,
      nightDate: null,
    });
    if (result.variant !== "rich") throw new Error("expected rich");
    expect(result.title.length).toBeLessThanOrEqual(64);
  });
});

describe("recap card helpers", () => {
  it("isApprovedShared matches only published + non-private", () => {
    expect(isApprovedShared(story("published", "public"))).toBe(true);
    expect(isApprovedShared(story("published", "unlisted"))).toBe(true);
    expect(isApprovedShared(story("published", "private"))).toBe(false);
    expect(isApprovedShared(story("draft", "public"))).toBe(false);
    expect(isApprovedShared(null)).toBe(false);
  });

  it("maps each ending to a short label", () => {
    expect(endingLabel("food")).toBe("Late food");
    expect(endingLabel("get_home")).toBe("Got home");
    expect(endingLabel("keep_going")).toBe("Kept going");
  });

  it("formats an ISO date and rejects garbage", () => {
    expect(formatNightDate("2026-07-12T23:30:00.000Z")).toMatch(/2026/);
    expect(formatNightDate("not-a-date")).toBeNull();
    expect(formatNightDate(null)).toBeNull();
  });

  it("uses a shorter shared-cache TTL for the rich (privacy-sensitive) card", () => {
    expect(recapOgCacheHeaders("rich")).toEqual({ "cache-control": RECAP_OG_CACHE_HEADERS.rich });
    expect(recapOgCacheHeaders("fallback")).toEqual({ "cache-control": RECAP_OG_CACHE_HEADERS.fallback });
    const richTtl = Number(/s-maxage=(\d+)/.exec(RECAP_OG_CACHE_HEADERS.rich)?.[1]);
    const fallbackTtl = Number(/s-maxage=(\d+)/.exec(RECAP_OG_CACHE_HEADERS.fallback)?.[1]);
    expect(richTtl).toBeLessThan(fallbackTtl);
  });
});
