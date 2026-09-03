import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic: every IO seam (freshest-snapshot reader, live provider fetch, cache
// store) is injected, so no Supabase, no committed-file disk read, and no live
// network. Three layers are covered:
//   - the pure staleness threshold (isWeatherFresh),
//   - the no-network baseline (fresh cache => serve it, never fetch),
//   - the live top-up path (stale cache => mocked live fetch, cached back),
//   - fail-soft (live throws / yields nothing => freshest cached snapshot).

import {
  __resetWeatherReadThrough,
  isWeatherFresh,
  loadFreshWeatherSnapshot,
  WEATHER_READTHROUGH_MAX_AGE_MS,
} from "@/lib/weatherFreshness.server";
import type { FetchObservationsResult } from "@/lib/weatherProvider";
import type { NightAreaWeatherObservation, WeatherSnapshot } from "@/lib/weatherSnapshots";
import type { WeatherSnapshotStore } from "@/lib/weatherSnapshotStore";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const NOW_MS = NOW.getTime();

function observation(generatedAt: string, feelsLikeC: number): NightAreaWeatherObservation {
  const observedAt = new Date(Date.parse(generatedAt) - 60_000).toISOString();
  return {
    nightArea: "clapham",
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 12 * 3_600_000).toISOString(),
    condition: "Clear",
    feelsLikeC,
    precipitationProbabilityPct: 10,
    windKph: 12,
    source: {
      sourceUrl: "https://api.open-meteo.com/v1/forecast?x",
      publisher: "Open-Meteo",
      publishedAt: observedAt,
    },
  };
}

function snap(generatedAt: string, feelsLikeC: number): WeatherSnapshot {
  return { version: 1, generatedAt, observations: [observation(generatedAt, feelsLikeC)] };
}

function storeSpy(): WeatherSnapshotStore & { writes: number } {
  const store = {
    writes: 0,
    async writeSnapshot() {
      store.writes += 1;
      return { written: 1 };
    },
    async readSnapshot() {
      return null;
    },
  };
  return store;
}

function liveResult(feelsLikeC: number): FetchObservationsResult {
  // Observed ~30 min before NOW so observedAt <= generatedAt (=NOW) holds.
  const observedAt = new Date(NOW_MS - 30 * 60_000).toISOString();
  return {
    observations: [
      {
        ...observation(observedAt, feelsLikeC),
        observedAt,
        expiresAt: new Date(Date.parse(observedAt) + 12 * 3_600_000).toISOString(),
        source: {
          sourceUrl: "https://api.open-meteo.com/v1/forecast?live",
          publisher: "Open-Meteo",
          publishedAt: observedAt,
        },
      },
    ],
    skipped: [],
  };
}

beforeEach(() => {
  __resetWeatherReadThrough();
});

afterEach(() => {
  __resetWeatherReadThrough();
  vi.clearAllMocks();
});

describe("isWeatherFresh (pure threshold)", () => {
  it("is fresh at and within the window", () => {
    expect(isWeatherFresh(snap(new Date(NOW_MS - 10 * 60_000).toISOString(), 20), NOW_MS)).toBe(true);
    // Exactly at the boundary counts as fresh.
    expect(isWeatherFresh(snap(new Date(NOW_MS - WEATHER_READTHROUGH_MAX_AGE_MS).toISOString(), 20), NOW_MS)).toBe(true);
  });

  it("is stale past the window", () => {
    expect(isWeatherFresh(snap(new Date(NOW_MS - WEATHER_READTHROUGH_MAX_AGE_MS - 1).toISOString(), 20), NOW_MS)).toBe(false);
    // The 4-day-old committed snapshot shape.
    expect(isWeatherFresh(snap("2026-07-18T22:25:46.579Z", 20), NOW_MS)).toBe(false);
  });

  it("treats missing, unparseable, or future stamps as not fresh", () => {
    expect(isWeatherFresh(null, NOW_MS)).toBe(false);
    expect(isWeatherFresh({ version: 1, generatedAt: "not-a-date", observations: [] } as unknown as WeatherSnapshot, NOW_MS)).toBe(false);
    expect(isWeatherFresh(snap(new Date(NOW_MS + 60_000).toISOString(), 20), NOW_MS)).toBe(false);
  });
});

