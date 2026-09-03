import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DRINK_BRAND_LANDING_PUBLICATION_FLOOR,
  type DrinkBrandLanding,
  buildDrinkBrandLanding,
  listDrinkBrandLandings,
} from "@/lib/drinkBrandLanding";
import {
  PRICED_LANDING_ROW_LIMIT,
  formatPricedLandingPintName,
  formatPricedLandingPublisherStatus,
  pricedLandingAreaMapCta,
  pricedLandingBrandAreaLinks,
  pricedLandingLogCta,
  pricedLandingMapArrivalRow,
  pricedLandingMapHref,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import {
  loadMapSelectableVenueIds,
  resetMapEagerVenueIndexForTests,
} from "@/lib/mapEagerVenueIndex.server";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const DATASET_FILE = path.join(
  process.cwd(),
  "public",
  "data",
  "pint_prices_app_dataset.json",
);

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
    pub_url: "https://www.pint-prices.com/pub/exact",
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

function venue(
  id: string,
  rows: VenuePrice[],
  overrides: Partial<Venue> = {},
): Venue {
  return {
    id,
    name: id,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
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

describe("governed drink brand landings", () => {
  it("refuses unknown brands and brands below the publication floor", () => {
    const belowFloor = Array.from(
      { length: DRINK_BRAND_LANDING_PUBLICATION_FLOOR - 1 },
      (_, index) =>
        venue(`below-${index}`, [
          priceRow({
            app_price_id: `below-price-${index}`,
            pub_name: `Below ${index}`,
          }),
        ]),
    );

    expect(buildDrinkBrandLanding("not-real", [])).toBeNull();
    expect(buildDrinkBrandLanding("guinness", belowFloor)).toBeNull();
  });

  it("keeps the fixed builder signature and non-empty landing row invariant", () => {
    expectTypeOf(buildDrinkBrandLanding).toEqualTypeOf<
      (slug: string, venues: readonly Venue[]) => DrinkBrandLanding | null
    >();
    expectTypeOf<DrinkBrandLanding["rows"]>().toEqualTypeOf<
      [PricedLandingRow, ...PricedLandingRow[]]
    >();
  });

  it("formats one exact publisher status for named and missing rows", () => {
    expect(
      formatPricedLandingPublisherStatus({
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/exact",
      }),
    ).toBe("Publisher: Pint Prices");
    expect(formatPricedLandingPublisherStatus(null)).toBe(
      "Publisher not recorded",
    );
  });

  it("keeps only valid pub rows and binds one cheapest exact row per pub", () => {
    const model = buildDrinkBrandLanding("guinness", [
        venue("non-pub", [priceRow()], { kind: "bar" }),
        venue("invalid", [
          priceRow({ app_price_id: "invalid-null", price_gbp: null }),
          priceRow({ app_price_id: "invalid-zero", price_gbp: 0 }),
          priceRow({ app_price_id: "invalid-negative", price_gbp: -1 }),
          priceRow({ app_price_id: "invalid-nan", price_gbp: Number.NaN }),
        ]),
        venue("wrong-brand", [priceRow({ pint_name: "Amstel" })]),
        venue("alpha-a", [
          priceRow({
            app_price_id: "alpha-expensive",
            pint_name: "Guinness Extra",
            price_gbp: 6,
          }),
          priceRow({
            app_price_id: "alpha-cheap",
            pint_name: "Guinness Draught",
            price_gbp: 4,
          }),
        ]),
        venue("publisher-missing", [
          priceRow({ app_price_id: "missing-source", price_gbp: 4.25, pub_url: "" }),
        ]),
        ...Array.from({ length: 18 }, (_, index) =>
          venue(`filler-${index}`, [
            priceRow({
              app_price_id: `filler-price-${index}`,
              pub_name: `Filler ${index}`,
              price_gbp: 10 + index,
            }),
          ]),
        ),
      ]);

    expect(model?.rows.slice(0, 2).map((row) => row.venueId)).toEqual([
      "alpha-a",
      "publisher-missing",
    ]);
    expect(model?.rows[0]).toMatchObject({
      rank: 1,
      venueId: "alpha-a",
      venueName: "alpha-a",
      borough: "Camden",
      pintName: "Guinness Draught",
      priceGbp: 4,
      publisher: {
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/exact",
      },
    });
    expect(model?.rows[1]?.publisher).toBeNull();
    expect(model?.totalPricedVenues).toBe(20);
    expect(model?.collectedAt).toBe(PINT_DATASET_OBSERVED_AT.toISOString());
  });

  it("breaks equal row prices by app price id and ranked pub ties by name then id", () => {
    const model = buildDrinkBrandLanding("guinness", [
        venue("alpha-b", [
          priceRow({ app_price_id: "b", pub_name: "Alpha B", price_gbp: 4 }),
        ]),
        venue("alpha-a", [
          priceRow({ app_price_id: "a", pint_name: "Guinness Z", pub_name: "Alpha A", price_gbp: 4 }),
          priceRow({ app_price_id: "a", pint_name: "Guinness A", pub_name: "Alpha A", price_gbp: 4 }),
          priceRow({ app_price_id: "z", pub_name: "Alpha A", price_gbp: 4 }),
        ]),
        venue("cheap", [priceRow({ app_price_id: "cheap", price_gbp: 3 })]),
        ...Array.from({ length: 17 }, (_, index) =>
          venue(`filler-${index}`, [
            priceRow({
              app_price_id: `filler-price-${index}`,
              pub_name: `Filler ${index}`,
              price_gbp: 10 + index,
            }),
          ]),
        ),
      ]);

    expect(model?.rows.slice(0, 3).map((row) => row.venueId)).toEqual([
      "cheap",
      "alpha-a",
      "alpha-b",
    ]);
    expect(model?.rows[1]).toMatchObject({
      venueId: "alpha-a",
      pintName: "Guinness A",
      priceGbp: 4,
    });
  });

  it("caps displayed rows while keeping the full eligible pub count", () => {
    const venues = Array.from({ length: PRICED_LANDING_ROW_LIMIT + 1 }, (_, index) =>
      venue(`venue-${String(index).padStart(2, "0")}`, [
        priceRow({
          app_price_id: `price-${index}`,
          pub_name: `Venue ${String(index).padStart(2, "0")}`,
          price_gbp: 4 + index / 100,
        }),
      ]),
    );

    const model = buildDrinkBrandLanding("guinness", venues);

    expect(model?.totalPricedVenues).toBe(PRICED_LANDING_ROW_LIMIT + 1);
    expect(model?.rows).toHaveLength(PRICED_LANDING_ROW_LIMIT);
    expect(model?.rows.map((row) => row.rank)).toEqual(
      Array.from({ length: PRICED_LANDING_ROW_LIMIT }, (_, index) => index + 1),
    );
  });

  // Derived from the loader rather than pinned to today's dataset: a refresh,
  // or one new brand below the floor, is a legitimate change in the numbers and
  // may not fail this contract.
  it("publishes beer brands over the floor, in catalogue order", async () => {
    const raw = JSON.parse(await readFile(DATASET_FILE, "utf8")) as VenuePrice[];
    const venues = groupVenuePrices(raw);
    const landings = listDrinkBrandLandings(venues);

    expect(landings.length).toBeGreaterThan(0);

    const catalogueOrder = DRINK_BRANDS.beer.map((brand) => brand.id);
    expect(landings.map((landing) => landing.slug)).toEqual(
      catalogueOrder.filter((id) =>
        landings.some((landing) => landing.slug === id),
      ),
    );

    for (const landing of landings) {
      expect(landing.totalPricedVenues).toBeGreaterThanOrEqual(
        DRINK_BRAND_LANDING_PUBLICATION_FLOOR,
      );
    }

    // A brand the loader withheld is one the dataset cannot carry, never one
    // the catalogue forgot.
    for (const brand of DRINK_BRANDS.beer) {
      if (landings.some((landing) => landing.slug === brand.id)) continue;
      expect(buildDrinkBrandLanding(brand.id, venues)).toBeNull();
    }
  });

  it("loads a non-empty grouped Pint Price dataset through the shared reader", async () => {
    const venues = await loadPintPriceLandingVenues();

    expect(venues.length).toBeGreaterThan(0);
    expect(venues.every((item) => item.prices.length > 0)).toBe(true);
  });
});

describe("priced landing map arrivals", () => {
  function row(venueId: string, rank: number, priceGbp: number): PricedLandingRow {
    return {
      rank,
      venueId,
      venueName: `Pub ${rank}`,
      borough: "Camden",
      pintName: "Guinness",
      priceGbp,
      publisher: null,
    };
  }

  const rows = [row("outer-1", 1, 3.09), row("core-1", 2, 3.5), row("core-2", 3, 4)];

  it("takes the cheapest row the map can open, not always rank 1", () => {
    expect(
      pricedLandingMapArrivalRow(rows, new Set(["core-1", "core-2"]))?.venueId,
    ).toBe("core-1");
  });

  it("names no pub when the map can open none of them", () => {
    expect(pricedLandingMapArrivalRow(rows, new Set(["elsewhere"]))).toBeNull();
  });

  it("names no pub when the eligibility read could not answer", () => {
    // Null is "we could not tell", never "nothing is selectable".
    expect(pricedLandingMapArrivalRow(rows, null)).toBeNull();
  });

  it("carries a named pub, the brand and the log intent in that order", () => {
    expect(
      pricedLandingMapHref({ brandSlug: "guinness", venueId: "core-1", log: true }),
    ).toBe("/map?sel=core-1&brand=guinness&log=1");
    expect(pricedLandingMapHref({ brandSlug: "guinness", venueId: "core-1" })).toBe(
      "/map?sel=core-1&brand=guinness",
    );
  });

  it("drops sel rather than naming a pub the map would discard", () => {
    expect(pricedLandingMapHref({ brandSlug: "guinness", log: true })).toBe(
      "/map?brand=guinness&log=1",
    );
    expect(
      pricedLandingMapHref({ brandSlug: "guinness", venueId: null, log: true }),
    ).not.toContain("sel=");
  });

  it("escapes a brand slug and a venue id that carry URL syntax", () => {
    expect(
      pricedLandingMapHref({ brandSlug: "a&b", venueId: "venue x", log: true }),
    ).toBe("/map?sel=venue+x&brand=a%26b&log=1");
  });

  it("pairs the area arrival words with the link the map will actually open", () => {
    const first = rows[0]!;

    expect(
      pricedLandingAreaMapCta({
        brandSlug: "guinness",
        brandLabel: "Guinness",
        areaName: "Clapham",
        row: first,
        selectable: new Set([first.venueId]),
      }),
    ).toEqual({
      href: "/map?sel=outer-1&brand=guinness",
      label: "Open the cheapest Clapham pint on the map",
    });
    expect(
      pricedLandingAreaMapCta({
        brandSlug: "guinness",
        brandLabel: "Guinness",
        areaName: "Clapham",
        row: first,
        selectable: new Set<string>(),
      }),
    ).toEqual({
      href: "/map?brand=guinness",
      label: "Find Guinness on the map",
    });
  });

  it("pairs Log this price with a named pub, and a generic log when sel drops", () => {
    expect(
      pricedLandingLogCta({
        brandSlug: "guinness",
        brandLabel: "Guinness",
        venueId: "core-1",
      }),
    ).toEqual({
      href: "/map?sel=core-1&brand=guinness&log=1",
      label: "Log this price",
    });
    expect(
      pricedLandingLogCta({
        brandSlug: "guinness",
        brandLabel: "Guinness",
        venueId: null,
      }),
    ).toEqual({
      href: "/map?brand=guinness&log=1",
      label: "Log a Guinness pint price",
    });
  });

  it("keeps the hero log CTA about the brand whichever href it gets", () => {
    expect(
      pricedLandingLogCta({
        brandSlug: "guinness",
        brandLabel: "Guinness",
        venueId: "core-1",
        surface: "hero",
      }),
    ).toEqual({
      href: "/map?sel=core-1&brand=guinness&log=1",
      label: "Log a Guinness pint price",
    });
    expect(
      pricedLandingLogCta({
        brandSlug: "guinness",
        brandLabel: "Guinness",
        venueId: null,
        surface: "hero",
      }),
    ).toEqual({
      href: "/map?brand=guinness&log=1",
      label: "Log a Guinness pint price",
    });
  });

  it("lists only this brand's published area pages, in the order they arrived", () => {
    expect(
      pricedLandingBrandAreaLinks("guinness", [
        { brandSlug: "guinness", areaSlug: "clapham", areaName: "Clapham" },
        { brandSlug: "amstel", areaSlug: "clapham", areaName: "Clapham" },
        { brandSlug: "guinness", areaSlug: "victoria", areaName: "Victoria" },
      ]),
    ).toEqual([
      { href: "/area/clapham/drink/guinness", label: "Clapham" },
      { href: "/area/victoria/drink/guinness", label: "Victoria" },
    ]);
  });

  it("title-cases an all-caps drink tag and keeps only the known capital tokens", () => {
    expect(formatPricedLandingPintName("GUINNESS")).toBe("Guinness");
    expect(formatPricedLandingPintName("Guinness Draught")).toBe("Guinness Draught");
    // A short word is not an acronym: the length rule shouted half of a tag.
    expect(formatPricedLandingPintName("NECK OIL")).toBe("Neck Oil");
    expect(formatPricedLandingPintName("BEVERTOWN NECK OIL")).toBe(
      "Bevertown Neck Oil",
    );
    expect(formatPricedLandingPintName("MCMULLEN AK")).toBe("Mcmullen Ak");
    // Every listed capital token survives, inside a shout and inside mixed case.
    expect(formatPricedLandingPintName("ALPACALYPSE SESSION IPA")).toBe(
      "Alpacalypse Session IPA",
    );
    expect(formatPricedLandingPintName("Greeneking IPA")).toBe("Greeneking IPA");
    expect(formatPricedLandingPintName("CRAZY HORSE APA")).toBe("Crazy Horse APA");
    expect(formatPricedLandingPintName("ESB")).toBe("ESB");
    expect(formatPricedLandingPintName("HAZY DIPA")).toBe("Hazy DIPA");
    expect(formatPricedLandingPintName("JUICY NEIPA")).toBe("Juicy NEIPA");
    expect(formatPricedLandingPintName("SUMMER XPA")).toBe("Summer XPA");
    // An accent is a letter, so a shout may not come back out half-shouted.
    expect(formatPricedLandingPintName("STEIGL GOLDBRAÜ")).toBe("Steigl Goldbraü");
    expect(formatPricedLandingPintName("MURPHY'S")).toBe("Murphy's");
    expect(formatPricedLandingPintName("YOUNG’S ORIGINAL")).toBe("Young’s Original");
    expect(formatPricedLandingPintName("LOST ALCOHOL FREE 0.5%")).toBe(
      "Lost Alcohol Free 0.5%",
    );
  });

  it("leaves no half-shouted tag on a published brand page", async () => {
    const landings = listDrinkBrandLandings(await loadPintPriceLandingVenues());
    const tags = new Set(landings.flatMap((landing) => landing.rows.map((row) => row.pintName)));
    expect(tags.size).toBeGreaterThan(0);

    for (const tag of tags) {
      const printed = formatPricedLandingPintName(tag);
      for (const word of printed.match(/\p{L}[\p{L}\p{N}'’.-]*/gu) ?? []) {
        if (word.length < 2 || word !== word.toUpperCase()) continue;
        expect(
          ["IPA", "APA", "DIPA", "NEIPA", "ESB", "XPA"],
          `${tag} printed ${word} in capitals`,
        ).toContain(word);
      }
    }
  });

  it("reads the map's eager shard so eligibility is never a hardcoded list", async () => {
    resetMapEagerVenueIndexForTests();
    const selectable = await loadMapSelectableVenueIds();

    expect(selectable).not.toBeNull();
    expect(selectable!.size).toBeGreaterThan(0);

    const landing = buildDrinkBrandLanding(
      "guinness",
      groupVenuePrices(
        JSON.parse(await readFile(DATASET_FILE, "utf8")) as VenuePrice[],
      ),
    );
    const arrival = pricedLandingMapArrivalRow(landing!.rows, selectable);

    expect(arrival).not.toBeNull();
    expect(selectable!.has(arrival!.venueId)).toBe(true);
  });
});
