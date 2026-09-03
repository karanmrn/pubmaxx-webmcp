// GET /api/freshness
//
// Read-only view of the freshness spine: the machine-readable registry
// (data/freshness_registry.json) resolved against every artifact's real
// observed/generated stamp. This is the one honest, uniform answer to "how live
// is every data class?" — the site can render staleness anywhere from it (the
// lib/dataFreshness idioms already turn observed instants into human labels;
// this feeds them the same way for every dataset at once).
//
// Never 500s: a missing/broken artifact surfaces as that dataset's own
// "unknown" status, not a route failure. Cacheable at the edge — the registry +
// stamps only move when a refresh PR merges.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  evaluateRegistry,
  resolveStoreStamp,
  type FreshnessDataset,
  type FreshnessRegistry,
  type StampResolution,
  type StoreRead,
} from "@/lib/freshness";
import { resolveDatasetStamp } from "@/lib/freshnessArtifact";
import {
  resolveDurableFeedStoreReads,
  resolveStoreObservedAt,
} from "@/lib/freshnessStoreOverlay";
import { countCorroboratedCommunityCategories } from "@/lib/communityPriceStore";

export const runtime = "nodejs";

const CACHE_MAX_AGE_S = 300;
const CACHE_STALE_WHILE_REVALIDATE_S = 1800;

function jsonResponse(body: unknown, opts: { status?: number; cache?: boolean } = {}): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`
        : "no-store",
    },
  });
}

export async function GET(): Promise<Response> {
  const rootDir = process.cwd();
  let registry: FreshnessRegistry;
  try {
    registry = JSON.parse(
      readFileSync(join(rootDir, "data", "freshness_registry.json"), "utf8"),
    ) as FreshnessRegistry;
  } catch (e) {
    return jsonResponse(
      { error: "registry unavailable", detail: (e as Error).message, datasets: [] },
      { status: 200 },
    );
  }

  const now = new Date();
  // Cron-plane feeds report their durable store observedAt (the committed file is
  // read-only on serverless and would report a frozen stamp); every other feed
  // keeps its disk-derived stamp. Fail-soft: no store configured → empty overlay.
  const overlay = await resolveStoreObservedAt();
  // The artifact-less night_signal_candidates cron feed declares a `{kind:"store"}`
  // stamp in the registry: it has no committed file at
  // all, so their stamp resolves ONLY from the durable store's real four-way read
  // (unconfigured/unreachable/empty/ok), never from a disk fallback that does not exist.
  const durableReads = await resolveDurableFeedStoreReads();
  const stampFor = (dataset: FreshnessDataset): StampResolution => {
    if (dataset.stamp?.kind === "store") {
      const read: StoreRead = durableReads[dataset.id] ?? { kind: "unconfigured" };
      return resolveStoreStamp(dataset.stamp, read);
    }
    const stored = overlay[dataset.id];
    if (stored) return { observedAt: stored, reason: null };
    return resolveDatasetStamp(rootDir, dataset);
  };
  const results = evaluateRegistry(registry, stampFor, now).map((result) => ({
    ...result,
    stampSource:
      result.observedAt &&
      (overlay[result.id] ||
        registry.datasets.find((dataset) => dataset.id === result.id)?.stamp?.kind === "store")
        ? "durable-store"
        : result.observedAt
          ? "artifact"
          : "unresolved",
  }));

  // The contribution flywheel's own number, alongside the dataset staleness:
  // how many (venue, drink category) pairs currently carry a community price
  // the map is allowed to paint. Derived on the read path from the same
  // corroboration + age rules the map itself uses (lib/communityPrice.ts), so
  // it can never claim a figure the map would refuse. Read-only and fail-soft:
  // an unavailable store reports `degraded`, never a fabricated 0.
  const community = await countCorroboratedCommunityCategories(now.getTime());

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return jsonResponse(
    {
      version: registry.version,
      generatedAt: now.toISOString(),
      summary,
      communityPrices: {
        corroboratedCategories: community.count,
        truncated: community.truncated,
        degraded: community.degraded,
      },
      datasets: results,
    },
    { cache: true },
  );
}
