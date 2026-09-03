import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic tests for BOTH backends of the walk-route leg cache. The memory
// backend is exercised directly (including TTL expiry via fake timers); the
// Supabase backend runs against an in-memory fluent mock of the admin client
// (no network), proving the durable path's upsert + freshness-filtered read
// match the memory contract and that a schema-miss fails soft to memory.

import {
  __resetWalkRouteStore,
  memoryWalkRouteStore,
  supabaseWalkRouteStore,
  WALK_ROUTE_LEG_TTL_MS,
} from "@/lib/walkRouteStore";
import type { LngLat } from "@/lib/walkRoute";

const KEY = "-0.1005,51.5136>-0.0975,51.5142";
const GEOM: LngLat[] = [
  [-0.1005, 51.5136],
  [-0.099, 51.5139],
  [-0.0975, 51.5142],
];

type Row = { leg_key: string; coordinates: unknown; expires_at: string };

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  failGet: false,
  failPut: false,
  schemaMiss: false,
}));

vi.mock("@/lib/supabase", () => {
  const SCHEMA_MISS = { message: "Could not find the table 'public.walk_route_legs'" };
  function makeQuery() {
    let key = "";
    let freshnessCutoff = "";
    const query: Record<string, unknown> = {
      select() {
        return query;
      },
      eq(_col: string, value: string) {
        key = value;
        return query;
      },
      gt(_col: string, value: string) {
        freshnessCutoff = value;
        return query;
      },
      maybeSingle() {
        if (db.schemaMiss) return Promise.resolve({ data: null, error: SCHEMA_MISS });
        if (db.failGet) return Promise.resolve({ data: null, error: { message: "read boom" } });
        const row = db.rows.find(
          (r) => r.leg_key === key && Date.parse(r.expires_at) > Date.parse(freshnessCutoff),
        );
        return Promise.resolve({ data: row ?? null, error: null });
      },
      upsert(row: Row) {
        if (db.schemaMiss) return Promise.resolve({ error: SCHEMA_MISS });
        if (db.failPut) return Promise.resolve({ error: { message: "write boom" } });
        const existing = db.rows.findIndex((r) => r.leg_key === row.leg_key);
        if (existing >= 0) db.rows[existing] = row;
        else db.rows.push(row);
        return Promise.resolve({ error: null });
      },
    };
    return query;
  }
  return {
    requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
    isSupabaseConfigured: () => true,
  };
});

beforeEach(() => {
  db.rows = [];
  db.failGet = false;
  db.failPut = false;
  db.schemaMiss = false;
  __resetWalkRouteStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memoryWalkRouteStore", () => {
  it("round-trips a leg", async () => {
    expect(await memoryWalkRouteStore.getLeg(KEY)).toBeNull();
    await memoryWalkRouteStore.putLeg(KEY, GEOM);
    expect(await memoryWalkRouteStore.getLeg(KEY)).toEqual(GEOM);
  });

  it("expires a leg past the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00Z"));
    await memoryWalkRouteStore.putLeg(KEY, GEOM);
    vi.setSystemTime(new Date(Date.now() + WALK_ROUTE_LEG_TTL_MS + 1));
    expect(await memoryWalkRouteStore.getLeg(KEY)).toBeNull();
  });
});

describe("supabaseWalkRouteStore", () => {
  it("upserts then reads back a fresh leg", async () => {
    await supabaseWalkRouteStore.putLeg(KEY, GEOM);
    expect(db.rows).toHaveLength(1);
    expect(await supabaseWalkRouteStore.getLeg(KEY)).toEqual(GEOM);
  });

  it("filters out an expired row on read", async () => {
    db.rows.push({ leg_key: KEY, coordinates: GEOM, expires_at: "2000-01-01T00:00:00Z" });
    expect(await supabaseWalkRouteStore.getLeg(KEY)).toBeNull();
  });

  it("fails soft to memory on a schema miss", async () => {
    db.schemaMiss = true;
    await supabaseWalkRouteStore.putLeg(KEY, GEOM);
    expect(db.rows).toHaveLength(0); // durable write never landed
    expect(await supabaseWalkRouteStore.getLeg(KEY)).toEqual(GEOM); // served from memory
  });

  it("treats a read error as a cache miss and a write error as a no-op", async () => {
    db.failGet = true;
    expect(await supabaseWalkRouteStore.getLeg(KEY)).toBeNull();
    db.failGet = false;
    db.failPut = true;
    await expect(supabaseWalkRouteStore.putLeg(KEY, GEOM)).resolves.toBeUndefined();
  });
});
