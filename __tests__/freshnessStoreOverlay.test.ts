// lib/freshnessStoreOverlay.ts's resolveDurableFeedStoreReads is the resolver
// that answers /api/freshness and the freshness-audit cron with the REAL
// four-way outcome (unconfigured / unreachable / empty / ok) of reading
// night_signal_candidates from the durable
// feed_freshness table (migration 0047). It must never collapse "the store
// could not be reached" into "empty" or "fresh" — those are three separate
// findings and resolveStoreStamp downstream depends on telling them apart.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  configured: true,
  row: null as { observed_at: string } | null,
  // Real @supabase/postgrest-js PostgrestError extends Error (message is
  // readable via `instanceof Error`, same as lib/storeBackend.ts errorMessage
  // expects) — mock it as a real Error, not a plain object, to match reality.
  error: null as Error | null,
  throws: null as Error | null,
}));

const feedReads = vi.hoisted(() => ({ keys: [] as string[] }));
const whatsOnReads = vi.hoisted(() => ({
  generatedAt: null as string | null,
  failed: false,
  failure: undefined as string | undefined,
}));

vi.mock("@/lib/feedFreshnessStore", () => ({
  feedFreshnessStore: () => ({
    read: async (feed: string) => {
      feedReads.keys.push(feed);
      return { observedAt: "2026-07-16T00:00:00Z" };
    },
  }),
}));

vi.mock("@/lib/weatherSnapshotStore", () => ({
  weatherSnapshotStore: () => ({
    readSnapshot: async () => ({ generatedAt: "2026-07-15T00:00:00Z" }),
  }),
}));

vi.mock("@/lib/whatsOnListingStore", () => ({
  whatsOnListingStore: () => ({
    readAll: async () => ({
      rows: [],
      generatedAt: whatsOnReads.generatedAt,
      ...(whatsOnReads.failed ? { failed: true as const, failure: whatsOnReads.failure } : {}),
    }),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => db.configured,
  requireSupabaseAdmin: () => ({
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (db.throws) throw db.throws;
          return { data: db.row, error: db.error };
        },
      };
    },
  }),
}));

import {
  NIGHT_SIGNAL_CANDIDATES_DATASET_ID,
  WHATS_ON_FEED_KEY,
  resolveDurableFeedStoreReads,
  resolveStoreObservedAt,
} from "@/lib/freshnessStoreOverlay";

beforeEach(() => {
  db.configured = true;
  db.row = null;
  db.error = null;
  db.throws = null;
  feedReads.keys = [];
  whatsOnReads.generatedAt = null;
  whatsOnReads.failed = false;
  whatsOnReads.failure = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveDurableFeedStoreReads — the real four-way read, never guessed", () => {
  it("reports unconfigured when Supabase env vars are absent, without attempting a query", async () => {
    db.configured = false;
    const reads = await resolveDurableFeedStoreReads();
    expect(reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID]).toEqual({ kind: "unconfigured" });
  });

  it("reports ok with the real observedAt when the store answers", async () => {
    db.row = { observed_at: "2026-07-16T00:00:00Z" };
    const reads = await resolveDurableFeedStoreReads();
    expect(reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID]).toEqual({
      kind: "ok",
      observedAt: "2026-07-16T00:00:00Z",
    });
  });

  it("reports empty (not unreachable) when the query succeeds but no row exists yet", async () => {
    db.row = null;
    db.error = null;
    const reads = await resolveDurableFeedStoreReads();
    expect(reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID]).toEqual({ kind: "empty" });
  });

  it("the unreachable case: a query error is unreachable, distinct from empty or unconfigured", async () => {
    db.error = new Error("connection reset");
    const reads = await resolveDurableFeedStoreReads();
    const read = reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID];
    expect(read.kind).toBe("unreachable");
    expect(read.kind === "unreachable" && read.error).toContain("connection reset");
  });

  it("the unreachable case: a schema-miss error names the migration, still unreachable not empty", async () => {
    db.error = new Error("Could not find the table 'public.feed_freshness' in the schema cache");
    const reads = await resolveDurableFeedStoreReads();
    const read = reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID];
    expect(read.kind).toBe("unreachable");
    expect(read.kind === "unreachable" && read.error).toContain("migration 0047");
  });

  it("the unreachable case: a thrown exception (network failure) never becomes empty or ok", async () => {
    db.throws = new Error("fetch failed: ENOTFOUND");
    const reads = await resolveDurableFeedStoreReads();
    const read = reads[NIGHT_SIGNAL_CANDIDATES_DATASET_ID];
    expect(read.kind).toBe("unreachable");
    expect(read.kind === "unreachable" && read.error).toContain("ENOTFOUND");
  });

  it("resolves only the candidate-ingestion feed", async () => {
    db.row = { observed_at: "2026-07-16T00:00:00Z" };
    const reads = await resolveDurableFeedStoreReads();
    expect(Object.keys(reads)).toEqual([
      NIGHT_SIGNAL_CANDIDATES_DATASET_ID,
      WHATS_ON_FEED_KEY,
    ]);
  });

  it("reports the durable What's-On generation stamp", async () => {
    whatsOnReads.generatedAt = "2026-08-24T05:30:00Z";
    const reads = await resolveDurableFeedStoreReads();
    expect(reads[WHATS_ON_FEED_KEY]).toEqual({
      kind: "ok",
      observedAt: "2026-08-24T05:30:00Z",
    });
  });

  it("reports ordinary durable read failures without inventing a migration fault", async () => {
    whatsOnReads.failed = true;
    whatsOnReads.failure = "network timeout";

    const reads = await resolveDurableFeedStoreReads();

    expect(reads[WHATS_ON_FEED_KEY]).toEqual({
      kind: "unreachable",
      error: "network timeout",
    });
  });

  it("does not overlay an untrusted failed-store watermark", async () => {
    whatsOnReads.failed = true;
    whatsOnReads.failure = "network timeout";
    whatsOnReads.generatedAt = "2026-08-24T05:30:00Z";

    const overlay = await resolveStoreObservedAt();

    expect(overlay).not.toHaveProperty(WHATS_ON_FEED_KEY);
  });

  it("falls back to disk when durable What's-On store is empty", async () => {
    const overlay = await resolveStoreObservedAt();
    expect(overlay).toEqual({
      weather: "2026-07-15T00:00:00Z",
      night_signal_candidates: "2026-07-16T00:00:00Z",
    });
    expect(feedReads.keys).toEqual(["night_signal_candidates"]);
  });

  it("overlays the durable What's-On stamp when listings store answers", async () => {
    whatsOnReads.generatedAt = "2026-08-24T05:30:00Z";

    const overlay = await resolveStoreObservedAt();

    expect(overlay).toMatchObject({
      weather: "2026-07-15T00:00:00Z",
      night_signal_candidates: "2026-07-16T00:00:00Z",
      whats_on: "2026-08-24T05:30:00Z",
    });
  });
});
