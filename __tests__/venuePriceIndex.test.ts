import { promises as fs } from "fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPricedVenues, resetVenuePriceIndexForTests } from "@/lib/venuePriceIndex";
import type { VenuePrice } from "@/lib/venues";

function priceRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "price-1",
    pub_name: "The Retry Arms",
    pint_name: "House Lager",
    price_gbp: 4.5,
    price_text: "£4.50",
    address: "1 Retry Street",
    latitude: 51.5,
    longitude: -0.12,
    boroughs_visible: "Camden",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "Camden",
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

beforeEach(() => {
  resetVenuePriceIndexForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetVenuePriceIndexForTests();
});

describe("getPricedVenues", () => {
  it("does not cache an empty list after a transient read failure", async () => {
    const readFile = vi.spyOn(fs, "readFile");
    readFile
      .mockRejectedValueOnce(new Error("missing prices"))
      .mockResolvedValueOnce(JSON.stringify([priceRow()]));

    await expect(getPricedVenues()).resolves.toEqual([]);
    const retried = await getPricedVenues();

    expect(retried).toHaveLength(1);
    expect(retried[0]?.name).toBe("The Retry Arms");
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
