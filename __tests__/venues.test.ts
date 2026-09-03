import { describe, it, expect } from "vitest";
import {
  groupVenuePrices,
  filterVenues,
  scoreVenue,
  buildCrawlRoute,
  corroboratedPriceDrop,
  crawlSummary,
  mergeVenueDrops,
  provisionalPintDropVenueIds,
  formatFreshness,
  formatObservedAt,
  stableVenueIdFromKey,
  venueGroupingKey,
  type SummaryDrop,
  type VenuePrice,
  type Filters,
} from "@/lib/venues";
import type { MapLensPrice } from "@/lib/mapExperienceLens";

function makeRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 6,
    price_text: "",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "",
    source_row_count: 1,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

function makeFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    query: "",
    maxPrice: 100,
    crawlStyle: "balanced",
    stopCount: 4,
    routeWindow: 25,
    requireBeerGarden: false,
    requireNonAlcoholic: false,
    requireLiveSports: false,
    requireFood: false,
    requireCocktails: false,
    requireWater: false,
    requirePintDrops: false,
    requireHeritage: false,
    requireStepFree: false,
    requireAccessibleToilet: false,
    requireSeatedService: false,
    canonicalOnly: false,
    openNow: false,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    zone: "",
    ...overrides,
  };
}

describe("groupVenuePrices", () => {
  it("collapses rows with same pub_name+address+lat+lng into one venue", () => {
    const venues = groupVenuePrices([
      makeRow({ pint_name: "Lager", price_gbp: 6 }),
      makeRow({ pint_name: "Ale", price_gbp: 5 }),
    ]);
    expect(venues).toHaveLength(1);
    expect(venues[0].prices).toHaveLength(2);
  });

  
  it("aggregates bookingLink from the first http(s) booking_link row", () => {
    const venues = groupVenuePrices([
      makeRow({ booking_link: "", website: "https://a.example" }),
      makeRow({
        pint_name: "Ale",
        price_gbp: 5,
        booking_link: "https://book.example/table",
      }),
    ]);
    expect(venues[0].bookingLink).toBe("https://book.example/table");
    expect(venues[0].website).toBe("https://a.example");
  });

  it("skips email/whitespace booking_link so a later http(s) URL wins", () => {
    const venues = groupVenuePrices([
      makeRow({ booking_link: "bookings@pub.example" }),
      makeRow({
        pint_name: "Ale",
        price_gbp: 5,
        booking_link: "  https://book.example/table  ",
      }),
    ]);
    expect(venues[0].bookingLink).toBe("https://book.example/table");
  });

  it("stores empty bookingLink when only non-http booking values exist", () => {
    const venues = groupVenuePrices([
      makeRow({ booking_link: "mailto:book@pub.example" }),
      makeRow({ pint_name: "Ale", price_gbp: 5, booking_link: "   " }),
    ]);
    expect(venues[0].bookingLink).toBe("");
  });

  it("cheapestPrice is the min numeric price and a null never wins", () => {
    const venues = groupVenuePrices([
      makeRow({ price_gbp: 7 }),
      makeRow({ price_gbp: null }),
      makeRow({ price_gbp: 4.5 }),
    ]);
    expect(venues[0].cheapestPrice).toBe(4.5);
  });

  it("all-null prices yield null cheapestPrice", () => {
    const venues = groupVenuePrices([makeRow({ price_gbp: null })]);
    expect(venues[0].cheapestPrice).toBeNull();
  });

  it("OR's amenities across the group's rows", () => {
    const venues = groupVenuePrices([
      makeRow({ beer_garden: "" }),
      makeRow({ beer_garden: "yes" }),
    ]);
    expect(venues[0].amenities.beerGarden).toBe(true);
  });

  it("attaches curation, honestly uncurated for a plain fixture with no heritage or water terms", () => {
    const venues = groupVenuePrices([makeRow()]);
    expect(venues[0].curation).toMatchObject({ nearWater: false, provenance: undefined });
  });

  it("uses stable venue ids from the grouping key instead of array order", () => {
    const left = makeRow({ pub_name: "The Crown", address: "1 High Street", latitude: 51.5 });
    const right = makeRow({ pub_name: "The Anchor", address: "2 River Road", latitude: 51.6 });

    const original = groupVenuePrices([left, right]);
    const reversed = groupVenuePrices([right, left]);

    expect(original.find((venue) => venue.name === "The Crown")?.id).toBe(
      reversed.find((venue) => venue.name === "The Crown")?.id,
    );
    expect(original.find((venue) => venue.name === "The Crown")?.id).toBe(
      stableVenueIdFromKey(venueGroupingKey(left)),
    );
  });
});

