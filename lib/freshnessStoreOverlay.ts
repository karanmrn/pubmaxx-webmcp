import "server-only";

// Store-backed honest-observedAt overlay for the freshness spine.
//
// The freshness registry resolves each dataset's stamp from its committed disk
// artifact. Some feeds are refreshed by the Vercel cron plane into a
// DURABLE store (not a committed file, which is read-only on serverless).
// For those feeds, the disk timestamp can freeze at the last commit. This
// overlay returns store-observed time so /api/freshness and freshness audit
// report the truth. The combined What's-On feed reads its generatedAt from the
// durable listings store when that store answers, with the bundled artifact as
// fallback.
//
// HARD RULE: a dataset id may only appear here when the cron's write IS what
// that dataset serves. An ingestion run that cannot update a committed artifact
// gets its OWN artifact-less registry dataset (night_signal_candidates) so
// "ingestion ran" can never be read as "data
// shipped", and so the served file's real staleness keeps alerting.
//
// Fail-soft and env-gated: when no durable store is configured (local/test) or a
// store read fails, the feed is simply absent from the overlay and the caller
// keeps the disk-derived stamp — behaviour-identical to before this plane.

import { feedFreshnessStore } from "@/lib/feedFreshnessStore";
import type { StoreRead } from "@/lib/freshness";
import { errorMessage, isMissingTableSchema } from "@/lib/storeBackend";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { weatherSnapshotStore } from "@/lib/weatherSnapshotStore";
import { whatsOnListingStore } from "@/lib/whatsOnListingStore";

// Registry dataset id → the store that holds its honest observedAt.
export const WHATS_ON_FEED_KEY = "whats_on";
export const WEATHER_DATASET_ID = "weather";
// Night Signal candidate ingestion (the Vercel-cron EXA sweep). This is the
// PENDING-candidate feed, distinct from the human-reviewed `night_signals`
// snapshot — it reports when ingestion last ran, never that claims were shipped.
export const NIGHT_SIGNAL_CANDIDATES_FEED_KEY = "night_signal_candidates";
export const NIGHT_SIGNAL_CANDIDATES_DATASET_ID = "night_signal_candidates";

/**
 * Resolve store-backed observedAt for the cron-plane feeds. Returns a map of
 * registry dataset id → ISO observedAt for every feed the store can answer for.
 * NEVER throws; a store miss/failure just omits that id.
 */
export async function resolveStoreObservedAt(): Promise<Record<string, string>> {
  const overlay: Record<string, string> = {};

  try {
    const snapshot = await weatherSnapshotStore().readSnapshot();
    if (snapshot?.generatedAt) overlay[WEATHER_DATASET_ID] = snapshot.generatedAt;
  } catch {
    // fail-soft: keep the disk stamp
  }

  try {
    const stamp = await feedFreshnessStore().read(NIGHT_SIGNAL_CANDIDATES_FEED_KEY);
    if (stamp?.observedAt) overlay[NIGHT_SIGNAL_CANDIDATES_DATASET_ID] = stamp.observedAt;
  } catch {
    // fail-soft: keep the disk stamp
  }

  try {
    const snapshot = await whatsOnListingStore().readAll();
    if (!snapshot.failed && snapshot.generatedAt) {
      overlay[WHATS_ON_FEED_KEY] = snapshot.generatedAt;
    }
  } catch {
    // fail-soft: keep the disk stamp
  }

  return overlay;
}

/**
 * Resolve the real four-way outcome (unconfigured / unreachable / empty / ok)
 * of reading night_signal_candidates from the
 * durable feed_freshness table.
 *
 * `feedFreshnessStore().read()` never throws, so it cannot tell "no row yet"
 * apart from "the query failed" — both come back as null. This function
 * queries the table directly (bypassing that fail-soft swallow) so the two
 * store-backed datasets can distinguish an unreachable store from one that is
 * simply not stamped yet, which resolveStoreStamp needs to keep the two
 * findings apart: "unmeasurable" is never "fresh", and never "stale" either.
 */
export async function resolveDurableFeedStoreReads(): Promise<Record<string, StoreRead>> {
  const nightSignalCandidates = await readDurableFeedStamp(NIGHT_SIGNAL_CANDIDATES_FEED_KEY);
  const whatsOn = await readDurableWhatsOnStamp();
  return {
    [NIGHT_SIGNAL_CANDIDATES_DATASET_ID]: nightSignalCandidates,
    [WHATS_ON_FEED_KEY]: whatsOn,
  };
}

async function readDurableWhatsOnStamp(): Promise<StoreRead> {
  if (!isSupabaseConfigured()) return { kind: "unconfigured" };

  try {
    const snapshot = await whatsOnListingStore().readAll();
    if (snapshot.failed) {
      return {
        kind: "unreachable",
        error: snapshot.failure ?? "durable What's-On store could not be read",
      };
    }
    if (!snapshot.generatedAt) return { kind: "empty" };
    return { kind: "ok", observedAt: snapshot.generatedAt };
  } catch (err) {
    return { kind: "unreachable", error: errorMessage(err) };
  }
}

async function readDurableFeedStamp(feedKey: string): Promise<StoreRead> {
  if (!isSupabaseConfigured()) return { kind: "unconfigured" };

  try {
    const { data, error } = await requireSupabaseAdmin()
      .from("feed_freshness")
      .select("observed_at")
      .eq("feed", feedKey)
      .maybeSingle();

    if (error) {
      if (isMissingTableSchema(error, "feed_freshness")) {
        return {
          kind: "unreachable",
          error: `durable table missing (apply migration 0047): ${errorMessage(error)}`,
        };
      }
      return { kind: "unreachable", error: errorMessage(error) };
    }

    if (!data?.observed_at) return { kind: "empty" };
    return { kind: "ok", observedAt: data.observed_at };
  } catch (err) {
    return { kind: "unreachable", error: errorMessage(err) };
  }
}
