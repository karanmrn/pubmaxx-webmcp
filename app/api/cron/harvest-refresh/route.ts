// GET /api/cron/harvest-refresh - scheduled first-party London harvest.
//
// HONEST SCOPE, the same one /api/cron/enrich-city-pubs states: a Vercel
// function's file system is read-only, so the durable output (the What's-On
// files, the pub-facts artifact) belongs to `npm run harvest:run`. What the
// schedule buys is NOTICING: the same fetchers and the same parsers run weekly
// over the same first-party pages, and the run report says what each one stated,
// what it refused and why. A chain that rewrites its offers page shows up here
// before a reader sees a stale club night.
//
// KEYS degrade loud-but-soft: without FIRECRAWL_API_KEY every source is reported
// as skipped for `no-firecrawl-key` and nothing is fetched or invented.
// BUDGET: the run cannot send more than HARVEST_CRON_REQUEST_BUDGET requests,
// retries included, so a schedule cannot burn the account.
// AUTH: CRON_SECRET Bearer (lib/cronAuth).

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { isFirecrawlConfigured, HARVEST_CRON_REQUEST_BUDGET } from "@/lib/harvest/firecrawl";
import { harvestShortfallLines, summariseHarvestRun } from "@/lib/harvest/runReport";
import { runHarvestBatch } from "@/lib/harvestRefresh.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  if (!isFirecrawlConfigured()) {
    console.warn("[cron:harvest-refresh] FIRECRAWL_API_KEY absent - harvest skipped, nothing fetched.");
  }

  const { report } = await runHarvestBatch({ mode: "cron", budgetLimit: HARVEST_CRON_REQUEST_BUDGET });

  console.log(`[cron:harvest-refresh] ${summariseHarvestRun(report)}`);
  for (const line of harvestShortfallLines(report)) {
    console.log(`[cron:harvest-refresh][shortfall] ${line}`);
  }
  // The whole report, so a run is reconstructable from the log alone.
  console.log("[cron:harvest-refresh][report]", JSON.stringify(report));

  return jsonNoStore({
    ok: true,
    mode: report.mode,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    budget: report.budget,
    totals: report.totals,
    sources: report.sources.map((source) => ({
      sourceId: source.sourceId,
      status: source.status,
      statedItems: source.statedItems,
      ...(source.skipReason ? { skipReason: source.skipReason } : {}),
      ...(source.failure ? { failure: source.failure.reason } : {}),
    })),
  });
}
