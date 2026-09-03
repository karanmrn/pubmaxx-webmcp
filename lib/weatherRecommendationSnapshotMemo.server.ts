import "server-only";

import type { WeatherSnapshot } from "@/lib/weatherSnapshots";
import { loadWeatherSnapshot } from "@/lib/weatherSnapshots.server";

const WEATHER_SNAPSHOT_MEMO_MS = 60_000;

let weatherSnapshotMemo: {
  readAt: number;
  snapshot: Promise<WeatherSnapshot | null>;
} | null = null;

export function cachedWeatherRecommendationSnapshot(
  now: number,
): Promise<WeatherSnapshot | null> {
  const memo = weatherSnapshotMemo;
  if (memo && now - memo.readAt < WEATHER_SNAPSHOT_MEMO_MS) {
    return memo.snapshot;
  }
  const entry = {
    readAt: now,
    snapshot: loadWeatherSnapshot().catch((error: unknown) => {
      if (weatherSnapshotMemo === entry) weatherSnapshotMemo = null;
      console.error(
        "[weather-recommendations] weather read failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }),
  };
  weatherSnapshotMemo = entry;
  return entry.snapshot;
}

/** Test seam kept outside the Next route module, whose exports are closed. */
export function __resetWeatherSnapshotMemo(): void {
  weatherSnapshotMemo = null;
}
