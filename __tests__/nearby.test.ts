import { describe, it, expect } from "vitest";

import { nearbyVenuesForMap, nearestVenueIds } from "@/lib/nearby";
import type { Venue } from "@/lib/venues";

// nearestVenueIds only reads id/latitude/longitude; a partial cast keeps the
// fixture honest without dragging in the full Venue shape.
function makeVenue(id: string, lat: number, lng: number): Venue {
  return { id, latitude: lat, longitude: lng } as Venue;
}

// A tight cluster around a London point, at increasing distances.
const point = { lat: 51.5074, lng: -0.1278 };
const venues = [
  makeVenue("far", 51.55, -0.2),
  makeVenue("nearest", 51.5075, -0.1279),
  makeVenue("mid", 51.51, -0.13),
  makeVenue("near", 51.508, -0.1281),
];

describe("nearestVenueIds", () => {
  it("returns the closest ids, nearest first", () => {
    expect(nearestVenueIds(point.lat, point.lng, venues, 3)).toEqual([
      "nearest",
      "near",
      "mid",
    ]);
  });

  it("respects n (clamps to venue count)", () => {
    expect(nearestVenueIds(point.lat, point.lng, venues, 2)).toEqual(["nearest", "near"]);
    expect(nearestVenueIds(point.lat, point.lng, venues, 99)).toHaveLength(venues.length);
    expect(nearestVenueIds(point.lat, point.lng, venues, 0)).toEqual([]);
  });

  it("returns [] for empty venues", () => {
    expect(nearestVenueIds(point.lat, point.lng, [], 5)).toEqual([]);
  });
});

describe("nearbyVenuesForMap", () => {
  it("frames every pub inside the local radius, nearest first", () => {
    const local = nearbyVenuesForMap(point.lat, point.lng, venues, {
      radiusKm: 1,
      minCount: 1,
      maxCount: 10,
    });
    expect(local.map((venue) => venue.id)).toEqual(["nearest", "near", "mid"]);
  });

  it("tops up sparse areas and caps dense results", () => {
    expect(
      nearbyVenuesForMap(point.lat, point.lng, venues, {
        radiusKm: 0.01,
        minCount: 2,
        maxCount: 2,
      }).map((venue) => venue.id),
    ).toEqual(["nearest", "near"]);
  });
});