describe("loadFreshWeatherSnapshot (read-through)", () => {
  it("serves the cached snapshot without touching the network when it is fresh", async () => {
    const fresh = snap(new Date(NOW_MS - 10 * 60_000).toISOString(), 21);
    const fetchObservations = vi.fn(async (): Promise<FetchObservationsResult> => {
      throw new Error("network must not be called on the fresh baseline");
    });
    const store = storeSpy();

    const result = await loadFreshWeatherSnapshot({
      now: NOW,
      loadFreshest: async () => fresh,
      fetchObservations,
      store,
    });

    expect(result?.generatedAt).toBe(fresh.generatedAt);
    expect(fetchObservations).not.toHaveBeenCalled();
    expect(store.writes).toBe(0);
  });

  it("fetches live and caches it when the cached snapshot is stale", async () => {
    const stale = snap("2026-07-18T22:25:46.579Z", 11); // committed-shaped, 4 days old
    const fetchObservations = vi.fn(async () => liveResult(26));
    const store = storeSpy();

    const result = await loadFreshWeatherSnapshot({
      now: NOW,
      loadFreshest: async () => stale,
      fetchObservations,
      store,
    });

    expect(fetchObservations).toHaveBeenCalledTimes(1);
    // Served the live snapshot (generatedAt stamped now), not the stale one.
    expect(result?.generatedAt).toBe(NOW.toISOString());
    expect(result?.observations[0].feelsLikeC).toBe(26);
    // Cached back through the store (in-process, or durable when configured).
    expect(store.writes).toBe(1);
  });

  it("fails soft to the freshest cached snapshot when the live fetch throws", async () => {
    const stale = snap("2026-07-18T22:25:46.579Z", 11);
    const fetchObservations = vi.fn(async (): Promise<FetchObservationsResult> => {
      throw new Error("Open-Meteo down");
    });
    const store = storeSpy();

    const result = await loadFreshWeatherSnapshot({
      now: NOW,
      loadFreshest: async () => stale,
      fetchObservations,
      store,
    });

    expect(result?.generatedAt).toBe(stale.generatedAt);
    expect(store.writes).toBe(0);
  });

  it("fails soft when the live fetch yields no surviving observations", async () => {
    const stale = snap("2026-07-18T22:25:46.579Z", 11);
    const fetchObservations = vi.fn(async (): Promise<FetchObservationsResult> => ({ observations: [], skipped: [] }));

    const result = await loadFreshWeatherSnapshot({
      now: NOW,
      loadFreshest: async () => stale,
      fetchObservations,
      store: storeSpy(),
    });

    expect(result?.generatedAt).toBe(stale.generatedAt);
  });

  it("stops waiting for a slow provider and serves the cached reading", async () => {
    const stale = snap("2026-07-18T22:25:46.579Z", 11);
    let release: (() => void) | undefined;
    const arrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchObservations = vi.fn(async () => {
      await arrived;
      return liveResult(26);
    });
    const store = storeSpy();

    const result = await loadFreshWeatherSnapshot({
      now: NOW,
      loadFreshest: async () => stale,
      fetchObservations,
      store,
      topUpDeadlineMs: 5,
    });

    // The render got the cached reading, with its own honest staleness stamp.
    expect(result?.generatedAt).toBe(stale.generatedAt);
    // The top-up was NOT cancelled: it lands, and it caches for the next reader.
    release?.();
    await vi.waitFor(() => expect(store.writes).toBe(1));
  });

  it("waits for as long as the provider takes when the deadline is switched off", async () => {
    const stale = snap("2026-07-18T22:25:46.579Z", 11);
    const fetchObservations = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return liveResult(26);
    });

    const result = await loadFreshWeatherSnapshot({
      now: NOW,
      loadFreshest: async () => stale,
      fetchObservations,
      store: storeSpy(),
      topUpDeadlineMs: 0,
    });

    expect(result?.generatedAt).toBe(NOW.toISOString());
    expect(result?.observations[0].feelsLikeC).toBe(26);
  });

  it("returns null when everything is stale and there is no cache to fall back to", async () => {
    const fetchObservations = vi.fn(async (): Promise<FetchObservationsResult> => {
      throw new Error("Open-Meteo down");
    });

    const result = await loadFreshWeatherSnapshot({
      now: NOW,
      loadFreshest: async () => null,
      fetchObservations,
      store: storeSpy(),
    });

    expect(result).toBeNull();
  });
});
