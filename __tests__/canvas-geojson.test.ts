import { describe, expect, it } from "vitest";

import {
  formatPinPriceLabel,
  priceBucket,
  pubsToGeoJSON,
  routeToLine,
  routeToStops,
  truncateStopName,
  ROUTE_STOP_LABEL_MAX,
  bandCorridorGeoJSON,
} from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import { summariseWhatsOnByVenue } from "@/lib/whatsOnBadges";
import {
  corroboratedPriceDrop,
  mergeVenueDrops,
  provisionalPintDropVenueIds,
  type SummaryDrop,
  type Venue,
} from "@/lib/venues";
import type { StoryBand } from "@/lib/storyBands";
import type { Landmark } from "@/lib/landmarks";

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
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
    sourceDatasets: [],
    curation: {},
    ...overrides,
  } as Venue;
}

describe("priceBucket", () => {
  it("maps null to 3, and price bands to 0/1/2", () => {
    expect(priceBucket(null)).toBe(3);
    expect(priceBucket(5.5)).toBe(0);
    expect(priceBucket(7)).toBe(1);
    expect(priceBucket(7.01)).toBe(2);
  });
});

describe("routeToLine", () => {
  it("returns no features for <2 stops", () => {
    expect(routeToLine([]).features).toHaveLength(0);
    expect(routeToLine([makeVenue()]).features).toHaveLength(0);
  });

  it("returns a single LineString with coords in order for >=2", () => {
    const a = makeVenue({ id: "a", longitude: -0.1, latitude: 51.5 });
    const b = makeVenue({ id: "b", longitude: -0.2, latitude: 51.6 });
    const fc = routeToLine([a, b]);
    expect(fc.features).toHaveLength(1);
    const geom = fc.features[0]?.geometry;
    expect(geom?.type).toBe("LineString");
    expect((geom as GeoJSON.LineString).coordinates).toEqual([
      [-0.1, 51.5],
      [-0.2, 51.6],
    ]);
    // Marks the instant paint as the approximate (dashed) route until the
    // /api/walk-route road geometry upgrades it.
    expect(fc.features[0]?.properties).toEqual({ source: "straight" });
  });
});

describe("truncateStopName", () => {
  it("returns a short name unchanged (at and below the budget)", () => {
    expect(truncateStopName("The Ship")).toBe("The Ship");
    // Exactly at the budget stays whole.
    const exact = "x".repeat(ROUTE_STOP_LABEL_MAX);
    expect(truncateStopName(exact)).toBe(exact);
  });

  it("trims surrounding whitespace before measuring", () => {
    expect(truncateStopName("  The Ship  ")).toBe("The Ship");
  });

  it("truncates an over-long name with a single-glyph ellipsis", () => {
    const out = truncateStopName("The Old Bank of England");
    expect(out.endsWith("…")).toBe(true);
    expect([...out]).toHaveLength(ROUTE_STOP_LABEL_MAX);
    expect(out).toBe("The Old Bank of E…");
  });

  it("drops a trailing space before the ellipsis (no 'word …')", () => {
    // The 17-char cut lands right after a space; it must not survive next to
    // the ellipsis.
    expect(truncateStopName("The Crown Anchor Tavern")).toBe(
      "The Crown Anchor…",
    );
  });

  it("honours a custom max", () => {
    expect(truncateStopName("The Winchester", 6)).toBe("The W…");
  });
});

