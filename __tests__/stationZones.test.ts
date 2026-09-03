import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The zone assignment is build-time plain JS; vitest can import the .mjs
// directly so the test exercises the exact functions the slim build calls.
import {
  haversineKm,
  nearestStationZone,
  loadStationZones,
} from "@/scripts/lib/stationZones.mjs";

const ROOT = path.resolve(__dirname, "..");

type Station = { name: string; lat: number; lng: number; zone: number };

function loadDataset(): { _provenance: unknown; stations: Station[] } {
  const raw = readFileSync(path.join(ROOT, "data", "tfl_station_zones.json"), "utf8");
  return JSON.parse(raw);
}

describe("nearestStationZone", () => {
  const stations: Station[] = [
    { name: "Zone One Central", lat: 51.5155, lng: -0.1418, zone: 1 },
    { name: "Zone Three Mid", lat: 51.56, lng: -0.11, zone: 3 },
    { name: "Zone Six Edge", lat: 51.63, lng: -0.13, zone: 6 },
  ];

  it("assigns the nearest station's zone", () => {
    // A point right on the Zone One station.
    const near1 = nearestStationZone(51.5155, -0.1418, stations);
    expect(near1?.zone).toBe(1);
    expect(near1?.station).toBe("Zone One Central");

    // A point up by the Zone Six edge station.
    const near6 = nearestStationZone(51.629, -0.129, stations);
    expect(near6?.zone).toBe(6);
  });

  it("breaks ties by strict closeness, not list order", () => {
    // Equidistant-ish but clearly closer to the mid (zone 3) station.
    const near = nearestStationZone(51.559, -0.111, stations);
    expect(near?.zone).toBe(3);
  });

  it("returns null for an empty station table", () => {
    expect(nearestStationZone(51.5, -0.1, [])).toBeNull();
  });

  it("returns null for non-finite coordinates", () => {
    expect(nearestStationZone(Number.NaN, -0.1, stations)).toBeNull();
    expect(nearestStationZone(51.5, Number.POSITIVE_INFINITY, stations)).toBeNull();
  });

  it("skips stations with bad coordinates rather than crashing", () => {
    const withBad: Station[] = [
      { name: "Bad", lat: Number.NaN, lng: -0.1, zone: 2 },
      { name: "Good", lat: 51.5, lng: -0.1, zone: 4 },
    ];
    const near = nearestStationZone(51.5, -0.1, withBad);
    expect(near?.zone).toBe(4);
  });

  it("still assigns a far-out venue the nearest zone (no unknown when a station exists)", () => {
    // A venue far from all three still resolves to the closest (zone 6 edge).
    const near = nearestStationZone(51.72, -0.14, stations);
    expect(near?.zone).toBe(6);
  });
});

describe("haversineKm", () => {
  it("is zero for a point against itself", () => {
    expect(haversineKm(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0, 6);
  });

  it("grows with separation", () => {
    const near = haversineKm(51.5, -0.1, 51.51, -0.1);
    const far = haversineKm(51.5, -0.1, 51.6, -0.1);
    expect(far).toBeGreaterThan(near);
  });
});

describe("committed station-zone dataset", () => {
  it("loads with provenance and only positive-integer zones", async () => {
    const doc = loadDataset();
    expect(doc._provenance).toBeTruthy();
    expect(doc.stations.length).toBeGreaterThan(500);
    for (const station of doc.stations) {
      expect(Number.isInteger(station.zone)).toBe(true);
      expect(station.zone).toBeGreaterThanOrEqual(1);
      expect(station.zone).toBeLessThanOrEqual(9);
      expect(Number.isFinite(station.lat)).toBe(true);
      expect(Number.isFinite(station.lng)).toBe(true);
    }
  });

  it("records multi-zone stations as their LOWER zone", () => {
    const doc = loadDataset();
    const byName = (needle: string) =>
      doc.stations.find((s) => s.name.toLowerCase() === needle.toLowerCase());
    // Earl's Court is zone 1/2 → lower is 1; Turnham Green is 2/3 → 2.
    expect(byName("Earls Court")?.zone).toBe(1);
    expect(byName("Turnham Green")?.zone).toBe(2);
  });

  it("loadStationZones returns the sanitised station list", async () => {
    const stations = await loadStationZones();
    expect(stations.length).toBeGreaterThan(500);
    expect(stations.every((s) => Number.isInteger(s.zone))).toBe(true);
  });
});
