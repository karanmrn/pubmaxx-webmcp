import { describe, expect, it } from "vitest";

import { nearestStaticStation, STATIC_STATIONS } from "@/lib/staticStations";

describe("staticStations", () => {
  it("ships a non-empty curated station list", () => {
    expect(STATIC_STATIONS.length).toBeGreaterThanOrEqual(10);
    for (const station of STATIC_STATIONS) {
      expect(station.id.trim()).not.toBe("");
      expect(station.name.trim()).not.toBe("");
      expect(Number.isFinite(station.lat)).toBe(true);
      expect(Number.isFinite(station.lon)).toBe(true);
      expect(station.lines.length).toBeGreaterThan(0);
    }
  });

  it("returns the nearest station to a point", () => {
    // Near Oxford Circus.
    const hit = nearestStaticStation(51.514, -0.140);
    expect(hit).not.toBeNull();
    expect(hit?.name).toBe("Oxford Circus");
    expect(hit!.distanceM).toBeLessThan(500);
  });

  it("returns null for invalid coordinates", () => {
    expect(nearestStaticStation(Number.NaN, 0)).toBeNull();
  });
});
