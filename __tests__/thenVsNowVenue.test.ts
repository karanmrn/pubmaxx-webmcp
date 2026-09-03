import { describe, it, expect } from "vitest";

import {
  computeVenuePriceStory,
  cpiIndexForYear,
  inflateToToday,
  parseEraYear,
  INFLATION_TODAY_YEAR,
  type VenuePriceStoryDrop,
} from "@/lib/thenVsNow";
import type { Venue } from "@/lib/venues";
import type { Provenance } from "@/lib/curation";

// computeVenuePriceStory only reads id/name/cheapestPrice/curation, so a partial
// cast keeps fixtures readable without spelling out every Venue field.
function v(
  over: Partial<Venue> & { id: string; name: string; cheapestPrice: number | null },
): Venue {
  return {
    primaryBorough: "",
    visibleBoroughs: [],
    cheapestPint: "",
    curation: {},
    ...over,
  } as Venue;
}

function drop(
  over: Partial<VenuePriceStoryDrop> & { venueId: string; provenance: Provenance },
): VenuePriceStoryDrop {
  return {
    priceGbp: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    era: "",
    handle: "someone",
    ...over,
  };
}

describe("parseEraYear", () => {
  it("pulls a bare 4-digit year out of a free-text era", () => {
    expect(parseEraYear("The wedding, 1971")).toBe(1971);
    expect(parseEraYear("Dad started drinking here in 2003")).toBe(2003);
  });

  it("resolves a decade tag to its midpoint", () => {
    expect(parseEraYear("Dad's rule, 1980s")).toBe(1985);
    expect(parseEraYear("Nan's shift, 1950s")).toBe(1955);
    expect(parseEraYear("Told since the 2010s")).toBe(2015);
  });

  it("prefers a decade over the bare year inside it", () => {
    // "1980s" contains "1980"; the decade midpoint must win, not 1980.
    expect(parseEraYear("1980s")).toBe(1985);
  });

  it("returns null for undated / out-of-range / non-string eras", () => {
    expect(parseEraYear("High-tide advice")).toBeNull();
    expect(parseEraYear("")).toBeNull();
    expect(parseEraYear(null)).toBeNull();
    expect(parseEraYear(undefined)).toBeNull();
    expect(parseEraYear("Back in 1850")).toBeNull(); // before the 1900 floor
    expect(parseEraYear("£5 a pint")).toBeNull(); // a price is not a year
  });
});

describe("cpiIndexForYear", () => {
  it("returns the exact index at an anchor year", () => {
    expect(cpiIndexForYear(2015)).toBe(100);
    expect(cpiIndexForYear(INFLATION_TODAY_YEAR)).toBeGreaterThan(100);
  });

  it("interpolates linearly between anchors", () => {
    // 1990 = 58.2, 2000 = 74.8 → 1995 is the midpoint.
    expect(cpiIndexForYear(1995)).toBeCloseTo((58.2 + 74.8) / 2, 5);
  });

  it("clamps outside the covered range", () => {
    expect(cpiIndexForYear(1800)).toBe(cpiIndexForYear(1950));
    expect(cpiIndexForYear(3000)).toBe(cpiIndexForYear(INFLATION_TODAY_YEAR));
  });

  it("returns null for a non-finite year", () => {
    expect(cpiIndexForYear(Number.NaN)).toBeNull();
  });
});

describe("inflateToToday", () => {
  it("revalues an older price UP into today's money", () => {
    const today = inflateToToday(2, 1990);
    expect(today).not.toBeNull();
    // 1990 money is worth more today, so £2 then > £2 now.
    expect(today as number).toBeGreaterThan(2);
  });

  it("is the identity at the today year", () => {
    expect(inflateToToday(4.5, INFLATION_TODAY_YEAR)).toBe(4.5);
  });

  it("rounds to the penny", () => {
    const value = inflateToToday(1.23, 1985);
    expect(value).not.toBeNull();
    expect(Math.round((value as number) * 100)).toBe((value as number) * 100);
  });

  it("returns null for an unusable amount", () => {
    expect(inflateToToday(Number.NaN, 1990)).toBeNull();
  });
});