describe("filterVenues", () => {
  it("query matches name", () => {
    const venues = groupVenuePrices([makeRow({ pub_name: "The Grapes" })]);
    expect(filterVenues(venues, makeFilters({ query: "grapes" }))).toHaveLength(1);
    expect(filterVenues(venues, makeFilters({ query: "nomatch" }))).toHaveLength(0);
  });

  it("query matches borough", () => {
    const venues = groupVenuePrices([makeRow({ primary_borough: "Hackney" })]);
    expect(filterVenues(venues, makeFilters({ query: "hackney" }))).toHaveLength(1);
  });

  it("zone filter narrows to the matching fare zone; unknown zone fails a concrete pick", () => {
    const zone1 = groupVenuePrices([makeRow({ address: "Z1" })]);
    zone1[0].zone = 1;
    const zone3 = groupVenuePrices([makeRow({ address: "Z3" })]);
    zone3[0].zone = 3;
    const unknown = groupVenuePrices([makeRow({ address: "Z?" })]); // no zone
    const all = [...zone1, ...zone3, ...unknown];

    // "" / "all" is a no-op — every venue passes.
    expect(filterVenues(all, makeFilters({ zone: "" }))).toHaveLength(3);
    expect(filterVenues(all, makeFilters({ zone: "all" }))).toHaveLength(3);
    // A concrete zone narrows to that zone only.
    expect(filterVenues(all, makeFilters({ zone: "1" }))).toHaveLength(1);
    expect(filterVenues(all, makeFilters({ zone: "3" }))[0].address).toBe("Z3");
    // An unknown-zone venue never matches a concrete zone.
    expect(filterVenues(unknown, makeFilters({ zone: "3" }))).toHaveLength(0);
  });

  it("maxPrice excludes pricier venues but a null-price venue passes", () => {
    const pricey = groupVenuePrices([makeRow({ address: "A", price_gbp: 9 })]);
    const nullPrice = groupVenuePrices([makeRow({ address: "B", price_gbp: null })]);
    expect(filterVenues(pricey, makeFilters({ maxPrice: 6 }))).toHaveLength(0);
    expect(filterVenues(nullPrice, makeFilters({ maxPrice: 6 }))).toHaveLength(1);
  });

  it("requireWater gates on curation", () => {
    const water = groupVenuePrices([makeRow({ address: "Wapping Wall" })]);
    const dry = groupVenuePrices([makeRow({ address: "Somewhere Dry" })]);
    expect(filterVenues(water, makeFilters({ requireWater: true }))).toHaveLength(1);
    expect(filterVenues(dry, makeFilters({ requireWater: true }))).toHaveLength(0);
  });

  it("requireHeritage gates on curation", () => {
    const heritage = groupVenuePrices([makeRow({ pub_name: "The Lamb" })]);
    const plain = groupVenuePrices([makeRow({ pub_name: "The Nothing" })]);
    expect(filterVenues(heritage, makeFilters({ requireHeritage: true }))).toHaveLength(1);
    expect(filterVenues(plain, makeFilters({ requireHeritage: true }))).toHaveLength(0);
  });

  it("canonicalOnly requires a canonical row", () => {
    const canonical = groupVenuePrices([makeRow({ is_clean_canonical_app_row: true })]);
    const nonCanonical = groupVenuePrices([makeRow({ is_clean_canonical_app_row: false })]);
    expect(filterVenues(canonical, makeFilters({ canonicalOnly: true }))).toHaveLength(1);
    expect(filterVenues(nonCanonical, makeFilters({ canonicalOnly: true }))).toHaveLength(0);
  });

  it("uses slim filter hints before venue detail rows hydrate", () => {
    const [venue] = groupVenuePrices([makeRow({ pub_name: "The Anchor", price_gbp: 5 })]);
    const slim = {
      ...venue,
      prices: [],
      cheapestPint: "",
      amenities: {
        ...venue.amenities,
        cocktails: false,
        nonAlcoholic: false,
      },
      curation: {},
      hasStory: false,
      filterHints: {
        searchText: "the anchor bankside wine cocktails low no",
        amenities: {
          food: false,
          cocktails: true,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: true,
        },
        curation: {
          nearWater: true,
          hasStory: true,
        },
        canonical: true,
      },
    };

    expect(filterVenues([slim], makeFilters({ query: "wine" }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireCocktails: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireNonAlcoholic: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireWater: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireHeritage: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ canonicalOnly: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ query: "vodka" }))).toHaveLength(0);
  });

  it("matches drinkCategory / drinkBrand via hints and search text", () => {
    const [base] = groupVenuePrices([makeRow({ pub_name: "The Spirit Arms", price_gbp: 5 })]);
    const ginVenue = {
      ...base,
      prices: [],
      cheapestPint: "",
      amenities: { ...base.amenities, cocktails: false },
      filterHints: {
        searchText: "the spirit arms sipsmith gin",
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: true,
        drinkCategories: ["gin"],
        drinkBrands: ["sipsmith"],
      },
    };
    const beerOnly = {
      ...base,
      id: "venue-beer-only",
      prices: [],
      cheapestPint: "",
      amenities: { ...base.amenities, cocktails: false },
      filterHints: {
        searchText: "lager pint guinness",
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: true,
        drinkCategories: ["beer"],
        drinkBrands: ["guinness"],
      },
    };

    expect(filterVenues([ginVenue], makeFilters({ drinkCategory: "gin" }))).toHaveLength(1);
    expect(filterVenues([beerOnly], makeFilters({ drinkCategory: "gin" }))).toHaveLength(0);
    expect(
      filterVenues([ginVenue], makeFilters({ drinkCategory: "gin", drinkBrand: "sipsmith" })),
    ).toHaveLength(1);
    expect(
      filterVenues([ginVenue], makeFilters({ drinkCategory: "gin", drinkBrand: "tanqueray" })),
    ).toHaveLength(0);
    expect(filterVenues([beerOnly], makeFilters({ drinkBrand: "guinness" }))).toHaveLength(1);
  });

  // A pub whose only drink evidence is a bare brand name — "GUINNESS" says
  // neither "beer" nor "stout" — so the category comes from the slim-index hint
  // and the subtype has to come from brand knowledge.
  function beerPub(name: string, pintName: string, price: number) {
    const [base] = groupVenuePrices([
      makeRow({ pub_name: name, pint_name: pintName, price_gbp: price }),
    ]);
    return {
      ...base,
      filterHints: {
        searchText: base.name.toLowerCase(),
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: true,
        drinkCategories: ["beer"],
      },
    };
  }

  it("refines a category with a subtype, and composes with the price filter", () => {
    const stoutPub = beerPub("The Stout Arms", "GUINNESS", 5);
    const lagerPub = beerPub("The Lager Arms", "AMSTEL", 9);
    const pubs = [stoutPub, lagerPub];

    // Category alone keeps both; the subtype narrows to the stout.
    expect(filterVenues(pubs, makeFilters({ drinkCategory: "beer" }))).toHaveLength(2);
    const stout = filterVenues(
      pubs,
      makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-stout" }),
    );
    expect(stout.map((venue) => venue.name)).toEqual(["The Stout Arms"]);
    expect(
      filterVenues(pubs, makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-lager" })),
    ).toHaveLength(1);

    // AND'd with the existing price filter, not replacing it.
    expect(
      filterVenues(
        pubs,
        makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-stout", maxPrice: 4 }),
      ),
    ).toHaveLength(0);
  });

  it("recognizes every stocked subtype when a venue carries multiple known brands", () => {
    const [mixed] = groupVenuePrices([
      makeRow({ pub_name: "The Mixed Tap", pint_name: "GUINNESS", price_gbp: 6 }),
      makeRow({ pub_name: "The Mixed Tap", pint_name: "AMSTEL", price_gbp: 6 }),
    ]);
    expect(
      filterVenues(
        [mixed],
        makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-stout" }),
      ),
    ).toHaveLength(1);
    expect(
      filterVenues(
        [mixed],
        makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-lager" }),
      ),
    ).toHaveLength(1);
  });

  it("ignores a subtype from a different family and rejects unknown ids", () => {
    const pub = beerPub("The Stout Arms", "GUINNESS", 5);
    // Stale rum refinement under a beer lens: dropped, not obeyed.
    expect(
      filterVenues([pub], makeFilters({ drinkCategory: "beer", drinkSubtype: "rum-dark" })),
    ).toHaveLength(1);
    // An unknown id must not silently no-op into "everything matches".
    expect(
      filterVenues([pub], makeFilters({ drinkCategory: "beer", drinkSubtype: "beer-unicorn" })),
    ).toHaveLength(0);
  });

  it("narrows to known top-shelf pours only, never guessing", () => {
    const [premium] = groupVenuePrices([
      makeRow({ pub_name: "The Back Bar", pint_name: "Lagavulin 16", price_gbp: 5 }),
    ]);
    const [ordinary] = groupVenuePrices([
      makeRow({ pub_name: "The Local", pint_name: "CARLING", price_gbp: 5 }),
    ]);
    const ordinaryWithOldBuildingCopy = {
      ...ordinary,
      description: "A premium pub in an aged Victorian building with vintage decor.",
    };
    const found = filterVenues(
      [premium, ordinaryWithOldBuildingCopy],
      makeFilters({ topShelfOnly: true }),
    );
    expect(found.map((venue) => venue.name)).toEqual(["The Back Bar"]);
    // Off is a no-op, not a hidden narrowing.
    expect(filterVenues([premium, ordinaryWithOldBuildingCopy], makeFilters())).toHaveLength(2);
  });

  it("does not match drinkBrand against pub name buried in filterHints.searchText", () => {
    const [base] = groupVenuePrices([makeRow({ pub_name: "The Gordon Arms", price_gbp: 5 })]);
    const named = {
      ...base,
      prices: [],
      cheapestPint: "",
      amenities: { ...base.amenities, cocktails: false },
      filterHints: {
        // Slim index still puts pub_name into searchText for general query —
        // drink brand matching must ignore it.
        searchText: "the gordon arms lager",
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: true,
        drinkCategories: ["beer"],
      },
    };
    expect(filterVenues([named], makeFilters({ drinkBrand: "gordon" }))).toHaveLength(0);
  });

  it("treats cocktail amenity as a drinkCategory=cocktail match", () => {
    const [venue] = groupVenuePrices([
      makeRow({ pub_name: "Cocktail Corner", cocktails: "yes", price_gbp: 6 }),
    ]);
    expect(filterVenues([venue], makeFilters({ drinkCategory: "cocktail" }))).toHaveLength(1);
    expect(filterVenues([venue], makeFilters({ drinkCategory: "vodka" }))).toHaveLength(0);
  });

  it("matches beer via pint tokens / hints, not any priced row", () => {
    const lager = groupVenuePrices([
      makeRow({ pub_name: "The Lager House", pint_name: "House Lager", price_gbp: 5 }),
    ]);
    const wineOnly = groupVenuePrices([
      makeRow({
        pub_name: "The Wine Bar",
        address: "9 Vine Lane",
        pint_name: "House Red Wine",
        price_gbp: 7,
      }),
    ]);
    expect(filterVenues(lager, makeFilters({ drinkCategory: "beer" }))).toHaveLength(1);
    expect(filterVenues(wineOnly, makeFilters({ drinkCategory: "beer" }))).toHaveLength(0);
  });

  it("does not match drink brands from the venue name alone", () => {
    const named = groupVenuePrices([
      makeRow({
        pub_name: "The Guinness Arms",
        pint_name: "House Red Wine",
        price_gbp: 6,
      }),
    ]);
    expect(filterVenues(named, makeFilters({ drinkBrand: "guinness" }))).toHaveLength(0);
    expect(filterVenues(named, makeFilters({ drinkCategory: "beer" }))).toHaveLength(0);
  });

  it("rejects unknown drinkBrand ids instead of no-opping", () => {
    const venues = groupVenuePrices([makeRow({ pint_name: "Lager", price_gbp: 5 })]);
    expect(filterVenues(venues, makeFilters({ drinkBrand: "not-a-real-brand" }))).toHaveLength(0);
  });
});

