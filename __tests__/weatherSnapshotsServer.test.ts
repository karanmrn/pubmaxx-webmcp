import { describe, expect, it } from "vitest";

// Store-first ordering for the read side (store wins over the committed file),
// with the committed file as the guaranteed fallback. Both seams are injected —
// no Supabase, no disk read of the live snapshot.

import { loadWeatherSnapshot } from "@/lib/weatherSnapshots.server";
import type { WeatherSnapshot } from "@/lib/weatherSnapshots";
import type { WeatherSnapshotStore } from "@/lib/weatherSnapshotStore";

function snap(generatedAt: string, feelsLikeC: number): WeatherSnapshot {
  return {
    version: 1,
    generatedAt,
    observations: [
      {
        nightArea: "clapham",
        observedAt: "2026-07-18T18:00:00.000Z",
        expiresAt: "2026-07-19T06:00:00.000Z",
        condition: "Clear",
        feelsLikeC,
        precipitationProbabilityPct: 10,
        windKph: 12,
        source: {
          sourceUrl: "https://api.open-meteo.com/v1/forecast?x",
          publisher: "Open-Meteo",
          publishedAt: "2026-07-18T18:00:00.000Z",
        },
      },
    ],
  };
}

const COMMITTED = snap("2026-07-19T00:00:00.000Z", 11);

function storeReturning(value: WeatherSnapshot | null): WeatherSnapshotStore {
  return {
    readSnapshot: async () => value,
    writeSnapshot: async () => ({ written: 0 }),
  };
}

describe("loadWeatherSnapshot (store-first, committed fallback)", () => {
  it("prefers the store snapshot when present and valid", async () => {
    const fresh = snap("2026-07-21T12:00:00.000Z", 25);
    const result = await loadWeatherSnapshot({ store: storeReturning(fresh), committed: COMMITTED });
    expect(result?.generatedAt).toBe("2026-07-21T12:00:00.000Z");
    expect(result?.observations[0].feelsLikeC).toBe(25);
  });

  it("falls back to the committed file when the store is empty", async () => {
    const result = await loadWeatherSnapshot({ store: storeReturning(null), committed: COMMITTED });
    expect(result?.generatedAt).toBe("2026-07-19T00:00:00.000Z");
    expect(result?.observations[0].feelsLikeC).toBe(11);
  });

  it("falls back to the committed file when the store returns something invalid", async () => {
    const bogus = { version: 1, generatedAt: "not-a-date", observations: [] } as unknown as WeatherSnapshot;
    const result = await loadWeatherSnapshot({ store: storeReturning(bogus), committed: COMMITTED });
    expect(result?.generatedAt).toBe("2026-07-19T00:00:00.000Z");
  });
});