describe("routeToStops", () => {
  it("labels stops 1..n in order and preserves ids", () => {
    const a = makeVenue({ id: "a" });
    const b = makeVenue({ id: "b" });
    const c = makeVenue({ id: "c" });
    const fc = routeToStops([a, b, c]);
    expect(fc.features.map((f) => f.properties?.label)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(fc.features.map((f) => f.properties?.id)).toEqual(["a", "b", "c"]);
  });

  it("carries the full name and a truncated plaque name per stop", () => {
    const a = makeVenue({ id: "a", name: "The Ship" });
    const b = makeVenue({ id: "b", name: "The Old Bank of England" });
    const fc = routeToStops([a, b]);
    expect(fc.features.map((f) => f.properties?.name)).toEqual([
      "The Ship",
      "The Old Bank of England",
    ]);
    expect(fc.features.map((f) => f.properties?.stopName)).toEqual([
      "The Ship",
      "The Old Bank of E…",
    ]);
  });
});

describe("bandCorridorGeoJSON", () => {
  const catalog: Landmark[] = [
    {
      id: "lm-1",
      name: "One",
      icon: "tower",
      coordinates: [-0.1, 51.5],
    } as Landmark,
    {
      id: "lm-2",
      name: "Two",
      icon: "tower",
      coordinates: [-0.2, 51.6],
    } as Landmark,
  ];

  it("is empty when the band is undefined", () => {
    expect(bandCorridorGeoJSON(undefined, catalog).features).toHaveLength(0);
  });

  it("is empty when the band resolves to <2 anchors", () => {
    const band = {
      id: "b",
      name: "B",
      anchorLandmarkIds: ["lm-1"],
    } as unknown as StoryBand;
    expect(bandCorridorGeoJSON(band, catalog).features).toHaveLength(0);
  });

  it("draws a LineString when the band resolves to >=2 anchors", () => {
    const band = {
      id: "b",
      name: "B",
      anchorLandmarkIds: ["lm-1", "lm-2"],
    } as unknown as StoryBand;
    const fc = bandCorridorGeoJSON(band, catalog);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry.type).toBe("LineString");
  });
});

describe("pubsToGeoJSON", () => {
  const signals = new Map<string, VenueSignal>();

  it("marks serves=false when a favoritePint returns no beer price", () => {
    const venue = makeVenue({ id: "no-beer" });
    const fc = pubsToGeoJSON([venue], signals, "some-unserved-beer");
    const props = fc.features[0]?.properties;
    expect(props?.serves).toBe(false);
    // No lens override, no beer price → bucket falls to null → 3.
    expect(props?.bucket).toBe(priceBucket(null));
  });

  it("falls back to venue hint categories for drinkKind without a lens", () => {
    const venue = makeVenue({
      id: "hinted",
      cheapestPrice: 6,
      filterHints: {
        searchText: "hinted",
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: false,
        scraped: false,
        drinkCategories: ["wine"],
      },
    });
    const fc = pubsToGeoJSON([venue], signals, null);
    const props = fc.features[0]?.properties;
    expect(props?.serves).toBe(true);
    expect(props?.bucket).toBe(priceBucket(6));
    expect(typeof props?.drinkKind).toBe("string");
  });

  it("defaults a hintless pub to the pint glyph, never a synthetic accent (The Black Friar)", () => {
    // venue-1sw9ofl's id hashes to the "cocktail" accent, which previously
    // painted this ale-led heritage pub with a martini pin. With no recorded
    // drinkCategories the resting pin must fall back to the honest pint glyph.
    const venue = makeVenue({ id: "venue-1sw9ofl", cheapestPrice: 6 });
    const props = pubsToGeoJSON([venue], signals, null).features[0]?.properties;
    expect(props?.drinkKind).toBe("pint");
  });

  it("keeps a hintless pub on the pint glyph even when it serves cocktails", () => {
    const venue = makeVenue({
      id: "venue-1sw9ofl",
      cheapestPrice: 6,
      amenities: { ...makeVenue().amenities, cocktails: true },
    });
    const props = pubsToGeoJSON([venue], signals, null).features[0]?.properties;
    expect(props?.drinkKind).toBe("pint");
  });

  it("uses venue-type glyphs and type-relative bands for curated non-pubs", () => {
    const bar = makeVenue({
      id: "bar",
      kind: "bar",
      priceBand: 1,
      cheapestPrice: 18,
    });
    const food = makeVenue({
      id: "food",
      kind: "food",
      priceBand: 0,
      cheapestPrice: 12,
    });
    const restaurant = makeVenue({
      id: "restaurant",
      kind: "restaurant",
      priceBand: 2,
      cheapestPrice: 35,
    });
    const [barFeature, foodFeature, restaurantFeature] = pubsToGeoJSON(
      [bar, food, restaurant],
      signals,
      null,
    ).features;
    expect(barFeature?.properties).toMatchObject({
      kind: "bar",
      drinkKind: "coupe",
      bucket: 1,
    });
    expect(foodFeature?.properties).toMatchObject({
      kind: "food",
      drinkKind: "skewer",
      bucket: 0,
    });
    expect(String(barFeature?.properties?.icon)).toContain("coupe-1");
    expect(String(foodFeature?.properties?.icon)).toContain("skewer-0");
    expect(restaurantFeature?.properties).toMatchObject({
      kind: "restaurant",
      drinkKind: "fork",
      bucket: 2,
    });
    expect(String(restaurantFeature?.properties?.icon)).toContain("fork-2");
    expect("priceLabel" in (restaurantFeature?.properties ?? {})).toBe(false);
  });
});

