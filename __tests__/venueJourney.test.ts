import { describe, expect, it } from "vitest";

import { coarsenViewerPoint } from "@/lib/geo";
import {
  optimalJourney,
  venueDirectionsUrl,
  type VenueJourney,
} from "@/lib/venueJourney";

function journey(
  durationMinutes: number,
  modes: string[],
): VenueJourney {
  return {
    durationMinutes,
    legs: modes.map((mode) => ({ mode })),
  };
}

describe("optimalJourney", () => {
  it("selects the shortest usable itinerary without reordering the input", () => {
    const journeys = [
      journey(24, ["walking", "tube"]),
      journey(15, ["walking", "bus", "walking"]),
      journey(19, ["walking", "tube"]),
    ];

    expect(optimalJourney(journeys)).toBe(journeys[1]);
    expect(journeys.map((item) => item.durationMinutes)).toEqual([24, 15, 19]);
  });

  it("ignores malformed itineraries and owns the empty case", () => {
    expect(
      optimalJourney([
        journey(Number.NaN, ["tube"]),
        journey(12, []),
      ]),
    ).toBeNull();
    expect(optimalJourney([])).toBeNull();
  });
});

describe("venueDirectionsUrl", () => {
  const venue = { lat: 51.5133, lng: -0.1349 };

  it("includes the user's coordinates as the directions origin", () => {
    const url = new URL(
      venueDirectionsUrl(venue, { lat: 51.5074, lng: -0.1278 }),
    );

    expect(url.searchParams.get("origin")).toBe("51.507,-0.128");
    expect(url.searchParams.get("destination")).toBe("51.513,-0.135");
    expect(url.searchParams.get("travelmode")).toBe("transit");
  });

  it("still creates a destination link when origin is unknown", () => {
    const url = new URL(venueDirectionsUrl(venue, null));
    expect(url.searchParams.has("origin")).toBe(false);
    expect(url.searchParams.get("destination")).toBe("51.513,-0.135");
  });
});

describe("coarsenViewerPoint", () => {
  it("reduces device coordinates to routing-level precision", () => {
    expect(
      coarsenViewerPoint({ lat: 51.50741234, lng: -0.12785678 }),
    ).toEqual({ lat: 51.507, lng: -0.128 });
  });

  it("uses reduced precision in external directions links", () => {
    const url = new URL(
      venueDirectionsUrl(
        { lat: 51.51331234, lng: -0.13495678 },
        { lat: 51.50741234, lng: -0.12785678 },
      ),
    );
    expect(url.searchParams.get("origin")).toBe("51.507,-0.128");
    expect(url.searchParams.get("destination")).toBe("51.513,-0.135");
  });
});