describe("computeVenuePriceStory", () => {
  it("resolves baseline, now, delta and inflation together", () => {
    const venue = v({ id: "v1", name: "The Anchor", cheapestPrice: 4 });
    const drops = [
      drop({
        venueId: "v1",
        priceGbp: 6,
        provenance: "contributor",
        createdAt: "2026-06-01T00:00:00.000Z",
      }),
      drop({
        venueId: "v1",
        priceGbp: 1.2,
        era: "Dad's round, 1985",
        provenance: "anecdote",
        handle: "@ken",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const story = computeVenuePriceStory(venue, drops);

    expect(story.isEmpty).toBe(false);
    expect(story.baseline).toEqual({
      gbp: 4,
      provenance: "sourced",
      label: "Baseline on record",
    });
    // "now" is the newest priced drop (the £6 contributor).
    expect(story.now?.gbp).toBe(6);
    expect(story.now?.provenance).toBe("contributor");
    expect(story.deltaGbp).toBe(2);
    expect(story.pct).toBe(50);

    // Inflation anchor is the dated 1985 anecdote, revalued up into today.
    expect(story.inflation?.year).toBe(1985);
    expect(story.inflation?.thenGbp).toBe(1.2);
    expect(story.inflation?.todayGbp as number).toBeGreaterThan(1.2);
    expect(story.inflation?.provenance).toBe("anecdote");
    expect(story.inflation?.handle).toBe("@ken");
    expect(story.inflation?.todayYear).toBe(INFLATION_TODAY_YEAR);
  });

  it("picks the OLDEST dated priced drop as the inflation anchor", () => {
    const venue = v({ id: "v2", name: "Old Bell", cheapestPrice: 5 });
    const drops = [
      drop({ venueId: "v2", priceGbp: 2, era: "1990s", provenance: "anecdote" }),
      drop({ venueId: "v2", priceGbp: 0.5, era: "1960s", provenance: "anecdote" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.inflation?.year).toBe(1965); // 1960s midpoint — the deepest look back
    expect(story.inflation?.thenGbp).toBe(0.5);
  });

  it("carries a demo drop's provenance through without flattening it", () => {
    const venue = v({ id: "v3", name: "Demo Arms", cheapestPrice: 3 });
    const drops = [
      drop({ venueId: "v3", priceGbp: 1, era: "1980s", provenance: "demo" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.inflation?.provenance).toBe("demo");
    expect(story.now?.provenance).toBe("demo");
  });

  it("honours a venue's own curation provenance on the baseline", () => {
    const venue = v({
      id: "v4",
      name: "Seeded Tap",
      cheapestPrice: 4,
      curation: { provenance: "demo" },
    });
    const story = computeVenuePriceStory(venue, []);
    expect(story.baseline?.provenance).toBe("demo");
  });

  it("skips the inflation line when no drop carries both a price and a dated era", () => {
    const venue = v({ id: "v5", name: "Undated", cheapestPrice: 4 });
    const drops = [
      // priced but undated
      drop({ venueId: "v5", priceGbp: 5, era: "High-tide advice", provenance: "contributor" }),
      // dated but unpriced
      drop({ venueId: "v5", priceGbp: null, era: "1975", provenance: "anecdote" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.inflation).toBeNull();
    // …but the baseline + now still resolve.
    expect(story.baseline?.gbp).toBe(4);
    expect(story.now?.gbp).toBe(5);
    expect(story.isEmpty).toBe(false);
  });

  it("is empty when the venue has no baseline, no priced drop and no dated memory", () => {
    const venue = v({ id: "v6", name: "Blank", cheapestPrice: null });
    const drops = [
      drop({ venueId: "v6", priceGbp: null, era: "", provenance: "anecdote" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.isEmpty).toBe(true);
    expect(story.baseline).toBeNull();
    expect(story.now).toBeNull();
    expect(story.inflation).toBeNull();
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();
  });

  it("shows a baseline-only story with no delta when there is no community price", () => {
    const venue = v({ id: "v7", name: "Baseline Only", cheapestPrice: 4.5 });
    const story = computeVenuePriceStory(venue, []);
    expect(story.isEmpty).toBe(false);
    expect(story.baseline?.gbp).toBe(4.5);
    expect(story.now).toBeNull();
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();
  });
});
