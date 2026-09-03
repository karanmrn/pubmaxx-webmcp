import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyVenueMenuEnrichment,
  loadVenueMenuEnrichmentIndex,
  resetVenueMenuEnrichmentCacheForTests,
  setVenueMenuEnrichmentPathForTests,
  type VenueMenuEnrichmentRecord,
} from "@/lib/venueMenuEnrichment";
import type { Venue } from "@/lib/venues";

function venue(over: Partial<Venue> = {}): Venue {
  return {
    id: "venue-test",
    name: "The Test Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: 5.5,
    cheapestPint: "Lager",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: true,
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
    website: "https://pub.example/",
    bookingLink: "https://book.example/old",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...over,
  };
}

afterEach(() => {
  resetVenueMenuEnrichmentCacheForTests();
});

describe("applyVenueMenuEnrichment", () => {
  it("leaves the venue unchanged for an empty / null record", () => {
    const base = venue();
    expect(applyVenueMenuEnrichment(base, null)).toEqual(base);
    expect(applyVenueMenuEnrichment(base, {})).toEqual(base);
  });

  it("lets bookingUrl override bookingLink when http(s)", () => {
    const record: VenueMenuEnrichmentRecord = {
      bookingUrl: "https://book.example/new",
    };
    const merged = applyVenueMenuEnrichment(venue(), record);
    expect(merged.bookingLink).toBe("https://book.example/new");
  });

  it("rejects javascript: URLs for booking / menu / tile media", () => {
    const record: VenueMenuEnrichmentRecord = {
      bookingUrl: "javascript:alert(1)",
      menuUrl: "javascript:alert(2)",
      orderUrl: "javascript:alert(3)",
      categoryTiles: [
        {
          id: "mains",
          label: "Mains",
          href: "javascript:alert(4)",
          imageUrl: "javascript:alert(5)",
        },
      ],
    };
    const base = venue({ bookingLink: "https://book.example/keep" });
    const merged = applyVenueMenuEnrichment(base, record);
    expect(merged.bookingLink).toBe("https://book.example/keep");
    expect(merged.menuUrl).toBeUndefined();
    expect(merged.orderUrl).toBeUndefined();
    // Tile kept (id+label) but non-http href/imageUrl dropped
    expect(merged.categoryTiles).toEqual([{ id: "mains", label: "Mains" }]);
  });

  it("rejects HTTP menu URLs and tile links", () => {
    const merged = applyVenueMenuEnrichment(venue(), {
      menuUrl: "http://pub.example/menu",
      categoryTiles: [{ id: "mains", label: "Mains", href: "http://pub.example/mains" }],
    });
    expect(merged.menuUrl).toBeUndefined();
    expect(merged.categoryTiles).toEqual([{ id: "mains", label: "Mains" }]);
  });
});

describe("loadVenueMenuEnrichmentIndex", () => {
  it("returns an empty map when the enrichment file is missing", async () => {
    setVenueMenuEnrichmentPathForTests(
      path.join(tmpdir(), `missing-venue-menu-enrichment-${Date.now()}.json`),
    );
    const index = await loadVenueMenuEnrichmentIndex();
    expect(index.size).toBe(0);
  });

  it("loads a valid enrichment file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "venue-menu-enrichment-"));
    const file = path.join(dir, "venue_menu_enrichment.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        venues: {
          "venue-test": {
            menuUrl: "https://pub.example/menu",
          },
        },
      }),
    );
    setVenueMenuEnrichmentPathForTests(file);
    const index = await loadVenueMenuEnrichmentIndex();
    expect(index.get("venue-test")?.menuUrl).toBe("https://pub.example/menu");
  });
});
