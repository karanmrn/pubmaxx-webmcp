import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic tests for BOTH backends of the operator-proposals store. Memory is
// exercised directly; the Supabase backend runs against an in-memory fluent mock
// (no network), proving create/list/getById/setStatus and the schema-miss
// fail-soft to memory.

import {
  __resetOperatorProposals,
  memoryOperatorProposalStore,
  supabaseOperatorProposalStore,
} from "@/lib/operatorProposalsStore";
import type { OperatorProposalFields } from "@/lib/operatorProposals";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ rows: [] as Row[], schemaMiss: false, failWrites: false }));

vi.mock("@/lib/supabase", () => {
  const TABLE_MISSING = "Could not find the table 'public.operator_proposals'";

  function makeQuery() {
    const state: {
      op: "select" | "insert" | "update" | null;
      insertRow: Row | null;
      patch: Row | null;
      filters: { col: string; value: unknown }[];
      single: boolean;
    } = { op: null, insertRow: null, patch: null, filters: [], single: false };

    const matches = (r: Row) => state.filters.every((f) => r[f.col] === f.value);

    const result = () => {
      if (db.schemaMiss) return { data: null, error: { message: TABLE_MISSING } };
      const rows = db.rows.filter(matches);
      if (state.op === "insert") {
        if (db.failWrites) return { data: null, error: { message: "insert boom" } };
        db.rows.push({ ...state.insertRow! });
        return { data: null, error: null };
      }
      if (state.op === "update") {
        if (db.failWrites) return { data: null, error: { message: "update boom" } };
        rows.forEach((r) => Object.assign(r, state.patch));
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      if (state.single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };

    const q: Record<string, unknown> = {
      select() {
        if (!state.op) state.op = "select";
        return q;
      },
      insert(row: Row) {
        state.op = "insert";
        state.insertRow = row;
        return q;
      },
      update(patch: Row) {
        state.op = "update";
        state.patch = patch;
        return q;
      },
      eq(col: string, value: unknown) {
        state.filters.push({ col, value });
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      maybeSingle() {
        state.single = true;
        return Promise.resolve(result());
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(onFulfilled, onRejected);
      },
    };
    return q;
  }

  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
  };
});

const fields = (over: Partial<OperatorProposalFields> = {}): OperatorProposalFields => ({
  venueId: "venue-1",
  accountId: "acct-1",
  type: "correction",
  payload: { field: "hours", body: "Open until midnight Fri/Sat" },
  ...over,
});

beforeEach(() => {
  db.rows = [];
  db.schemaMiss = false;
  db.failWrites = false;
  __resetOperatorProposals();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("memoryOperatorProposalStore", () => {
  it("creates a pending proposal and lists it for review", async () => {
    const dto = await memoryOperatorProposalStore.create(fields());
    expect(dto.status).toBe("pending");
    expect(dto.payload.body).toBe("Open until midnight Fri/Sat");
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(1);
  });

  it("accept moves it out of pending and into the venue's accepted set", async () => {
    const dto = await memoryOperatorProposalStore.create(fields());
    expect(await memoryOperatorProposalStore.setStatus(dto.id, "accepted", "verified change")).toBe(true);
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(0);
    const accepted = await memoryOperatorProposalStore.listAcceptedForVenue("venue-1");
    expect(accepted).toHaveLength(1);
    expect(accepted[0].id).toBe(dto.id);
  });

  it("decline leaves nothing accepted", async () => {
    const dto = await memoryOperatorProposalStore.create(fields());
    await memoryOperatorProposalStore.setStatus(dto.id, "declined");
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("venue-1")).toHaveLength(0);
  });

  it("getById returns the payload; unknown id is null / false", async () => {
    const dto = await memoryOperatorProposalStore.create(fields());
    expect((await memoryOperatorProposalStore.getById(dto.id))?.type).toBe("correction");
    expect(await memoryOperatorProposalStore.getById("nope")).toBeNull();
    expect(await memoryOperatorProposalStore.setStatus("nope", "accepted")).toBe(false);
  });
});

describe("supabaseOperatorProposalStore", () => {
  it("inserts, lists, and accepts", async () => {
    const dto = await supabaseOperatorProposalStore.create(fields());
    expect(db.rows).toHaveLength(1);
    expect(await supabaseOperatorProposalStore.listForReview("pending")).toHaveLength(1);
    expect(await supabaseOperatorProposalStore.setStatus(dto.id, "accepted")).toBe(true);
    expect(await supabaseOperatorProposalStore.listAcceptedForVenue("venue-1")).toHaveLength(1);
  });

  it("throws on a hard write failure (route maps that to 503)", async () => {
    db.failWrites = true;
    await expect(supabaseOperatorProposalStore.create(fields())).rejects.toThrow();
  });

  it("fails soft to memory on a schema miss", async () => {
    db.schemaMiss = true;
    const dto = await supabaseOperatorProposalStore.create(fields());
    expect(dto.status).toBe("pending");
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(1);
    expect(await supabaseOperatorProposalStore.listForReview("pending")).toHaveLength(1);
  });
});
