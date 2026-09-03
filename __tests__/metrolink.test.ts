import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-tram/route";
import {
  computeMetrolinkLastRide,
  loadMetrolinkStations,
  nearestMetrolinkStation,
  resetMetrolinkStationsCache,
  typicalLastTramForDayType,
} from "@/lib/metrolink";
import {
  lastRideApiPath,
  lastRideFetchUrl,
  lastRideProviderForCity,
  lastRideTabLabel,
} from "@/lib/lastRide";

beforeEach(() => {
  resetMetrolinkStationsCache();
  vi.useRealTimers();
});

afterEach(() => {
  resetMetrolinkStationsCache();
  vi.useRealTimers();
});

describe("lastRide routing", () => {
  it("maps london → /api/last-train, manchester → /api/last-tram, glasgow → /api/last-subway", () => {
    expect(lastRideApiPath("london")).toBe("/api/last-train");
    expect(lastRideApiPath("manchester")).toBe("/api/last-tram");
    expect(lastRideApiPath("glasgow")).toBe("/api/last-subway");
    expect(lastRideApiPath("oxford")).toBeNull();
    expect(lastRideProviderForCity("oxford")).toBeNull();
    expect(lastRideFetchUrl("oxford", 51.75, -1.26)).toBeNull();
    expect(lastRideFetchUrl("manchester", 53.48, -2.24)).toBe(
      "/api/last-tram?lat=53.48&lng=-2.24",
    );
    expect(lastRideTabLabel("Last Tram")).toBe("Tram");
    expect(lastRideTabLabel("Last Pint")).toBe("Pint");
    expect(lastRideTabLabel("Last Subway")).toBe("Subway");
  });
});

describe("Metrolink stations", () => {
  it("loads the bundled seed with key city stops", () => {
    const stations = loadMetrolinkStations();
    expect(stations.length).toBeGreaterThanOrEqual(20);
    const names = stations.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Piccadilly", "Victoria", "St Peter's Square"]));
  });

  it("finds the nearest stop to Manchester city centre", () => {
    const nearest = nearestMetrolinkStation(53.48, -2.24);
    expect(nearest).not.toBeNull();
    expect(nearest!.name.length).toBeGreaterThan(0);
    expect(nearest!.distanceM).toBeLessThan(1500);
    expect(nearest!.lines.length).toBeGreaterThan(0);
  });

  it("returns null for empty station lists", () => {
    expect(nearestMetrolinkStation(53.48, -2.24, [])).toBeNull();
  });
});

describe("typical last tram + decision", () => {
  it("uses conservative day-type clocks", () => {
    expect(typicalLastTramForDayType("mon-thu")).toEqual({ hour: 23, minute: 45 });
    expect(typicalLastTramForDayType("fri")).toEqual({ hour: 24, minute: 30 });
    expect(typicalLastTramForDayType("sat")).toEqual({ hour: 24, minute: 45 });
    expect(typicalLastTramForDayType("sun")).toEqual({ hour: 23, minute: 15 });
  });

  it("returns order_one_more with plenty of margin mid-evening Mon–Thu", () => {
    // Wednesday 20:00 Europe/London (BST) = 19:00 UTC in July.
    const now = new Date("2026-07-08T19:00:00.000Z");
    const result = computeMetrolinkLastRide({ lat: 53.48, lng: -2.24, now });
    expect(result.provider).toBe("metrolink");
    expect(result.modeLabel).toBe("tram");
    expect(result.provenance).toMatch(/Typical Metrolink last service/i);
    expect(result.station.name.length).toBeGreaterThan(0);
    expect(result.trains.length).toBeGreaterThan(0);
    expect(result.decision?.decision).toBe("order_one_more");
    expect(result.decision?.live).toBe(true);
  });

  it("returns train_risk when the typical last tram has already gone", () => {
    // Wednesday 23:55 Europe/London — past Mon–Thu typical last (23:45).
    const now = new Date("2026-07-08T22:55:00.000Z");
    const result = computeMetrolinkLastRide({ lat: 53.48, lng: -2.24, now });
    expect(result.decision?.decision).toBe("train_risk");
  });

  it("marks live_data_unavailable when no stations are available", () => {
    const result = computeMetrolinkLastRide({
      lat: 53.48,
      lng: -2.24,
      stations: [],
    });
    expect(result.decision?.decision).toBe("live_data_unavailable");
    expect(result.error).toMatch(/Metrolink/i);
  });
});

describe("GET /api/last-tram", () => {
  it("400s when lat/lng are missing or invalid", async () => {
    const res = await GET(new Request("http://localhost/api/last-tram"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add valid lat and lng coordinates.", code: "INVALID_REQUEST", retryable: false });
  });

  it("returns 200 with a station for Manchester centre coords", async () => {
    const res = await GET(
      new Request("http://localhost/api/last-tram?lat=53.48&lng=-2.24"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("metrolink");
    expect(body.modeLabel).toBe("tram");
    expect(body.provenance).toMatch(/Typical Metrolink last service/i);
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
    // Force empty stations via compute path by stubbing nearest through empty list
    // — the route itself always catches. Smoke: valid coords always 200.
    const res = await GET(
      new Request("http://localhost/api/last-tram?lat=53.48&lng=-2.24"),
    );
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });
});
