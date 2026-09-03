import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic tests for BOTH backends of the structured visit reports store. The
// memory backend is exercised directly; the Supabase backend runs against an
// in-memory fluent mock of the admin client (no network), proving the durable
// path's upsert / report / moderate match the process-memory contract, while
// schema misses fall back only outside deployed production.

import {
  __resetVisitReports,
  memoryVisitReportStore,
  supabaseVisitReportStore,
} from "@/lib/visitReportsStore";
import type { VisitReportFields } from "@/lib/visitReports";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ rows: [] as Row[], schemaMiss: false, failWrites: false }));

vi.mock("@/lib/supabase", () => {
  const TABLE_MISSING = "Could not find the table 'public.structured_visit_reports'";

  function makeQuery() {
    const state: {
      op: "select" | "insert" | "update" | null;
      insertRow: Row | null;
      patch: Row | null;
      filters: { col: string; value: unknown }[];
      greaterThan: { col: string; value: number }[];
      orders: { col: string; ascending: boolean }[];
      single: boolean;
      headCount: boolean;
    } = {
      op: null,
      insertRow: null,
      patch: null,
      filters: [],
      greaterThan: [],
      orders: [],
      single: false,
      headCount: false,
    };

    const matches = (r: Row) =>
      state.filters.every((f) => r[f.col] === f.value) &&
      state.greaterThan.every((f) => Number(r[f.col] ?? 0) > f.value);

    const result = () => {
      if (db.schemaMiss) return { data: null, error: { message: TABLE_MISSING } };
      const rows = db.rows.filter(matches);
      if (state.op === "insert") {
        if (db.failWrites) return { data: null, error: { message: "insert boom" } };
        const row = state.insertRow!;
        const dup = db.rows.find(
          (r) =>
            r.venue_id === row.venue_id && r.handle === row.handle && r.visited_at === row.visited_at,
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
      if (state.headCount) return { data: null, count: rows.length, error: null };
      if (state.single) return { data: rows[0] ?? null, error: null };
      // Honour .order() the way Postgres does (each key in the order it was
      // added) so the durable read's ordering is actually under test.
      const ordered = [...rows].sort((a, b) => {
        for (const { col, ascending } of state.orders) {
          const cmp = String(a[col] ?? "").localeCompare(String(b[col] ?? ""));
          if (cmp !== 0) return ascending ? cmp : -cmp;
        }
        return 0;
      });
      return { data: ordered, error: null };
    };

    const q: Record<string, unknown> = {
      select(_cols?: string, options?: { count?: string; head?: boolean }) {
        if (!state.op) state.op = "select";
        state.headCount = options?.count === "exact" && options.head === true;
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
      gt(col: string, value: number) {
        state.greaterThan.push({ col, value });
        return q;
      },
      is(col: string, value: unknown) {
        state.filters.push({ col, value });
        return q;
      },
      order(col: string, options?: { ascending?: boolean }) {
        state.orders.push({ col, ascending: options?.ascending !== false });
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

const fields = (over: Partial<VisitReportFields> = {}): VisitReportFields => ({
  venueId: "venue-1",
  handle: "sam",
  visitedAt: "2026-07-20",
  busyness: "steady",
  noise: "easy-to-talk",
  seating: "plenty",
  serviceWait: "quick",
  note: "",
  ...over,
});

beforeEach(() => {
  db.rows = [];
  db.schemaMiss = false;
  db.failWrites = false;
  __resetVisitReports();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("memoryVisitReportStore", () => {
  it("creates a report and reads it back for the venue", async () => {
    const dto = await memoryVisitReportStore.create(fields());
    expect(dto.handle).toBe("sam");
    const read = await memoryVisitReportStore.readForVenue("venue-1");
    expect(read.status).toBe("ready");
    expect(read.reports).toHaveLength(1);
    expect(read.reports[0].busyness).toBe("steady");
  });

  it("is idempotent: one report per handle per venue per night (upsert in place)", async () => {
    const first = await memoryVisitReportStore.create(fields({ busyness: "quiet" }));
    const second = await memoryVisitReportStore.create(fields({ busyness: "rammed" }));
    // Same night → same row id, updated fields, not a second row.
    expect(second.id).toBe(first.id);
    const read = await memoryVisitReportStore.readForVenue("venue-1");
    expect(read.reports).toHaveLength(1);
    expect(read.reports[0].busyness).toBe("rammed");
  });

  it("a different night is a distinct report", async () => {
    await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-20" }));
    await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-21" }));
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(2);
  });

  it("orders a venue read by the night, not by when it was submitted", async () => {
    // The two keys DISAGREE: the older night is written up last. A row prints
    // its visit date and nothing else, so submission order would read as broken.
    await memoryVisitReportStore.create(
      fields({ handle: "later-night", visitedAt: "2026-07-21" }),
      1_000,
    );
    await memoryVisitReportStore.create(
      fields({ handle: "older-night", visitedAt: "2026-07-19" }),
      2_000,
    );
    const read = await memoryVisitReportStore.readForVenue("venue-1");
    expect(read.reports.map((r) => r.visitedAt)).toEqual(["2026-07-21", "2026-07-19"]);
  });

  it("breaks a same-night tie on the newest submission", async () => {
    await memoryVisitReportStore.create(
      fields({ handle: "first", visitedAt: "2026-07-20" }),
      1_000,
    );
    await memoryVisitReportStore.create(
      fields({ handle: "second", visitedAt: "2026-07-20" }),
      2_000,
    );
    const read = await memoryVisitReportStore.readForVenue("venue-1");
    expect(read.reports.map((r) => r.handle)).toEqual(["second", "first"]);
  });

  it("queues flags without letting readers erase a report", async () => {
    const dto = await memoryVisitReportStore.create(fields());
    expect(await memoryVisitReportStore.report(dto.id, "spam", "actor-a")).toBe(true);
    expect(await memoryVisitReportStore.report(dto.id, "spam", "actor-a")).toBe(true);
    expect(await memoryVisitReportStore.report(dto.id, "spam", "actor-b")).toBe(true);
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
    const queue = await memoryVisitReportStore.listForReview();
    expect(queue.map((r) => r.id)).toContain(dto.id);
    expect(queue[0].reportCount).toBe(2);
  });

  it("report on an unknown id is false", async () => {
    expect(await memoryVisitReportStore.report("nope", undefined, "actor-a")).toBe(false);
  });

  it("only moderator action changes visibility and clears the queue", async () => {
    const dto = await memoryVisitReportStore.create(fields());
    await memoryVisitReportStore.report(dto.id, undefined, "a");
    expect(await memoryVisitReportStore.moderate(dto.id, "hidden", "abuse")).toBe(true);
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(0);
    expect(await memoryVisitReportStore.listForReview()).toHaveLength(0);
  });

  it("keeps a hidden report listed so a moderator can restore it", async () => {
    const dto = await memoryVisitReportStore.create(fields());
    await memoryVisitReportStore.moderate(dto.id, "hidden", "abuse");

    // A hide leaves the review queue but never disappears: the hidden lane
    // carries the identity (and the decision) needed to put it back.
    const hidden = await memoryVisitReportStore.listHidden();
    expect(hidden.map((r) => r.id)).toEqual([dto.id]);
    expect(hidden[0]).toMatchObject({ handle: "sam", visitedAt: "2026-07-20", moderatorNote: "abuse" });

    expect(await memoryVisitReportStore.moderate(dto.id, "visible")).toBe(true);
    expect(await memoryVisitReportStore.listHidden()).toHaveLength(0);
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
  });

  it("re-queues a kept report when a new reader flags it after the decision", async () => {
    const dto = await memoryVisitReportStore.create(fields());
    await memoryVisitReportStore.report(dto.id, undefined, "a");
    await memoryVisitReportStore.moderate(dto.id, "visible", "kept");
    expect(await memoryVisitReportStore.listForReview()).toHaveLength(0);

    // The same actor flagging again is still a no-op, so the queue stays clear.
    await memoryVisitReportStore.report(dto.id, undefined, "a");
    expect(await memoryVisitReportStore.listForReview()).toHaveLength(0);

    await memoryVisitReportStore.report(dto.id, "still wrong", "b");
    const queue = await memoryVisitReportStore.listForReview();
    expect(queue.map((r) => r.id)).toEqual([dto.id]);
    expect(queue[0].moderatorNote).toBe("kept");
  });

  it("leaves a hidden report decided however many times it is flagged", async () => {
    const dto = await memoryVisitReportStore.create(fields());
    await memoryVisitReportStore.report(dto.id, undefined, "a");
    await memoryVisitReportStore.moderate(dto.id, "hidden", "abuse");
    await memoryVisitReportStore.report(dto.id, undefined, "b");
    expect(await memoryVisitReportStore.listForReview()).toHaveLength(0);
  });

  it("counts only visible reports for one normalized contributor", async () => {
    await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-19" }));
    const hidden = await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-20" }));
    await memoryVisitReportStore.create(
      fields({ handle: "other", visitedAt: "2026-07-21" }),
    );
    await memoryVisitReportStore.moderate(hidden.id, "hidden", "abuse");

    expect(await memoryVisitReportStore.countForContributor("  SAM ")).toEqual({
      status: "ready",
      count: 1,
    });
  });
});

describe("supabaseVisitReportStore", () => {
  it("inserts, upserts per night, and reads back", async () => {
    const first = await supabaseVisitReportStore.create(fields({ busyness: "quiet" }));
    expect(db.rows).toHaveLength(1);
    // Same night again → update in place (no second row), same id.
    const second = await supabaseVisitReportStore.create(fields({ busyness: "rammed" }));
    expect(db.rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    const read = await supabaseVisitReportStore.readForVenue("venue-1");
    expect(read.reports).toHaveLength(1);
    expect(read.reports[0].busyness).toBe("rammed");
  });

  it("report dedupes per actor and waits for a moderator decision", async () => {
    const dto = await supabaseVisitReportStore.create(fields());
    await supabaseVisitReportStore.report(dto.id, "spam", "a");
    await supabaseVisitReportStore.report(dto.id, "spam", "a"); // dup — no-op
    expect((db.rows[0].report_count as number)).toBe(1);
    expect(db.rows[0].status).toBe("visible");
    await supabaseVisitReportStore.report(dto.id, "spam", "b");
    expect((db.rows[0].report_count as number)).toBe(2);
    expect(db.rows[0].status).toBe("visible");
    expect((await supabaseVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
    expect(await supabaseVisitReportStore.listForReview()).toHaveLength(1);
  });

  it("re-queues a kept report on a new flag and leaves a hidden one decided", async () => {
    const kept = await supabaseVisitReportStore.create(fields());
    await supabaseVisitReportStore.report(kept.id, undefined, "a");
    await supabaseVisitReportStore.moderate(kept.id, "visible", "kept");
    expect(await supabaseVisitReportStore.listForReview()).toHaveLength(0);
    await supabaseVisitReportStore.report(kept.id, undefined, "b");
    expect(await supabaseVisitReportStore.listForReview()).toHaveLength(1);

    await supabaseVisitReportStore.moderate(kept.id, "hidden", "abuse");
    await supabaseVisitReportStore.report(kept.id, undefined, "c");
    expect(await supabaseVisitReportStore.listForReview()).toHaveLength(0);
  });

  it("reads a venue by the night, with the submission time only as a tie-break", async () => {
    // Disagreeing keys again, this time through the durable read's ORDER BY.
    await supabaseVisitReportStore.create(
      fields({ handle: "later-night", visitedAt: "2026-07-21" }),
      1_000,
    );
    await supabaseVisitReportStore.create(
      fields({ handle: "older-night", visitedAt: "2026-07-19" }),
      2_000,
    );
    await supabaseVisitReportStore.create(
      fields({ handle: "same-night-newer", visitedAt: "2026-07-21" }),
      3_000,
    );
    const read = await supabaseVisitReportStore.readForVenue("venue-1");
    expect(read.reports.map((r) => r.handle)).toEqual([
      "same-night-newer",
      "later-night",
      "older-night",
    ]);
  });

  it("lists hidden rows so a moderator can restore one", async () => {
    const dto = await supabaseVisitReportStore.create(fields());
    await supabaseVisitReportStore.moderate(dto.id, "hidden", "abuse");
    const hidden = await supabaseVisitReportStore.listHidden();
    expect(hidden.map((r) => r.id)).toEqual([dto.id]);
    expect(hidden[0].moderatorNote).toBe("abuse");

    await supabaseVisitReportStore.moderate(dto.id, "visible");
    expect(await supabaseVisitReportStore.listHidden()).toHaveLength(0);
    expect((await supabaseVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
  });

  it("counts visible rows for a contributor", async () => {
    await supabaseVisitReportStore.create(fields({ visitedAt: "2026-07-19" }));
    const hidden = await supabaseVisitReportStore.create(fields({ visitedAt: "2026-07-20" }));
    await supabaseVisitReportStore.moderate(hidden.id, "hidden");
    expect(await supabaseVisitReportStore.countForContributor("SAM")).toEqual({
      status: "ready",
      count: 1,
    });
  });

  it("throws on a hard write failure (route maps that to 503)", async () => {
    db.failWrites = true;
    await expect(supabaseVisitReportStore.create(fields())).rejects.toThrow();
  });

  it("fails soft to memory on a schema miss (table not yet applied)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    db.schemaMiss = true;
    const dto = await supabaseVisitReportStore.create(fields());
    expect(dto.handle).toBe("sam");
    // The memory fallback holds the row.
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
    // A read also fails soft to memory.
    expect(await supabaseVisitReportStore.readForVenue("venue-1")).toMatchObject({
      status: "degraded",
      reports: [{ handle: "sam" }],
    });
  });

  it("refuses all schema-miss write fallbacks in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    db.schemaMiss = true;

    await expect(supabaseVisitReportStore.create(fields())).rejects.toThrow(
      /refusing process-memory write fallback.*0046/,
    );
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(0);

    const seeded = await memoryVisitReportStore.create(fields());
    await expect(supabaseVisitReportStore.report(seeded.id, "spam", "actor-a")).rejects.toThrow(
      /refusing process-memory write fallback.*0046/,
    );
    await expect(supabaseVisitReportStore.moderate(seeded.id, "hidden")).rejects.toThrow(
      /refusing process-memory write fallback.*0046/,
    );
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
    expect(await memoryVisitReportStore.listForReview()).toHaveLength(0);
  });

  it("keeps schema-miss reads fail-soft in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await memoryVisitReportStore.create(fields());
    db.schemaMiss = true;

    expect(await supabaseVisitReportStore.readForVenue("venue-1")).toMatchObject({
      status: "degraded",
      reports: [{ handle: "sam" }],
    });
  });
});