// The provisional badge rides on the pin pipeline as a plain boolean prop, and
// it must stay exactly that: a MARK. If it ever reaches `bucket`, one anonymous
// report would be recolouring pins - the thing the trust gate exists to stop.
describe("pubsToGeoJSON provisional mark", () => {
  const signals = new Map<string, VenueSignal>();

  it("is false for every pin when nothing is pending", () => {
    const venue = makeVenue({ id: "quiet", cheapestPrice: 6 });
    expect(
      pubsToGeoJSON([venue], signals, null).features[0]?.properties
        ?.provisional,
    ).toBe(false);
  });

  it("marks only the reported pub, and leaves its price band alone", () => {
    const marked = makeVenue({ id: "marked", cheapestPrice: 6 });
    const other = makeVenue({ id: "other", cheapestPrice: 6 });
    const [a, b] = pubsToGeoJSON(
      [marked, other],
      signals,
      null,
      null,
      null,
      new Set(["marked"]),
    ).features;
    expect(a?.properties?.provisional).toBe(true);
    expect(b?.properties?.provisional).toBe(false);
    // Colour is still the baseline's bucket on both - the badge adds a fact,
    // it never edits the price-band system.
    expect(a?.properties?.bucket).toBe(priceBucket(6));
    expect(b?.properties?.bucket).toBe(priceBucket(6));
  });
});

describe("pubsToGeoJSON experience-lens price isolation", () => {
  it("prints a category-labelled lens figure and never borrows pint state", () => {
    const venue = makeVenue({ id: "soft", cheapestPrice: 6 });
    const signals = new Map<string, VenueSignal>([
      [
        "soft",
        {
          hasPintDrops: true,
          latestContributorPrice: 5,
        },
      ],
    ]);
    const lensPrices = new Map([
      ["soft", {
        venueId: "soft",
        category: "soft-drink" as const,
        categoryLabel: "Soft drinks",
        priceGbp: 3.2,
        submittedAt: 2_000,
        source: "community" as const,
      }],
    ]);
    const props = pubsToGeoJSON(
      [venue],
      signals,
      null,
      null,
      null,
      new Set(["soft"]),
      lensPrices,
    ).features[0]?.properties ?? {};

    expect(props.priceLabel).toBe("£3.20 Soft drinks");
    expect(props.bucket).toBe(priceBucket(3.2));
    expect(props.drops).toBe(false);
    expect(props.provisional).toBe(false);
    expect(venue.cheapestPrice).toBe(6);
  });

  it("shows whisky as whisky and leaves a pint-only pub unknown", () => {
    const known = makeVenue({ id: "known", cheapestPrice: 5 });
    const pintOnly = makeVenue({ id: "pint-only", cheapestPrice: 4 });
    const lensPrices = new Map([
      ["known", {
        venueId: "known",
        category: "whisky" as const,
        categoryLabel: "Whisky",
        priceGbp: 6,
        submittedAt: 2_000,
        source: "community" as const,
      }],
    ]);

    const [knownFeature, unknownFeature] = pubsToGeoJSON(
      [known, pintOnly],
      new Map<string, VenueSignal>(),
      null,
      "whisky",
      null,
      null,
      lensPrices,
    ).features;

    expect(knownFeature?.properties).toMatchObject({
      bucket: priceBucket(6),
      priceLabel: "£6 Whisky",
    });
    expect(unknownFeature?.properties?.bucket).toBe(priceBucket(null));
    expect(unknownFeature?.properties?.priceLabel).toBeUndefined();
  });

  it("suppresses a pub's own sourced pint figure while a view owns the map", () => {
    const venue = makeVenue({ id: "pub", cheapestPrice: 5.4 });
    const withoutLens = pubsToGeoJSON(
      [venue],
      new Map<string, VenueSignal>(),
      null,
    ).features[0]?.properties ?? {};
    expect(withoutLens.priceLabel).toBe("£5.40");
    // An empty lens map still means a view owns the map, and the honest answer
    // for a pub with no figure in that view is silence, not last night's pint.
    const withLens = pubsToGeoJSON(
      [venue],
      new Map<string, VenueSignal>(),
      null,
      null,
      null,
      null,
      new Map(),
    ).features[0]?.properties ?? {};
    expect(withLens.priceLabel).toBeUndefined();
  });
});

