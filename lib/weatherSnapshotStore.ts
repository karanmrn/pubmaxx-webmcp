import "server-only";

// Durable-or-memory backing for the cron weather plane. The scheduled route
// (app/api/cron/refresh-weather) writes fresh Open-Meteo observations HERE, and
// the read side (lib/weatherSnapshots.server.ts) reads them store-first, falling
// back to the committed public/data/weather/latest.json so nothing breaks before
// migration 0047 lands or when the store is unavailable.
//
// WHY a store and not the committed file: on Vercel the serverless filesystem is
// read-only, so a cron cannot rewrite the checked-in snapshot. The durable table
// is the only place a scheduled function can persist fresh weather. Same
// dual-backend seam as lib/areaDemandStore.ts: Supabase when env keys exist,
// process-memory otherwise, chosen at the single weatherSnapshotStore() seam.
//
// One row per night area (upserted each run) carrying its observation plus the
// batch `generated_at`. A read reconstructs a WeatherSnapshot: generatedAt = the
// max batch stamp, observations = every stored row still shaped to contract.

import { createFailSoftGuard, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  validateWeatherObservation,
  WEATHER_SNAPSHOT_VERSION,
  type NightAreaWeatherObservation,
  type WeatherSnapshot,
} from "@/lib/weatherSnapshots";

export type WriteWeatherOutcome = {
  /** Number of observations persisted. */
  written: number;
  /** Set when the durable write hard-failed — nothing was persisted. */
  failed?: true;
};

export type WeatherSnapshotStore = {
  /**
   * Persist a batch of observations under one `generatedAt` stamp (upsert per
   * night area). NEVER throws; a durable hard-failure resolves `failed: true` so
   * the route answers honestly rather than faking success.
   */
  writeSnapshot(
    observations: NightAreaWeatherObservation[],
    generatedAt: string,
  ): Promise<WriteWeatherOutcome>;
  /**
   * Read the freshest stored snapshot, or null when the store holds none (empty
   * / not-yet-migrated / read failure). NEVER throws.
   */
  readSnapshot(): Promise<WeatherSnapshot | null>;
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Module-level so it survives across requests within one server process.
const memoryRows = new Map<string, { observation: NightAreaWeatherObservation; generatedAt: string }>();

function snapshotFromRows(
  rows: Array<{ observation: NightAreaWeatherObservation; generatedAt: string }>,
): WeatherSnapshot | null {
  if (rows.length === 0) return null;
  const generatedAt = rows
    .map((row) => row.generatedAt)
    .reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
  const observations = rows.map((row) => row.observation);
  // The snapshot generatedAt must not predate any observation (validateWeatherSnapshot
  // enforces this); the batch stamp is always >= its observations by construction.
  return { version: WEATHER_SNAPSHOT_VERSION, generatedAt, observations };
}

export const memoryWeatherSnapshotStore: WeatherSnapshotStore = {
  async writeSnapshot(observations, generatedAt) {
    let written = 0;
    for (const observation of observations) {
      memoryRows.set(observation.nightArea, { observation, generatedAt });
      written += 1;
    }
    return { written };
  },
  async readSnapshot() {
    return snapshotFromRows([...memoryRows.values()]);
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "weather-snapshot",
  tables: "weather_snapshots",
  migrationHint: "apply migration 0047",
});

type WeatherRow = {
  night_area: string;
  observed_at: string;
  expires_at: string;
  condition: string;
  feels_like_c: number;
  precipitation_probability_pct: number;
  wind_kph: number | null;
  source_url: string;
  source_publisher: string;
  source_published_at: string;
  generated_at: string;
};

function toRow(observation: NightAreaWeatherObservation, generatedAt: string): WeatherRow {
  return {
    night_area: observation.nightArea,
    observed_at: observation.observedAt,
    expires_at: observation.expiresAt,
    condition: observation.condition,
    feels_like_c: observation.feelsLikeC,
    precipitation_probability_pct: observation.precipitationProbabilityPct,
    wind_kph: observation.windKph,
    source_url: observation.source.sourceUrl,
    source_publisher: observation.source.publisher,
    source_published_at: observation.source.publishedAt,
    generated_at: generatedAt,
  };
}

function fromRow(row: WeatherRow): NightAreaWeatherObservation | null {
  return validateWeatherObservation({
    nightArea: row.night_area,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    condition: row.condition,
    feelsLikeC: row.feels_like_c,
    precipitationProbabilityPct: row.precipitation_probability_pct,
    windKph: row.wind_kph,
    source: {
      sourceUrl: row.source_url,
      publisher: row.source_publisher,
      publishedAt: row.source_published_at,
    },
  });
}

export const supabaseWeatherSnapshotStore: WeatherSnapshotStore = {
  async writeSnapshot(observations, generatedAt) {
    if (observations.length === 0) return { written: 0 };
    return guard<WriteWeatherOutcome>({
      context: "writeSnapshot",
      onSchemaMiss: () => memoryWeatherSnapshotStore.writeSnapshot(observations, generatedAt),
      message: "writeSnapshot failed — flagging degraded write",
      onError: () => ({ written: 0, failed: true }),
      run: async () => {
        const { error } = await requireSupabaseAdmin()
          .from("weather_snapshots")
          .upsert(observations.map((o) => toRow(o, generatedAt)), { onConflict: "night_area" });
        if (error) throw new Error(error.message);
        return { written: observations.length };
      },
    });
  },

  async readSnapshot() {
    return guard<WeatherSnapshot | null>({
      context: "readSnapshot",
      onSchemaMiss: () => memoryWeatherSnapshotStore.readSnapshot(),
      message: "readSnapshot failed — returning null",
      onError: () => null,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("weather_snapshots")
          .select("*");
        if (error) throw new Error(error.message);
        const rows = ((data ?? []) as WeatherRow[])
          .map((row) => ({ observation: fromRow(row), generatedAt: row.generated_at }))
          .filter((r): r is { observation: NightAreaWeatherObservation; generatedAt: string } => r.observation !== null);
        return snapshotFromRows(rows);
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function weatherSnapshotStore(): WeatherSnapshotStore {
  return selectStore(memoryWeatherSnapshotStore, supabaseWeatherSnapshotStore);
}

/** Test-only: clear the in-memory rows and warn dedupe. */
export function __resetWeatherSnapshotStore(): void {
  memoryRows.clear();
  resetSchemaMissWarnings();
}