describe("scoreVenue", () => {
  it("writer pick scores higher under writerTrail than balanced", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Grapes" })])[0];
    expect(scoreVenue(venue, "writerTrail")).toBeGreaterThan(scoreVenue(venue, "balanced"));
  });

  it("cheap venue outscores expensive under cheapest", () => {
    const cheap = groupVenuePrices([makeRow({ address: "A", price_gbp: 4 })])[0];
    const expensive = groupVenuePrices([makeRow({ address: "B", price_gbp: 9 })])[0];
    expect(scoreVenue(cheap, "cheapest")).toBeGreaterThan(scoreVenue(expensive, "cheapest"));
  });

  it("heritage-note venue outscores a plain one under heritage", () => {
    const heritage = groupVenuePrices([makeRow({ pub_name: "The Lamb" })])[0];
    const plain = groupVenuePrices([makeRow({ pub_name: "The Nothing" })])[0];
    expect(scoreVenue(heritage, "heritage")).toBeGreaterThan(scoreVenue(plain, "heritage"));
  });

  // noAlcoholFirst biases toward a corroborated NA price the same way filters
  // travel: a Map keyed by venue id, never a new VenueSignal or pint bucket.
  it("corroborated-NA venue outscores one without under noAlcoholFirst", () => {
    const withNa = groupVenuePrices([
      makeRow({ address: "A", pub_name: "The Dry Arms" }),
    ])[0];
    const withoutNa = groupVenuePrices([
      makeRow({ address: "B", pub_name: "The Wet Arms" }),
    ])[0];
    const naLensPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [
        withNa.id,
        {
          venueId: withNa.id,
          category: "alcohol-free",
          categoryLabel: "Alcohol-free",
          priceGbp: 3.5,
          source: "community",
        },
      ],
    ]);
    expect(scoreVenue(withNa, "noAlcoholFirst", naLensPrices)).toBeGreaterThan(
      scoreVenue(withoutNa, "noAlcoholFirst", naLensPrices),
    );
  });

  // Missing NA price is neutral, not penalised, mirroring lensPriceForVenue:
  // two venues absent from the map score identically under noAlcoholFirst.
  it("treats a missing NA price as neutral rather than a penalty", () => {
    const cheap = groupVenuePrices([makeRow({ address: "A", price_gbp: 4 })])[0];
    const alsoCheap = groupVenuePrices([makeRow({ address: "B", price_gbp: 4 })])[0];
    const emptyNaLensPrices: ReadonlyMap<string, MapLensPrice> = new Map();
    expect(scoreVenue(cheap, "noAlcoholFirst", emptyNaLensPrices)).toBe(
      scoreVenue(alsoCheap, "noAlcoholFirst", emptyNaLensPrices),
    );
    // Neutral holds with no map at all, too.
    expect(scoreVenue(cheap, "noAlcoholFirst")).toBe(
      scoreVenue(alsoCheap, "noAlcoholFirst"),
    );
  });

  // Among two NA-priced venues, rank on the NA figure itself, not pint
  // cheapness - a dearer pint with a cheaper corroborated lemonade still wins.
  it("cheaper corroborated NA price outranks a dearer one under noAlcoholFirst, even against a cheaper pint", () => {
    const cheaperNa = groupVenuePrices([
      makeRow({ address: "A", pub_name: "The Dry Arms", price_gbp: 9 }),
    ])[0];
    const dearerNa = groupVenuePrices([
      makeRow({ address: "B", pub_name: "The Dry Anchor", price_gbp: 4 }),
    ])[0];
    const naLensPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [
        cheaperNa.id,
        {
          venueId: cheaperNa.id,
          category: "alcohol-free",
          categoryLabel: "Alcohol-free",
          priceGbp: 2,
          source: "community",
        },
      ],
      [
        dearerNa.id,
        {
          venueId: dearerNa.id,
          category: "alcohol-free",
          categoryLabel: "Alcohol-free",
          priceGbp: 3.5,
          source: "community",
        },
      ],
    ]);
    expect(scoreVenue(cheaperNa, "noAlcoholFirst", naLensPrices)).toBeGreaterThan(
      scoreVenue(dearerNa, "noAlcoholFirst", naLensPrices),
    );
  });
});

