import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-merseyrail/route";
import {
  computeMerseyrailLastRide,
  loadMerseyrailStations,
  nearestMerseyrailStation,
  resetMerseyrailStationsCache,
  typicalLastTrainForDayType,
} from "@/lib/merseyrail";
import {
  lastRideApiPath,
  lastRideFetchUrl,
  lastRideProviderForCity,
  lastRideTabLabel,
} from "@/lib/lastRide";

beforeEach(() => {
  resetMerseyrailStationsCache();
  vi.useRealTimers();
});

afterEach(() => {
  resetMerseyrailStationsCache();
  vi.useRealTimers();
});

describe("lastRide routing (Liverpool)", () => {
  it("maps liverpool → /api/last-merseyrail with merseyrail provider", () => {
    expect(lastRideApiPath("liverpool")).toBe("/api/last-merseyrail");
    expect(lastRideProviderForCity("liverpool")).toBe("merseyrail");
    expect(lastRideFetchUrl("liverpool", 53.41, -2.98)).toBe(
      "/api/last-merseyrail?lat=53.41&lng=-2.98",
    );
    expect(lastRideTabLabel("Last Train")).toBe("Train");
  });
});

describe("Merseyrail stations", () => {
  it("loads the bundled seed with key city stops", () => {
    const stations = loadMerseyrailStations();
    expect(stations.length).toBeGreaterThanOrEqual(15);
    expect(stations.length).toBeLessThanOrEqual(30);
    const names = stations.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Liverpool Central",
        "James Street",
        "Moorfields",
        "Sandhills",
        "Hamilton Square",
        "Conway Park",
        "Birkenhead Central",
      ]),
    );
  });

  it("finds the nearest stop to Liverpool city centre", () => {
    const nearest = nearestMerseyrailStation(53.4046, -2.9802);
    expect(nearest).not.toBeNull();
    expect(nearest!.name).toMatch(/Central|Lime Street|Moorfields|James/i);
    expect(nearest!.distanceM).toBeLessThan(800);
    expect(nearest!.lines.length).toBeGreaterThan(0);
  });

  it("returns null for empty station lists", () => {
    expect(nearestMerseyrailStation(53.41, -2.98, [])).toBeNull();
  });
});

describe("typical last train + decision", () => {
  it("uses conservative day-type clocks", () => {
    expect(typicalLastTrainForDayType("mon-thu")).toEqual({ hour: 23, minute: 50 });
    expect(typicalLastTrainForDayType("fri")).toEqual({ hour: 24, minute: 35 });
    expect(typicalLastTrainForDayType("sat")).toEqual({ hour: 24, minute: 50 });
    expect(typicalLastTrainForDayType("sun")).toEqual({ hour: 23, minute: 20 });
  });

  it("returns order_one_more with plenty of margin mid-evening Mon–Thu", () => {
    // Wednesday 20:00 Europe/London (BST) = 19:00 UTC in July.
    const now = new Date("2026-07-08T19:00:00.000Z");
    const result = computeMerseyrailLastRide({ lat: 53.4046, lng: -2.9802, now });
    expect(result.provider).toBe("merseyrail");
    expect(result.modeLabel).toBe("train");
    expect(result.provenance).toMatch(/Typical Merseyrail last service/i);
    expect(result.station.name.length).toBeGreaterThan(0);
    expect(result.trains.length).toBeGreaterThan(0);
    expect(result.decision?.decision).toBe("order_one_more");
    expect(result.decision?.live).toBe(true);
  });

  it("returns train_risk when the typical last train has already gone", () => {
    // Wednesday 23:55 Europe/London — past Mon–Thu typical last (23:50).
    const now = new Date("2026-07-08T22:55:00.000Z");
    const result = computeMerseyrailLastRide({ lat: 53.4046, lng: -2.9802, now });
    expect(result.decision?.decision).toBe("train_risk");
  });

  it("marks live_data_unavailable when no stations are available", () => {
    const result = computeMerseyrailLastRide({
      lat: 53.4046,
      lng: -2.9802,
      stations: [],
    });
    expect(result.decision?.decision).toBe("live_data_unavailable");
    expect(result.error).toMatch(/Merseyrail/i);
  });
});

describe("GET /api/last-merseyrail", () => {
  it("400s when lat/lng are missing or invalid", async () => {
    const res = await GET(new Request("http://localhost/api/last-merseyrail"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add valid lat and lng coordinates.", code: "INVALID_REQUEST", retryable: false });
  });

  it("returns 200 with a station for Liverpool centre coords", async () => {
    const res = await GET(
      new Request("http://localhost/api/last-merseyrail?lat=53.4046&lng=-2.9802"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("merseyrail");
    expect(body.modeLabel).toBe("train");
    expect(body.provenance).toMatch(/Typical Merseyrail last service/i);
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
      new Request("http://localhost/api/last-merseyrail?lat=53.4046&lng=-2.9802"),
    );
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });
});