describe("formatPinPriceLabel", () => {
  it("drops the pence on a whole pound and keeps both otherwise", () => {
    // Two dead zeroes cost a third of the glyph's width and say nothing.
    expect(formatPinPriceLabel(6)).toBe("£6");
    expect(formatPinPriceLabel(6.0)).toBe("£6");
    expect(formatPinPriceLabel(5.4)).toBe("£5.40");
    expect(formatPinPriceLabel(5.45)).toBe("£5.45");
    expect(formatPinPriceLabel(12.5)).toBe("£12.50");
  });

  it("rounds to the nearest penny rather than printing float noise", () => {
    expect(formatPinPriceLabel(5.405)).toBe("£5.41");
    expect(formatPinPriceLabel(6.999)).toBe("£7");
  });

  it("returns null for anything that is not a real, positive figure", () => {
    // A missing price is silence on this map, never a placeholder.
    for (const value of [null, undefined, 0, -1, NaN, Infinity]) {
      expect(formatPinPriceLabel(value as number | null)).toBeNull();
    }
    // …including a rounding-to-zero figure, which would print "£0".
    expect(formatPinPriceLabel(0.001)).toBeNull();
  });
});

// The pin's figure is a CLAIM about a pub, so its input stack is narrower than
// the colour band's: colour may be a hint, a number may not. These pin the
// three exclusions that keeps true.
describe("pubsToGeoJSON price label (only a sourced price gets a figure)", () => {
  const noSignals = new Map<string, VenueSignal>();
  const propsOf = (
    venue: Venue,
    signals = noSignals,
    favoritePint: string | null = null,
    provisional: ReadonlySet<string> | null = null,
  ) =>
    pubsToGeoJSON([venue], signals, favoritePint, null, null, provisional)
      .features[0]?.properties ?? {};

  it("labels a curated sourced price", () => {
    expect(
      propsOf(makeVenue({ id: "curated", cheapestPrice: 5.4 })).priceLabel,
    ).toBe("£5.40");
  });

  it("prefers a contributor price, exactly as the colour band does", () => {
    const signals = new Map<string, VenueSignal>([
      ["logged", { hasPintDrops: true, latestContributorPrice: 4.8 }],
    ]);
    const props = propsOf(
      makeVenue({ id: "logged", cheapestPrice: 6 }),
      signals,
    );
    expect(props.priceLabel).toBe("£4.80");
    expect(props.bucket).toBe(priceBucket(4.8));
  });

  it("labels the favourite-pint price under a beer lens", () => {
    const venue = makeVenue({
      id: "lensed",
      cheapestPrice: 4,
      prices: [{ pint_name: "Guinness", price_gbp: 7.2 }],
    } as Partial<Venue>);
    expect(propsOf(venue, noSignals, "guinness").priceLabel).toBe("£7.20");
  });

  it("omits the property entirely on an unpriced pub - never a placeholder", () => {
    const props = propsOf(makeVenue({ id: "unpriced" }));
    expect("priceLabel" in props).toBe(false);
    expect(props.bucket).toBe(priceBucket(null));
  });

  it("never prints a demo seed, even though the seed still tints the pin", () => {
    // The seed exists so a city pack with null cheapestPrice still reads as a
    // map. A band is a hint; "£5.20" over a pub is a claim we cannot back.
    const signals = new Map<string, VenueSignal>([
      [
        "seeded",
        {
          hasPintDrops: true,
          latestContributorPrice: null,
          latestDemoPrice: 5.2,
        },
      ],
    ]);
    const props = propsOf(makeVenue({ id: "seeded" }), signals);
    expect("priceLabel" in props).toBe(false);
    expect(props.bucket).toBe(priceBucket(5.2));
  });

  it("gives a lone provisional report a mark and no figure", () => {
    // An uncorroborated submission never reaches latestContributorPrice (the
    // gate is mergeCommunityPriceSignals), so there is nothing here to print.
    const props = propsOf(
      makeVenue({ id: "pending" }),
      noSignals,
      null,
      new Set(["pending"]),
    );
    expect(props.provisional).toBe(true);
    expect("priceLabel" in props).toBe(false);
  });

  it("still prints a curated price on a pub that also has a pending report", () => {
    // The figure shown is the one the colour band is ALREADY painting. Hiding
    // it because someone filed an unconfirmed report would be the map
    // pretending not to know a price it does know.
    const props = propsOf(
      makeVenue({ id: "pending", cheapestPrice: 6.3 }),
      noSignals,
      null,
      new Set(["pending"]),
    );
    expect(props.provisional).toBe(true);
    expect(props.priceLabel).toBe("£6.30");
  });

  it("prints nothing where a price BAND was set without a price", () => {
    // priceBand short-circuits the bucket for famous bars/food venues; the
    // label has no such shortcut, because a band is not a figure.
    const props = propsOf(
      makeVenue({ id: "banded", kind: "bar", priceBand: 1 }),
    );
    expect(props.bucket).toBe(1);
    expect("priceLabel" in props).toBe(false);
  });

  it("never prints a non-pub anchor price - the figure idiom is the pint", () => {
    // Famous bar/food rows carry their anchor price (a house cocktail, a dish)
    // as cheapestPrice in the slim index; printed bare it would read as a pint
    // price. The band still paints; the sheet still shows the labelled anchor.
    const bar = propsOf(
      makeVenue({
        id: "anchored-bar",
        kind: "bar",
        priceBand: 2,
        cheapestPrice: 25,
      }),
    );
    expect(bar.bucket).toBe(2);
    expect("priceLabel" in bar).toBe(false);
    const food = propsOf(
      makeVenue({
        id: "anchored-food",
        kind: "food",
        priceBand: 0,
        cheapestPrice: 15,
      }),
    );
    expect(food.bucket).toBe(0);
    expect("priceLabel" in food).toBe(false);
    const restaurant = propsOf(
      makeVenue({
        id: "anchored-restaurant",
        kind: "restaurant",
        priceBand: 1,
        cheapestPrice: 32,
      }),
    );
    expect(restaurant.bucket).toBe(1);
    expect("priceLabel" in restaurant).toBe(false);
  });
});

