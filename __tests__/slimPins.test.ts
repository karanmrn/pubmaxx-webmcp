import { describe, it, expect } from "vitest";

import { slimVenueToPin, slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";

const slim: SlimVenue = {
  id: "venue-abc123",
  name: "The Prospect of Whitby",
  lat: 51.509,
  lng: -0.0498,
  cheapestPrice: 5.2,
  borough: "Tower Hamlets",
  filterHints: {
    searchText: "prospect of whitby wine",
    amenities: {
      food: true,
      cocktails: true,
      beerGarden: false,
      liveSports: false,
      nonAlcoholic: true,
    },
    curation: {
      nearWater: true,
      hasStory: true,
    },
    canonical: true,
  },
};

describe("slimVenueToPin", () => {
  it("maps the pin-critical fields straight through", () => {
    const pin = slimVenueToPin(slim);
    expect(pin.id).toBe("venue-abc123");
    expect(pin.name).toBe("The Prospect of Whitby");
    expect(pin.latitude).toBe(51.509);
    expect(pin.longitude).toBe(-0.0498);
    expect(pin.cheapestPrice).toBe(5.2);
    expect(pin.primaryBorough).toBe("Tower Hamlets");
  });

  it("preserves a null cheapestPrice (bucketed as no-price by the canvas)", () => {
    const pin = slimVenueToPin({ ...slim, cheapestPrice: null });
    expect(pin.cheapestPrice).toBeNull();
  });

  it("lights hasStory from slim filterHints so heritage rings paint before detail", () => {
    expect(slimVenueToPin(slim).hasStory).toBe(true);
    expect(
      slimVenueToPin({
        ...slim,
        filterHints: {
          ...slim.filterHints!,
          curation: { nearWater: false, hasStory: false },
        },
      }).hasStory,
    ).toBe(false);
  });

  it("degrades prices to [] so priceForBeer returns null (favorite-pint dims until hydration)", () => {
    expect(slimVenueToPin(slim).prices).toEqual([]);
  });

  it("carries inert, non-throwing defaults for every full-Venue field the pipeline reads", () => {
    const pin = slimVenueToPin(slim);
    // filterVenues reads amenities.* / curation.* / address / visibleBoroughs —
    // all present and safe so a stray pre-hydration read never throws.
    expect(pin.amenities.beerGarden).toBe(false);
    expect(pin.amenities.nonAlcoholic).toBe(false);
    expect(pin.curation).toEqual({});
    expect(pin.visibleBoroughs).toEqual(["Tower Hamlets"]);
    expect(pin.latestContributorPrice).toBeNull();
    expect(pin.averagePrice).toBeNull();
  });

  it("carries slim filter hints through to the venue-shaped pin", () => {
    expect(slimVenueToPin(slim).filterHints).toEqual(slim.filterHints);
  });

  it("carries optional venue kind and type-relative price band to the map pin", () => {
    const pin = slimVenueToPin({
      ...slim,
      kind: "bar",
      priceBand: 1,
      anchorLabel: "House cocktail",
      anchorObservedAt: "2026-07-26",
      anchorSourceUrl: "https://example.com/menu",
    });
    expect(pin.kind).toBe("bar");
    expect(pin.priceBand).toBe(1);
    expect(pin.anchorLabel).toBe("House cocktail");
    expect(pin.anchorObservedAt).toBe("2026-07-26");
    expect(pin.anchorSourceUrl).toBe("https://example.com/menu");
  });

  it("keeps legacy slim rows backward-compatible as pubs", () => {
    const pin = slimVenueToPin(slim);
    expect(pin.kind).toBeUndefined();
    expect(pin.priceBand).toBeUndefined();
  });

  it("produces an empty visibleBoroughs when borough is blank", () => {
    expect(slimVenueToPin({ ...slim, borough: "" }).visibleBoroughs).toEqual([]);
  });

  it("returns a value the pin-render path can key on by id", () => {
    const pin = slimVenueToPin(slim);
    expect(typeof pin.id).toBe("string");
    expect(pin.id.length).toBeGreaterThan(0);
  });
});

describe("slimVenuesToPins", () => {
  it("maps a list preserving order and length", () => {
    const pins = slimVenuesToPins([slim, { ...slim, id: "venue-def456", name: "Second" }]);
    expect(pins.map((p) => p.id)).toEqual(["venue-abc123", "venue-def456"]);
  });

  it("returns [] for an empty input", () => {
    expect(slimVenuesToPins([])).toEqual([]);
  });
});
