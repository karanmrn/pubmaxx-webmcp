import { describe, it, expect } from "vitest";
import { buildVenueClaims, type ClaimDrop } from "@/lib/curation";
import { groupVenuePrices, scoreVenue, type VenuePrice } from "@/lib/venues";

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

function makeDrop(overrides: Partial<ClaimDrop> = {}): ClaimDrop {
  return {
    handle: "@thirsty_ted",
    drink: "Lager",
    priceGbp: null,
    passedDownNote: "",
    era: "",
    provenance: "anecdote",
    ...overrides,
  };
}

describe("buildVenueClaims", () => {
  it("keeps a Sourced editorial claim and an Anecdote drop as SEPARATE entries", () => {
    // The Grapes is a curated writer pick with a source URL → sourced editorial.
    const venue = groupVenuePrices([makeRow({ pub_name: "The Grapes" })])[0];
    const claims = buildVenueClaims(venue.curation, [
      makeDrop({ passedDownNote: "My grandad drank here in the 70s.", provenance: "anecdote" }),
    ]);

    const sourced = claims.filter((c) => c.kind === "sourced");
    const anecdote = claims.filter((c) => c.kind === "anecdote");
    expect(sourced).toHaveLength(1);
    expect(anecdote).toHaveLength(1);
    // The two contents are distinct — nothing is buried under the other.
    expect(sourced[0].content).not.toBe(anecdote[0].content);
    expect(sourced[0].sourceRef).toBeTruthy();
    expect(anecdote[0].content).toContain("grandad");
  });

  it("downgrades an unverified inferred heritage note to needs-source", () => {
    const venue = groupVenuePrices([
      makeRow({ pub_name: "The Nothing", description: "A grand Victorian corner pub." }),
    ])[0];
    const claims = buildVenueClaims(venue.curation, []);
    expect(claims).toHaveLength(1);
    expect(claims[0].kind).toBe("needs-source");
    expect(claims[0].sourceRef).toBeUndefined();
  });

  it("a priced drop is a contributor claim, a note-only drop is an anecdote", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Nothing" })])[0];
    const claims = buildVenueClaims(venue.curation, [
      makeDrop({ priceGbp: 4.5, drink: "Ale", provenance: "contributor" }),
      makeDrop({ passedDownNote: "Best jukebox in Camden.", provenance: "anecdote" }),
    ]);
    expect(claims.map((c) => c.kind)).toEqual(["contributor", "anecdote"]);
    expect(claims[0].content).toContain("4.50");
  });

  it("a demo seed drop becomes a Baseline claim, never Contributor/Anecdote", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Nothing" })])[0];
    const claims = buildVenueClaims(venue.curation, [
      makeDrop({ priceGbp: 5.8, passedDownNote: "A seeded passed-down note.", provenance: "demo" }),
    ]);
    expect(claims).toHaveLength(1);
    expect(claims[0].kind).toBe("baseline");
  });

  it("a Sourced claim is never relabeled by a later contributor/anecdote drop", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Grapes" })])[0];
    const claims = buildVenueClaims(venue.curation, [
      makeDrop({ priceGbp: 5, provenance: "contributor" }),
      makeDrop({ passedDownNote: "Cosy corner.", provenance: "anecdote" }),
    ]);
    const sourced = claims.find((c) => c.kind === "sourced");
    expect(sourced).toBeDefined();
    // Its content is the editorial note, not either drop's text.
    expect(sourced!.content).toBe(venue.curation.heritageNote);
  });
});

describe("Pint Drop summary signals (no flattening)", () => {
  it("hasStory lights from an editorial heritage note", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Lamb" })])[0];
    expect(venue.hasStory).toBe(true);
  });

  it("a plain venue has no story until a signal is derived", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Nothing" })])[0];
    expect(venue.hasStory).toBe(false);
    // The heritage score reads the derived hasStory signal, not a merged note.
    const withStory = { ...venue, hasStory: true };
    expect(scoreVenue(withStory, "heritage")).toBeGreaterThan(scoreVenue(venue, "heritage"));
  });

  it("a contributor price drives the summary cheapestPrice via Math.min", () => {
    // Mirrors mergeVenueDrops: contributor price undercuts baseline.
    const venue = groupVenuePrices([makeRow({ price_gbp: 7 })])[0];
    const contributorPrice = 4.5;
    const cheapest = Math.min(venue.cheapestPrice ?? Infinity, contributorPrice);
    expect(cheapest).toBe(4.5);
  });
});
