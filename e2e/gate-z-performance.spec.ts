import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

type GateZMetrics = {
  lcpMs: number;
  cls: number;
  maxInteractionMs: number;
  firstPinsMs: number;
  warmNavigationMs: number;
  routeReadinessMs: number;
  slowestInteractions: Array<{ name: string; duration: number; startTime: number; interactionId: number }>;
};

declare global {
  interface Window {
    __pubmaxGateZ?: { lcpMs: number; cls: number; maxInteractionMs: number; interactions: Array<{ name: string; duration: number; startTime: number; interactionId: number }> };
    __pubmaxWarmNavigationStart?: number;
    __pubmaxWarmNavigationEnd?: number;
    __pubmaxRouteReadinessStart?: number;
    __pubmaxRouteReadinessEnd?: number;
  }
}

test("Gate Z mobile lab budgets stay inside the release targets", async ({ page }) => {
  test.skip(!process.env.PUBMAX_GATE_Z_PERF, "Run explicitly in the isolated Gate Z performance lab.");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.__pubmaxGateZ = { lcpMs: 0, cls: 0, maxInteractionMs: 0, interactions: [] };
    if (PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__pubmaxGateZ!.lcpMs = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) window.__pubmaxGateZ!.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes("event")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const interactionId = (entry as PerformanceEventTiming).interactionId;
          if (interactionId > 0) {
            window.__pubmaxGateZ!.maxInteractionMs = Math.max(window.__pubmaxGateZ!.maxInteractionMs, entry.duration);
            window.__pubmaxGateZ!.interactions.push({ name: entry.name, duration: entry.duration, startTime: entry.startTime, interactionId });
          }
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    }
});
  await page.goto("/map");
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Now", exact: true }).click();
  await expect(page).toHaveURL(/\/(today|tonight)$/);
  await page
    .getByRole("navigation", { name: "Now" })
    .getByRole("link", { name: "Tonight", exact: true })
    .click();
  await expect(page.getByTestId("tonight-screen")).toBeVisible();
  const mapLink = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Map", exact: true });
  await page.waitForTimeout(500);
  await mapLink.evaluate((link) => link.addEventListener("click", () => {
    window.__pubmaxWarmNavigationStart = performance.now();
    const observePath = () => {
      if (window.location.pathname === "/map") {
        window.__pubmaxWarmNavigationEnd = performance.now();
        return;
      }
      window.requestAnimationFrame(observePath);
    };
    window.requestAnimationFrame(observePath);
  }, { once: true }));
  await mapLink.click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/map$/);
  await page.waitForFunction(() => typeof window.__pubmaxWarmNavigationEnd === "number");
  const warmNavigationMs = await page.evaluate(() => (window.__pubmaxWarmNavigationEnd ?? 0) - (window.__pubmaxWarmNavigationStart ?? 0));
  await page.waitForFunction(() => {
    const started = window.__pubmaxWarmNavigationStart ?? Number.POSITIVE_INFINITY;
    return (performance.getEntriesByName("pubmax:first-pins").at(-1)?.startTime ?? 0) > started;
  });
  const firstPinsMs = await page.evaluate(() => {
    const started = window.__pubmaxWarmNavigationStart ?? 0;
    return (performance.getEntriesByName("pubmax:first-pins").at(-1)?.startTime ?? Number.POSITIVE_INFINITY) - started;
  });
  const paint = await page.evaluate(() => window.__pubmaxGateZ ?? { lcpMs: 0, cls: 0, maxInteractionMs: 0, interactions: [] });

  await expect(page.getByRole("button", { name: "Describe the outing" })).toBeVisible({ timeout: 45_000 });
  const planningWarmup = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/api/plans/generate?cityId=") && response.status() === 204);
  await page.getByRole("button", { name: "Describe the outing" }).click();
  await planningWarmup;
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  await planner.getByLabel("Describe the outing").fill("Three quiet pubs in Barnes under £24");
  const buildRoute = planner.getByRole("button", { name: "Make a plan" });
  await buildRoute.evaluate((button) => button.addEventListener("click", () => {
    window.__pubmaxRouteReadinessStart = performance.now();
    const plannerRoot = button.closest(".mobilePlannerIntent");
    const observer = new MutationObserver(() => {
      if (plannerRoot?.querySelector(".mobilePlannerRouteTotal")) {
        window.__pubmaxRouteReadinessEnd = performance.now();
        observer.disconnect();
      }
    });
    if (plannerRoot) observer.observe(plannerRoot, { childList: true, subtree: true });
  }, { once: true }));
  await buildRoute.click();
  await expect(planner.locator(".mobilePlannerRouteTotal")).toBeVisible();
  await page.waitForFunction(() => typeof window.__pubmaxRouteReadinessEnd === "number");
  const routeReadinessMs = await page.evaluate(() => (window.__pubmaxRouteReadinessEnd ?? 0) - (window.__pubmaxRouteReadinessStart ?? 0));

  const metrics: GateZMetrics = {
    lcpMs: Math.round(paint.lcpMs),
    cls: Number(paint.cls.toFixed(4)),
    maxInteractionMs: Math.round(paint.maxInteractionMs),
    firstPinsMs: Math.round(firstPinsMs),
    warmNavigationMs: Math.round(warmNavigationMs),
    routeReadinessMs,
    slowestInteractions: [...paint.interactions].sort((left, right) => right.duration - left.duration).slice(0, 5).map((entry) => ({ ...entry, duration: Math.round(entry.duration), startTime: Math.round(entry.startTime) })),
  };

  if (process.env.PUBMAX_GATE_Z_SHOTS) {
    const directory = "docs/screenshots/the-local-gate-z";
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/performance-lab.json`, `${JSON.stringify(metrics, null, 2)}\n`);
  }

  expect(metrics.lcpMs).toBeGreaterThan(0);
  expect(metrics.lcpMs).toBeLessThan(2_500);
  expect(metrics.cls).toBeLessThan(0.1);
  expect(metrics.maxInteractionMs).toBeLessThan(200);
  expect(metrics.firstPinsMs).toBeLessThan(1_500);
  expect(metrics.warmNavigationMs).toBeLessThan(100);
  expect(metrics.routeReadinessMs).toBeLessThan(1_500);

});
