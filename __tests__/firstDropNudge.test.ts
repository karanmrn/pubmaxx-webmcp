import { describe, expect, it } from "vitest";

import {
  firstDropComposerIntent,
  firstDropNudgeCopy,
  isVenueUnpriced,
} from "@/lib/firstDropNudge";
import type { Venue } from "@/lib/venues";
import type { PricedVenue } from "@/lib/priceUpdates";

// Minimal Venue factory (same shape used across the map tests). Defaults are the
// fully-unpriced case so each test overrides only the price field it exercises.
function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Barking and Dagenham",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...overrides,
  } as Venue;
}

describe("isVenueUnpriced — first-drop gate", () => {
  it("is true only when no source has a price (the 658-unpriced case)", () => {
    expect(isVenueUnpriced(makeVenue(), null)).toBe(true);
    expect(isVenueUnpriced(makeVenue(), undefined)).toBe(true);
  });

  it("is false when a live contributor price exists", () => {
    expect(isVenueUnpriced(makeVenue(), 5.4)).toBe(false);
    // A zero price still counts as a price — only null/undefined are unpriced.
    expect(isVenueUnpriced(makeVenue(), 0)).toBe(false);
  });

  it("is false when a baseline dataset price is on record", () => {
    expect(isVenueUnpriced(makeVenue({ cheapestPrice: 6.2 }), null)).toBe(false);
  });

  it("is false when a sourced first-party price won precedence", () => {
    const priced = makeVenue() as PricedVenue;
    priced.sourcedPrice = {
      provenance: "sourced",
      sourceLabel: "pub.example",
      sourceUrl: "https://pub.example",
      observedAt: "2026-01-01",
    };
    expect(isVenueUnpriced(priced, null)).toBe(false);
  });

  it("mirrors the overview precedence: contributor beats the empty gate", () => {
    // Even with cheapestPrice null, a contributor price means we are priced.
    expect(isVenueUnpriced(makeVenue({ cheapestPrice: null }), 4.9)).toBe(false);
  });
});

describe("firstDropNudgeCopy — dry London variants", () => {
  it("is deterministic per venue id (stable across renders)", () => {
    expect(firstDropNudgeCopy("venue-42")).toEqual(firstDropNudgeCopy("venue-42"));
  });

  it("always offers a community-price CTA", () => {
    for (const id of ["a", "venue-1", "osm-9987", "long-venue-id-xyz", ""]) {
      const copy = firstDropNudgeCopy(id);
      expect(copy.line.length).toBeGreaterThan(0);
      expect(copy.cta).toBe("Log tonight's price");
    }
  });

  it("spreads across the variant set (not one repeated string)", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `venue-${i}`);
    const lines = new Set(ids.map((id) => firstDropNudgeCopy(id).line));
    expect(lines.size).toBeGreaterThan(1);
  });
});

describe("firstDropComposerIntent — composer prefill params", () => {
  it("targets the Pints tab, opens the composer, carries the venue id", () => {
    expect(firstDropComposerIntent("venue-7")).toEqual({
      venueId: "venue-7",
      tab: "pints",
      openComposer: true,
    });
  });
});
