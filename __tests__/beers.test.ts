import { describe, it, expect } from "vitest";

import { BEERS, normalizeBeer, priceForBeer } from "@/lib/beers";
import type { Venue, VenuePrice } from "@/lib/venues";

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
    has_visible_borough_row: true,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

function makeVenue(prices: VenuePrice[]): Venue {
  return { prices } as unknown as Venue;
}

describe("BEERS catalog ABV", () => {
  it("records typical UK ABV for Guinness", () => {
    const guinness = BEERS.find((b) => b.id === "guinness");
    expect(guinness?.abv).toBe(4.2);
  });

  it("sets ABV on every catalog beer", () => {
    for (const beer of BEERS) {
      expect(typeof beer.abv).toBe("number");
      expect(beer.abv).toBeGreaterThan(0);
    }
  });
});

describe("normalizeBeer", () => {
  it("maps case/whitespace variants of Guinness to one id", () => {
    expect(normalizeBeer("GUINNESS")).toBe("guinness");
    expect(normalizeBeer("Guinness")).toBe("guinness");
    expect(normalizeBeer("  guinness  ")).toBe("guinness");
  });

  it("resolves Beavertown Neck Oil via alias", () => {
    expect(normalizeBeer("BEAVERTOWN NECK OIL")).toBe("neck-oil");
  });

  it("returns null for a non-matching string", () => {
    expect(normalizeBeer("Fizzy Sock Juice")).toBeNull();
  });
});

describe("priceForBeer", () => {
  it("picks the minimum matching price", () => {
    const venue = makeVenue([
      makeRow({ pint_name: "Guinness", price_gbp: 6.4 }),
      makeRow({ pint_name: "GUINNESS DRAUGHT", price_gbp: 5.9 }),
      makeRow({ pint_name: "Peroni", price_gbp: 5.2 }),
    ]);
    expect(priceForBeer(venue, "guinness")).toBe(5.9);
  });

  it("returns null when the venue serves no matching beer", () => {
    const venue = makeVenue([makeRow({ pint_name: "Peroni", price_gbp: 5.2 })]);
    expect(priceForBeer(venue, "guinness")).toBeNull();
  });
});
