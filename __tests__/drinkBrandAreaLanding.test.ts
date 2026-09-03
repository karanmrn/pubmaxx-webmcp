import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DRINK_BRAND_AREA_PUBLICATION_FLOOR,
  buildDrinkBrandAreaLanding,
  listDrinkBrandAreaLandings,
  listDrinkBrandAreaLandingsForBrand,
  type DrinkBrandAreaLanding,
} from "@/lib/drinkBrandAreaLanding";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { haversineKm } from "@/lib/haversine";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import {
  PRICED_LANDING_ROW_LIMIT,
  assignVenueToNightArea,
  nightAreaPublishesPrices,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import {
  NIGHT_AREAS,
  getNightArea,
  isNightAreaRouteReady,
  type NightArea,
} from "@/lib/nightAreas";
import { selectDrinkBrandPriceForVenue } from "@/lib/drinkBrandLanding";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { type Venue, type VenuePrice } from "@/lib/venues";

async function realVenues(): Promise<Venue[]> {
  return loadPintPriceLandingVenues();
}

function priceRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "price-1",
    pub_name: "Test Pub",
    pint_name: "Guinness",
    price_gbp: 4.5,
    price_text: "£4.50",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "Camden",
    boroughs_raw_embedded_non_anomaly: "Camden",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "1",
    estimated_average_price_text: "£5.00",
    pub_url: "https://www.pint-prices.com/pub/test-pub",
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
    source_datasets: "pint-prices",
    source_row_count: 1,
    has_visible_borough_row: true,
    has_raw_embedded_map_row: true,
    has_individual_pub_page_row: true,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

function venueAt(
  id: string,
  lat: number,
  lng: number,
  rows: VenuePrice[] = [],
  overrides: Partial<Venue> = {},
): Venue {
  return {
    id,
    name: id,
    address: "1 Test Street",
    latitude: lat,
    longitude: lng,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: rows,
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
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
    sourceDatasets: ["pint-prices"],
    curation: {},
    ...overrides,
  } as Venue;
}

function pricedVenue(
  id: string,
  area: NightArea,
  price = 4.5,
  overrides: Partial<VenuePrice> = {},
): Venue {
  return venueAt(
    id,
    area.centre.lat,
    area.centre.lng,
    [
      priceRow({
        app_price_id: `price-${id}`,
        pub_name: id,
        price_gbp: price,
        ...overrides,
      }),
    ],
  );
}

function enoughVenues(
  area: NightArea,
  count: number,
  price = 4.5,
): Venue[] {
  return Array.from({ length: count }, (_, index) =>
    pricedVenue(`${area.slug}-${String(index).padStart(2, "0")}`, area, price + index / 100),
  );
}

describe("governed drink brand by Night Area landings", () => {
  it("keeps pair model signatures, tuple rows, and publication constants fixed", () => {
    expect(DRINK_BRAND_AREA_PUBLICATION_FLOOR).toBe(10);
    expect(PRICED_LANDING_ROW_LIMIT).toBe(20);
    expectTypeOf(buildDrinkBrandAreaLanding).toEqualTypeOf<
      (
        areaSlug: string,
        brandSlug: string,
        venues: readonly Venue[],
        areas?: readonly NightArea[],
      ) => DrinkBrandAreaLanding | null
    >();
    expectTypeOf(listDrinkBrandAreaLandings).toEqualTypeOf<
      (
        venues: readonly Venue[],
        areas?: readonly NightArea[],
      ) => DrinkBrandAreaLanding[]
    >();
    expectTypeOf<DrinkBrandAreaLanding["rows"]>().toEqualTypeOf<
      [PricedLandingRow, ...PricedLandingRow[]]
    >();
  });

  it("refuses unknown pairs, not-ready areas, and pairs below the floor", () => {
    const readyArea = getNightArea("clapham");
    const notReadyArea = getNightArea("barnes");

    expect(buildDrinkBrandAreaLanding("unknown", "guinness", [])).toBeNull();
    expect(buildDrinkBrandAreaLanding("clapham", "unknown", [])).toBeNull();
    expect(
      buildDrinkBrandAreaLanding(
        readyArea.slug,
        "guinness",
        enoughVenues(readyArea, DRINK_BRAND_AREA_PUBLICATION_FLOOR - 1),
        [readyArea],
      ),
    ).toBeNull();
    expect(
      buildDrinkBrandAreaLanding(
        notReadyArea.slug,
        "guinness",
        enoughVenues(notReadyArea, DRINK_BRAND_AREA_PUBLICATION_FLOOR),
        [notReadyArea],
      ),
    ).toBeNull();
  });

  it("keeps publishing an indexed pair after the area review window lapses", () => {
    const area = getNightArea("clapham");
    const lapsed: NightArea = {
      ...area,
      lastReviewedAt: "2026-01-01T00:00:00.000Z",
      reviewExpiresAt: "2026-02-01T00:00:00.000Z",
    };

    // Route readiness expires because planning a crawl on unchecked transport
    // is wrong. A priced list is not a route, and 404ing a URL already in the
    // sitemap deindexes it, so the page degrades instead of disappearing.
    expect(isNightAreaRouteReady(lapsed, new Date("2026-08-15T12:00:00.000Z"))).toBe(false);
    expect(nightAreaPublishesPrices(lapsed)).toBe(true);
    expect(
      buildDrinkBrandAreaLanding(
        lapsed.slug,
        "guinness",
        enoughVenues(lapsed, DRINK_BRAND_AREA_PUBLICATION_FLOOR),
        [lapsed],
      )?.rows,
    ).toHaveLength(DRINK_BRAND_AREA_PUBLICATION_FLOOR);
  });

  it("still requires the gate version and completeness predicates after dropping expiry", () => {
    const area = getNightArea("clapham");
    const venues = enoughVenues(area, DRINK_BRAND_AREA_PUBLICATION_FLOOR);

    const wrongVersion: NightArea = {
      ...area,
      gate: {
        ...area.gate,
        version: 0 as NightArea["gate"]["version"],
      },
    };
    const incompleteReasons: NightArea = {
      ...area,
      routeReadyReasons: area.routeReadyReasons.slice(0, 1),
    };
    const incompleteGate: NightArea = {
      ...area,
      gate: { ...area.gate, checks: [] },
    };

    expect(nightAreaPublishesPrices(area)).toBe(true);
    expect(nightAreaPublishesPrices(wrongVersion)).toBe(false);
    expect(nightAreaPublishesPrices(incompleteReasons)).toBe(false);
    expect(nightAreaPublishesPrices(incompleteGate)).toBe(false);
    expect(
      buildDrinkBrandAreaLanding(wrongVersion.slug, "guinness", venues, [wrongVersion]),
    ).toBeNull();
    expect(
      buildDrinkBrandAreaLanding(
        incompleteReasons.slug,
        "guinness",
        venues,
        [incompleteReasons],
      ),
    ).toBeNull();
    expect(
      buildDrinkBrandAreaLanding(incompleteGate.slug, "guinness", venues, [incompleteGate]),
    ).toBeNull();
  });

  it("requires ten unique matching pubs for the publication floor", () => {
    const area = getNightArea("clapham");
    const nineUnique = enoughVenues(
      area,
      DRINK_BRAND_AREA_PUBLICATION_FLOOR - 1,
    );
    const duplicate = nineUnique[0]!;

    expect(
      buildDrinkBrandAreaLanding(
        area.slug,
        "guinness",
        [...nineUnique, duplicate, duplicate],
        [area],
      ),
    ).toBeNull();

    const tenUnique = [
      ...nineUnique,
      pricedVenue("clapham-10", area),
    ];
    const landing = buildDrinkBrandAreaLanding(
      area.slug,
      "guinness",
      [...tenUnique, duplicate],
      [area],
    );

    const rowIds = landing?.rows.map((row) => row.venueId) ?? [];
    expect(landing?.totalPricedVenues).toBe(10);
    expect(new Set(rowIds).size).toBe(rowIds.length);
    expect(rowIds).toContain(duplicate.id);
  });

  it("assigns an overlapping pub to one nearest Night Area", () => {
    const clapham = getNightArea("clapham");
    const brixton = getNightArea("brixton");
    const venue = venueAt(
      "overlap",
      (clapham.centre.lat + brixton.centre.lat) / 2,
      (clapham.centre.lng + brixton.centre.lng) / 2,
    );
    const expected = [clapham, brixton]
      .map((area) => ({
        area,
        distance: haversineKm(
          [venue.longitude, venue.latitude],
          [area.centre.lng, area.centre.lat],
        ),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance || left.area.slug.localeCompare(right.area.slug),
      )[0]!.area;

    expect(assignVenueToNightArea(venue, [clapham, brixton])?.slug).toBe(expected.slug);
  });

  it("assigns a shared matching pub to only its nearest overlapping route-ready area", () => {
    const left = {
      ...getNightArea("clapham"),
      centre: { lat: 51.5, lng: -0.14 },
      radiusKm: 1,
    };
    const right = {
      ...getNightArea("victoria"),
      centre: { lat: 51.5, lng: -0.13 },
      radiusKm: 1,
    };
    const shared = venueAt(
      "shared",
      51.5,
      -0.136,
      [
        priceRow({
          app_price_id: "shared-price",
          pub_name: "Shared",
          price_gbp: 4.25,
        }),
      ],
    );
    const areas = [left, right];
    const venues = [
      ...enoughVenues(left, DRINK_BRAND_AREA_PUBLICATION_FLOOR),
      ...enoughVenues(right, DRINK_BRAND_AREA_PUBLICATION_FLOOR),
      shared,
    ];

    const leftLanding = buildDrinkBrandAreaLanding(
      left.slug,
      "guinness",
      venues,
      areas,
    );
    const rightLanding = buildDrinkBrandAreaLanding(
      right.slug,
      "guinness",
      venues,
      areas,
    );

    expect(leftLanding?.totalPricedVenues).toBe(11);
    expect(leftLanding?.rows.some((row) => row.venueId === shared.id)).toBe(true);
    expect(rightLanding?.totalPricedVenues).toBe(10);
    expect(rightLanding?.rows.some((row) => row.venueId === shared.id)).toBe(false);
  });

  it("selects one exact cheapest matching brand row without mutating a pub's prices", () => {
    const rows = [
      priceRow({ app_price_id: "expensive", pint_name: "Guinness Extra", price_gbp: 6 }),
      priceRow({ app_price_id: "cheap", pint_name: "Guinness Draught", price_gbp: 4 }),
      priceRow({ app_price_id: "other", pint_name: "Amstel", price_gbp: 3 }),
      priceRow({ app_price_id: "invalid", pint_name: "Guinness", price_gbp: Number.NaN }),
    ];
    const venue = venueAt("exact", 51.46, -0.138, rows);
    const originalRows = [...venue.prices];

    expect(selectDrinkBrandPriceForVenue(venue, DRINK_BRANDS.beer[0]!)).toBe(rows[1]);
    expect(venue.prices).toEqual(originalRows);
  });

  it("excludes non-pub venues and invalid brand prices from pair coverage", () => {
    const area = getNightArea("clapham");
    const valid = enoughVenues(area, DRINK_BRAND_AREA_PUBLICATION_FLOOR);
    const ignored = [
      pricedVenue("bar", area, 1, { pint_name: "Guinness", app_price_id: "bar-price" }),
      pricedVenue("invalid", area, 1, { pint_name: "Guinness", price_gbp: 0, app_price_id: "invalid-price" }),
    ].map((venue, index) => ({ ...venue, kind: index === 0 ? "bar" : undefined } as Venue));

    const landing = buildDrinkBrandAreaLanding(
      area.slug,
      "guinness",
      [...valid, ...ignored],
      [area],
    );

    expect(landing?.totalPricedVenues).toBe(DRINK_BRAND_AREA_PUBLICATION_FLOOR);
    expect(landing?.rows.some((row) => row.venueId === "bar")).toBe(false);
    expect(landing?.rows.some((row) => row.venueId === "invalid")).toBe(false);
    expect(isPubVenueKind("bar")).toBe(false);
  });

  it("ranks deterministic ties by price, pub name, then pub id", () => {
    const area = getNightArea("clapham");
    const nameFirst = pricedVenue("z-id", area, 4, {
      pub_name: "Alpha Pub",
      app_price_id: "z-price",
    });
    nameFirst.name = "Alpha Pub";
    const nameSecond = pricedVenue("a-id", area, 4, {
      pub_name: "Beta Pub",
      app_price_id: "a-price",
    });
    nameSecond.name = "Beta Pub";
    const sameNameZ = pricedVenue("z-same", area, 4, {
      pub_name: "Same Pub",
      app_price_id: "z-same-price",
    });
    sameNameZ.name = "Same Pub";
    const sameNameA = pricedVenue("a-same", area, 4, {
      pub_name: "Same Pub",
      app_price_id: "a-same-price",
    });
    sameNameA.name = "Same Pub";
    const venues = [
      nameFirst,
      nameSecond,
      sameNameZ,
      sameNameA,
      pricedVenue("cheap", area, 3, { pub_name: "Cheap Name", app_price_id: "cheap-price" }),
      ...enoughVenues(area, 6, 5),
    ];
    nameFirst.prices.push(
      priceRow({ app_price_id: "a-row", pint_name: "Guinness A", price_gbp: 4, pub_name: "Same Name" }),
    );

    const landing = buildDrinkBrandAreaLanding(area.slug, "guinness", venues, [area]);

    expect(landing?.rows.slice(0, 3).map((row) => row.venueId)).toEqual([
      "cheap",
      "z-id",
      "a-id",
    ]);
    expect(landing?.rows.slice(3, 5).map((row) => row.venueId)).toEqual([
      "a-same",
      "z-same",
    ]);
    expect(selectDrinkBrandPriceForVenue(venues[0]!, DRINK_BRANDS.beer[0]!)?.app_price_id).toBe(
      "a-row",
    );
  });

  it("caps rendered rows at 20 while retaining full eligible count", () => {
    const area = getNightArea("clapham");
    const landing = buildDrinkBrandAreaLanding(
      area.slug,
      "guinness",
      enoughVenues(area, PRICED_LANDING_ROW_LIMIT + 1),
      [area],
    );

    expect(landing?.totalPricedVenues).toBe(PRICED_LANDING_ROW_LIMIT + 1);
    expect(landing?.rows).toHaveLength(PRICED_LANDING_ROW_LIMIT);
    expect(landing?.rows.map((row) => row.rank)).toEqual(
      Array.from({ length: PRICED_LANDING_ROW_LIMIT }, (_, index) => index + 1),
    );
  });

  it("uses one shared collection date and the exact displayed-row publisher", () => {
    const area = getNightArea("clapham");
    const venues = enoughVenues(area, DRINK_BRAND_AREA_PUBLICATION_FLOOR);
    venues[0]!.prices = [
      priceRow({
        app_price_id: "missing-expensive",
        pub_name: "Conflicting Source",
        pint_name: "Guinness Extra",
        price_gbp: 3.5,
        pub_url: "",
      }),
      priceRow({
        app_price_id: "named-cheapest",
        pub_name: "Conflicting Source",
        pint_name: "Guinness Draught",
        price_gbp: 3,
        pub_url: "https://www.pint-prices.com/pub/named-source",
      }),
    ];
    venues[1]!.prices[0] = priceRow({
      app_price_id: "missing-source",
      pub_name: "Missing Source",
      pint_name: "Guinness Draught",
      price_gbp: 3.1,
      pub_url: "",
    });

    const landing = buildDrinkBrandAreaLanding(area.slug, "guinness", venues, [area]);

    expect(landing).toMatchObject({
      areaSlug: "clapham",
      areaName: "Clapham",
      brandSlug: "guinness",
      brandLabel: "Guinness",
      collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
      totalPricedVenues: 10,
    });
    expect(landing?.rows[0]).toMatchObject({
      venueId: venues[0]!.id,
      pintName: "Guinness Draught",
      priceGbp: 3,
      publisher: {
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/named-source",
      },
    });
    expect(landing?.rows[1]?.publisher).toBeNull();
  });

  // The brand page needs its OWN pairs, so it asks for them rather than
  // building every brand's and discarding the rest on every request.
  it("answers one brand's pairs exactly as the whole list filtered to it", async () => {
    const venues = await realVenues();
    const everyPair = listDrinkBrandAreaLandings(venues, NIGHT_AREAS);

    for (const brand of DRINK_BRANDS.beer) {
      expect(listDrinkBrandAreaLandingsForBrand(brand.id, venues, NIGHT_AREAS)).toEqual(
        everyPair.filter((landing) => landing.brandSlug === brand.id),
      );
    }
    expect(
      listDrinkBrandAreaLandingsForBrand("not-a-brand", venues, NIGHT_AREAS),
    ).toEqual([]);
    expect(
      listDrinkBrandAreaLandingsForBrand("guinness", venues, NIGHT_AREAS).length,
    ).toBeGreaterThan(0);
  });

  // Derived from the publishing areas and the brand catalogue rather than from
  // today's figures: a dataset refresh, or a pair that drops below the floor,
  // is a legitimate change in which pairs publish and how many pubs each holds.
  it("publishes eligible pairs over the floor, in area then catalogue order", async () => {
    const venues = await realVenues();
    const landings = listDrinkBrandAreaLandings(venues, NIGHT_AREAS);

    expect(landings.length).toBeGreaterThan(0);

    const pairOrder = NIGHT_AREAS.filter(nightAreaPublishesPrices).flatMap((area) =>
      DRINK_BRANDS.beer.map((brand) => `${area.slug}/${brand.id}`),
    );
    const published = landings.map(
      (landing) => `${landing.areaSlug}/${landing.brandSlug}`,
    );

    expect(published).toEqual(pairOrder.filter((pair) => published.includes(pair)));

    for (const landing of landings) {
      expect(landing.totalPricedVenues).toBeGreaterThanOrEqual(
        DRINK_BRAND_AREA_PUBLICATION_FLOOR,
      );
      expect(landing.collectedAt).toBe(PINT_DATASET_OBSERVED_AT.toISOString());
    }

    // A pair the list withheld is one the dataset cannot carry, never one this
    // ordering dropped.
    for (const pair of pairOrder) {
      if (published.includes(pair)) continue;
      const [areaSlug, brandSlug] = pair.split("/");
      expect(
        buildDrinkBrandAreaLanding(areaSlug!, brandSlug!, venues, NIGHT_AREAS),
      ).toBeNull();
    }
  });
});
