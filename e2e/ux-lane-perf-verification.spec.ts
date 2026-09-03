/**
 * UX lane 13: LCP, CLS and decoded JS at 390x844 against perf/route-budgets.json.
 *
 * Gated on PUBMAX_PERF_BUDGET and owned by the ux-lane-performance CI job
 * (.github/workflows/ci.yml), so the markdown table for the PR body really is
 * produced by a run. It is a JOB OF ITS OWN rather than a second file in the
 * performance-budget step: both sweeps build and serve the app themselves, and
 * this route set's map load runs 10 to 25 seconds cold.
 *
 * It measures through e2e/helpers/perfMeasurement.ts - the SAME warm-up, median
 * runs, CPU throttle, third-party block and app-defined interactive cut the
 * tracked budget spec uses - because a figure compared against a ceiling has to
 * have been taken the way that ceiling was.
 *
 * This job REPORTS; it does not gate. The measure moved 20% between two runs of
 * one build on the same box (`/` read 1191, 1435.5 and 1191 KB), which is wider
 * than any tolerance worth writing down, so failing on it would mark a build
 * red for noise rather than for a regression. perf/route-budgets.json is
 * enforced by the tracked performance-budget job, which is the ONE gate; a
 * route over its own ceiling here is printed as a warning for the reader. What
 * this job still fails on is a route that could not be measured at all: an
 * absent figure is a broken route, not a slow one.
 *
 * A ceiling borrowed from another document is printed as context: /map is
 * prerendered and CDN-cached while /map/london renders per request, so a
 * difference between them is not a regression in either.
 *
 * The table is WRITTEN to the test's own output directory, not only attached:
 * an attachment carrying a body never reaches disk, and this run's whole point
 * is a file the PR body can quote.
 */
import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { PERFORMANCE_BUDGETS } from "../lib/performanceBudgets";
import { measurePerfRoute, preparePerfPage, type PerfRoute } from "./helpers/perfMeasurement";

type UxLaneRoute = PerfRoute & {
  /**
   * Route path in perf/route-budgets.json whose ceiling is printed beside this
   * route's figure, or null for a route that carries no tracked ceiling. A
   * ceiling raises a WARNING only when it belongs to the document that was
   * loaded (`budgetPath === path`); anything else is context for the reader.
   */
  budgetPath: string | null;
  /** Stated when the ceiling belongs to a different document than the one loaded. */
  budgetNote?: string;
};

const UX_LANE_ROUTES: UxLaneRoute[] = [
  { path: "/", readySelector: "main", budgetPath: "/" },
  { path: "/near?patch=soho", readySelector: ".nmn", budgetPath: null },
  {
    path: "/map/london",
    readySelector: ".mobileMapTopbar",
    settledSelectorHidden: ".mapLoading",
    budgetPath: "/map",
    budgetNote:
      "ceiling belongs to /map, the CDN-cached prerendered document, while /map/london renders per request with a nonce. The figure is reported for comparison, not against this document's own ceiling",
  },
  { path: "/out", readySelector: "main", budgetPath: "/out" },
];

/** The PR table's file name, uploaded by the ux-lane-performance CI job. */
const UX_LANE_TABLE_FILE = "ux-lane-13-perf.md";

const method = PERFORMANCE_BUDGETS.method;

const SWEEP_TIMEOUT_MS =
  60_000 * UX_LANE_ROUTES.length * (method.warmupRuns + method.measuredRuns);

function budgetForPath(path: string | null): number | null {
  if (!path) return null;
  const route = PERFORMANCE_BUDGETS.routes.find((entry) => entry.path === path);
  return route?.jsDecodedKB ?? null;
}

test("UX lane routes report LCP, CLS and JS decoded against route budgets", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(!process.env.PUBMAX_PERF_BUDGET, "Owned by the ux-lane-performance CI job.");
  test.setTimeout(SWEEP_TIMEOUT_MS);

  const origin = new URL(baseURL ?? "http://localhost:3100").origin;
  await preparePerfPage(page, origin, method);

  const rows: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const measured: { path: string; jsDecodedKB: number; lcpMs: number }[] = [];

  for (const route of UX_LANE_ROUTES) {
    const { lcpMs, cls, jsDecodedKB } = await measurePerfRoute(page, route, method);
    const budgetKb = budgetForPath(route.budgetPath);
    const overPct =
      budgetKb !== null && jsDecodedKB > budgetKb
        ? Math.round(((jsDecodedKB - budgetKb) / budgetKb) * 100)
        : null;

    measured.push({ path: route.path, jsDecodedKB, lcpMs });

    // A ceiling measured on another document is not this document's ceiling:
    // /map is prerendered and CDN-cached, /map/london is rendered per request,
    // so a per-request-only difference is not a JS regression.
    const ownCeiling = route.budgetPath === route.path;
    if (ownCeiling && budgetKb !== null && overPct !== null) {
      warnings.push(
        `- \`${route.path}\`: JS decoded ${jsDecodedKB} KB is over its own ${budgetKb} KB ceiling (+${overPct}%). The tracked performance-budget job owns that gate.`,
      );
    }

    if (route.budgetNote) notes.push(`- \`${route.path}\`: ${route.budgetNote}.`);

    rows.push(
      `| ${route.path} | ${Math.round(lcpMs)} | ${cls.toFixed(3)} | ${jsDecodedKB} | ${
        budgetKb === null
          ? "n/a"
          : `${budgetKb}${ownCeiling ? "" : ` (${route.budgetPath}, reported)`}`
      } | ${overPct !== null ? `+${overPct}%` : "n/a"} |`,
    );
  }

  const markdown = [
    `## UX lane 13 performance (${method.viewport.width}x${method.viewport.height}, production build)`,
    "",
    `Method: ${method.warmupRuns} warm-up run then the ${method.aggregate} of ${method.measuredRuns}, CPU throttled ${method.cpuThrottleRate}x, cross-origin requests refused. ${method.countedUpTo}`,
    "",
    "| route | LCP (ms) | CLS | JS decoded (KB) | budget (KB) | over budget |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    ...(notes.length > 0 ? [...notes, ""] : []),
    ...(warnings.length > 0
      ? ["Over budget on this run, reported rather than gated:", "", ...warnings, ""]
      : ["No route was over its own ceiling on this run.", ""]),
    "Every figure here is reported. perf/route-budgets.json is enforced by the tracked performance-budget job, so this run marks nothing red for a measure that moved 20% between two runs of one build.",
  ].join("\n");

  for (const warning of warnings) console.warn(warning.replace(/^- /, ""));

  // `attach({ body })` keeps the table in memory and writes no file, and the
  // `list` reporter prints an attachment only inside a failure block, so a green
  // run used to produce the PR table nowhere. Write it first, then attach the
  // written file by path.
  const tablePath = testInfo.outputPath(UX_LANE_TABLE_FILE);
  await writeFile(tablePath, `${markdown}\n`, "utf8");
  await testInfo.attach(UX_LANE_TABLE_FILE, {
    path: tablePath,
    contentType: "text/markdown",
  });

  // What is still a failure: a route this job could not measure. An absent or
  // zero figure means the document never became interactive, which the table
  // would otherwise print as a flattering number.
  expect(measured.map((entry) => entry.path)).toEqual(
    UX_LANE_ROUTES.map((route) => route.path),
  );
  for (const entry of measured) {
    expect(entry.jsDecodedKB, `${entry.path} decoded no JS`).toBeGreaterThan(0);
    expect(entry.lcpMs, `${entry.path} reported no LCP`).toBeGreaterThan(0);
  }
});
