import "server-only";

// Durable-or-memory "when was this feed last revalidated" stamp. The cron plane
// writes a stamp here for feeds it refreshes but CANNOT re-persist to a committed
// file on Vercel's read-only serverless filesystem. What's-On events persist to
// whats_on_listings, but the combined What's-On feed does not use this overlay.
//
// The /api/freshness spine (and the freshness-audit cron) overlay this stamp so
// the store-backed feed reports an HONEST observedAt instead of the frozen
// generatedAt of the committed baseline file. Same dual-backend seam as the
// other stores: Supabase when configured, process-memory otherwise.
//
// A stamp is metadata only (feed id + when it was revalidated + how many rows
// were servable + an optional note). No user data, no PII.

import {
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type FeedFreshnessStamp = {
  feed: string;
  observedAt: string;
  rowsServed: number | null;
  note: string | null;
};

export type StampFeedInput = {
  feed: string;
  observedAt: string;
  rowsServed?: number | null;
  note?: string | null;
};

export type StampOutcome = { status: "stamped"; failed?: true };

export type FeedFreshnessStore = {
  /** Record/replace the freshness stamp for a feed. NEVER throws. */
  stamp(input: StampFeedInput): Promise<StampOutcome>;
  /** Read one feed's stamp, or null. NEVER throws. */
  read(feed: string): Promise<FeedFreshnessStamp | null>;
};

// ── In-memory implementation ─────────────────────────────────────────────────
const memoryStamps = new Map<string, FeedFreshnessStamp>();

export const memoryFeedFreshnessStore: FeedFreshnessStore = {
  async stamp(input) {
    memoryStamps.set(input.feed, {
      feed: input.feed,
      observedAt: input.observedAt,
      rowsServed: input.rowsServed ?? null,
      note: input.note ?? null,
    });
    return { status: "stamped" };
  },
  async read(feed) {
    return memoryStamps.get(feed) ?? null;
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "feed-freshness",
  tables: "feed_freshness",
  migrationHint: "apply migration 0047",
});

type FeedRow = {
  feed: string;
  observed_at: string;
  rows_served: number | null;
  note: string | null;
};

export const supabaseFeedFreshnessStore: FeedFreshnessStore = {
  async stamp(input) {
    return guard<StampOutcome>({
      context: "stamp",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "feed-freshness",
          migrationHint: "apply migration 0047",
          fallback: () => memoryFeedFreshnessStore.stamp(input),
          onProduction: async (error) => {
            console.error(error.message);
            return { status: "stamped", failed: true };
          },
        }),
      message: "stamp failed — flagging degraded write",
      onError: () => ({ status: "stamped", failed: true }),
      run: async () => {
        const { error } = await requireSupabaseAdmin()
          .from("feed_freshness")
          .upsert(
            {
              feed: input.feed,
              observed_at: input.observedAt,
              rows_served: input.rowsServed ?? null,
              note: input.note ?? null,
            },
            { onConflict: "feed" },
          );
        if (error) throw new Error(error.message);
        return { status: "stamped" };
      },
    });
  },
  async read(feed) {
    return guard<FeedFreshnessStamp | null>({
      context: "read",
      onSchemaMiss: () => memoryFeedFreshnessStore.read(feed),
      message: "read failed — returning null",
      onError: () => null,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("feed_freshness")
          .select("*")
          .eq("feed", feed)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const row = data as FeedRow;
        return {
          feed: row.feed,
          observedAt: row.observed_at,
          rowsServed: row.rows_served,
          note: row.note,
        };
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export const feedFreshnessStore = createDualBackendStore(
  memoryFeedFreshnessStore,
  supabaseFeedFreshnessStore,
);

/** Test-only: clear the in-memory stamps and warn dedupe. */
export function __resetFeedFreshnessStore(): void {
  memoryStamps.clear();
  resetSchemaMissWarnings();
}
