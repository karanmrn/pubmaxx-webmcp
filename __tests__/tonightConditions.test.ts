import { describe, expect, it } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import {
  buildVenueClaim,
  formatConditionDate,
  lensVenuePredicate,
  londonMonth,
  summariseTonightConditions,
  tallyLensMatches,
  PINT_CEILING_GBP,
} from "@/lib/tonightConditions";

// Piccadilly-ish centre so nearby-venue maths is realistic.
const CENTRE: [number, number] = [-0.134, 51.511];

type VenueOverrides = Omit<Partial<ConciergeVenue>, "amenities"> & {
  amenities?: Partial<ConciergeVenue["amenities"]>;
};

function venue(overrides: VenueOverrides = {}): ConciergeVenue {
  return {
    id: overrides.id ?? "v1",
    name: overrides.name ?? "The Test Tavern",
    area: "Soho",
    lat: overrides.lat ?? 51.512,
    lng: overrides.lng ?? -0.135,
    cheapestPrice: overrides.cheapestPrice ?? null,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
      ...overrides.amenities,
    },
    nearWater: overrides.nearWater ?? false,
    hasStory: false,
    canonical: true,
    ...(overrides.searchText ? { searchText: overrides.searchText } : {}),
  };
}

describe("formatConditionDate", () => {
  it("renders the calm 'Saturday 19 Jul' style with no comma", () => {
    // 2026-07-18 is a Saturday; check in a fixed zone to avoid host drift.
    const label = formatConditionDate(new Date("2026-07-18T19:00:00.000Z"), "Europe/London");
    expect(label).toBe("Saturday 18 Jul");
    expect(label).not.toContain(",");
  });
});

describe("londonMonth", () => {
  it("returns 1-12 for the London wall-clock month", () => {
    expect(londonMonth(new Date("2026-07-18T12:00:00.000Z"))).toBe(7);
    // Just past midnight UTC on 1 Jan is still 1 Jan in London (winter, +0).
    expect(londonMonth(new Date("2026-01-01T00:30:00.000Z"))).toBe(1);
  });
});

describe("lensVenuePredicate", () => {
  it("claims beer gardens via the amenity flag", () => {
    const pred = lensVenuePredicate("beer-garden");
    expect(pred?.(venue({ amenities: { beerGarden: true } }))).toBe(true);
    expect(pred?.(venue({ amenities: { beerGarden: false } }))).toBe(false);
  });

  it("claims riverside via the nearWater curation flag", () => {
    const pred = lensVenuePredicate("riverside");
    expect(pred?.(venue({ nearWater: true }))).toBe(true);
    expect(pred?.(venue({ nearWater: false }))).toBe(false);
  });

  it("makes no claim for fireplace or 'any' (no supporting data)", () => {
    expect(lensVenuePredicate("fireplace")).toBeNull();
    expect(lensVenuePredicate("any")).toBeNull();
  });
});

describe("tallyLensMatches", () => {
  it("counts nearby lens matches and the subset with a pint under the ceiling", () => {
    const venues: ConciergeVenue[] = [
      venue({ id: "a", amenities: { beerGarden: true }, cheapestPrice: 5.2 }),
      venue({ id: "b", amenities: { beerGarden: true }, cheapestPrice: 5.9 }),
      venue({ id: "c", amenities: { beerGarden: true }, cheapestPrice: 7.5 }),
      venue({ id: "d", amenities: { beerGarden: true }, cheapestPrice: null }),
      venue({ id: "e", amenities: { beerGarden: false }, cheapestPrice: 4 }),
    ];
    const tally = tallyLensMatches(venues, "beer-garden", CENTRE);
    expect(tally).toEqual({ count: 4, underCeiling: 2 });
  });

  it("excludes venues beyond the near radius", () => {
    const venues: ConciergeVenue[] = [
      venue({ id: "near", amenities: { beerGarden: true }, cheapestPrice: 5 }),
      // Canary Wharf is well beyond 2.5km from Piccadilly.
      venue({ id: "far", lat: 51.505, lng: -0.022, amenities: { beerGarden: true }, cheapestPrice: 5 }),
    ];
    const tally = tallyLensMatches(venues, "beer-garden", CENTRE);
    expect(tally).toEqual({ count: 1, underCeiling: 1 });
  });

  it("returns null for a lens with no supporting data", () => {
    expect(tallyLensMatches([venue()], "fireplace", CENTRE)).toBeNull();
  });

  it("treats a pint exactly at the ceiling as not under it", () => {
    const venues = [venue({ amenities: { beerGarden: true }, cheapestPrice: PINT_CEILING_GBP })];
    expect(tallyLensMatches(venues, "beer-garden", CENTRE)).toEqual({ count: 1, underCeiling: 0 });
  });
});

