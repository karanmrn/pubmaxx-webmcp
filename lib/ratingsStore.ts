// Ratings store (PRD E3). ONE store interface, TWO implementations
// (process-memory + Supabase public.drink_ratings / public.venue_ratings) —
// the exact dual-backend seam pattern as notificationsStore: Supabase when env
// keys exist, process-memory otherwise, chosen at the single ratingsStore()
// seam.
//
// Contract:
//   • rate() is an UPSERT on (ref, handle): a handle's latest vote REPLACES
//     its old one (never a second row), and the timestamp refreshes so recency
//     windows see the re-cast. rate() THROWS on storage failure — a vote the
//     user cast must not silently vanish (the route maps that to a 503).
//   • summaryFor() is a fail-soft READ: an outage renders as "no ratings yet",
//     never a 500 on a menu.
//
// Identity is the self-asserted handle (no auth) — the same trust posture as
// reactions/comments/notifications: a star rating is already-public,
// low-sensitivity signal. Noted honestly here, in the route, and in migration
// 0020. When auth ownership merges, gate writes on auth.uid().
//
// All the MATHS (Bayesian prior, vote floor, recency, ranking) lives in the
// pure lib/ratings.ts — this file only moves raw votes in and out of storage.
// The store is the impure seam, so Date.now() is allowed HERE (not in
// lib/ratings.ts).

import {
  aggregateRatings,
  type RatingKind,
  type RatingRecord,
  type RatingSummary,
  type RatingValue,
} from "@/lib/ratings";
import { normalizeHandle } from "@/lib/profiles";
import {
  admin,
  createSchemaMissWarner,
  missingTables,
  selectStore,
} from "@/lib/storeBackend";

export { isRatingKind, type RatingKind } from "@/lib/ratings";

export type RateInput = {
  kind: RatingKind;
  /** The item key: a drink ref, or (kind "venue") the venue id itself. */
  ref: string;
  /** The venue the drink lives at — stored alongside drink votes when known. */
  venueId?: string;
  handle: string;
  rating: RatingValue;
};

export type RatingsStore = {
  /** Upsert one handle's rating of one item; returns the item's fresh
   *  summary. THROWS on storage failure (the route maps it to 503). */
  rate(input: RateInput): Promise<RatingSummary>;
  /** Batch summaries for a list of refs. Fail-soft: an unknown ref maps to
   *  the honest empty summary; a storage error returns all-empty. */
  summaryFor(kind: RatingKind, refs: string[]): Promise<Record<string, RatingSummary>>;
};

const TABLES: Record<RatingKind, { table: string; refColumn: string }> = {
  drink: { table: "drink_ratings", refColumn: "drink_ref" },
  venue: { table: "venue_ratings", refColumn: "venue_id" },
};

const isMissingRatingsSchema = missingTables("drink_ratings", "venue_ratings");
const { warn: warnSchemaMiss } = createSchemaMissWarner(
  "ratings",
  "apply migration 0020",
);

const EMPTY_SUMMARY: RatingSummary = {
  average: null,
  bayesian: null,
  count: 0,
  shown: false,
};

function emptySummaries(refs: string[]): Record<string, RatingSummary> {
  const out: Record<string, RatingSummary> = {};
  for (const ref of refs) out[ref] = { ...EMPTY_SUMMARY };
  return out;
}

// Guard the untyped supabase-js projection (rows come back as unknown for the
// dynamic column select). A malformed row — non-object, missing ref, a
// non-numeric rating, or a non-string timestamp — is SKIPPED rather than
// coerced into a bogus vote; a well-formed row normalises exactly as before.
function normalizeRatingRow(
  r: unknown,
  refColumn: string,
): { ref: string; rating: number; createdAt: string } | null {
  if (typeof r !== "object" || r === null) return null;
  const row = r as Record<string, unknown>;
  const ref = row[refColumn];
  const rating = row.rating;
  const createdAt = row.created_at;
  if (typeof ref !== "string" || ref === "") return null;
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  if (typeof createdAt !== "string" || createdAt === "") return null;
  return { ref, rating, createdAt };
}

