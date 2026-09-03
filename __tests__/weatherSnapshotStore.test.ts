import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic tests for BOTH backends of the weather snapshot store. The memory
// backend is exercised directly; the Supabase backend runs against an in-memory
// fluent mock of the admin client (no network), proving the upsert/read round-
// trip and that a schema-miss fails soft to memory.

import {
  __resetWeatherSnapshotStore,
  memoryWeatherSnapshotStore,
  supabaseWeatherSnapshotStore,
} from "@/lib/weatherSnapshotStore";
import type { NightAreaWeatherObservation } from "@/lib/weatherSnapshots";

type Row = Record<string, unknown> & { night_area: string };

const db = vi.hoisted(() => ({ rows: [] as Row[], failWrite: false, schemaMiss: false }));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({
    from: () => ({
      upsert(rows: Row[]) {
        if (db.schemaMiss) {
          return Promise.resolve({ error: { message: "Could not find the table 'public.weather_snapshots'" } });
        }
        if (db.failWrite) return Promise.resolve({ error: { message: "write boom" } });
        for (const r of rows) {
          const i = db.rows.findIndex((x) => x.night_area === r.night_area);
          if (i >= 0) db.rows[i] = r;
          else db.rows.push(r);
        }
        return Promise.resolve({ error: null });
      },
      select() {
        if (db.schemaMiss) {
          return Promise.resolve({ data: null, error: { message: "Could not find the table 'public.weather_snapshots'" } });
        }
        return Promise.resolve({ data: db.rows, error: null });
      },
    }),
  }),
}));

const OBSERVED = "2026-07-20T18:00:00.000Z";
const GENERATED = "2026-07-20T18:05:00.000Z";

function obs(nightArea: string, over: Partial<NightAreaWeatherObservation> = {}): NightAreaWeatherObservation {
  return {
    nightArea: nightArea as NightAreaWeatherObservation["nightArea"],
    observedAt: OBSERVED,
    expiresAt: "2026-07-21T06:00:00.000Z",
    condition: "Clear",
    feelsLikeC: 20,
    precipitationProbabilityPct: 10,
    windKph: 12,
    source: {
      sourceUrl: "https://api.open-meteo.com/v1/forecast?x",
      publisher: "Open-Meteo",
      publishedAt: OBSERVED,
    },
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  db.failWrite = false;
  db.schemaMiss = false;
  __resetWeatherSnapshotStore();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("memoryWeatherSnapshotStore", () => {
  it("round-trips a batch into a reconstructed snapshot", async () => {
    const outcome = await memoryWeatherSnapshotStore.writeSnapshot([obs("clapham"), obs("camden")], GENERATED);
    expect(outcome).toEqual({ written: 2 });
    const snap = await memoryWeatherSnapshotStore.readSnapshot();
    expect(snap?.generatedAt).toBe(GENERATED);
    expect(snap?.observations).toHaveLength(2);
  });

  it("upserts per night area (latest wins)", async () => {
    await memoryWeatherSnapshotStore.writeSnapshot([obs("clapham", { feelsLikeC: 10 })], GENERATED);
    await memoryWeatherSnapshotStore.writeSnapshot([obs("clapham", { feelsLikeC: 25 })], GENERATED);
    const snap = await memoryWeatherSnapshotStore.readSnapshot();
    expect(snap?.observations).toHaveLength(1);
    expect(snap?.observations[0].feelsLikeC).toBe(25);
  });

  it("reads null when empty", async () => {
    expect(await memoryWeatherSnapshotStore.readSnapshot()).toBeNull();
  });
});

describe("supabaseWeatherSnapshotStore", () => {
  it("writes and reads against the durable backend", async () => {
    expect(await supabaseWeatherSnapshotStore.writeSnapshot([obs("clapham"), obs("brixton")], GENERATED)).toEqual({ written: 2 });
    expect(db.rows).toHaveLength(2);
    const snap = await supabaseWeatherSnapshotStore.readSnapshot();
    expect(snap?.observations.map((o) => o.nightArea).sort()).toEqual(["brixton", "clapham"]);
  });

  it("flags failed:true on a hard write error (no fake success)", async () => {
    db.failWrite = true;
    const outcome = await supabaseWeatherSnapshotStore.writeSnapshot([obs("clapham")], GENERATED);
    expect(outcome.failed).toBe(true);
  });

  it("fails soft to memory on a schema miss (table not yet applied)", async () => {
    db.schemaMiss = true;
    const outcome = await supabaseWeatherSnapshotStore.writeSnapshot([obs("clapham")], GENERATED);
    expect(outcome).toEqual({ written: 1 });
    // The memory fallback holds the row; a schema-miss read also drops to memory.
    expect((await supabaseWeatherSnapshotStore.readSnapshot())?.observations).toHaveLength(1);
  });
});
