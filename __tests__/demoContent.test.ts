import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ambientPresenceCurve } from "@/lib/ambientPresence";
import { demoContentEnabled } from "@/lib/demoContent";
import {
  parseDrinkPriceUpdates,
  type DrinkPriceUpdate,
} from "@/lib/drinkPriceUpdates";
import { demoDropsFor, demoPintDropsForCity } from "@/lib/pintDropSeeds";
import type { VenuePrice } from "@/lib/venues";
import { venueMenuForInspector } from "@/lib/venueMenu";

const FLAG = "NEXT_PUBLIC_DEMO_CONTENT";
const original = process.env[FLAG];
const SEEDED_VENUE_ID = "venue-16pnwmm";
const PROSPECT_KEY =
  "prospect of whitby|57 wapping wall, e1w 3sh|51.50710|-0.05113";
const SHIPPED_MENU_UPDATES = parseDrinkPriceUpdates(
  JSON.parse(
    readFileSync(
      join(process.cwd(), "public/data/drink_price_updates/latest.json"),
      "utf8",
    ),
  ) as unknown,
  Date.parse("2026-08-05T12:00:00.000Z"),
);

function prospectPrice(): VenuePrice {
  return {
    app_price_id: "prospect-pint",
    pub_name: "Prospect of Whitby",
    pint_name: "Amstel",
    price_gbp: 6.1,
    price_text: "£6.10",
    address: "57 Wapping Wall, E1W 3SH",
    latitude: 51.5071,
    longitude: -0.0511255,
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
  };
}

const MENU_UPDATES: DrinkPriceUpdate[] = [
  {
    venueKey: PROSPECT_KEY,
    drinkName: "Fixture Spritz",
    category: "cocktail",
    priceGbp: 9.5,
    source: {
      label: "PUBMAXXING demo menu fixture",
      url: "https://pubmaxx.vercel.app/data/drink_price_updates/latest.json",
      licence: "First-party demo fixture for UI coverage; not a live venue price.",
    },
    observedAt: "2026-07-06T12:00:00.000Z",
    lane: "demo",
  },
  {
    venueKey: PROSPECT_KEY,
    drinkName: "Publisher Pinot",
    category: "wine",
    priceGbp: 7.2,
    source: {
      label: "Greene King official menu",
      url: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
      licence: "All rights reserved; first-party publisher.",
    },
    observedAt: "2026-07-11T13:06:21.340Z",
    lane: "publisher",
  },
];

function inspectorMenu() {
  return venueMenuForInspector(
    { id: SEEDED_VENUE_ID, prices: [prospectPrice()] },
    MENU_UPDATES,
  );
}

afterEach(() => {
  if (original === undefined) delete process.env[FLAG];
  else process.env[FLAG] = original;
});

describe("demo content kill switch", () => {
  it("documents the explicit public-release value", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(example).toContain("NEXT_PUBLIC_DEMO_CONTENT=");
    expect(example).toContain("Set the literal value `off` in BOTH");
  });

  it("test baseline is hermetic: ambient deployment env cannot flip the flag", () => {
    // vitest.setup.ts strips NEXT_PUBLIC_DEMO_CONTENT (Production sets it to
    // "off" and `npm run ci` runs vitest inside that build). If this fails,
    // the setup stopped pinning the baseline and seed tests depend on
    // whichever environment the suite happens to run in.
    expect(original).toBeUndefined();
    expect(demoContentEnabled()).toBe(true);
  });

  it("defaults ON — behavior unchanged until the owner flips it", () => {
    delete process.env[FLAG];
    expect(demoContentEnabled()).toBe(true);
    expect(demoPintDropsForCity("london").length).toBeGreaterThan(0);
  });

  it("off silences seeded drops for every read path", () => {
    process.env[FLAG] = "off";
    expect(demoContentEnabled()).toBe(false);
    expect(demoPintDropsForCity("london")).toEqual([]);
    expect(demoPintDropsForCity("manchester")).toEqual([]);
    expect(demoDropsFor("venue-16pnwmm")).toEqual([]);
  });

  it("off zeroes ambient presence at peak hours", () => {
    process.env[FLAG] = "off";
    // 22:00 London on a Friday sits inside the busiest HOUR_BAND.
    expect(ambientPresenceCurve("venue-16pnwmm", new Date("2026-07-17T21:00:00Z"))).toBe(0);
  });

  it("off removes menu seeds", () => {
    process.env[FLAG] = "off";

    const menu = inspectorMenu();

    expect(menu.some((drink) => drink.provenance.source === "seed")).toBe(false);
  });

  it("off removes demo overlays while keeping publisher rows", () => {
    process.env[FLAG] = "off";

    const menu = inspectorMenu();

    expect(
      menu.some((drink) => drink.provenance.source.toLowerCase().includes("demo")),
    ).toBe(false);
    expect(menu.some((drink) => drink.name === "Publisher Pinot")).toBe(true);
  });

  it("off removes demo rows from the shipped drink-price artifact", () => {
    process.env[FLAG] = "off";

    const menu = venueMenuForInspector(
      { id: SEEDED_VENUE_ID, prices: [prospectPrice()] },
      SHIPPED_MENU_UPDATES,
    );

    expect(menu.some((drink) => drink.name === "Lucky Saint 0.5%")).toBe(false);
    expect(menu.some((drink) => drink.provenance.source.includes("demo"))).toBe(false);
  });

  it("on preserves seeded menu drinks and demo overlays", () => {
    delete process.env[FLAG];

    const menu = inspectorMenu();

    expect(menu.some((drink) => drink.provenance.source === "seed")).toBe(true);
    expect(menu.some((drink) => drink.name === "Fixture Spritz")).toBe(true);
  });

  it("only the literal 'off' disables — anything else stays on", () => {
    process.env[FLAG] = "false";
    expect(demoContentEnabled()).toBe(true);
  });
});
