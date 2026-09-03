import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic tests for BOTH backends of the area-demand store. The memory backend
// is exercised directly; the Supabase backend runs against an in-memory fluent
// mock of the admin client (no network), proving the durable path's insert +
// count-by-area-key match the process-memory contract, while schema misses fall
// back only outside deployed production.

import {
  __resetAreaDemand,
  memoryAreaDemandStore,
  supabaseAreaDemandStore,
} from "@/lib/areaDemandStore";
import type { NormalisedAreaDemand } from "@/lib/areaDemand";

type Row = {
  area: string;
  area_key: string;
  matched_patch_id: string | null;
  source: string;
  email: string | null;
  created_at: string;
};

const db = vi.hoisted(() => ({ rows: [] as Row[], failInsert: false, schemaMiss: false }));

vi.mock("@/lib/supabase", () => {
  function makeQuery() {
    let op: "insert" | "select" | null = null;
    let selectCount = false;
    const filters: { column: string; value: unknown }[] = [];

    const query = {
      insert(row: Row) {
        op = "insert";
        if (db.schemaMiss) {
          return Promise.resolve({
            error: { message: "Could not find the table 'public.area_demand'" },
          });
        }
        if (db.failInsert) {
          return Promise.resolve({ error: { message: "insert boom" } });
        }
        db.rows.push(row);
        return Promise.resolve({ error: null });
      },
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        op = "select";
        selectCount = Boolean(opts?.count);
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        if (db.schemaMiss) {
          return Promise.resolve({
            count: null,
            error: { message: "Could not find the table 'public.area_demand'" },
          });
        }
        const key = filters.find((f) => f.column === "area_key")?.value;
        const count = db.rows.filter((r) => r.area_key === key).length;
        return Promise.resolve({ count: selectCount ? count : null, error: null });
      },
    };
    void op;
    return query;
  }

  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
  };
});

const input = (over: Partial<NormalisedAreaDemand> = {}): NormalisedAreaDemand => ({
  area: "Peckham",
  matchedPatchId: null,
  source: "area-picker",
  email: null,
  ...over,
});

beforeEach(() => {
  db.rows = [];
  db.failInsert = false;
  db.schemaMiss = false;
  __resetAreaDemand();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("memoryAreaDemandStore", () => {
  it("records a demand signal without an email", async () => {
    const outcome = await memoryAreaDemandStore.record(input());
    expect(outcome).toEqual({ status: "recorded" });
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(1);
  });

  it("counts by normalised area key, case-insensitively", async () => {
    await memoryAreaDemandStore.record(input({ area: "Peckham" }));
    await memoryAreaDemandStore.record(input({ area: "peckham" }));
    await memoryAreaDemandStore.record(input({ area: "Deptford" }));
    expect(await memoryAreaDemandStore.countForArea("PECKHAM")).toBe(2);
    expect(await memoryAreaDemandStore.countForArea("deptford")).toBe(1);
  });

  it("keeps an offered email but never requires it", async () => {
    await memoryAreaDemandStore.record(input({ email: "me@example.com" }));
    await memoryAreaDemandStore.record(input());
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(2);
  });

  it("flags a blank area as a degraded write", async () => {
    const outcome = await memoryAreaDemandStore.record(input({ area: "   " }));
    expect(outcome.failed).toBe(true);
  });
});

describe("supabaseAreaDemandStore", () => {
  it("inserts and counts against the durable backend", async () => {
    expect(await supabaseAreaDemandStore.record(input())).toEqual({ status: "recorded" });
    await supabaseAreaDemandStore.record(input({ area: "Peckham", email: "me@example.com" }));
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0].area_key).toBe("peckham");
    expect(await supabaseAreaDemandStore.countForArea("peckham")).toBe(2);
  });

  it("answers 503-shaped failed:true on a hard insert error", async () => {
    db.failInsert = true;
    const outcome = await supabaseAreaDemandStore.record(input());
    expect(outcome.failed).toBe(true);
  });

  it("fails soft to memory on a schema miss (table not yet applied)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    db.schemaMiss = true;
    const outcome = await supabaseAreaDemandStore.record(input());
    expect(outcome).toEqual({ status: "recorded" });
    // The memory fallback holds the row, so a subsequent memory read sees it.
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(1);
  });

  it("returns a failed outcome without writing memory on a production schema miss", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    db.schemaMiss = true;

    expect(await supabaseAreaDemandStore.record(input())).toEqual({
      status: "recorded",
      failed: true,
    });
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(0);
  });

  it("keeps schema-miss reads fail-soft in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await memoryAreaDemandStore.record(input());
    db.schemaMiss = true;

    expect(await supabaseAreaDemandStore.countForArea("peckham")).toBe(1);
  });
});
