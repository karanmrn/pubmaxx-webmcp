import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetWhatsOnListingStore,
  memoryWhatsOnListingStore,
  supabaseWhatsOnListingStore,
} from "@/lib/whatsOnListingStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

type Row = Record<string, unknown> & { id: string; kind: string };

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  generations: [] as Array<{ kind: string; generated_at: string }>,
  failWrite: false,
  schemaMiss: false,
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({
    rpc(_name: string, args: { p_kind: string; p_rows: Row[]; p_generated_at: string }) {
      if (db.schemaMiss) {
        return Promise.resolve({
          data: null,
          error: { message: "Could not find the table 'public.whats_on_listings'" },
        });
      }
      if (db.failWrite) return Promise.resolve({ data: null, error: { message: "write boom" } });
      db.rows = db.rows.filter((row) => row.kind !== args.p_kind);
      db.rows.push(...args.p_rows);
      db.generations = db.generations.filter((row) => row.kind !== args.p_kind);
      db.generations.push({ kind: args.p_kind, generated_at: args.p_generated_at });
      return Promise.resolve({ data: args.p_rows.length, error: null });
    },
    from: (table: string) => ({
      select() {
        if (table === "whats_on_listings") {
          return {
            eq(field: string, value: string) {
              if (db.schemaMiss) {
                return Promise.resolve({
                  data: null,
                  error: { message: "Could not find the table 'public.whats_on_listings'" },
                });
              }
              return Promise.resolve({
                data: db.rows.filter((row) => row[field] === value),
                error: null,
              });
            },
          };
        }
        if (db.schemaMiss) {
          return Promise.resolve({
            data: null,
            error: { message: "Could not find the table 'public.whats_on_listings'" },
          });
        }
        return Promise.resolve({ data: db.generations, error: null });
      },
    }),
  }),
}));

const GENERATED = "2026-08-24T05:30:00.000Z";

function eventRow(id: string, over: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id,
    placeName: "Jazz Cafe",
    kind: "event",
    startsAt: "2026-08-24T19:00:00.000Z",
    endsAt: "2026-08-24T22:00:00.000Z",
    title: "Live jazz",
    source: { label: "Ticketmaster", url: `https://www.ticketmaster.co.uk/event/${id}` },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
    sourceId: id,
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  db.generations = [];
  db.failWrite = false;
  db.schemaMiss = false;
  __resetWhatsOnListingStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("memoryWhatsOnListingStore", () => {
  it("replaces one kind and leaves the others", async () => {
    await memoryWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz-1", { kind: "quiz", id: "quiz-1", sourceId: "quiz-1" })],
      GENERATED,
    );
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("tm-2")], GENERATED);
    const snap = await memoryWhatsOnListingStore.readAll();
    expect(snap.rows.map((row) => row.id).sort()).toEqual(["quiz-1", "tm-2"]);
    expect(snap.generatedAt).toBe(GENERATED);
  });

  it("reads empty when nothing has been written", async () => {
    expect(await memoryWhatsOnListingStore.readAll()).toEqual({ rows: [], generatedAt: null });
  });

  it("keeps the durable generation stamp when a successful refresh wrote zero rows", async () => {
    db.generations = [{ kind: "event", generated_at: GENERATED }];
    expect(await supabaseWhatsOnListingStore.readAll()).toEqual({
      rows: [],
      generatedAt: GENERATED,
    });
  });

  it("rejects a stale replacement", async () => {
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("new")], "2026-08-24T06:00:00.000Z");
    const outcome = await memoryWhatsOnListingStore.replaceKind(
      "event",
      [eventRow("old")],
      "2026-08-24T05:00:00.000Z",
    );
    expect(outcome).toEqual({ written: 0, failed: true });
    expect((await memoryWhatsOnListingStore.readAll()).rows.map((row) => row.id)).toEqual(["new"]);
  });

  it("uses the oldest kind generation for the combined freshness stamp", async () => {
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("event")], "2026-08-24T05:00:00.000Z");
    await memoryWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz", { kind: "quiz", sourceId: "quiz" })],
      "2026-08-24T06:00:00.000Z",
    );
    expect((await memoryWhatsOnListingStore.readAll()).generatedAt).toBe("2026-08-24T05:00:00.000Z");
  });
});

describe("supabaseWhatsOnListingStore", () => {
  it("writes and reads against the durable backend", async () => {
    const outcome = await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    expect(outcome).toEqual({ written: 1 });
    const snap = await supabaseWhatsOnListingStore.readAll();
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].id).toBe("tm-1");
  });

  it("uses the oldest durable kind generation for combined freshness", async () => {
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("event")], "2026-08-24T05:00:00.000Z");
    await supabaseWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz", { kind: "quiz", sourceId: "quiz" })],
      "2026-08-24T06:00:00.000Z",
    );
    expect((await supabaseWhatsOnListingStore.readAll()).generatedAt).toBe("2026-08-24T05:00:00.000Z");
  });

  it("reads only London rows from the durable table", async () => {
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("london")], GENERATED);
    db.rows.push({
      id: "manchester",
      kind: "event",
      city: "manchester",
      payload: eventRow("manchester", { placeName: "Manchester Arena" }),
      observed_at: "2026-08-24T10:00:00.000Z",
      generated_at: GENERATED,
    });

    expect((await supabaseWhatsOnListingStore.readAll()).rows.map((row) => row.id)).toEqual([
      "london",
    ]);
  });

  it("flags a hard write failure", async () => {
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("kept")], GENERATED);
    db.failWrite = true;
    const outcome = await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    expect(outcome.failed).toBe(true);
    expect(outcome.written).toBe(0);
    expect((await supabaseWhatsOnListingStore.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("refuses a schema-miss memory write in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    db.schemaMiss = true;
    const outcome = await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("lost")], GENERATED);
    expect(outcome).toEqual({ written: 0, failed: true });
    expect(await memoryWhatsOnListingStore.readAll()).toEqual({ rows: [], generatedAt: null });
  });

  it("marks a schema-miss read as failed while retaining memory fallback rows", async () => {
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("memory")], GENERATED);
    db.schemaMiss = true;
    await expect(supabaseWhatsOnListingStore.readAll()).resolves.toEqual({
      rows: [eventRow("memory")],
      generatedAt: GENERATED,
      failed: true,
      failure: "durable table missing (apply migration 0119)",
    });
  });
});
