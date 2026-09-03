// The artifact a harvest run leaves behind: what each source gave, what it did
// not, and why.
//
// A RUN REPORT IS THE HONEST HALF OF THE HARVEST. Rows land in the What's-On
// files where a reader sees them; everything the run DID NOT take lands here,
// where nobody sees it unless it is written down. So an empty source and a
// skipped source and a failed source are three different outcomes with three
// different names, never one "0 rows" that reads as a quiet city:
//
//   harvested - the page stated things and rows came out of it.
//   empty     - the page was read and stated nothing this harvest may take.
//               This is a CORRECT outcome, not a fault (Greene King's per-pub
//               deal pages have always been marketing copy with no deal day).
//   skipped   - the source was not read, and `skipReason` says on whose say-so.
//   failed    - the source should have been read and could not be.
//
// The report is pure data with an injected clock, so the CLI can write it to
// disk and the cron can log the same object without either owning the shape.

import type { HarvestSkipReason, HarvestSourceKind } from "@/lib/harvest/sourcePolicy";

export const HARVEST_REPORT_VERSION = 1;

export type HarvestOutcomeStatus = "harvested" | "empty" | "skipped" | "failed";

export type HarvestDropCount = {
  reason: string;
  count: number;
};

export type HarvestSourceOutcome = {
  sourceId: string;
  label: string;
  url: string;
  kind: HarvestSourceKind;
  firstParty: boolean;
  status: HarvestOutcomeStatus;
  /**
   * Things the page STATED that survived parsing - a deal day, an event, a set
   * of stated hours. Kept apart from `rowsEmitted` because a scheduled run
   * writes nothing: it can still report that Wetherspoon publishes five club
   * days, which is the change a human wants to hear about.
   */
  statedItems: number;
  /**
   * Rows this source actually contributed to a committed payload. Always 0 for
   * a scheduled run, whose file system is read-only.
   */
  rowsEmitted: number;
  /** Things the page stated but this harvest refused to turn into a row. */
  drops: HarvestDropCount[];
  /** Present when status is "skipped". */
  skipReason?: HarvestSkipReason;
  /** The rule behind a skip, or the note behind an empty. */
  evidence?: string;
  /** Present when status is "failed". */
  failure?: { reason: string; detail: string; status?: number };
};

export type HarvestRunReport = {
  version: typeof HARVEST_REPORT_VERSION;
  mode: "cron" | "cli";
  startedAt: string;
  finishedAt: string;
  budget: { limit: number; spent: number; remaining: number };
  sources: HarvestSourceOutcome[];
  totals: {
    harvested: number;
    empty: number;
    skipped: number;
    failed: number;
    statedItems: number;
    rowsEmitted: number;
  };
};

export type HarvestReporter = {
  record(outcome: HarvestSourceOutcome): void;
  outcomes(): HarvestSourceOutcome[];
  finish(input: {
    finishedAt: string;
    budget: { limit: number; spent: number; remaining: number };
  }): HarvestRunReport;
};

export function countDrops(reasons: readonly string[]): HarvestDropCount[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function createHarvestReporter(input: {
  mode: "cron" | "cli";
  startedAt: string;
}): HarvestReporter {
  const outcomes: HarvestSourceOutcome[] = [];
  return {
    record(outcome) {
      outcomes.push(outcome);
    },
    outcomes: () => [...outcomes],
    finish({ finishedAt, budget }) {
      const totals = {
        harvested: outcomes.filter((o) => o.status === "harvested").length,
        empty: outcomes.filter((o) => o.status === "empty").length,
        skipped: outcomes.filter((o) => o.status === "skipped").length,
        failed: outcomes.filter((o) => o.status === "failed").length,
        statedItems: outcomes.reduce((sum, o) => sum + o.statedItems, 0),
        rowsEmitted: outcomes.reduce((sum, o) => sum + o.rowsEmitted, 0),
      };
      return {
        version: HARVEST_REPORT_VERSION,
        mode: input.mode,
        startedAt: input.startedAt,
        finishedAt,
        budget,
        sources: outcomes,
        totals,
      };
    },
  };
}

/** One line a human can read in a cron log without opening the JSON. */
export function summariseHarvestRun(report: HarvestRunReport): string {
  const { harvested, empty, skipped, failed, statedItems, rowsEmitted } = report.totals;
  return (
    `${report.mode}: ${harvested} source(s) stated ${statedItems} thing(s), ${rowsEmitted} row(s) written; ` +
    `${empty} stated nothing, ${skipped} skipped, ${failed} failed; ` +
    `${report.budget.spent}/${report.budget.limit} requests spent.`
  );
}

/** The skipped and failed sources, spelled out one per line for a log. */
export function harvestShortfallLines(report: HarvestRunReport): string[] {
  const lines: string[] = [];
  for (const source of report.sources) {
    if (source.status === "skipped") {
      lines.push(`skipped ${source.sourceId} (${source.skipReason}): ${source.evidence ?? "no evidence recorded"}`);
    } else if (source.status === "failed") {
      lines.push(`failed ${source.sourceId} (${source.failure?.reason}): ${source.failure?.detail ?? ""}`.trim());
    } else if (source.status === "empty") {
      lines.push(`empty ${source.sourceId}: ${source.evidence ?? "page stated nothing this harvest may take"}`);
    }
  }
  return lines;
}
