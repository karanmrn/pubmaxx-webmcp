// LCP is budgeted like everything else a route may spend.
//
// The file already held the three LEVERS - server render, decoded JS, requests -
// and a route can hold all three and still paint late. U1 of
// docs/plans/SITE_SPEED_2026-09-01.md adds the figure a drinker actually feels
// to the same sweep, under the same method block, so the four numbers describe
// one load rather than four.
//
// KTD-2 is the law this file guards hardest: ceilings only ratchet DOWN.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUDGET_METRICS,
  BUDGET_METRIC_LABELS,
  PERFORMANCE_BUDGETS,
  findBudgetBreaches,
  findRatchetCandidates,
  formatRatchetTable,
  type RouteMeasurement,
} from "@/lib/performanceBudgets";

/** The programme's target for the front door and its one primary action. */
const FRONT_DOOR_CEILING_MS = 1500;
/** The Core Web Vitals good boundary: no route may be worse than good. */
const GOOD_LCP_MS = 2500;

describe("lcpMs is a budgeted metric", () => {
  it("rides the same list as the levers, so one sweep measures all four", () => {
    expect(BUDGET_METRICS).toContain("lcpMs");
    expect(BUDGET_METRIC_LABELS.lcpMs).toBe("LCP (ms)");
  });

  it("is set on every budgeted route", () => {
    for (const route of PERFORMANCE_BUDGETS.routes) {
      expect(route.lcpMs, route.path).toBeGreaterThan(0);
      expect(Number.isInteger(route.lcpMs), route.path).toBe(true);
    }
  });

  it("fails a route that paints past its ceiling", () => {
    const route = PERFORMANCE_BUDGETS.routes[0];
    const measured = new Map<string, RouteMeasurement>([
      [
        route.path,
        {
          serverRenderMs: 1,
          jsDecodedKB: 1,
          requests: 1,
          lcpMs: route.lcpMs + 1,
        },
      ],
    ]);
    const breaches = findBudgetBreaches([route], measured);
    expect(breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
  });

  it("passes a route that paints exactly on its ceiling", () => {
    const route = PERFORMANCE_BUDGETS.routes[0];
    const measured = new Map<string, RouteMeasurement>([
      [
        route.path,
        {
          serverRenderMs: 1,
          jsDecodedKB: 1,
          requests: 1,
          lcpMs: route.lcpMs,
        },
      ],
    ]);
    expect(findBudgetBreaches([route], measured)).toEqual([]);
  });
});

describe("the seeded ceilings say what they mean", () => {
  const byPath = new Map(
    PERFORMANCE_BUDGETS.routes.map((route) => [route.path, route]),
  );

  it("holds the front door and its primary action to the programme target", () => {
    expect(byPath.get("/")?.lcpMs).toBe(FRONT_DOOR_CEILING_MS);
    expect(byPath.get("/pal")?.lcpMs).toBe(FRONT_DOOR_CEILING_MS);
  });

  it("lets no route be worse than the good boundary", () => {
    for (const route of PERFORMANCE_BUDGETS.routes) {
      expect(route.lcpMs, route.path).toBeLessThanOrEqual(GOOD_LCP_MS);
    }
  });

  it("records where the seed came from, so the next reader can ratchet it", () => {
    expect(PERFORMANCE_BUDGETS.note).toContain("2026-09-01");
    expect(PERFORMANCE_BUDGETS.note).toContain("4x CPU throttle");
    expect(PERFORMANCE_BUDGETS.note).toMatch(/down is free, up is a decision/);
  });
});

describe("/pal is budgeted at all", () => {
  const pal = PERFORMANCE_BUDGETS.routes.find((route) => route.path === "/pal");

  it("is measured beside the landing that sends people to it", () => {
    expect(pal, "/pal is a budgeted route").toBeTruthy();
    expect(pal?.readySelector).toBe(".palExperience");
    expect(pal?.settledSelectorHidden).toBe(".palLoading");
  });

  it("carries every metric, so nothing about it is unmeasured", () => {
    for (const metric of BUDGET_METRICS) {
      expect(pal?.[metric], metric).toBeGreaterThan(0);
    }
  });
});

// U8 of docs/plans/SITE_SPEED_2026-09-01.md: slack does not stay slack.
//
// #1296 is the record of what happens without this. A ceiling is set
// generously, the route quietly grows back into it, and nobody can say when.
// A sweep that beats a ceiling by a clear margin now NAMES the candidate, so
// the margin is banked as a lower number instead of spent.
//
// It is a warning and only a warning: it edits no file and fails no build. A
// ceiling comes down because a person decided it should, with the measurement
// in front of them.
describe("the ratchet warning", () => {
  const route = PERFORMANCE_BUDGETS.routes[0];

  function measurement(over: Partial<RouteMeasurement> = {}): RouteMeasurement {
    return {
      serverRenderMs: route.serverRenderMs,
      jsDecodedKB: route.jsDecodedKB,
      requests: route.requests,
      lcpMs: route.lcpMs,
      ...over,
    };
  }

  it("stays quiet when every ceiling is snug", () => {
    const measured = new Map([[route.path, measurement()]]);
    expect(findRatchetCandidates([route], measured)).toEqual([]);
    expect(formatRatchetTable([])).toBe("");
  });

  it("names a metric beaten by more than the slack fraction", () => {
    const measured = new Map([
      [route.path, measurement({ lcpMs: Math.round(route.lcpMs * 0.5) })],
    ]);
    const candidates = findRatchetCandidates([route], measured);
    expect(candidates.map((candidate) => candidate.metric)).toEqual(["lcpMs"]);
    expect(candidates[0].underBy).toBeGreaterThanOrEqual(15);
    expect(formatRatchetTable(candidates)).toContain(route.path);
  });

  it("leaves a metric just inside the fraction alone", () => {
    // 10% under is not worth a decision; 15% is the line.
    const measured = new Map([
      [route.path, measurement({ lcpMs: Math.round(route.lcpMs * 0.9) })],
    ]);
    expect(findRatchetCandidates([route], measured)).toEqual([]);
  });

  it("never treats an unmeasured route as slack", () => {
    // That route is a BREACH, and findBudgetBreaches already says so.
    expect(findRatchetCandidates([route], new Map())).toEqual([]);
    expect(findBudgetBreaches([route], new Map()).length).toBeGreaterThan(0);
  });

  it("banks nothing on its own: no writer touches the budget file", () => {
    const source = readFileSync(
      join(__dirname, "..", "lib/performanceBudgets.ts"),
      "utf8",
    );
    // Reading the ceilings is the module's whole job; WRITING them is what a
    // warning must never do.
    expect(source).not.toMatch(/writeFile|appendFile|node:fs/);
  });
});
