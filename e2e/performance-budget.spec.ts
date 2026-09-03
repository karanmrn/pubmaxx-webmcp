import { expect, test } from "@playwright/test";

import {
  PERFORMANCE_BUDGETS,
  findBudgetBreaches,
  findRatchetCandidates,
  formatBreachTable,
  formatMeasurementTable,
  formatRatchetTable,
  type RouteMeasurement,
} from "../lib/performanceBudgets";
import { measurePerfRoute, preparePerfPage } from "./helpers/perfMeasurement";

// The enforced site performance budget (docs/PERFORMANCE_BUDGETS.md).
//
// One spec measures every budgeted route against perf/route-budgets.json and
// fails with an over-budget table naming what went past which ceiling. It runs
// against the production build Playwright's webServer already builds, because
// a dev-server measurement would be a number about webpack rather than about
// what a drinker downloads.
//
// WHAT IS MEASURED, and why each is the honest proxy:
//   serverRenderMs — responseStart minus requestStart on the document's own
//     navigation entry. Over loopback that is server think time with no network
//     in it, which is the part of a production TTFB the code owns.
//   jsDecodedKB — decoded (so: parse cost, not transfer cost) bytes of every
//     same-origin script the route asked for before it was interactive.
//   requests — how many same-origin requests it took to get there. A route can
//     hold its bytes and still lose the night to a waterfall.
//   lcpMs — the largest contentful paint the same run observed. The three above
//     are levers; this is the one a drinker feels, and a route can hold every
//     lever and still paint late.
//
// HOW it is measured is e2e/helpers/perfMeasurement.ts, shared with the UX lane
// report so the two sets of figures are taken the same way and stay comparable.
//
// Gated on PUBMAX_PERF_BUDGET so the ordinary browser suite does not pay for
// it; the CI job that owns it sets the variable.

const budgets = PERFORMANCE_BUDGETS;

// The whole sweep in one test: the server is shared, so the routes must be
// measured one after another rather than raced by parallel workers.
const SWEEP_TIMEOUT_MS =
  60_000 * budgets.routes.length * (budgets.method.warmupRuns + budgets.method.measuredRuns);

test("every budgeted route stays inside its performance budget", async ({ page, baseURL }) => {
  test.skip(!process.env.PUBMAX_PERF_BUDGET, "Owned by the performance-budget CI job.");
  test.setTimeout(SWEEP_TIMEOUT_MS);

  const origin = new URL(baseURL ?? "http://localhost:3100").origin;
  await preparePerfPage(page, origin, budgets.method);

  const measured = new Map<string, RouteMeasurement>();
  for (const route of budgets.routes) {
    const sample = await measurePerfRoute(page, route, budgets.method);
    measured.set(route.path, {
      serverRenderMs: sample.serverRenderMs,
      jsDecodedKB: sample.jsDecodedKB,
      requests: sample.requests,
      lcpMs: Math.round(sample.lcpMs),
    });
  }

  console.log(`[perf-budget]\n${formatMeasurementTable(budgets.routes, measured)}`);

  // Slack does not stay slack (#1296): a ceiling set generously is a ceiling a
  // route quietly grows back into. A sweep that beats one by a clear margin
  // names the candidate here so the margin gets banked as a lower number rather
  // than spent. It is a WARNING - it edits nothing and fails nothing.
  const ratchet = findRatchetCandidates(budgets.routes, measured);
  if (ratchet.length > 0) {
    console.log(
      `\n[perf-budget][ratchet] ceilings with slack to bank ` +
        `(docs/PERFORMANCE_BUDGETS.md: down is free, up is a decision):\n` +
        `${formatRatchetTable(ratchet)}\n`,
    );
  }

  const breaches = findBudgetBreaches(budgets.routes, measured);
  expect(
    breaches,
    breaches.length === 0
      ? "no breach"
      : `Over the performance budget. Fix the route or take the ceiling up deliberately (docs/PERFORMANCE_BUDGETS.md).\n\n${formatBreachTable(breaches)}\n`,
  ).toEqual([]);
});
