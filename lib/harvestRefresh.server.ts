import "server-only";

// The bounded harvest batch a scheduled run performs, shared with the CLI.
//
// WHAT A CRON CAN HONESTLY DO HERE. A Vercel function has a read-only file
// system, so it cannot write the committed What's-On files the way
// `npm run harvest:run` does. It runs the SAME fetchers and the SAME parsers
// over the same sources and reports what they yielded, exactly as
// /api/cron/enrich-city-pubs does for city enrichment: the durable, reviewable
// output stays with the local CLI, and the scheduled run is the thing that
// notices a chain changed its offers page before a human does.
//
// It reads NO data file on purpose. Every URL it touches comes from the source
// table, which is source code, so this module never hands `fs` an assembled path
// and the route stays outside the runtime-data tracing registry.
//
// EVERY ALLOWED SOURCE, EVERY RUN. There are few enough first-party chain pages
// that a rotation would only delay noticing a change; the request budget, not a
// rotation, is what bounds the run.

import {
  createFirecrawlClient,
  createHarvestBudget,
  HARVEST_CRON_REQUEST_BUDGET,
  type FirecrawlClient,
} from "@/lib/harvest/firecrawl";
import { parseChainDealDays } from "@/lib/harvest/chainDeals";
import {
  createHarvestReporter,
  countDrops,
  type HarvestRunReport,
  type HarvestSourceOutcome,
} from "@/lib/harvest/runReport";
import { HARVEST_SOURCES, harvestSourcesOfKind, type HarvestSource } from "@/lib/harvest/sourcePolicy";

/** A refused source contributes its recorded decision, never a silent absence. */
function skippedOutcome(source: HarvestSource): HarvestSourceOutcome {
  const access = source.access;
  return {
    sourceId: source.id,
    label: source.label,
    url: source.url,
    kind: source.kind,
    firstParty: source.firstParty,
    status: "skipped",
    statedItems: 0,
    rowsEmitted: 0,
    drops: [],
    skipReason: access.allowed ? "not-scheduled-this-run" : access.reason,
    evidence: access.evidence,
  };
}

function keylessOutcome(source: HarvestSource): HarvestSourceOutcome {
  return {
    sourceId: source.id,
    label: source.label,
    url: source.url,
    kind: source.kind,
    firstParty: source.firstParty,
    status: "skipped",
    statedItems: 0,
    rowsEmitted: 0,
    drops: [],
    skipReason: "no-firecrawl-key",
    evidence: "FIRECRAWL_API_KEY is not configured, so nothing was fetched.",
  };
}

export type ChainDealHarvest = {
  sourceId: string;
  label: string;
  url: string;
  deals: ReturnType<typeof parseChainDealDays>["deals"];
};

export type HarvestBatchResult = {
  report: HarvestRunReport;
  /** Deal days per source, for a caller that can cross them against venues. */
  chainDeals: ChainDealHarvest[];
};

export type RunHarvestBatchOptions = {
  client?: FirecrawlClient | null;
  /** Omit to build a client from FIRECRAWL_API_KEY with the cron budget. */
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  budgetLimit?: number;
  now?: number;
  mode?: "cron" | "cli";
  /** Force a live read rather than reusing a recent Firecrawl index copy. */
  maxAgeMs?: number;
};

/**
 * Fetch and parse every first-party chain offers page the source policy allows,
 * and report every one it does not. Never throws: a source that fails is a
 * recorded failure so the rest of the run still happens.
 */
export async function runHarvestBatch(
  options: RunHarvestBatchOptions = {},
): Promise<HarvestBatchResult> {
  const now = options.now ?? Date.now();
  const mode = options.mode ?? "cron";
  const startedAt = new Date(now).toISOString();
  const reporter = createHarvestReporter({ mode, startedAt });

  const ownBudget = createHarvestBudget(options.budgetLimit ?? HARVEST_CRON_REQUEST_BUDGET);
  const client =
    options.client !== undefined
      ? options.client
      : createFirecrawlClient({
          env: options.env,
          fetchImpl: options.fetchImpl,
          sleepImpl: options.sleepImpl,
          budget: ownBudget,
        });
  // A supplied client brought its own ceiling; report the one that actually
  // governed the run rather than an unused local copy.
  const budget = client?.budget ?? ownBudget;

  const chainSources = harvestSourcesOfKind("chain-deals");
  const chainDeals: ChainDealHarvest[] = [];

  for (const source of chainSources) {
    if (!source.access.allowed) {
      reporter.record(skippedOutcome(source));
      continue;
    }
    if (!client) {
      reporter.record(keylessOutcome(source));
      continue;
    }

    const outcome = await client.scrape(source.url, { maxAgeMs: options.maxAgeMs });
    if (!outcome.ok) {
      const { failure } = outcome;
      // Running out of budget is a bounded run doing its job, not a breakage.
      reporter.record({
        sourceId: source.id,
        label: source.label,
        url: source.url,
        kind: source.kind,
        firstParty: source.firstParty,
        status: failure.reason === "budget-exhausted" ? "skipped" : "failed",
        statedItems: 0,
        rowsEmitted: 0,
        drops: [],
        ...(failure.reason === "budget-exhausted"
          ? { skipReason: "budget-exhausted" as const, evidence: failure.detail }
          : { failure: { reason: failure.reason, detail: failure.detail, ...(failure.status !== undefined ? { status: failure.status } : {}) } }),
      });
      continue;
    }

    const parsed = parseChainDealDays(outcome.page.markdown);
    if (parsed.deals.length > 0) {
      chainDeals.push({
        sourceId: source.id,
        label: source.label,
        url: source.url,
        deals: parsed.deals,
      });
    }
    reporter.record({
      sourceId: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      firstParty: source.firstParty,
      status: parsed.deals.length > 0 ? "harvested" : "empty",
      // A deal day is not yet a row: the CLI multiplies it by that chain's
      // London venues. A scheduled run states what it read and writes nothing.
      statedItems: parsed.deals.length,
      rowsEmitted: 0,
      drops: countDrops(parsed.drops.map((drop) => drop.reason)),
      ...(parsed.deals.length === 0
        ? { evidence: "Page was read and stated no deal day with both a weekday and a window." }
        : {}),
    });
  }

  // Everything the policy refuses outright still belongs in the report, so a
  // reader sees the whole map rather than only the part that was walked.
  for (const source of HARVEST_SOURCES) {
    if (source.kind === "chain-deals") continue;
    if (source.access.allowed) continue;
    reporter.record(skippedOutcome(source));
  }

  const report = reporter.finish({
    finishedAt: new Date(Math.max(now, Date.now())).toISOString(),
    budget: { limit: budget.limit, spent: budget.spent(), remaining: budget.remaining() },
  });

  return { report, chainDeals };
}
