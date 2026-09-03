// GET /api/cron/freshness-audit — daily freshness audit ping.
//
// Reads the freshness spine (data/freshness_registry.json resolved against each
// artifact's on-disk stamp, PLUS the store-backed honest observedAt overlay for
// cron-plane feeds), then reports two SEPARATE findings: feeds whose data is
// stale, and feeds whose age it could not determine at all. Console-only alerting
// today via lib/freshnessNotify — a deliberate seam so a later push/alert
// integration (Sol's push lane) hangs off ONE place. This route sends NO pushes.
//
// The artifacts are reached by a path taken from the registry at request time, so
// Next cannot trace them; next.config.mjs declares them for this route (and for
// /api/freshness) under outputFileTracingIncludes. Without that they reached this
// function only by accident of Vercel's lambda grouping, and every field-stamped
// feed reported "unknown" daily.
//
// AUTH: CRON_SECRET Bearer. Never 500s on a bad artifact — a broken file surfaces
// as that dataset's own "unknown" status, exactly like /api/freshness.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import {
  evaluateDataset,
  hasBreach,
  resolveStoreStamp,
  staleFeeds,
  unresolvedFeeds,
  type FreshnessDataset,
  type FreshnessRegistry,
  type FreshnessResult,
  type StoreRead,
} from "@/lib/freshness";
import { resolveDatasetStamp } from "@/lib/freshnessArtifact";
import {
  resolveDurableFeedStoreReads,
  resolveStoreObservedAt,
} from "@/lib/freshnessStoreOverlay";
import { notifyFreshnessFindings } from "@/lib/freshnessNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const rootDir = process.cwd();
  let registry: FreshnessRegistry;
  try {
    registry = JSON.parse(
      readFileSync(join(rootDir, "data", "freshness_registry.json"), "utf8"),
    ) as FreshnessRegistry;
  } catch (err) {
    console.error("[cron:freshness-audit] registry unavailable:", err instanceof Error ? err.message : String(err));
    return jsonNoStore({ ok: false, error: "registry unavailable", stale: [] }, { status: 200 });
  }

  // Store-backed feeds report their durable observedAt; everything else keeps its
  // disk-derived stamp. The two artifact-less cron feeds declare a `{kind:"store"}`
  // stamp and resolve ONLY from the durable store's real four-way read — they have
  // no committed file to fall back to.
  const overlay = await resolveStoreObservedAt();
  const durableReads = await resolveDurableFeedStoreReads();
  const now = new Date();
  const results: FreshnessResult[] = registry.datasets.map((dataset: FreshnessDataset) => {
    if (dataset.stamp?.kind === "store") {
      const read: StoreRead = durableReads[dataset.id] ?? { kind: "unconfigured" };
      const { observedAt, reason } = resolveStoreStamp(dataset.stamp, read);
      return evaluateDataset(dataset, observedAt, now, reason);
    }
    const stored = overlay[dataset.id];
    const { observedAt, reason } = stored
      ? { observedAt: stored, reason: null }
      : resolveDatasetStamp(rootDir, dataset);
    return evaluateDataset(dataset, observedAt, now, reason);
  });

  // Two findings, never merged: stale means the data is old, unresolved means we
  // could not measure it. Only the first one says the data is bad.
  const findings = notifyFreshnessFindings(staleFeeds(results), unresolvedFeeds(results));

  return jsonNoStore({
    ok: true,
    generatedAt: now.toISOString(),
    breach: hasBreach(results),
    counts: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
    stale: findings.stale,
    unresolved: findings.unresolved,
  });
}