describe("buildVenueClaim", () => {
  it("prefers the price-backed framing when any match is under the ceiling", () => {
    expect(buildVenueClaim("beer-garden", { count: 5, underCeiling: 4 })).toBe(
      "4 gardens near you with a pint under 6 quid",
    );
  });

  it("uses a plain count when no match has a qualifying price", () => {
    expect(buildVenueClaim("beer-garden", { count: 3, underCeiling: 0 })).toBe("3 gardens near you");
  });

  it("pluralises honestly at one", () => {
    expect(buildVenueClaim("beer-garden", { count: 1, underCeiling: 1 })).toBe(
      "1 garden near you with a pint under 6 quid",
    );
    expect(buildVenueClaim("riverside", { count: 1, underCeiling: 0 })).toBe("1 riverside pub near you");
    expect(buildVenueClaim("riverside", { count: 2, underCeiling: 0 })).toBe("2 riverside pubs near you");
  });

  it("makes no claim for zero matches, a null tally, or a lensless verdict", () => {
    expect(buildVenueClaim("beer-garden", { count: 0, underCeiling: 0 })).toBeNull();
    expect(buildVenueClaim("beer-garden", null)).toBeNull();
    expect(buildVenueClaim("fireplace", { count: 3, underCeiling: 1 })).toBeNull();
    expect(buildVenueClaim("any", { count: 3, underCeiling: 1 })).toBeNull();
  });
});

describe("summariseTonightConditions", () => {
  const now = new Date("2026-07-18T19:00:00.000Z");

  it("composes date, weather, drink line and a venue claim", () => {
    const summary = summariseTonightConditions({
      weather: { tempC: 22, condition: "Clear", precipitationProbabilityPct: 10 },
      now,
      tally: { count: 4, underCeiling: 4 },
    });
    expect(summary).toEqual({
      dateLabel: "Saturday 18 Jul",
      weatherLabel: "22°C, clear",
      drinkLine: "Beer garden weather. Lager or cider.",
      drinkSuggestion: "a cold lager or cider",
      venueClaim: "4 gardens near you with a pint under 6 quid",
    });
  });

  it("shows the weather line with no venue claim when there are none nearby", () => {
    const summary = summariseTonightConditions({
      weather: { tempC: 22, condition: "Sunny", precipitationProbabilityPct: 10 },
      now,
      tally: { count: 0, underCeiling: 0 },
    });
    expect(summary?.venueClaim).toBeNull();
    expect(summary?.drinkLine).toBe("Beer garden weather. Lager or cider.");
  });

  it("drops the condition text gracefully when it is blank", () => {
    const summary = summariseTonightConditions({
      weather: { tempC: 22, condition: "  ", precipitationProbabilityPct: 10 },
      now,
      tally: null,
    });
    expect(summary?.weatherLabel).toBe("22°C");
  });

  it("returns null when the rules table claims nothing for tonight", () => {
    const summary = summariseTonightConditions({
      weather: { tempC: 15, condition: "Drizzle", precipitationProbabilityPct: 45 },
      now,
      tally: null,
    });
    expect(summary).toBeNull();
  });
});
