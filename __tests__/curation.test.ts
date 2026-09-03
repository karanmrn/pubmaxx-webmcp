import { describe, it, expect } from "vitest";
import { getVenueCuration, normaliseVenueName } from "@/lib/curation";
import type { VenuePrice } from "@/lib/venues";

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

describe("getVenueCuration", () => {
  it("marks a known writer pick as sourced", () => {
    const curation = getVenueCuration([makeRow({ pub_name: "The Grapes" })]);
    expect(curation.writerPick).toBe(true);
    expect(curation.provenance).toBe("sourced");
  });

  it("does NOT over-label weak signals (traditional/historic/cool)", () => {
    for (const word of ["traditional", "historic", "cool"]) {
      const curation = getVenueCuration([
        makeRow({ pub_name: "The Nothing", description: `A ${word} old boozer.` }),
      ]);
      expect(curation.heritageNote).toBeUndefined();
      expect(curation.provenance).toBeUndefined();
    }
  });

  it("infers heritage from a strong signal as an unverified anecdote", () => {
    const curation = getVenueCuration([
      makeRow({ pub_name: "The Nothing", description: "A grand Victorian corner pub." }),
    ]);
    expect(curation.heritageNote).toBeDefined();
    expect(curation.heritageEra).toContain("unverified");
    expect(curation.provenance).toBe("anecdote");
  });

  it("flags nearWater from address keywords", () => {
    expect(getVenueCuration([makeRow({ address: "Wapping Wall" })]).nearWater).toBe(true);
    expect(getVenueCuration([makeRow({ address: "A riverside spot" })]).nearWater).toBe(true);
    expect(getVenueCuration([makeRow({ address: "Dry Inland Road" })]).nearWater).toBeFalsy();
  });

  it("address-qualifies Eating Europe's Islington Albion without labelling other Albions", () => {
    const barnsbury = getVenueCuration([
      makeRow({ pub_name: "The Albion", address: "Barnsbury, N1 1HW" }),
    ]);
    expect(barnsbury.heritageNote).toBeDefined();
    expect(barnsbury.sourceLabel).toBe("Eating Europe");
    expect(barnsbury.provenance).toBe("sourced");

    const other = getVenueCuration([
      makeRow({ pub_name: "The Albion", address: "121 Hammersmith Rd, London W14" }),
    ]);
    expect(other.heritageNote).toBeUndefined();
    expect(other.sourceLabel).toBeUndefined();
  });
});

describe("normaliseVenueName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normaliseVenueName("  The   Grapes  ")).toBe("the grapes");
  });
});