describe("pubsToGeoJSON whats-on badge join (W1)", () => {
  it("stamps hero kind + timed flag on venues with a tonight row, absent otherwise", () => {
    const a = makeVenue({ id: "with-quiz" });
    const b = makeVenue({ id: "no-events" });
    const summary = summariseWhatsOnByVenue([
      {
        id: "r1",
        venueId: "with-quiz",
        placeName: a.name,
        kind: "quiz",
        startsAt: "2026-07-12T19:00:00.000Z",
        title: "Quiz night",
        source: { label: "Org", url: "https://example.com" },
        observedAt: "2026-07-12T09:00:00.000Z",
        confidence: "listed",
      },
    ]);
    const fc = pubsToGeoJSON([a, b], new Map(), null, null, summary);
    const [pa, pb] = fc.features.map((f) => f.properties);
    expect(pa?.whatsOn).toBe("quiz");
    expect(pa?.whatsOnTimed).toBe(true);
    expect(pb?.whatsOn).toBeUndefined();
  });
});

describe("pubsToGeoJSON Pint Drop trust gate (AGENTS.md pin law: an uncorroborated report cannot reach either lane)", () => {
  // The composed drop-lane pipeline, exactly as PubMap wires it: drops fold
  // into the venue through mergeVenueDrops, into signals through
  // corroboratedPriceDrop (usePintDrops.venueSignals), and into the mark set
  // through provisionalPintDropVenueIds. The pin then reads all three.
  const NOW = Date.parse("2026-06-02T10:00:00.000Z");

  function makeDrop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
    return {
      drink: "Lager",
      priceGbp: 4.5,
      passedDownNote: "",
      provenance: "contributor",
      createdAt: "2026-06-01T10:00:00.000Z",
      handle: "first_drinker",
      ...overrides,
    };
  }

  function pinPropsFor(venue: Venue, drops: SummaryDrop[]) {
    const dropsByVenueId = new Map([[venue.id, drops]]);
    const [merged] = mergeVenueDrops([venue], dropsByVenueId, NOW);
    const candidate = corroboratedPriceDrop(drops, NOW);
    const signals = new Map<string, VenueSignal>([
      [
        venue.id,
        {
          hasPintDrops: drops.length > 0,
          latestContributorPrice: candidate?.priceGbp ?? null,
          latestContributorAt: candidate ? Date.parse(candidate.createdAt) : null,
          latestDemoPrice: null,
        },
      ],
    ]);
    const provisional = provisionalPintDropVenueIds(dropsByVenueId, NOW);
    return (
      pubsToGeoJSON([merged], signals, null, null, null, provisional)
        .features[0]?.properties ?? {}
    );
  }

  it("a single uncorroborated drop changes no band, prints no figure, and wears the mark", () => {
    const venue = makeVenue({ id: "lone-report", cheapestPrice: 6 });
    const props = pinPropsFor(venue, [makeDrop({ priceGbp: 4.5 })]);
    // Band and figure stay on the curated price - the drop moved neither lane.
    expect(props.bucket).toBe(priceBucket(6));
    expect(props.priceLabel).toBe("£6");
    // Visibility without authority: the pin says someone reported here.
    expect(props.provisional).toBe(true);
  });

  it("a single drop on an unpriced pub leaves it unpriced - no band, no label, just the mark", () => {
    const venue = makeVenue({ id: "lone-unpriced", cheapestPrice: null });
    const props = pinPropsFor(venue, [makeDrop({ priceGbp: 4.5 })]);
    expect(props.bucket).toBe(priceBucket(null));
    expect("priceLabel" in props).toBe(false);
    expect(props.provisional).toBe(true);
  });

  it("a corroborated pair paints band and figure, exactly as community submissions do", () => {
    const venue = makeVenue({ id: "confirmed", cheapestPrice: 6 });
    const props = pinPropsFor(venue, [
      makeDrop({
        priceGbp: 4.5,
        handle: "first_drinker",
        authorityKey: "account-first-drinker",
      }),
      makeDrop({
        priceGbp: 4.5,
        handle: "second_drinker",
        authorityKey: "account-second-drinker",
        createdAt: "2026-05-31T10:00:00.000Z",
      }),
    ]);
    expect(props.bucket).toBe(priceBucket(4.5));
    expect(props.priceLabel).toBe("£4.50");
    // A painting lane has nothing pending.
    expect(props.provisional).toBe(false);
  });

  it("the demo seed path still tints an unpriced pin and still never prints", () => {
    // Demo seeds ride VenueSignal.latestDemoPrice, not the drop gate - the
    // gate must not regress the unpriced-city colouring the law allows.
    const venue = makeVenue({ id: "seeded-city", cheapestPrice: null });
    const signals = new Map<string, VenueSignal>([
      [
        "seeded-city",
        { hasPintDrops: true, latestContributorPrice: null, latestDemoPrice: 5.2 },
      ],
    ]);
    const props =
      pubsToGeoJSON([venue], signals, null).features[0]?.properties ?? {};
    expect(props.bucket).toBe(priceBucket(5.2));
    expect("priceLabel" in props).toBe(false);
  });
});
