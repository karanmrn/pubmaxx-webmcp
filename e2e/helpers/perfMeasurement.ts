import { expect, type Page, type Request } from "@playwright/test";

import { PERFORMANCE_BUDGETS, median, type BudgetMethod } from "../../lib/performanceBudgets";

/**
 * The ONE way a route's cost is measured in this suite.
 *
 * Two specs read these numbers - e2e/performance-budget.spec.ts, which enforces
 * perf/route-budgets.json, and e2e/ux-lane-perf-verification.spec.ts, which
 * reports the same routes plus LCP and CLS - and two figures are only
 * comparable when they were taken the same way. So the method lives here once:
 * the tracked warm-up and median runs, the CPU throttle, the third-party block,
 * and the app-defined cut for what counts as "before interactive".
 *
 * WHERE "BEFORE INTERACTIVE" IS CUT, and why it is not a wall clock: the app
 * deliberately warms the OTHER tab destinations once the foreground surface
 * says it has painted (lib/backgroundWarmup.ts). Those chunks are off the
 * critical path by design, but a time-based settle catches or misses them
 * depending on how fast the box is: the first CI run measured /today at 2726 KB
 * and the retry at 1186 KB, on one build. So the cut is the route's own
 * readiness gate, no earlier than the window load event, and a resource counts
 * if it STARTED before that moment. The run then waits for the network to go
 * quiet so every counted entry carries its final size.
 */
export type PerfRoute = {
  /** The path measured, exactly as a browser would open it. */
  path: string;
  /** Rendered proof the route arrived; measurement waits for it. */
  readySelector: string;
  /** Optional loading affordance that must be gone before measuring. */
  settledSelectorHidden?: string;
};

export type PerfSample = {
  serverRenderMs: number;
  jsDecodedKB: number;
  requests: number;
  lcpMs: number;
  cls: number;
};

export const ROUTE_READY_TIMEOUT_MS = 45_000;

export function aggregatePerfMetric(values: readonly number[]): number {
  if (values.some((value) => !Number.isFinite(value))) return Number.NaN;
  return median(values);
}

/** No new resource entry for this long counts as the network having gone quiet. */
const NETWORK_QUIET_MS = 1_500;
const NETWORK_QUIET_CEILING_MS = 20_000;

type NetworkTracker = {
  active: Set<Request>;
  revision: number;
};

const networkTrackers = new WeakMap<Page, NetworkTracker>();

function ensureNetworkTracker(page: Page): NetworkTracker {
  const existing = networkTrackers.get(page);
  if (existing) return existing;

  const tracker: NetworkTracker = { active: new Set(), revision: 0 };
  const start = (request: Request) => {
    tracker.active.add(request);
    tracker.revision += 1;
  };
  const finish = (request: Request) => {
    tracker.active.delete(request);
    tracker.revision += 1;
  };
  page.on("request", start);
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);
  networkTrackers.set(page, tracker);
  return tracker;
}

/**
 * First-run surfaces are their own chunks and their own overlays, the CPU is
 * throttled and cross-origin requests are refused, so a run describes what we
 * ship to a returning visitor rather than a tile server's morning.
 */
export async function preparePerfPage(
  page: Page,
  origin: string,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
): Promise<void> {
  ensureNetworkTracker(page);
  await page.setViewportSize(method.viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // The default buffer holds 250 entries and a busy route is close to it;
    // a dropped entry would read as a route that asked for less than it did.
    performance.setResourceTimingBufferSize(1000);

    const gateWindow = window as typeof window & {
      __pubmaxPerfPaint?: { lcpMs: number; cls: number };
    };
    gateWindow.__pubmaxPerfPaint = { lcpMs: Number.NaN, cls: 0 };
    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) gateWindow.__pubmaxPerfPaint!.lcpMs = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        >) {
          if (!entry.hadRecentInput) {
            gateWindow.__pubmaxPerfPaint!.cls += entry.value ?? 0;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });

  if (method.thirdPartyBlocked) {
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      return route.abort();
    });
  }

  const rate = method.cpuThrottleRate;
  if (rate && rate > 1) {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate });
  }
}

