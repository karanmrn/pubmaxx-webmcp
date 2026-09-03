import { describe, expect, it } from "vitest";

import {
  MIN_PRICED_VENUES,
  computeZonePintIndex,
  median,
  parseZoneParam,
  toZoneId,
  venueMatchesZone,
  zoneLabel,
  type ZonePricedVenue,
} from "@/lib/zones";

describe("median", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("ignores non-finite values", () => {
    expect(median([Number.NaN, 4, 2, Number.POSITIVE_INFINITY])).toBe(3);
  });

  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });
});

describe("toZoneId / parseZoneParam", () => {
  it("accepts 1–6 and rejects out-of-range / junk", () => {
    expect(toZoneId(3)).toBe(3);
    expect(toZoneId("6")).toBe(6);
    expect(toZoneId(0)).toBeNull();
    expect(toZoneId(7)).toBeNull();
    expect(toZoneId(2.5)).toBeNull();
    expect(toZoneId("x")).toBeNull();
  });

  it("parses 'all' and blank as their own selections", () => {
    expect(parseZoneParam("all")).toBe("all");
    expect(parseZoneParam("")).toBeNull();
    expect(parseZoneParam(null)).toBeNull();
    expect(parseZoneParam("4")).toBe(4);
    expect(parseZoneParam("nope")).toBeNull();
  });
});

describe("venueMatchesZone", () => {
  it("passes everything for all / blank / null selection", () => {
    expect(venueMatchesZone(3, "all")).toBe(true);
    expect(venueMatchesZone(3, "")).toBe(true);
    expect(venueMatchesZone(null, "all")).toBe(true);
    expect(venueMatchesZone(undefined, null)).toBe(true);
  });

  it("matches only the exact zone for a concrete selection", () => {
    expect(venueMatchesZone(3, 3)).toBe(true);
    expect(venueMatchesZone(2, 3)).toBe(false);
  });

  it("never matches an unknown-zone venue against a concrete zone", () => {
    expect(venueMatchesZone(null, 3)).toBe(false);
    expect(venueMatchesZone(undefined, 1)).toBe(false);
  });
});

describe("zoneLabel", () => {
  it("labels concrete zones and the all case", () => {
    expect(zoneLabel(2)).toBe("Zone 2");
    expect(zoneLabel("all")).toBe("All zones");
  });
});

describe("computeZonePintIndex", () => {
  // Build a zone with n priced venues at a given price plus optional extras.
  function pricedVenues(zone: number, prices: number[]): ZonePricedVenue[] {
    return prices.map((cheapestPrice) => ({ zone, cheapestPrice }));
  }

  it("gates a zone with fewer than MIN_PRICED_VENUES priced venues", () => {
    const venues = pricedVenues(1, [6, 6.2, 6.4]); // only 3 < 10
    const index = computeZonePintIndex(venues);
    const zone1 = index.rows.find((r) => r.zone === 1)!;
    expect(zone1.pricedCount).toBe(3);
    expect(zone1.enough).toBe(false);
    expect(zone1.medianGbp).toBeNull();
    expect(index.ranked).toHaveLength(0);
    expect(index.taxGbp).toBeNull();
  });

  it("publishes a median once a zone clears the gate", () => {
    const prices = Array.from({ length: MIN_PRICED_VENUES }, (_, i) => 6 + i * 0.1);
    const index = computeZonePintIndex(pricedVenues(2, prices));
    const zone2 = index.rows.find((r) => r.zone === 2)!;
    expect(zone2.enough).toBe(true);
    expect(zone2.pricedCount).toBe(MIN_PRICED_VENUES);
    expect(zone2.medianGbp).not.toBeNull();
  });

  it("computes the zone tax between the dearest and cheapest publishable zones", () => {
    // Zone 1: median 7.00; Zone 3: median 5.00 → tax 2.00.
    const zone1 = pricedVenues(1, Array.from({ length: 10 }, () => 7));
    const zone3 = pricedVenues(3, Array.from({ length: 10 }, () => 5));
    const index = computeZonePintIndex([...zone1, ...zone3]);
    expect(index.dearest?.zone).toBe(1);
    expect(index.cheapest?.zone).toBe(3);
    expect(index.taxGbp).toBe(2);
    // ranked is cheapest → dearest.
    expect(index.ranked.map((r) => r.zone)).toEqual([3, 1]);
  });

  it("excludes venues with no price or an unknown/out-of-range zone", () => {
    const venues: ZonePricedVenue[] = [
      ...pricedVenues(1, Array.from({ length: 10 }, () => 6)),
      { zone: 1, cheapestPrice: null }, // no price → not counted
      { zone: null, cheapestPrice: 6 }, // unknown zone → dropped
      { zone: 9, cheapestPrice: 6 }, // outside 1–6 filter set → dropped
    ];
    const index = computeZonePintIndex(venues);
    const zone1 = index.rows.find((r) => r.zone === 1)!;
    expect(zone1.pricedCount).toBe(10);
  });

  it("excludes non-pub anchors from pint medians", () => {
    const pubs = pricedVenues(1, Array.from({ length: 10 }, () => 6));
    const index = computeZonePintIndex([
      ...pubs,
      { zone: 1, cheapestPrice: 25, kind: "bar" },
      { zone: 1, cheapestPrice: 12, kind: "food" },
    ]);
    const zone1 = index.rows.find((row) => row.zone === 1)!;
    expect(zone1.pricedCount).toBe(10);
    expect(zone1.medianGbp).toBe(6);
  });

  it("always returns exactly the six filterable zones in order", () => {
    const index = computeZonePintIndex([]);
    expect(index.rows.map((r) => r.zone)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(index.rows.every((r) => r.pricedCount === 0 && !r.enough)).toBe(true);
  });
});
