// The site's performance budgets: what each measured route is allowed to cost,
// and how an over-budget run is reported.
//
// Speed is the product's claim, so it is held by a number rather than by
// somebody's feel for it. perf/route-budgets.json is the tracked ceiling table;
// this module parses it, decides pass or fail against a measured run, and
// formats the table a failing CI job prints. It is pure and data-only on
// purpose: the measuring lives in e2e/performance-budget.spec.ts, so the rules
// can be unit-tested without a browser.
//
// docs/PERFORMANCE_BUDGETS.md owns what each metric means and the rule for
// changing a number.

import budgetsJson from "@/perf/route-budgets.json";

/**
 * The four things a route is budgeted on.
 *
 * `lcpMs` is the one a drinker actually feels: the other three are the levers
 * that move it, and a route can hold all three and still paint late. It is
 * measured by the same run, under the same method block, so the four figures
 * in a sweep describe one load rather than four.
 */
export const BUDGET_METRICS = [
  "serverRenderMs",
  "jsDecodedKB",
  "requests",
  "lcpMs",
] as const;

export type BudgetMetric = (typeof BUDGET_METRICS)[number];

/** How a metric reads in the failure table. */
export const BUDGET_METRIC_LABELS: Record<BudgetMetric, string> = {
  serverRenderMs: "server render (ms)",
  jsDecodedKB: "JS decoded (KB)",
  requests: "requests",
  lcpMs: "LCP (ms)",
};

export type RouteBudget = {
  /** The path measured, exactly as a browser would open it. */
  path: string;
  /** Rendered proof the route arrived; measurement waits for it. */
  readySelector: string;
  /** Optional loading affordance that must be gone before measuring. */
  settledSelectorHidden?: string;
  /** Why this route is on the list, in one sentence. */
  why: string;
} & Record<BudgetMetric, number>;

export type BudgetMethod = {
  browser: string;
  deviceScaleFactor: number;
  /** Unmeasured runs first, so a cold module load is not charged to the route. */
  warmupRuns: number;
  /** Measured runs per route. */
  measuredRuns: number;
  aggregate: "median";
  /** CDP CPU throttle applied to every measured run. */
  cpuThrottleRate: number;
  viewport: { width: number; height: number };
  /** Cross-origin requests are refused, so a run measures only what we ship. */
  thirdPartyBlocked: boolean;
  futureDeviceMigration: string;
  /**
   * Where the byte and request counts are cut, in words. Deliberately part of
   * the tracked config: two runs are only comparable if they stopped counting
   * at the same moment, and a time-based settle does not.
   */
  countedUpTo: string;
};

export type PerformanceBudgets = {
  note: string;
  method: BudgetMethod;
  routes: RouteBudget[];
};

export const PERFORMANCE_BUDGETS = budgetsJson as PerformanceBudgets;

/** One route's measured figures, in the same units as its budget. */
export type RouteMeasurement = Record<BudgetMetric, number>;

export type BudgetBreach = {
  path: string;
  metric: BudgetMetric;
  measured: number;
  budget: number;
  /** How far past the ceiling, as a whole percentage. */
  overBy: number;
};

/**
 * Every metric a run put past its ceiling, in route order then metric order.
 * A route with no measurement is NOT a pass: an unmeasured route is reported as
 * a breach of every metric, because a budget nothing checked is not a budget.
 */
export function findBudgetBreaches(
  budgets: readonly RouteBudget[],
  measured: ReadonlyMap<string, RouteMeasurement>,
): BudgetBreach[] {
  const breaches: BudgetBreach[] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of BUDGET_METRICS) {
      const budget = route[metric];
      if (!measurement) {
        breaches.push({
          path: route.path,
          metric,
          measured: Number.NaN,
          budget,
          overBy: Number.NaN,
        });
        continue;
      }
      const value = measurement[metric];
      if (value <= budget) continue;
      breaches.push({
        path: route.path,
        metric,
        measured: value,
        budget,
        overBy: Math.round(((value - budget) / budget) * 100),
      });
    }
  }
  return breaches;
}

/**
 * How far under a ceiling a route has to sit before the slack is worth banking.
 *
 * Slack does not stay slack. #1296 is the record of what happens otherwise: a
 * ceiling set generously, a route that quietly grew back into it, and nobody
 * able to say when. So a sweep that beats a ceiling by more than this names the
 * candidate, and somebody decides whether to take it down.
 */
export const RATCHET_SLACK_FRACTION = 0.15;

export type RatchetCandidate = {
  path: string;
  metric: BudgetMetric;
  measured: number;
  budget: number;
  /** How far under the ceiling, as a whole percentage. */
  underBy: number;
};

/**
 * Every metric a run beat by more than the slack fraction.
 *
 * This is a WARNING and nothing else: it edits no file and fails no build. A
 * ceiling comes down because a person decided it should, with the measurement
 * in front of them - the same rule the budget file's own note states.
 *
 * An unmeasured route is not a candidate: it is a breach, and
 * `findBudgetBreaches` already says so.
 */
export function findRatchetCandidates(
  budgets: readonly RouteBudget[],
  measured: ReadonlyMap<string, RouteMeasurement>,
  slackFraction: number = RATCHET_SLACK_FRACTION,
): RatchetCandidate[] {
  const candidates: RatchetCandidate[] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    if (!measurement) continue;
    for (const metric of BUDGET_METRICS) {
      const budget = route[metric];
      const value = measurement[metric];
      if (!Number.isFinite(value) || budget <= 0) continue;
      const slack = (budget - value) / budget;
      if (slack <= slackFraction) continue;
      candidates.push({
        path: route.path,
        metric,
        measured: value,
        budget,
        underBy: Math.round(slack * 100),
      });
    }
  }
  return candidates;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function figure(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "not measured";
}

/**
 * The ratchet table a green run prints when there is slack to bank. Empty
 * string when every ceiling is snug, so a quiet sweep stays quiet.
 */
export function formatRatchetTable(candidates: readonly RatchetCandidate[]): string {
  if (candidates.length === 0) return "";
  const rows = candidates.map((candidate) => [
    candidate.path,
    BUDGET_METRIC_LABELS[candidate.metric],
    figure(candidate.measured),
    figure(candidate.budget),
    `-${candidate.underBy}%`,
  ]);
  const header = ["route", "metric", "measured", "budget", "under by"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/** The over-budget table a failing run prints. Empty string when nothing broke. */
export function formatBreachTable(breaches: readonly BudgetBreach[]): string {
  if (breaches.length === 0) return "";
  const rows = breaches.map((breach) => [
    breach.path,
    BUDGET_METRIC_LABELS[breach.metric],
    figure(breach.measured),
    figure(breach.budget),
    Number.isFinite(breach.overBy) ? `+${breach.overBy}%` : "-",
  ]);
  const header = ["route", "metric", "measured", "budget", "over by"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/** The full pass line a green run prints, so the numbers are in the log either way. */
export function formatMeasurementTable(
  budgets: readonly RouteBudget[],
  measured: ReadonlyMap<string, RouteMeasurement>,
): string {
  const rows: string[][] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of BUDGET_METRICS) {
      rows.push([
        route.path,
        BUDGET_METRIC_LABELS[metric],
        figure(measurement ? measurement[metric] : Number.NaN),
        figure(route[metric]),
      ]);
    }
  }
  const header = ["route", "metric", "measured", "budget"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/** The middle value of a sample, so one slow run cannot fail a green route. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
