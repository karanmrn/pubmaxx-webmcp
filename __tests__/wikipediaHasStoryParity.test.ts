import { describe, it, expect } from "vitest";
import { getVenueCuration } from "@/lib/curation";
import type { VenuePrice } from "@/lib/venues";
// The build-time slim `hasStory` predicate. Importing the .mjs must not run
// main() (guarded by the process.argv[1] === import.meta.url check).
import { buildCurationHints } from "@/scripts/build_slim_index.mjs";

function makeRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "",
    pub_name: "The Neutral Bar",
    pint_name: "Lager",
    price_gbp: 6,
    price_text: "",
    address: "1 Nowhere Street",
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
    locality: "",
    source_datasets: "",
    ...overrides,
  } as VenuePrice;
}

describe("Wikipedia hasStory / hasWikipediaList parity (item 4)", () => {
  it("a wikipedia_london_list row WITH a URL is sourced in both predicates", () => {
    const rows = [
      makeRow({
        source_datasets: "wikipedia_london_list",
        comment: "Wikipedia: https://en.wikipedia.org/wiki/The_Neutral_Bar",
      }),
    ];

    const curation = getVenueCuration(rows);
    const hints = buildCurationHints(rows);

    // curation flags it as sourced heritage (renderable note exists)
    expect(curation.provenance).toBe("sourced");
    // slim index agrees
    expect(hints.hasStory).toBe(true);
  });

  it("a wikipedia_london_list row WITHOUT a URL/note is NOT flagged by either predicate", () => {
    // Regression: build_slim used to set hasStory=true on the source_datasets
    // tag alone, disagreeing with curation's hasWikipediaList (row + URL), so
    // venues could claim a heritage story with no renderable note.
    const rows = [
      makeRow({
        source_datasets: "wikipedia_london_list",
        comment: "", // no citation / URL -> no renderable heritage note
      }),
    ];

    const curation = getVenueCuration(rows);
    const hints = buildCurationHints(rows);

    expect(curation.provenance).not.toBe("sourced");
    expect(hints.hasStory).toBe(false);
  });

  it("the two predicates agree across a matrix of comment shapes", () => {
    const comments: string[] = [
      "",
      "   ",
      "Wikipedia: https://en.wikipedia.org/wiki/Some_Pub",
      "Some free-text note without a link",
      "Wikipedia: ",
    ];

    for (const comment of comments) {
      const rows = [makeRow({ source_datasets: "wikipedia_london_list", comment })];
      const curationSourced = getVenueCuration(rows).provenance === "sourced";
      const slimStory = buildCurationHints(rows).hasStory;
      expect(slimStory).toBe(curationSourced);
    }
  });
});
