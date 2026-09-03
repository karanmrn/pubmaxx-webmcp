import { describe, expect, it } from "vitest";

import { initialFilters } from "@/components/map/ControlRail";
import { PRICE_CHOICES } from "@/components/map/MobilePriceChoices";
import { buildFiltersChip } from "@/lib/mapChromeTiers";
import { encodeCrawl, seedCrawlState } from "@/lib/crawlUrl";
import {
  filterVenues,
  groupVenuePrices,
  NO_PINT_PRICE_CAP,
  type Venue,
  type VenuePrice,
} from "@/lib/venues";

// A price cap nobody can see is worse than a wrong figure: the reader cannot
// tell there is anything to disbelieve. A fresh visitor used to land on
// maxPrice 8, which lit a "1" filter badge reading "Filters: ≤£8.00 active"
// over a map already narrowed by a value no control in the app could show or
// clear. This pins the three halves of that: no default cap, a badge that
// counts only reachable state, and an OFF value the sheet offers.

function makeVenue(address: string, priceGbp: number | null): Venue {
  const row = {
    app_price_id: "",
    pub_name: `The ${address} Arms`,
    pint_name: "Lager",
    price_gbp: priceGbp,
    price_text: "",
    address,
    latitude: 51.54,
    longitude: -0.14,
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
  } as VenuePrice;
  return groupVenuePrices([row])[0];
}

const chipFor = (maxPrice: number) =>
  buildFiltersChip({
    drinkFiltersActive: false,
    priceCapActive: maxPrice < NO_PINT_PRICE_CAP,
    priceLabel: `≤£${maxPrice.toFixed(2)}`,
  });

describe("map price cap default", () => {
  it("gives a fresh visitor no pint-price cap", () => {
    expect(initialFilters.maxPrice).toBe(NO_PINT_PRICE_CAP);
  });

  it("lights no filter badge on first load", () => {
    const chip = chipFor(initialFilters.maxPrice);
    expect(chip.refinements).toBe(0);
    expect(chip.ariaLabel).toBe("Filters");
  });

  it("counts a cap the reader chose, and names it", () => {
    const chip = chipFor(5.5);
    expect(chip.refinements).toBe(1);
    expect(chip.ariaLabel).toBe("Filters: ≤£5.50 active");
  });

  it("offers the default cap as a choice the phone sheet can set", () => {
    expect(PRICE_CHOICES).toContain(initialFilters.maxPrice);
    // Every other choice is a real cap, so each must be below the OFF value.
    for (const choice of PRICE_CHOICES) {
      if (choice === NO_PINT_PRICE_CAP) continue;
      expect(choice).toBeLessThan(NO_PINT_PRICE_CAP);
    }
  });

  it("hides no priced pub on first load", () => {
    const venues = [
      makeVenue("cheap", 4.5),
      makeVenue("dear", 9.5),
      makeVenue("dearest", 9.95),
      makeVenue("unpriced", null),
    ];
    const kept = filterVenues(venues, initialFilters, () => false).map((venue) => venue.address);
    expect(kept).toEqual(["cheap", "dear", "dearest", "unpriced"]);
  });

  it("still narrows the map when the reader picks a cap", () => {
    const venues = [makeVenue("cheap", 4.5), makeVenue("dear", 9.5)];
    const kept = filterVenues(venues, { ...initialFilters, maxPrice: 5.5 }, () => false);
    expect(kept.map((venue) => venue.address)).toEqual(["cheap"]);
  });

  it("keeps the no-cap default out of the URL and round-trips a chosen cap", () => {
    const bare = {
      mode: "suggest" as const,
      filters: initialFilters,
      builtIds: [],
      selectedVenueId: "",
    };
    expect(encodeCrawl(bare)).toBe("");
    expect(seedCrawlState("").filters.maxPrice).toBe(NO_PINT_PRICE_CAP);
    expect(seedCrawlState("?max=5.5").filters.maxPrice).toBe(5.5);
  });
});
