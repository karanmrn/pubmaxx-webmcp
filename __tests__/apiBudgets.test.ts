// The hot reads have ceilings too.
//
// U7 of docs/plans/SITE_SPEED_2026-09-01.md. perf/route-budgets.json says what
// a PAGE may cost; this is the same discipline one layer down, for the public
// GETs the map, Today and Out spend on arrival. A page can hold every byte
// budget it has and still lose the night because the read behind it took a
// second.
//
// The rules live in lib/apiBudgets.ts so they are testable without a network:
// scripts/probe-api-budgets.mjs only measures.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  API_BUDGETS,
  API_BUDGET_METRICS,
  findApiBudgetBreaches,
  formatApiBreachTable,
  percentile,
  type ApiRouteMeasurement,
} from "@/lib/apiBudgets";

const REPO_ROOT = join(__dirname, "..");

describe("percentile is nearest-rank, and says so once", () => {
  it("takes the last sample for p95 of twelve", () => {
    const samples = Array.from({ length: 12 }, (_, index) => index + 1);
    expect(percentile(samples, 0.95)).toBe(12);
    expect(percentile(samples, 0.5)).toBe(6);
  });

  it("never reads past either end", () => {
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([5], 0)).toBe(5);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });

  it("is order-independent", () => {
    expect(percentile([9, 1, 5], 0.5)).toBe(percentile([5, 9, 1], 0.5));
  });
});

describe("the budget file", () => {
  it("budgets the reads a cold arrival actually spends", () => {
    const paths = API_BUDGETS.routes.map((route) => route.path);
    expect(paths).toContain("/api/whats-on");
    expect(paths).toContain("/api/out");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps each recorded seed and orders p95 after p50", () => {
    for (const route of API_BUDGETS.routes) {
      expect(route.seedP50Ms, route.path).toBeGreaterThan(0);
      expect(route.seedP95Ms, route.path).toBeGreaterThan(0);
      expect(route.p95Ms, route.path).toBeGreaterThanOrEqual(route.p50Ms);
    }
  });

  it("budgets only PUBLIC reads, so a probe needs no session", () => {
    for (const route of API_BUDGETS.routes) {
      expect(route.path.startsWith("/api/"), route.path).toBe(true);
      expect(route.why.length, route.path).toBeGreaterThan(20);
    }
  });

  it("keeps the seed it was set from, so a ratchet has its baseline", () => {
    expect(API_BUDGETS.note).toContain("2026-09-01");
    expect(API_BUDGETS.note).toContain("down is free, up is a decision");
  });
});

describe("a breach is reported, and an unmeasured route is not a pass", () => {
  const route = API_BUDGETS.routes[0];

  it("fails a read past its p95", () => {
    const measured = new Map<string, ApiRouteMeasurement>([
      [route.path, { p50Ms: 1, p95Ms: route.p95Ms + 1 }],
    ]);
    const breaches = findApiBudgetBreaches([route], measured);
    expect(breaches.map((breach) => breach.metric)).toEqual(["p95Ms"]);
    expect(formatApiBreachTable(breaches)).toContain(route.path);
  });

  it("passes a read exactly on its ceilings", () => {
    const measured = new Map<string, ApiRouteMeasurement>([
      [route.path, { p50Ms: route.p50Ms, p95Ms: route.p95Ms }],
    ]);
    expect(findApiBudgetBreaches([route], measured)).toEqual([]);
  });

  it("reports every metric of a route nothing measured", () => {
    const breaches = findApiBudgetBreaches([route], new Map());
    expect(breaches.map((breach) => breach.metric)).toEqual([...API_BUDGET_METRICS]);
  });
});

describe("the probe measures and nothing else", () => {
  const probe = readFileSync(
    join(REPO_ROOT, "scripts/probe-api-budgets.mjs"),
    "utf8",
  );

  it("reads the ceilings and the verdict from the shared module", () => {
    expect(probe).toContain("perf/api-budgets.json");
    expect(probe).toContain("findApiBudgetBreaches");
  });

  it("refuses to run without a target rather than guessing one", () => {
    expect(probe).toContain("--base-url");
    expect(probe).toContain("process.exit(2)");
  });

  it("drains the body it timed", () => {
    // A response nobody reads is a request that never finishes.
    expect(probe).toContain("reader.cancel()");
  });

  it("treats an error page as unmeasured, never as a fast read", () => {
    expect(probe).toContain("firstNonSuccessStatus !== null");
  });
});