describe("buildCrawlRoute", () => {
  it("returns [] for empty input", () => {
    expect(buildCrawlRoute([], makeFilters())).toEqual([]);
  });

  it("returns at most stopCount stops with no duplicate ids", () => {
    const venues = groupVenuePrices([
      makeRow({ address: "A", latitude: 51.5, longitude: -0.1 }),
      makeRow({ address: "B", latitude: 51.501, longitude: -0.1 }),
      makeRow({ address: "C", latitude: 51.502, longitude: -0.1 }),
      makeRow({ address: "D", latitude: 51.503, longitude: -0.1 }),
      makeRow({ address: "E", latitude: 51.504, longitude: -0.1 }),
    ]);
    const route = buildCrawlRoute(venues, makeFilters({ stopCount: 3 }));
    expect(route.length).toBeLessThanOrEqual(3);
    const ids = route.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("mergeVenueDrops", () => {
  // A fixed clock keeps the 30-day age window deterministic. Drops default to
  // one day old (in window) and carry a handle so corroboration can count
  // independent drinkers.
  const NOW = Date.parse("2026-06-02T10:00:00.000Z");

  function makeSummaryDrop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
    return {
      drink: "Lager",
      priceGbp: null,
      passedDownNote: "",
      provenance: "contributor",
      createdAt: "2026-06-01T10:00:00.000Z",
      handle: "first_drinker",
      ...overrides,
    };
  }

  // A corroborated pair: two independent drinkers, in window, agreeing within
  // the shared tolerance. The minimum a price needs to move the map.
  function corroboratedPair(priceGbp = 4.5): SummaryDrop[] {
    return [
      makeSummaryDrop({
        priceGbp,
        handle: "first_drinker",
        authorityKey: "venue-authority-a",
      }),
      makeSummaryDrop({
        priceGbp,
        handle: "second_drinker",
        authorityKey: "venue-authority-b",
        createdAt: "2026-05-31T10:00:00.000Z",
      }),
    ];
  }

  // A venue with no editorial heritage note → hasStory starts false.
  function plainVenue() {
    return groupVenuePrices([makeRow({ pub_name: "The Nothing", price_gbp: 6 })])[0];
  }

  it("a price-only drop does NOT flip hasStory (a bare price is not a story)", () => {
    const venue = plainVenue();
    expect(venue.hasStory).toBe(false);
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, corroboratedPair(4.5)]]),
      NOW,
    );
    expect(merged.hasStory).toBe(false);
    // ...and therefore no heritage-score boost either.
    expect(scoreVenue(merged, "heritage")).toBe(scoreVenue(venue, "heritage"));
    // The corroborated price signal itself still merges.
    expect(merged.cheapestPrice).toBe(4.5);
  });

  it("a lone uncorroborated drop never moves cheapestPrice or the contributor layer (AGENTS.md pin law: an uncorroborated report cannot reach either lane)", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, [makeSummaryDrop({ priceGbp: 4.5 })]]]),
      NOW,
    );
    expect(merged.cheapestPrice).toBe(venue.cheapestPrice);
    expect(merged.cheapestPint).toBe(venue.cheapestPint);
    expect(merged.latestContributorPrice).toBeNull();
    expect(merged.latestContributorAt).toBeNull();
  });

  it("two drops from the SAME handle stay one report - no self-corroboration", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            makeSummaryDrop({ priceGbp: 4.5, handle: "first_drinker" }),
            makeSummaryDrop({
              priceGbp: 4.6,
              handle: "@First_Drinker", // normalises to the same handle
              createdAt: "2026-05-31T10:00:00.000Z",
            }),
          ],
        ],
      ]),
      NOW,
    );
    expect(merged.latestContributorPrice).toBeNull();
    expect(merged.cheapestPrice).toBe(venue.cheapestPrice);
  });

  it("two independent drinkers disagreeing beyond tolerance do not corroborate", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            makeSummaryDrop({ priceGbp: 4.5, handle: "first_drinker" }),
            makeSummaryDrop({
              priceGbp: 7.5,
              handle: "second_drinker",
              createdAt: "2026-05-31T10:00:00.000Z",
            }),
          ],
        ],
      ]),
      NOW,
    );
    expect(merged.latestContributorPrice).toBeNull();
  });

  it("a second report outside the 30-day window does not corroborate", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            makeSummaryDrop({ priceGbp: 4.5, handle: "first_drinker" }),
            makeSummaryDrop({
              priceGbp: 4.5,
              handle: "second_drinker",
              createdAt: "2026-04-01T10:00:00.000Z", // 62 days before NOW
            }),
          ],
        ],
      ]),
      NOW,
    );
    expect(merged.latestContributorPrice).toBeNull();
  });

  it("drops without a handle cannot prove independence, so they never corroborate", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            makeSummaryDrop({ priceGbp: 4.5, handle: undefined }),
            makeSummaryDrop({
              priceGbp: 4.5,
              handle: undefined,
              createdAt: "2026-05-31T10:00:00.000Z",
            }),
          ],
        ],
      ]),
      NOW,
    );
    expect(merged.latestContributorPrice).toBeNull();
  });

  it("a drop WITH a passed-down note lights hasStory", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [venue.id, [makeSummaryDrop({ passedDownNote: "My grandad's corner table.", provenance: "anecdote" })]],
      ]),
      NOW,
    );
    expect(merged.hasStory).toBe(true);
  });

  it("a whitespace-only note is not a story", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, [makeSummaryDrop({ passedDownNote: "   ", priceGbp: 5 })]]]),
      NOW,
    );
    expect(merged.hasStory).toBe(false);
  });

  it("demo seeds are display-only: they never move prices or hasStory", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            makeSummaryDrop({
              provenance: "demo",
              priceGbp: 1.0,
              passedDownNote: "A seeded story that must not count.",
            }),
          ],
        ],
      ]),
      NOW,
    );
    expect(merged.hasStory).toBe(false);
    expect(merged.cheapestPrice).toBe(venue.cheapestPrice);
    expect(merged).toEqual(venue);
  });

  it("a demo drop ahead of corroborated organic ones never wins the latest-price or story slot", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            // Newest-first list: the demo seed sits ahead of the organic pair.
            makeSummaryDrop({
              provenance: "demo",
              drink: "Seeded Stout",
              priceGbp: 1.0,
              passedDownNote: "A seeded story that must not count.",
            }),
            makeSummaryDrop({
              drink: "Organic Ale",
              priceGbp: 4.5,
              handle: "first_drinker",
              authorityKey: "venue-authority-a",
            }),
            makeSummaryDrop({
              drink: "Organic Ale",
              priceGbp: 4.5,
              handle: "second_drinker",
              authorityKey: "venue-authority-b",
              createdAt: "2026-05-31T10:00:00.000Z",
            }),
          ],
        ],
      ]),
      NOW,
    );
    // The corroborated organic signals win; the demo drop is invisible to them.
    expect(merged.cheapestPrice).toBe(4.5);
    expect(merged.cheapestPint).toBe("Organic Ale");
    expect(merged.hasStory).toBe(false);
  });

  it("an editorial heritage note keeps hasStory true regardless of drops", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Lamb" })])[0];
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, corroboratedPair(5)]]),
      NOW,
    );
    expect(merged.hasStory).toBe(true);
  });

  it("carries the corroborated price drop's createdAt through as latestContributorAt", () => {
    const venue = plainVenue();
    expect(venue.latestContributorPrice).toBeNull();
    expect(venue.latestContributorAt).toBeNull();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, corroboratedPair(4.5)]]),
      NOW,
    );
    expect(merged.latestContributorPrice).toBe(4.5);
    // The candidate is the newest agreeing drop; its timestamp travels with it.
    expect(merged.latestContributorAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("a note-only drop leaves the contributor price layer null (no live price)", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, [makeSummaryDrop({ passedDownNote: "Grandad's local.", provenance: "anecdote" })]]]),
      NOW,
    );
    expect(merged.latestContributorPrice).toBeNull();
    expect(merged.latestContributorAt).toBeNull();
  });

  describe("corroboratedPriceDrop", () => {
    it("does not treat two self-asserted handles as independent price authority", () => {
      const drops = [
        makeSummaryDrop({ priceGbp: 4.5, handle: "invented_one" }),
        makeSummaryDrop({ priceGbp: 4.5, handle: "invented_two" }),
      ];

      expect(corroboratedPriceDrop(drops, NOW)).toBeNull();
    });

    it("does not let one verified account corroborate through a handle rename", () => {
      const drops = [
        makeSummaryDrop({
          priceGbp: 4.5,
          handle: "old_handle",
          authorityKey: "same-verified-account",
        }),
        makeSummaryDrop({
          priceGbp: 4.5,
          handle: "new_handle",
          authorityKey: "same-verified-account",
        }),
      ];

      expect(corroboratedPriceDrop(drops, NOW)).toBeNull();
    });

    it("never selects a provisional row as the corroborated candidate", () => {
      const drops = [
        makeSummaryDrop({ priceGbp: 4.5, handle: "withheld" }),
        makeSummaryDrop({
          priceGbp: 4.5,
          handle: "first_verified",
          authorityKey: "venue-authority-a",
          createdAt: "2026-05-31T10:00:00.000Z",
        }),
        makeSummaryDrop({
          priceGbp: 4.5,
          handle: "second_verified",
          authorityKey: "venue-authority-b",
          createdAt: "2026-05-30T10:00:00.000Z",
        }),
      ];

      expect(corroboratedPriceDrop(drops, NOW)?.authorityKey).toBe(
        "venue-authority-a",
      );
    });

    it("a corroborated pair yields the newest agreeing drop as the candidate", () => {
      const drops = corroboratedPair(4.5);
      const candidate = corroboratedPriceDrop(drops, NOW);
      expect(candidate).toBe(drops[0]);
    });

    it("a lone fresh disagreement cannot un-paint a corroborated older figure", () => {
      const drops = [
        // Newest-first: a lone £9 report ahead of a corroborated £4.50 pair.
        makeSummaryDrop({
          priceGbp: 9,
          handle: "third_drinker",
          authorityKey: "venue-authority-c",
        }),
        makeSummaryDrop({
          priceGbp: 4.5,
          handle: "first_drinker",
          authorityKey: "venue-authority-a",
          createdAt: "2026-05-30T10:00:00.000Z",
        }),
        makeSummaryDrop({
          priceGbp: 4.6,
          handle: "second_drinker",
          authorityKey: "venue-authority-b",
          createdAt: "2026-05-29T10:00:00.000Z",
        }),
      ];
      const candidate = corroboratedPriceDrop(drops, NOW);
      expect(candidate?.priceGbp).toBe(4.5);
    });

    it("returns null for a single drop, however fresh", () => {
      expect(corroboratedPriceDrop([makeSummaryDrop({ priceGbp: 4.5 })], NOW)).toBeNull();
    });
  });

  describe("provisionalPintDropVenueIds", () => {
    it("a lone in-window drop marks the venue provisional (visibility without authority)", () => {
      const ids = provisionalPintDropVenueIds(
        new Map([["venue-a", [makeSummaryDrop({ priceGbp: 4.5 })]]]),
        NOW,
      );
      expect(ids.has("venue-a")).toBe(true);
    });

    it("a corroborated lane is painting, so nothing is pending", () => {
      const ids = provisionalPintDropVenueIds(
        new Map([["venue-a", corroboratedPair(4.5)]]),
        NOW,
      );
      expect(ids.size).toBe(0);
    });

    it("demo-only, note-only, and aged-out lanes never mark", () => {
      const ids = provisionalPintDropVenueIds(
        new Map([
          ["venue-demo", [makeSummaryDrop({ provenance: "demo", priceGbp: 4.5 })]],
          ["venue-note", [makeSummaryDrop({ passedDownNote: "Grandad's local." })]],
          [
            "venue-aged",
            [makeSummaryDrop({ priceGbp: 4.5, createdAt: "2026-01-01T00:00:00.000Z" })],
          ],
        ]),
        NOW,
      );
      expect(ids.size).toBe(0);
    });
  });
});

