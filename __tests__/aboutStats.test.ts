import { afterEach, describe, it, expect } from "vitest";

import {
  computeAboutStats,
  loadAboutStats,
  resetAboutStatsForTests,
} from "@/lib/aboutStats";
import type { VenuePrice } from "@/lib/venues";

// computeAboutStats only reads pub_name/address/latitude/longitude (for the
// same grouping the map uses), price_gbp, and primary_borough — so a partial
// cast keeps fixtures readable without spelling out every VenuePrice field.
function row(over: Partial<VenuePrice>): VenuePrice {
  return {
    pub_name: "The Test Arms",
    address: "1 Test St",
    latitude: 51.5,
    longitude: -0.1,
    price_gbp: 5,
    primary_borough: "Camden",
    ...over,
  } as unknown as VenuePrice;
}

describe("computeAboutStats", () => {
  it("counts distinct pubs the same way the app groups venues", () => {
    const rows = [
      row({ pub_name: "A", address: "1 St", latitude: 51.5, longitude: -0.1, price_gbp: 5 }),
      // Same pub, second pint reading → still one venue.
      row({ pub_name: "A", address: "1 St", latitude: 51.5, longitude: -0.1, price_gbp: 6 }),
      row({ pub_name: "B", address: "2 St", latitude: 51.6, longitude: -0.2, price_gbp: 4 }),
    ];
    const s = computeAboutStats(rows, { historicPubsCited: 10, citiesCovered: 3 });
    expect(s.pubsTracked).toBe(2);
    expect(s.pintPricesObserved).toBe(3);
  });

  it("derives cheapest / dearest / average from positive numeric prices only", () => {
    const rows = [
      row({ pub_name: "A", address: "1", price_gbp: 4 }),
      row({ pub_name: "B", address: "2", price_gbp: 6 }),
      row({ pub_name: "C", address: "3", price_gbp: 8 }),
      // Ignored: null / zero / negative are not observations.
      row({ pub_name: "D", address: "4", price_gbp: null }),
      row({ pub_name: "E", address: "5", price_gbp: 0 }),
      row({ pub_name: "F", address: "6", price_gbp: -1 }),
    ];
    const s = computeAboutStats(rows, { historicPubsCited: 0, citiesCovered: 0 });
    expect(s.cheapestPint).toBe(4);
    expect(s.dearestPint).toBe(8);
    expect(s.averagePint).toBe(6);
    expect(s.pintPricesObserved).toBe(3);
    // Venues with only null/zero/negative readings never count as tracked.
    expect(s.pubsTracked).toBe(3);
  });

  it("rounds the average to pence", () => {
    const rows = [
      row({ pub_name: "A", address: "1", price_gbp: 5 }),
      row({ pub_name: "B", address: "2", price_gbp: 5 }),
      row({ pub_name: "C", address: "3", price_gbp: 6 }),
    ];
    const s = computeAboutStats(rows, { historicPubsCited: 0, citiesCovered: 0 });
    expect(s.averagePint).toBe(5.33);
  });

  it("counts distinct, non-empty primary boroughs", () => {
    const rows = [
      row({ pub_name: "A", address: "1", primary_borough: "Camden" }),
      row({ pub_name: "B", address: "2", primary_borough: "Camden" }),
      row({ pub_name: "C", address: "3", primary_borough: "Hackney" }),
      row({ pub_name: "D", address: "4", primary_borough: "  " }),
      row({ pub_name: "E", address: "5", primary_borough: "" }),
    ];
    const s = computeAboutStats(rows, { historicPubsCited: 0, citiesCovered: 0 });
    expect(s.boroughsCovered).toBe(2);
  });

  it("passes through historic + city counts and never returns negatives", () => {
    const s = computeAboutStats([], { historicPubsCited: -5, citiesCovered: 9 });
    expect(s.historicPubsCited).toBe(0);
    expect(s.citiesCovered).toBe(9);
    expect(s.pubsTracked).toBe(0);
    expect(s.cheapestPint).toBeNull();
    expect(s.averagePint).toBeNull();
  });

  it("is defensive against a non-array input", () => {
    const s = computeAboutStats(undefined as unknown as VenuePrice[], {
      historicPubsCited: 1,
      citiesCovered: 1,
    });
    expect(s.pubsTracked).toBe(0);
    expect(s.pintPricesObserved).toBe(0);
  });
});

// The landing page is prerendered now, so this read happens at build and again
// on each hourly regeneration rather than per view. The memo still earns its
// place: the raw price read alone is a 6.7 MB JSON.parse, every other caller
// shares it, and nothing here may quietly go back to reading per render.
describe("loadAboutStats", () => {
  afterEach(() => {
    resetAboutStatsForTests();
  });

  it("reads the bundled datasets once and hands every later caller the same figures", async () => {
    const first = loadAboutStats();
    const second = loadAboutStats();
    expect(second).toBe(first);
    expect(await second).toBe(await first);
  });

  it("reads again after a reset, so a test can start from cold", async () => {
    const before = loadAboutStats();
    await before;
    resetAboutStatsForTests();
    expect(loadAboutStats()).not.toBe(before);
  });
});
