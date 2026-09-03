import { describe, it, expect } from "vitest";

import { haversineKm } from "@/lib/haversine";
import { distanceKm, type Venue } from "@/lib/venues";

// distanceKm(Venue, Venue) is a thin adapter over the canonical great-circle
// helper (lib/haversine, GeoJSON [lng, lat] order). Pin that they agree so the
// Venue-shaped wrapper can never drift back to a bespoke reimplementation.
// distanceKm only reads latitude/longitude; a partial cast keeps the fixture
// honest without the full Venue shape.
function makeVenue(lat: number, lng: number): Venue {
  return { latitude: lat, longitude: lng } as Venue;
}

describe("distanceKm", () => {
  it("matches haversineKm on the same coordinates", () => {
    const kingsCross = makeVenue(51.5308, -0.124);
    const waterloo = makeVenue(51.5033, -0.1133);
    expect(distanceKm(kingsCross, waterloo)).toBeCloseTo(
      haversineKm([-0.124, 51.5308], [-0.1133, 51.5033]),
      9,
    );
  });

  it("is 0 for a venue against itself", () => {
    const v = makeVenue(51.5, -0.1);
    expect(distanceKm(v, v)).toBeCloseTo(0, 9);
  });
});
