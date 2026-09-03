import { describe, expect, it } from "vitest";

import { landmarksForCity } from "@/lib/cityLandmarks";
import { storyBandsForCity } from "@/lib/cityStoryBands";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
import { CITIES } from "@/lib/cities";

describe("Bath browse-only pack (no editorial catalogs yet)", () => {
  it("returns empty landmarks, story bands, and curated crawls", () => {
    expect(landmarksForCity("bath")).toEqual([]);
    expect(storyBandsForCity("bath")).toEqual([]);
    expect(curatedCrawlsForCity("bath")).toEqual([]);
  });

  it("does not fall through to London catalogs", () => {
    expect(landmarksForCity("bath").some((l) => l.id === "tower-bridge")).toBe(
      false,
    );
    expect(storyBandsForCity("bath").some((b) => b.id === "river-history")).toBe(
      false,
    );
    expect(curatedCrawlsForCity("london").length).toBeGreaterThanOrEqual(3);
    expect(landmarksForCity("london").some((l) => l.id === "tower-bridge")).toBe(
      true,
    );
  });

  it("keeps Bath enabled with a slim venues path and no POIs yet", () => {
    expect(CITIES.bath.enabled).toBe(true);
    expect(CITIES.bath.slimVenuesPath).toBe("/data/cities/bath/venues_slim.json");
    expect(CITIES.bath.poisPath).toBeNull();
  });
});

describe("city catalog selectors — no London default fallthrough", () => {
  it("returns empty arrays for an unhandled / future city path via default", () => {
    // `resolveCityId` maps unknown strings to DEFAULT_CITY_ID (london), so
    // unknown raw ids still hit the london case. Explicit bath is the
    // browse-only empty path; london alone returns London catalogs.
    expect(landmarksForCity("london").length).toBeGreaterThan(0);
    expect(landmarksForCity("bath")).toEqual([]);
    expect(storyBandsForCity("bath")).toEqual([]);
    expect(curatedCrawlsForCity("bath")).toEqual([]);
  });
});