function groupRecords(
  rows: Array<{ ref: string; rating: number; createdAt: string }>,
): Map<string, RatingRecord[]> {
  const byRef = new Map<string, RatingRecord[]>();
  for (const row of rows) {
    const list = byRef.get(row.ref) ?? [];
    list.push({ rating: row.rating, createdAt: row.createdAt });
    byRef.set(row.ref, list);
  }
  return byRef;
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseRatingsStore: RatingsStore = {
  async rate(input) {
    const handle = normalizeHandle(input.handle);
    if (!handle) throw new Error("A rating needs a handle.");
    const { table, refColumn } = TABLES[input.kind];
    const row: Record<string, unknown> = {
      [refColumn]: input.ref,
      handle,
      rating: input.rating,
      // Refresh on re-rate so recency windows see the latest cast.
      created_at: new Date().toISOString(),
    };
    if (input.kind === "drink") row.venue_id = input.venueId ?? null;
    try {
      const { error } = await admin()
        .from(table)
        .upsert(row, { onConflict: `${refColumn},handle` });
      if (error) throw new Error(error.message);
    } catch (err) {
      if (isMissingRatingsSchema(err)) {
        warnSchemaMiss("rate", err);
        return memoryRatingsStore.rate(input);
      }
      throw err;
    }
    const summaries = await this.summaryFor(input.kind, [input.ref]);
    return summaries[input.ref] ?? { ...EMPTY_SUMMARY };
  },

  async summaryFor(kind, refs) {
    if (refs.length === 0) return {};
    const { table, refColumn } = TABLES[kind];
    try {
      // Dynamic column → widen to `string` so the supabase-js typed-select
      // parser treats it as a plain projection (rows come back untyped, which
      // is exactly what the Record<string, unknown> mapping below expects).
      const columns: string = `${refColumn}, rating, created_at`;
      const { data, error } = await admin()
        .from(table)
        .select(columns)
        .in(refColumn, refs);
      if (error) throw new Error(error.message);
      const byRef = groupRecords(
        (data ?? [])
          .map((r) => normalizeRatingRow(r, refColumn))
          .filter((row): row is { ref: string; rating: number; createdAt: string } => row !== null),
      );
      const now = Date.now();
      const out: Record<string, RatingSummary> = {};
      for (const ref of refs) {
        out[ref] = aggregateRatings(byRef.get(ref) ?? [], { now });
      }
      return out;
    } catch (err) {
      if (isMissingRatingsSchema(err)) {
        warnSchemaMiss("summaryFor", err);
        return memoryRatingsStore.summaryFor(kind, refs);
      }
      console.error(
        "[ratings] summaryFor failed — returning empty summaries:",
        err instanceof Error ? err.message : err,
      );
      return emptySummaries(refs);
    }
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Map<kind, Map<ref, Map<handle, RatingRecord>>> — the inner map IS the upsert
// semantics (one live vote per handle per item). Resets on restart — right for
// dev/demo/test.
const memoryVotes: Record<RatingKind, Map<string, Map<string, RatingRecord>>> = {
  drink: new Map(),
  venue: new Map(),
};

export const memoryRatingsStore: RatingsStore = {
  async rate(input) {
    const handle = normalizeHandle(input.handle);
    if (!handle) throw new Error("A rating needs a handle.");
    const byRef = memoryVotes[input.kind];
    const votes = byRef.get(input.ref) ?? new Map<string, RatingRecord>();
    votes.set(handle, {
      rating: input.rating,
      createdAt: new Date().toISOString(),
    });
    byRef.set(input.ref, votes);
    const summaries = await this.summaryFor(input.kind, [input.ref]);
    return summaries[input.ref] ?? { ...EMPTY_SUMMARY };
  },

  async summaryFor(kind, refs) {
    const now = Date.now();
    const out: Record<string, RatingSummary> = {};
    for (const ref of refs) {
      const votes = memoryVotes[kind].get(ref);
      out[ref] = aggregateRatings(votes ? Array.from(votes.values()) : [], {
        now,
      });
    }
    return out;
  },
};

/** The single backend selection point (mirrors the other stores). */
export function ratingsStore(): RatingsStore {
  return selectStore(memoryRatingsStore, supabaseRatingsStore);
}

/** Test-only: clear the in-memory vote maps between cases. */
export function __resetMemoryRatings(): void {
  memoryVotes.drink.clear();
  memoryVotes.venue.clear();
}
