import { describe, it, expect } from "vitest";
import {
  isValidPriceUpdate,
  parsePriceUpdates,
  mergePriceUpdates,
  PRICE_UPDATE_PROVENANCE,
  type PriceUpdate,
} from "@/lib/priceUpdates";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const NOW = Date.parse("2026-07-06T12:00:00.000Z");

function makeUpdate(overrides: Partial<PriceUpdate> = {}): PriceUpdate {
  return {
    venueKey: "the test arms|1 test street|51.50000|-0.10000",
    price: 5.5,
    source: { label: "Official pub site", url: "https://example-pub.co.uk/menu" },
    observedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 7,
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

describe("isValidPriceUpdate", () => {
  it("accepts a well-formed update", () => {
    expect(isValidPriceUpdate(makeUpdate(), NOW)).toBe(true);
    // price 0 (free-pint promo) is allowed.
    expect(isValidPriceUpdate(makeUpdate({ price: 0 }), NOW)).toBe(true);
  });

  it("rejects non-objects and missing fields", () => {
    expect(isValidPriceUpdate(null, NOW)).toBe(false);
    expect(isValidPriceUpdate("nope", NOW)).toBe(false);
    expect(isValidPriceUpdate({}, NOW)).toBe(false);
    expect(isValidPriceUpdate(makeUpdate({ venueKey: "" }), NOW)).toBe(false);
  });

  it("rejects bad prices", () => {
    expect(isValidPriceUpdate({ ...makeUpdate(), price: "5.5" }, NOW)).toBe(false);
    expect(isValidPriceUpdate(makeUpdate({ price: -1 }), NOW)).toBe(false);
    expect(isValidPriceUpdate({ ...makeUpdate(), price: NaN }, NOW)).toBe(false);
  });

  it("requires a labelled source with an http(s) url", () => {
    expect(isValidPriceUpdate({ ...makeUpdate(), source: null }, NOW)).toBe(false);
    expect(isValidPriceUpdate(makeUpdate({ source: { label: "", url: "https://x.com" } }), NOW)).toBe(false);
    expect(isValidPriceUpdate(makeUpdate({ source: { label: "X", url: "not-a-url" } }), NOW)).toBe(false);
    expect(isValidPriceUpdate(makeUpdate({ source: { label: "X", url: "ftp://x.com" } }), NOW)).toBe(false);
  });

  it("rejects a missing/invalid/future observedAt (never present stale-or-fake as live)", () => {
    expect(isValidPriceUpdate(makeUpdate({ observedAt: "" }), NOW)).toBe(false);
    expect(isValidPriceUpdate(makeUpdate({ observedAt: "yesterday" }), NOW)).toBe(false);
    // A future observation is a data error.
    expect(isValidPriceUpdate(makeUpdate({ observedAt: "2026-07-07T00:00:00.000Z" }), NOW)).toBe(false);
  });
});

describe("parsePriceUpdates", () => {
  it("drops bad rows and keeps good ones", () => {
    const parsed = parsePriceUpdates(
      [makeUpdate(), { garbage: true }, makeUpdate({ venueKey: "other|k|1|2", price: -3 })],
      NOW,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].venueKey).toBe("the test arms|1 test street|51.50000|-0.10000");
  });

  it("accepts a { updates: [...] } envelope", () => {
    const parsed = parsePriceUpdates({ updates: [makeUpdate()] }, NOW);
    expect(parsed).toHaveLength(1);
  });

  it("keeps only the newest observation per venueKey", () => {
    const parsed = parsePriceUpdates(
      [
        makeUpdate({ price: 5.0, observedAt: "2026-06-01T00:00:00.000Z" }),
        makeUpdate({ price: 5.9, observedAt: "2026-07-02T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].price).toBe(5.9);
  });

  it("returns [] for non-array, non-envelope input", () => {
    expect(parsePriceUpdates(null, NOW)).toEqual([]);
    expect(parsePriceUpdates("nope", NOW)).toEqual([]);
  });
});

describe("mergePriceUpdates precedence", () => {
  const keyFor = (v: Venue) =>
    `${v.name.toLowerCase()}|${v.address.toLowerCase()}|${v.latitude.toFixed(5)}|${v.longitude.toFixed(5)}`;

  function baseVenue(): Venue {
    return groupVenuePrices([makeRow()])[0];
  }

  it("a sourced update overrides the static baseline and stamps attribution", () => {
    const venue = baseVenue();
    expect(venue.cheapestPrice).toBe(7);
    const [merged] = mergePriceUpdates([venue], [makeUpdate({ price: 5.5 })], keyFor);
    expect(merged.cheapestPrice).toBe(5.5);
    expect(merged.sourcedPrice).not.toBeNull();
    expect(merged.sourcedPrice?.provenance).toBe(PRICE_UPDATE_PROVENANCE);
    expect(merged.sourcedPrice?.provenance).toBe("sourced");
    expect(merged.sourcedPrice?.sourceUrl).toBe("https://example-pub.co.uk/menu");
    expect(merged.sourcedPrice?.observedAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("no update → baseline stands, sourcedPrice null", () => {
    const venue = baseVenue();
    const [merged] = mergePriceUpdates([venue], [], keyFor);
    expect(merged.cheapestPrice).toBe(7);
    expect(merged.sourcedPrice).toBeNull();
  });

  it("a FRESHER community drop beats the sourced update (community stays live)", () => {
    const venue: Venue = {
      ...baseVenue(),
      cheapestPrice: 4.2,
      latestContributorPrice: 4.2,
      latestContributorAt: "2026-07-05T00:00:00.000Z", // after the update's observedAt
    };
    const [merged] = mergePriceUpdates(
      [venue],
      [makeUpdate({ price: 5.5, observedAt: "2026-07-01T00:00:00.000Z" })],
      keyFor,
    );
    // The community price is untouched; the update is ignored.
    expect(merged.cheapestPrice).toBe(4.2);
    expect(merged.sourcedPrice).toBeNull();
  });

  it("a STALE community drop does NOT block a fresher sourced update", () => {
    const venue: Venue = {
      ...baseVenue(),
      cheapestPrice: 4.2,
      latestContributorPrice: 4.2,
      latestContributorAt: "2026-06-01T00:00:00.000Z", // BEFORE the update
    };
    const [merged] = mergePriceUpdates(
      [venue],
      [makeUpdate({ price: 5.5, observedAt: "2026-07-01T00:00:00.000Z" })],
      keyFor,
    );
    expect(merged.cheapestPrice).toBe(5.5);
    expect(merged.sourcedPrice?.provenance).toBe("sourced");
  });
});
