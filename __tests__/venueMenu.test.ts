import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import DrinkMenu from "@/components/drinks/DrinkMenu";
import { hasMenuBeyondPints } from "@/lib/drinkMenu";
import { parseDrinkPriceUpdates, type DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { parseFoodPriceUpdates } from "@/lib/foodPriceUpdates";
import type { VenuePrice } from "@/lib/venues";
import { venueMenuForInspector, venueMenuLookupKeys } from "@/lib/venueMenu";
import { venueFoodMenuForInspector } from "@/lib/venueFoodMenu";
import rawDrinkPriceUpdates from "../public/data/drink_price_updates/latest.json";
import rawFoodPriceUpdates from "../public/data/food_price_updates/latest.json";

// The overlays are no longer statically bundled with the menu seams (they are
// fetched at runtime by lib/priceUpdatesLoader.ts); tests parse the same files
// directly and pass them in, keeping the behavioural assertions identical.
function fileGeneratedAt(raw: unknown): number {
  const stamp = Date.parse(
    String((raw as { generatedAt?: unknown })?.generatedAt ?? ""),
  );
  return Number.isFinite(stamp) ? stamp : Date.now();
}
const drinkUpdates = parseDrinkPriceUpdates(
  rawDrinkPriceUpdates,
  fileGeneratedAt(rawDrinkPriceUpdates),
);
const foodUpdates = parseFoodPriceUpdates(
  rawFoodPriceUpdates,
  fileGeneratedAt(rawFoodPriceUpdates),
);

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

// A seeded heritage venue id (Prospect of Whitby) — see __tests__/drinkSeeds.test.ts.
const SEEDED_VENUE_ID = "venue-16pnwmm";

/** Pinned Manchester OSM pub: empty prices[], coords-keyed overlay target. */
const MANCHESTER_GEORGE_DRAGON = {
  id: "venue-mcr-8nl72x",
  name: "George & Dragon",
  address: "14, London Road, Stockport, SK7 4AH",
  latitude: 53.3843726,
  longitude: -2.127616,
  prices: [] as VenuePrice[],
};

const MANCHESTER_GEORGE_DRAGON_VENUE_KEY =
  "george & dragon|14, london road, stockport, sk7 4ah|53.38437|-2.12762";

const MANCHESTER_DRINK_OVERLAYS: DrinkPriceUpdate[] = [
  {
    venueKey: MANCHESTER_GEORGE_DRAGON_VENUE_KEY,
    drinkName: "Abbot Ale",
    category: "beer",
    priceGbp: 4.85,
    source: {
      label: "Greene King — official menu",
      url: "https://www.greeneking.co.uk/pubs/greater-manchester/george-and-dragon",
      licence: "venue menu",
    },
    observedAt: "2026-07-11T12:13:09.496Z",
    lane: "publisher",
  },
  {
    venueKey: MANCHESTER_GEORGE_DRAGON_VENUE_KEY,
    drinkName: "House Pinot Grigio",
    category: "wine",
    priceGbp: 5.25,
    source: {
      label: "Greene King — official menu",
      url: "https://www.greeneking.co.uk/pubs/greater-manchester/george-and-dragon",
      licence: "venue menu",
    },
    observedAt: "2026-07-11T12:13:09.496Z",
    lane: "publisher",
  },
];

function fabricatedPrice(
  id: string,
  name: string,
  priceGbp: number | null,
): VenuePrice {
  return {
    app_price_id: id,
    pub_name: "Test Pub",
    pint_name: name,
    price_gbp: priceGbp,
    price_text: priceGbp !== null ? `£${priceGbp.toFixed(2)}` : "",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "",
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
  } as VenuePrice;
}

function prospectPrice(
  id: string,
  name: string,
  priceGbp: number | null,
): VenuePrice {
  return {
    ...fabricatedPrice(id, name, priceGbp),
    pub_name: "Prospect of Whitby",
    address: "57 Wapping Wall, E1W 3SH",
    latitude: 51.5071,
    longitude: -0.0511255,
  };
}

describe("venueMenuForInspector", () => {
  it("returns beer first then seeded non-beer drinks for a seeded venue", () => {
    const prices = [
      fabricatedPrice("p1", "London Pride", 6.4),
      fabricatedPrice("p2", "Guinness", 6.1),
    ];
    const menu = venueMenuForInspector({ id: SEEDED_VENUE_ID, prices });

    expect(menu.length).toBeGreaterThan(prices.length);
    expect(menu[0].category).toBe("beer");
    expect(menu[1].category).toBe("beer");
    const nonBeer = menu.filter((d) => d.category !== "beer");
    expect(nonBeer.length).toBeGreaterThan(0);
    for (const drink of nonBeer) {
      expect(drink.provenance.source).toBe("seed");
    }
    expect(hasMenuBeyondPints(menu)).toBe(true);
  });

  it("returns only beer for a non-seeded venue with pint rows", () => {
    const prices = [
      fabricatedPrice("p1", "London Pride", 6.4),
      fabricatedPrice("p2", "Guinness", 6.1),
    ];
    const menu = venueMenuForInspector({ id: "venue-not-seeded", prices });

    expect(menu.every((d) => d.category === "beer")).toBe(true);
    expect(hasMenuBeyondPints(menu)).toBe(false);
    for (const drink of menu) {
      expect(drink.provenance.source).toBe("app-dataset");
    }
  });

  it("returns an empty menu for null-priced rows with no seeds", () => {
    const prices = [
      fabricatedPrice("p1", "Unknown", null),
      fabricatedPrice("p2", "Unknown 2", null),
    ];
    const menu = venueMenuForInspector({ id: "venue-not-seeded", prices });

    expect(menu).toEqual([]);
  });

  it("applies demo drink-price overlays to the real Prospect menu", () => {
    const menu = venueMenuForInspector(
      {
        id: SEEDED_VENUE_ID,
        prices: [prospectPrice("p1", "Amstel", 6.1)],
      },
      drinkUpdates,
    );

    const luckySaint = menu.find((drink) => drink.name === "Lucky Saint 0.5%");
    expect(luckySaint).toBeDefined();
    expect(luckySaint!.category).toBe("beer");
    expect(luckySaint!.priceGbp).toBe(4.6);
    expect(luckySaint!.alcoholType).toBe("low-no");
    expect(luckySaint!.provenance.source).toBe("PUBMAXXING demo menu fixture");

    const oldFashioned = menu.find(
      (drink) => drink.name === "Wapping Old Fashioned",
    );
    expect(oldFashioned).toBeDefined();
    expect(oldFashioned!.priceGbp).toBe(10.95);
    expect(oldFashioned!.provenance.source).toBe(
      "PUBMAXXING demo menu fixture",
    );

    // Scraped Greene King Prospect drink rows land alongside the demo rows,
    // carrying honest attribution (never presented as community/organic).
    const pinot = menu.find((drink) => drink.name.includes("Pinot Grigio"));
    expect(pinot).toMatchObject({
      category: "wine",
      priceGbp: 7.2,
      provenance: { source: "Greene King — official menu" },
    });
  });

  it("lookup keys fall back to name|address|lat|lng and venue.id when prices are empty", () => {
    const keys = venueMenuLookupKeys(MANCHESTER_GEORGE_DRAGON);
    expect(keys[0]).toBe(MANCHESTER_GEORGE_DRAGON_VENUE_KEY);
    expect(keys).toContain("venue-mcr-8nl72x");
  });

  it("applies drink-price overlays to a price-free Manchester OSM pub", () => {
    const menu = venueMenuForInspector(
      MANCHESTER_GEORGE_DRAGON,
      MANCHESTER_DRINK_OVERLAYS,
    );

    expect(menu).toHaveLength(2);
    expect(menu.some((drink) => drink.provenance.source === "app-dataset")).toBe(
      false,
    );
    const abbot = menu.find((drink) => drink.name === "Abbot Ale");
    expect(abbot).toMatchObject({
      category: "beer",
      priceGbp: 4.85,
      provenance: {
        source: "Greene King — official menu",
        observedAt: "2026-07-11T12:13:09.496Z",
      },
    });
    const pinot = menu.find((drink) => drink.name === "House Pinot Grigio");
    expect(pinot).toMatchObject({
      category: "wine",
      priceGbp: 5.25,
      provenance: {
        source: "Greene King — official menu",
        observedAt: "2026-07-11T12:13:09.496Z",
      },
    });
    expect(hasMenuBeyondPints(menu)).toBe(true);
  });

  it("does not invent a pint row for a price-free city pub without an overlay", () => {
    const menu = venueMenuForInspector(MANCHESTER_GEORGE_DRAGON, []);
    expect(menu).toEqual([]);
  });

  it("renders dated overlay lines with publisher provenance for a price-free city pub", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    const menu = venueMenuForInspector(
      MANCHESTER_GEORGE_DRAGON,
      MANCHESTER_DRINK_OVERLAYS,
    );
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: menu,
        venueName: MANCHESTER_GEORGE_DRAGON.name,
        venueId: MANCHESTER_GEORGE_DRAGON.id,
      }),
    );

    expect(html).toContain("Abbot Ale");
    expect(html).toContain("Greene King — official menu");
    expect(html).toContain("Last seen");
    expect(html).toContain('<time dateTime="2026-07-11T12:13:09.496Z">11 Jul 2026</time>');
    vi.useRealTimers();
  });

  it("drops demo drink overlays for price-free city pubs when demo content is off", () => {
    process.env.NEXT_PUBLIC_DEMO_CONTENT = "off";
    const menu = venueMenuForInspector(MANCHESTER_GEORGE_DRAGON, [
      ...MANCHESTER_DRINK_OVERLAYS,
      {
        venueKey: MANCHESTER_GEORGE_DRAGON_VENUE_KEY,
        drinkName: "Fixture Spritz",
        category: "cocktail",
        priceGbp: 9.5,
        source: {
          label: "PUBMAXXING demo menu fixture",
          url: "https://pubmaxxing.com/demo",
          licence: "demo",
        },
        observedAt: "2026-07-11T12:13:09.496Z",
        lane: "demo",
      },
    ]);

    expect(menu.some((drink) => drink.name === "Fixture Spritz")).toBe(false);
    expect(menu).toHaveLength(2);
    delete process.env.NEXT_PUBLIC_DEMO_CONTENT;
  });

  it("attaches Prospect food updates from the food price layer", () => {
    const food = venueFoodMenuForInspector(
      {
        id: SEEDED_VENUE_ID,
        prices: [prospectPrice("p1", "Amstel", 6.1)],
      },
      foodUpdates,
    );
    expect(food.length).toBeGreaterThan(0);
    const chips = food.find((item) => item.name === "Fish & Chips");
    expect(chips?.priceGbp).toBe(19.95);
    expect(chips?.category).toBe("mains");
    expect(chips?.provenance.source).toBe("Greene King — official site");
  });

  it("turns a restaurant signature-dish anchor into a sourced food row", () => {
    const food = venueFoodMenuForInspector({
      id: "restaurant-rules",
      prices: [],
      kind: "restaurant",
      anchorLabel: "Steak & Kidney Pudding",
      anchorCourse: "mains",
      cheapestPrice: 26.25,
      anchorObservedAt: "2026-07-27",
      anchorSourceUrl: "https://rules.co.uk/our-menus/",
    });

    expect(food).toEqual([
      expect.objectContaining({
        name: "Steak & Kidney Pudding",
        category: "mains",
        priceGbp: 26.25,
        provenance: expect.objectContaining({
          observedAt: "2026-07-27",
        }),
        source: "https://rules.co.uk/our-menus/",
      }),
    ]);
  });

  it("files the anchor under the course the venue's own menu lists", () => {
    const [dessert] = venueFoodMenuForInspector({
      id: "restaurant-river-cafe",
      prices: [],
      kind: "restaurant",
      anchorLabel: "Chocolate Nemesis",
      anchorCourse: "desserts",
      cheapestPrice: 15,
      anchorObservedAt: "2026-07-27",
      anchorSourceUrl: "https://www.rivercafe.co.uk/",
    });
    expect(dessert?.category).toBe("desserts");
  });

  it("keeps breakfast anchors out of mains", () => {
    const [breakfast] = venueFoodMenuForInspector({
      id: "restaurant-regency-cafe",
      prices: [],
      kind: "restaurant",
      anchorLabel: "Set Breakfast",
      anchorCourse: "breakfast",
      cheapestPrice: 9.99,
      anchorObservedAt: "2026-07-27",
      anchorSourceUrl: "https://regencycafe.co.uk/menu",
    });
    expect(breakfast?.category).toBe("breakfast");
  });

  it("drops an anchor whose course is missing rather than calling it a main", () => {
    expect(
      venueFoodMenuForInspector({
        id: "restaurant-river-cafe",
        prices: [],
        kind: "restaurant",
        anchorLabel: "Chocolate Nemesis",
        cheapestPrice: 15,
        anchorObservedAt: "2026-07-27",
        anchorSourceUrl: "https://www.rivercafe.co.uk/",
      }),
    ).toEqual([]);
  });
});
