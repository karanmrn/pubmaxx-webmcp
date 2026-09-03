import { describe, expect, it } from "vitest";

import { filterMapVenues, withForcedVenue } from "@/lib/filterMapVenues";
import { initialFilters } from "@/components/map/ControlRail";
import type { Venue } from "@/lib/venues";

function slimPin(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-scraped",
    name: "The Mayflower",
    address: "Rotherhithe",
    latitude: 51.5,
    longitude: -0.05,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: true,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: ["london_chain_gazetteer_seed"],
    curation: {},
    filterHints: {
      searchText: "the mayflower",
      amenities: {
        food: true,
        cocktails: false,
        beerGarden: false,
        liveSports: false,
        nonAlcoholic: false,
      },
      curation: { nearWater: true, hasStory: true },
      canonical: false,
      scraped: true,
      drinkCategories: ["gin"],
    },
    ...overrides,
  };
}

describe("filterMapVenues", () => {
  it("keeps slim scraped pubs visible even when canonicalOnly is on", () => {
    const filters = { ...initialFilters, canonicalOnly: true };
    const result = filterMapVenues([slimPin()], filters, () => false);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("venue-scraped");
  });

  it("still respects price query on slim pins", () => {
    const filters = { ...initialFilters, query: "zzzz-no-match" };
    const result = filterMapVenues([slimPin()], filters, () => false);
    expect(result).toHaveLength(0);
  });

  it("keeps non-pub anchors out of the maximum pint price filter", () => {
    const filters = { ...initialFilters, maxPrice: 8 };
    const bar = slimPin({
      id: "bar-house-cocktail",
      kind: "bar",
      cheapestPrice: 14,
    });
    const pub = slimPin({
      id: "pub-pricey-pint",
      kind: "pub",
      cheapestPrice: 14,
    });

    expect(filterMapVenues([bar, pub], filters, () => false)).toEqual([bar]);
  });

  it("applies food and cocktail filters from slim venue hints", () => {
    const bar = slimPin({
      id: "bar-cocktails",
      kind: "bar",
      filterHints: {
        ...slimPin().filterHints!,
        amenities: {
          ...slimPin().filterHints!.amenities,
          food: false,
          cocktails: true,
        },
      },
    });
    const food = slimPin({
      id: "food-late",
      kind: "food",
      filterHints: {
        ...slimPin().filterHints!,
        amenities: {
          ...slimPin().filterHints!.amenities,
          food: true,
          cocktails: false,
        },
      },
    });

    expect(
      filterMapVenues(
        [bar, food],
        { ...initialFilters, requireCocktails: true },
        () => false,
      ),
    ).toEqual([bar]);
    expect(
      filterMapVenues(
        [bar, food],
        { ...initialFilters, requireFood: true },
        () => false,
      ),
    ).toEqual([food]);
  });

  it("keeps Pint Drops filtering pub-only even with a stale non-pub signal", () => {
    const legacyPub = slimPin({ id: "legacy-pub" });
    const explicitPub = slimPin({ id: "explicit-pub", kind: "pub" });
    const bar = slimPin({ id: "bar-with-stale-drop", kind: "bar" });
    const food = slimPin({ id: "food-with-stale-drop", kind: "food" });

    expect(
      filterMapVenues(
        [legacyPub, explicitPub, bar, food],
        { ...initialFilters, requirePintDrops: true },
        () => true,
      ),
    ).toEqual([legacyPub, explicitPub]);
  });
});

describe("withForcedVenue", () => {
  it("appends a deep-linked venue missing from the filtered set", () => {
    const forced = slimPin({ id: "venue-force", name: "Forced" });
    const byId = new Map([[forced.id, forced]]);
    const out = withForcedVenue([], byId, "venue-force");
    expect(out.map((v) => v.id)).toEqual(["venue-force"]);
  });

  it("does not duplicate an already-visible venue", () => {
    const venue = slimPin();
    const byId = new Map([[venue.id, venue]]);
    const out = withForcedVenue([venue], byId, venue.id);
    expect(out).toHaveLength(1);
  });
});