describe("formatFreshness", () => {
  const now = new Date("2026-07-06T12:00:00.000Z");

  it("returns empty string for missing/invalid input", () => {
    expect(formatFreshness(null, now)).toBe("");
    expect(formatFreshness(undefined, now)).toBe("");
    expect(formatFreshness("", now)).toBe("");
    expect(formatFreshness("not-a-date", now)).toBe("");
  });

  it("collapses sub-minute and future ages to 'just now'", () => {
    expect(formatFreshness("2026-07-06T11:59:30.000Z", now)).toBe("logged just now");
    // Future timestamp (clock skew) never claims a negative age.
    expect(formatFreshness("2026-07-06T13:00:00.000Z", now)).toBe("logged just now");
  });

  it("formats minutes, hours and days at the boundaries", () => {
    expect(formatFreshness("2026-07-06T11:58:00.000Z", now)).toBe("logged 2m ago");
    // 59 minutes stays minutes; 60 rolls to hours.
    expect(formatFreshness("2026-07-06T11:01:00.000Z", now)).toBe("logged 59m ago");
    expect(formatFreshness("2026-07-06T11:00:00.000Z", now)).toBe("logged 1h ago");
    expect(formatFreshness("2026-07-06T10:00:00.000Z", now)).toBe("logged 2h ago");
    // 23h stays hours; 24h rolls to a singular day.
    expect(formatFreshness("2026-07-05T13:00:00.000Z", now)).toBe("logged 23h ago");
    expect(formatFreshness("2026-07-05T12:00:00.000Z", now)).toBe("logged 1 day ago");
    expect(formatFreshness("2026-07-03T12:00:00.000Z", now)).toBe("logged 3 days ago");
  });

  it("accepts epoch milliseconds from map venue signals", () => {
    expect(
      formatFreshness(now.getTime() - 2 * 60_000, now),
    ).toBe("logged 2m ago");
  });
});