/** Loads the route and returns the interactive moment on the page's own clock. */
export async function loadPerfRoute(page: Page, route: PerfRoute): Promise<number> {
  await page.goto(route.path, { waitUntil: "load" });
  await expect(page.locator(route.readySelector).first()).toBeVisible({
    timeout: ROUTE_READY_TIMEOUT_MS,
  });
  if (route.settledSelectorHidden) {
    await expect(page.locator(route.settledSelectorHidden)).toBeHidden({
      timeout: ROUTE_READY_TIMEOUT_MS,
    });
  }
  return page.evaluate(() => performance.now());
}

/** Waits until nothing new has been requested for a while, so sizes are final. */
export async function waitForQuietNetwork(page: Page): Promise<void> {
  const tracker = ensureNetworkTracker(page);
  let seenRevision = tracker.revision;
  let quietSince = Date.now();
  const deadline = Date.now() + NETWORK_QUIET_CEILING_MS;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (Date.now() >= deadline && tracker.active.size > 0) {
      throw new Error(
        `Network did not drain within ${NETWORK_QUIET_CEILING_MS}ms (${tracker.active.size} request(s) still active).`,
      );
    }
    if (tracker.revision !== seenRevision || tracker.active.size > 0) {
      seenRevision = tracker.revision;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= NETWORK_QUIET_MS) return;
  }
}

/** One load, measured. */
export async function samplePerfRoute(page: Page, route: PerfRoute): Promise<PerfSample> {
  const interactiveAt = await loadPerfRoute(page, route);
  await waitForQuietNetwork(page);
  return page.evaluate((boundary) => {
    const gateWindow = window as typeof window & {
      __pubmaxPerfPaint?: { lcpMs: number; cls: number };
    };
    const paint = gateWindow.__pubmaxPerfPaint ?? { lcpMs: Number.NaN, cls: 0 };
    const origin = location.origin;
    const [navigation] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    let jsBytes = 0;
    let requests = 0;
    for (const entry of performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[]) {
      if (!entry.name.startsWith(origin)) continue;
      // Asked for before the route was interactive, whenever it finished.
      if (entry.startTime > boundary) continue;
      requests += 1;
      const isJs = entry.initiatorType === "script" || /\.js(\?|$)/.test(entry.name);
      if (isJs) jsBytes += entry.decodedBodySize || 0;
    }
    return {
      // The document itself is a request too, and it is the one that pays the
      // server render, so it counts.
      requests: requests + 1,
      jsDecodedKB: Math.round(jsBytes / 1024),
      serverRenderMs: navigation
        ? Math.round(navigation.responseStart - navigation.requestStart)
        : Number.NaN,
      lcpMs: paint.lcpMs,
      cls: paint.cls,
    };
  }, interactiveAt);
}

/**
 * The tracked method end to end: warm-up loads drain fully before a real
 * three-sample median. Without the drain, late warm-up requests can race into
 * the first sample and make identical builds report different route costs.
 */
export async function measurePerfRoute(
  page: Page,
  route: PerfRoute,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
): Promise<PerfSample> {
  for (let run = 0; run < method.warmupRuns; run += 1) {
    await loadPerfRoute(page, route);
    await waitForQuietNetwork(page);
  }
  const samples: PerfSample[] = [];
  for (let run = 0; run < method.measuredRuns; run += 1) {
    samples.push(await samplePerfRoute(page, route));
  }
  return {
    serverRenderMs: aggregatePerfMetric(samples.map((sample) => sample.serverRenderMs)),
    jsDecodedKB: aggregatePerfMetric(samples.map((sample) => sample.jsDecodedKB)),
    requests: aggregatePerfMetric(samples.map((sample) => sample.requests)),
    lcpMs: aggregatePerfMetric(samples.map((sample) => sample.lcpMs)),
    cls: aggregatePerfMetric(samples.map((sample) => sample.cls)),
  };
}
