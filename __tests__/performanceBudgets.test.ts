import { describe, expect, it } from "vitest";

import {
  BUDGET_METRICS,
  PERFORMANCE_BUDGETS,
  findBudgetBreaches,
  formatBreachTable,
  median,
  type RouteBudget,
  type RouteMeasurement,
} from "@/lib/performanceBudgets";

// The budget's own fence. The measuring runs in a browser (e2e/performance
// -budget.spec.ts), so the RULES are pinned here where they cost nothing:
// a budget that is missing, unreadable or silently unenforced is the same as
// no budget at all, and that is the failure this file exists to catch.

const route = (over: Partial<RouteBudget> = {}): RouteBudget => ({
  path: "/x",
  readySelector: "main",
  why: "because",
  serverRenderMs: 100,
  jsDecodedKB: 1000,
  requests: 50,
  lcpMs: 2000,
  ...over,
});

const measurement = (over: Partial<RouteMeasurement> = {}): RouteMeasurement => ({
  serverRenderMs: 10,
  jsDecodedKB: 100,
  requests: 5,
  lcpMs: 200,
  ...over,
});

describe("perf/route-budgets.json", () => {
  it("budgets the routes the product is judged on", () => {
    const paths = PERFORMANCE_BUDGETS.routes.map((entry) => entry.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/map");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every route a real ceiling on every metric and a reason to be listed", () => {
    for (const entry of PERFORMANCE_BUDGETS.routes) {
      expect(entry.path.startsWith("/"), entry.path).toBe(true);
      expect(entry.readySelector.length, entry.path).toBeGreaterThan(0);
      expect(entry.why.trim().length, entry.path).toBeGreaterThan(0);
      for (const metric of BUDGET_METRICS) {
        expect(Number.isFinite(entry[metric]), `${entry.path} ${metric}`).toBe(true);
        expect(entry[metric], `${entry.path} ${metric}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the method honest: a warm-up, a real three-sample median", () => {
    const { method } = PERFORMANCE_BUDGETS;
    expect(method.warmupRuns).toBeGreaterThanOrEqual(1);
    expect(method.measuredRuns).toBe(3);
    expect(method.aggregate).toBe("median");
    expect(method.thirdPartyBlocked).toBe(true);
  });

  it("says in the config where counting stops, because that is what makes two runs comparable", () => {
    expect(PERFORMANCE_BUDGETS.method.countedUpTo.trim().length).toBeGreaterThan(0);
  });
});

describe("findBudgetBreaches", () => {
  it("passes a run that is inside every ceiling", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement()]]),
    );
    expect(breaches).toEqual([]);
  });

  it("treats the ceiling itself as inside the budget", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement({ serverRenderMs: 100 })]]),
    );
    expect(breaches).toEqual([]);
  });

  it("names the metric, the figure and how far past it went", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement({ jsDecodedKB: 1500 })]]),
    );
    expect(breaches).toEqual([
      { path: "/x", metric: "jsDecodedKB", measured: 1500, budget: 1000, overBy: 50 },
    ]);
  });

  it("fails a metric that was not measured", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement({ lcpMs: Number.NaN })]]),
    );

    expect(breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
    expect(Number.isNaN(breaches[0].measured)).toBe(true);
  });

  it("fails a route nobody measured rather than reading silence as a pass", () => {
    const breaches = findBudgetBreaches([route()], new Map());
    expect(breaches.map((breach) => breach.metric)).toEqual([...BUDGET_METRICS]);
    expect(breaches.every((breach) => Number.isNaN(breach.measured))).toBe(true);
  });
});

describe("formatBreachTable", () => {
  it("says nothing when nothing broke", () => {
    expect(formatBreachTable([])).toBe("");
  });

  it("prints one row per breach with the route, the figure and the ceiling", () => {
    const table = formatBreachTable(
      findBudgetBreaches(
        [route({ path: "/map" })],
        new Map([["/map", measurement({ serverRenderMs: 250, requests: 75 })]]),
      ),
    );
    expect(table).toContain("route");
    expect(table).toContain("/map");
    expect(table).toContain("server render (ms)");
    expect(table).toContain("250");
    expect(table).toContain("+150%");
    expect(table).toContain("+50%");
  });

  it("says a missing figure was not measured instead of printing NaN", () => {
    expect(formatBreachTable(findBudgetBreaches([route()], new Map()))).toContain(
      "not measured",
    );
  });
});

describe("median", () => {
  it("takes the middle of an odd sample and the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("has no answer for an empty sample", () => {
    expect(Number.isNaN(median([]))).toBe(true);
  });
});
