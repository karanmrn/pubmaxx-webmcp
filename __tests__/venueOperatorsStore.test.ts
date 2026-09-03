import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic tests for BOTH backends of the venue-operator claims store. Memory is
// exercised directly; the Supabase backend runs against an in-memory fluent mock
// of the admin client (no network), proving the durable path's upsert-on-pair,
// verification lifecycle, preview schema-miss fallback, and production
// fail-closed writes.

import {
  __resetVenueOperators,
  memoryVenueOperatorStore,
  supabaseVenueOperatorStore,
} from "@/lib/venueOperatorsStore";
import type { OperatorClaimFields } from "@/lib/venueOperators";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ rows: [] as Row[], schemaMiss: false, failWrites: false }));

vi.mock("@/lib/supabase", () => {
  const TABLE_MISSING = "Could not find the table 'public.venue_operators'";

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
        const row = state.insertRow!;
        const dup = db.rows.find(
          (r) => r.account_id === row.account_id && r.venue_id === row.venue_id,
        );
        if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
        db.rows.push({ ...row });
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

const fields = (over: Partial<OperatorClaimFields> = {}): OperatorClaimFields => ({
  accountId: "acct-1",
  venueId: "venue-1",
  evidenceKind: "email-domain",
  evidenceNote: "manager@thepub.co.uk on the pub's domain",
  ...over,
});

beforeEach(() => {
  db.rows = [];
  db.schemaMiss = false;
  db.failWrites = false;
  __resetVenueOperators();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("memoryVenueOperatorStore", () => {
  it("files a pending claim and reads it back for the account+venue", async () => {
    const dto = await memoryVenueOperatorStore.claim(fields());
    expect(dto.verificationState).toBe("pending");
    const found = await memoryVenueOperatorStore.getForAccountVenue("acct-1", "venue-1");
    expect(found?.evidenceKind).toBe("email-domain");
  });

  it("is idempotent per (account, venue): a re-claim reopens the same row", async () => {
    const first = await memoryVenueOperatorStore.claim(fields());
    await memoryVenueOperatorStore.setState(first.id, "rejected", "no proof");
    const second = await memoryVenueOperatorStore.claim(
      fields({ evidenceNote: "new evidence" }),
    );
    expect(second.id).toBe(first.id);
    expect(second.verificationState).toBe("pending"); // reopened
    const queue = await memoryVenueOperatorStore.listForReview("pending");
    expect(queue).toHaveLength(1);
  });

  it("isVerifiedOperator is false until the owner verifies, then true", async () => {
    const dto = await memoryVenueOperatorStore.claim(fields());
    expect(await memoryVenueOperatorStore.isVerifiedOperator("acct-1", "venue-1")).toBe(false);
    await memoryVenueOperatorStore.setState(dto.id, "verified");
    expect(await memoryVenueOperatorStore.isVerifiedOperator("acct-1", "venue-1")).toBe(true);
  });

  it("a revoked operator is no longer verified", async () => {
    const dto = await memoryVenueOperatorStore.claim(fields());
    await memoryVenueOperatorStore.setState(dto.id, "verified");
    await memoryVenueOperatorStore.setState(dto.id, "revoked");
    expect(await memoryVenueOperatorStore.isVerifiedOperator("acct-1", "venue-1")).toBe(false);
  });

  it("setState on an unknown id is false", async () => {
    expect(await memoryVenueOperatorStore.setState("nope", "verified")).toBe(false);
  });
});

describe("supabaseVenueOperatorStore", () => {
  it("inserts, reopens on re-claim, and verifies", async () => {
    const first = await supabaseVenueOperatorStore.claim(fields());
    expect(db.rows).toHaveLength(1);
    await supabaseVenueOperatorStore.setState(first.id, "rejected");
    // Re-claim the same pair → update in place (no second row), reopened pending.
    const second = await supabaseVenueOperatorStore.claim(fields({ evidenceNote: "again" }));
    expect(db.rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.verificationState).toBe("pending");
    await supabaseVenueOperatorStore.setState(first.id, "verified");
    expect(await supabaseVenueOperatorStore.isVerifiedOperator("acct-1", "venue-1")).toBe(true);
  });

  it("lists the review queue by state", async () => {
    await supabaseVenueOperatorStore.claim(fields({ accountId: "a", venueId: "v1" }));
    await supabaseVenueOperatorStore.claim(fields({ accountId: "b", venueId: "v2" }));
    expect(await supabaseVenueOperatorStore.listForReview("pending")).toHaveLength(2);
  });

  it("throws on a hard write failure (route maps that to 503)", async () => {
    db.failWrites = true;
    await expect(supabaseVenueOperatorStore.claim(fields())).rejects.toThrow();
  });

  it("fails soft to memory on a schema miss (table not yet applied)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    db.schemaMiss = true;
    const dto = await supabaseVenueOperatorStore.claim(fields());
    expect(dto.verificationState).toBe("pending");
    // The memory fallback holds it; a durable read also fails soft to memory.
    expect(await memoryVenueOperatorStore.getForAccountVenue("acct-1", "venue-1")).not.toBeNull();
    expect(await supabaseVenueOperatorStore.getForAccountVenue("acct-1", "venue-1")).not.toBeNull();
  });

  it("refuses claim and moderation memory fallbacks in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    db.schemaMiss = true;

    await expect(supabaseVenueOperatorStore.claim(fields())).rejects.toThrow(
      /refusing process-memory write fallback.*0048/,
    );
    expect(await memoryVenueOperatorStore.getForAccountVenue("acct-1", "venue-1")).toBeNull();

    const seeded = await memoryVenueOperatorStore.claim(fields());
    await expect(supabaseVenueOperatorStore.setState(seeded.id, "verified")).rejects.toThrow(
      /refusing process-memory write fallback.*0048/,
    );
    expect(await memoryVenueOperatorStore.isVerifiedOperator("acct-1", "venue-1")).toBe(false);
  });

  it("keeps schema-miss reads fail-soft in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const seeded = await memoryVenueOperatorStore.claim(fields());
    await memoryVenueOperatorStore.setState(seeded.id, "verified");
    db.schemaMiss = true;

    expect(await supabaseVenueOperatorStore.getForAccountVenue("acct-1", "venue-1")).not.toBeNull();
    expect(await supabaseVenueOperatorStore.isVerifiedOperator("acct-1", "venue-1")).toBe(true);
  });

  it("isVerifiedOperator fails closed (false) on a read wobble", async () => {
    // No matching row + not schemaMiss → maybeSingle returns null, not verified.
    expect(await supabaseVenueOperatorStore.isVerifiedOperator("ghost", "venue-x")).toBe(false);
  });
});
