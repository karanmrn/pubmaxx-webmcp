import "server-only";

// Server-only store-first reader for the weather snapshot. Kept OUT of the pure
// lib/weatherSnapshots.ts on purpose: that module is imported by the deliberately
// fetch-free lib/todayBrief.ts and by app/api/plans/generate (another lane's
// surface), so it must stay IO-free. This sibling adds the durable read.
//
// Ordering (honest freshness): the durable store wins when it holds a valid
// snapshot (the cron plane writes fresh Open-Meteo readings there); otherwise we
// fall back to the committed public/data/weather/latest.json so the feed keeps
// working before migration 0047 lands and whenever the store is unavailable. A
// store read NEVER throws (the store swallows schema-miss / errors to null), and
// the committed file is always a valid last resort.

import {
  validateWeatherSnapshot,
  type WeatherSnapshot,
} from "@/lib/weatherSnapshots";
import { weatherSnapshotStore, type WeatherSnapshotStore } from "@/lib/weatherSnapshotStore";
import committedSnapshot from "@/public/data/weather/latest.json";

export type LoadWeatherSnapshotDeps = {
  /** Test seam: the store to read (defaults to the selected backend). */
  store?: WeatherSnapshotStore;
  /** Test seam: the committed-file fallback (defaults to the bundled import). */
  committed?: unknown;
};

/**
 * Resolve the snapshot the app should serve: store-first, committed-file
 * fallback. Returns a validated WeatherSnapshot, or the committed file's parsed
 * value (validated) when the store is empty/unavailable. Both paths are shaped
 * to the same contract, so callers (e.g. tonight-conditions) treat the result
 * identically to the old direct file import.
 */
export async function loadWeatherSnapshot(
  deps: LoadWeatherSnapshotDeps = {},
): Promise<WeatherSnapshot | null> {
  const store = deps.store ?? weatherSnapshotStore();
  const fromStore = await store.readSnapshot();
  if (fromStore && validateWeatherSnapshot(fromStore)) return fromStore;
  return validateWeatherSnapshot(deps.committed ?? committedSnapshot);
}