describe("formatObservedAt", () => {
  const now = new Date("2026-07-06T12:00:00.000Z");

  it("returns empty string for missing/invalid input", () => {
    expect(formatObservedAt(null, now)).toBe("");
    expect(formatObservedAt(undefined, now)).toBe("");
    expect(formatObservedAt("", now)).toBe("");
    expect(formatObservedAt("not-a-date", now)).toBe("");
  });

  it("mirrors formatFreshness ages with an observed verb", () => {
    expect(formatObservedAt("2026-07-06T11:59:30.000Z", now)).toBe("observed just now");
    expect(formatObservedAt("2026-07-06T13:00:00.000Z", now)).toBe("observed just now");
    expect(formatObservedAt("2026-07-06T11:58:00.000Z", now)).toBe("observed 2m ago");
    expect(formatObservedAt("2026-07-06T10:00:00.000Z", now)).toBe("observed 2h ago");
    expect(formatObservedAt("2026-07-05T12:00:00.000Z", now)).toBe("observed 1 day ago");
    expect(formatObservedAt("2026-07-03T12:00:00.000Z", now)).toBe("observed 3 days ago");
  });
});

describe("crawlSummary", () => {
  it("total sums cheapest prices", () => {
    const venues = groupVenuePrices([
      makeRow({ address: "A", latitude: 51.5, longitude: -0.1, price_gbp: 5 }),
      makeRow({ address: "B", latitude: 51.6, longitude: -0.2, price_gbp: 6 }),
    ]);
    expect(crawlSummary(venues).total).toBe(11);
  });

  it("distance is 0 for a single-stop route", () => {
    const venues = groupVenuePrices([makeRow()]);
    expect(crawlSummary(venues).distance).toBe(0);
  });
});
