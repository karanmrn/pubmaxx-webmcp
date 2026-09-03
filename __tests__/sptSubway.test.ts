import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-subway/route";
import { lastRideApiPath, lastRideFetchUrl, lastRideTabLabel } from "@/lib/lastRide";
import {
  computeSptSubwayLastRide,
  loadSptSubwayStations,
  nearestSptSubwayStation,
  resetSptSubwayStationsCache,
  typicalLastSubwayForDayType,
} from "@/lib/sptSubway";

beforeEach(() => {
  resetSptSubwayStationsCache();
  vi.useRealTimers();
});

afterEach(() => {
  resetSptSubwayStationsCache();
  vi.useRealTimers();
});

describe("lastRide routing (Glasgow)", () => {
  it("maps glasgow → /api/last-subway", () => {
    expect(lastRideApiPath("glasgow")).toBe("/api/last-subway");
    expect(lastRideFetchUrl("glasgow", 55.86, -4.25)).toBe(
      "/api/last-subway?lat=55.86&lng=-4.25",
    );
    expect(lastRideTabLabel("Last Subway")).toBe("Subway");
  });
});

describe("SPT Subway stations", () => {
  it("loads all 15 Clockwork Orange stops", () => {
    const stations = loadSptSubwayStations();
    expect(stations).toHaveLength(15);
    const names = stations.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "St Enoch",
        "Buchanan Street",
        "Cowcaddens",
        "St George's Cross",
        "Kelvinbridge",
        "Hillhead",
        "Kelvinhall",
        "Partick",
        "Govan",
        "Ibrox",
        "Cessnock",
        "Kinning Park",
        "West Street",
        "Bridge Street",
        "Shields Road",
      ]),
    );
  });

  it("finds the nearest stop to Glasgow city centre (55.86, -4.25)", () => {
    const nearest = nearestSptSubwayStation(55.86, -4.25);
    expect(nearest).not.toBeNull();
    expect(nearest!.name.length).toBeGreaterThan(0);
    expect(nearest!.distanceM).toBeLessThan(1500);
    expect(nearest!.lines.length).toBeGreaterThan(0);
    // Centre sits between Buchanan Street / St Enoch — either is fine.
    expect(["Buchanan Street", "St Enoch", "Cowcaddens"]).toContain(nearest!.name);
  });

  it("returns null for empty station lists", () => {
    expect(nearestSptSubwayStation(55.86, -4.25, [])).toBeNull();
  });
});

describe("typical last subway + decision", () => {
  it("uses honest ~23:00 typical close (Fri/Sat similar)", () => {
    expect(typicalLastSubwayForDayType("mon-thu")).toEqual({ hour: 23, minute: 0 });
    expect(typicalLastSubwayForDayType("fri")).toEqual({ hour: 23, minute: 0 });
    expect(typicalLastSubwayForDayType("sat")).toEqual({ hour: 23, minute: 0 });
    expect(typicalLastSubwayForDayType("sun")).toEqual({ hour: 22, minute: 45 });
  });

  it("returns order_one_more with plenty of margin mid-evening Mon–Thu", () => {
    // Wednesday 20:00 Europe/London (BST) = 19:00 UTC in July.
    const now = new Date("2026-07-08T19:00:00.000Z");
    const result = computeSptSubwayLastRide({ lat: 55.86, lng: -4.25, now });
    expect(result.provider).toBe("spt-subway");
    expect(result.modeLabel).toBe("subway");
    expect(result.provenance).toMatch(/Typical SPT Subway last service/i);
    expect(result.station.name.length).toBeGreaterThan(0);
    expect(result.trains.length).toBeGreaterThan(0);
    expect(result.decision?.decision).toBe("order_one_more");
    expect(result.decision?.live).toBe(true);
  });

  it("returns train_risk when the typical last subway has already gone", () => {
    // Wednesday 23:10 Europe/London — past Mon–Thu typical last (23:00).
    const now = new Date("2026-07-08T22:10:00.000Z");
    const result = computeSptSubwayLastRide({ lat: 55.86, lng: -4.25, now });
    expect(result.decision?.decision).toBe("train_risk");
  });

  it("marks live_data_unavailable when no stations are available", () => {
    const result = computeSptSubwayLastRide({
      lat: 55.86,
      lng: -4.25,
      stations: [],
    });
    expect(result.decision?.decision).toBe("live_data_unavailable");
    expect(result.error).toMatch(/Subway/i);
  });
});

describe("GET /api/last-subway", () => {
  it("400s when lat/lng are missing or invalid", async () => {
    const res = await GET(new Request("http://localhost/api/last-subway"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add valid lat and lng coordinates.", code: "INVALID_REQUEST", retryable: false });
  });

  it("returns 200 with a station for Glasgow centre coords", async () => {
    const res = await GET(
      new Request("http://localhost/api/last-subway?lat=55.86&lng=-4.25"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("spt-subway");
    expect(body.modeLabel).toBe("subway");
    expect(body.provenance).toMatch(/Typical SPT Subway last service/i);
    expect(body.station).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        distanceM: expect.any(Number),
      }),
    );
    expect(body.station.id.length).toBeGreaterThan(0);
    expect(body.trains.length).toBeGreaterThan(0);
    expect(body.decision).toEqual(
      expect.objectContaining({
        decision: expect.any(String),
        stationName: body.station.name,
      }),
    );
    expect(body.decision.destinationLabel).toBeNull();
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });

  it("never 500s on unexpected failure paths (empty seed still 200)", async () => {
    const res = await GET(
      new Request("http://localhost/api/last-subway?lat=55.86&lng=-4.25"),
    );
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });
});
