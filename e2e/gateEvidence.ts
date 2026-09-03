import type { BrowserContext, Page, TestInfo } from "@playwright/test";

export type GateViewport = {
  width: 390 | 1440;
  height: 844 | 900;
};

export type GatePresentation = {
  viewport: GateViewport;
  theme: "light" | "dark";
  motion: "normal" | "reduced";
};

export type BrowserPerformanceSample = {
  lcp: number;
  cls: number;
  inp: number | null;
  ttfb: number;
  usefulState: number | null;
};

export const GATE_PRESENTATIONS: readonly GatePresentation[] = [
  { viewport: { width: 390, height: 844 }, theme: "light", motion: "normal" },
  { viewport: { width: 390, height: 844 }, theme: "light", motion: "reduced" },
  { viewport: { width: 390, height: 844 }, theme: "dark", motion: "normal" },
  { viewport: { width: 390, height: 844 }, theme: "dark", motion: "reduced" },
  { viewport: { width: 1440, height: 900 }, theme: "light", motion: "normal" },
  { viewport: { width: 1440, height: 900 }, theme: "light", motion: "reduced" },
  { viewport: { width: 1440, height: 900 }, theme: "dark", motion: "normal" },
  { viewport: { width: 1440, height: 900 }, theme: "dark", motion: "reduced" },
] as const;

export async function applyGatePresentation(
  page: Page,
  presentation: GatePresentation,
) {
  await page.setViewportSize(presentation.viewport);
  await page.emulateMedia({
    colorScheme: presentation.theme,
    reducedMotion: presentation.motion === "reduced" ? "reduce" : "no-preference",
  });
}

export async function captureGateScreenshot(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  const path = testInfo.outputPath(`${label}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(label, { path, contentType: "image/png" });
  return path;
}

export async function samplePagePerformance({
  context,
  url,
  samples,
  usefulSelector,
}: {
  context: BrowserContext;
  url: string;
  samples: number;
  usefulSelector?: string;
}) {
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error("samples must be a positive integer");
  }

  const results: BrowserPerformanceSample[] = [];
  for (let index = 0; index < samples; index += 1) {
    // A fresh page gives each sample exactly one observer set and a clean
    // performance timeline. Reusing one page would accumulate addInitScript
    // registrations and count later samples more than once.
    const page = await context.newPage();
    try {
      await page.addInitScript(() => {
        const gateWindow = window as typeof window & {
          __pubmaxGateMetrics?: { lcp: number; cls: number; inp: number };
        };
        gateWindow.__pubmaxGateMetrics = { lcp: 0, cls: 0, inp: 0 };

        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries.at(-1);
          if (last) gateWindow.__pubmaxGateMetrics!.lcp = last.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { hadRecentInput?: boolean; value?: number }
          >) {
            if (!entry.hadRecentInput) {
              gateWindow.__pubmaxGateMetrics!.cls += entry.value ?? 0;
            }
          }
        }).observe({ type: "layout-shift", buffered: true });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { duration: number; interactionId?: number }
          >) {
            if ((entry.interactionId ?? 0) > 0) {
              gateWindow.__pubmaxGateMetrics!.inp = Math.max(
                gateWindow.__pubmaxGateMetrics!.inp,
                entry.duration,
              );
            }
          }
        }).observe({
          type: "event",
          buffered: true,
          durationThreshold: 16,
        } as PerformanceObserverInit);
      });

      // Start before navigation. Useful-state timing ends when target selector
      // becomes visible, independent of later network-idle or load completion.
      const navigationStarted = Date.now();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      let usefulState = null;
      if (usefulSelector) {
        await page.locator(usefulSelector).first().waitFor({ state: "visible" });
        usefulState = Date.now() - navigationStarted;
      }
      await page.waitForLoadState("load");
      await page.waitForTimeout(100);

      results.push(
        await page.evaluate((measuredUsefulState) => {
          const gateWindow = window as typeof window & {
            __pubmaxGateMetrics?: { lcp: number; cls: number; inp: number };
          };
          const navigation = performance.getEntriesByType("navigation")[0] as
            | PerformanceNavigationTiming
            | undefined;
          const metrics = gateWindow.__pubmaxGateMetrics ?? { lcp: 0, cls: 0, inp: 0 };
          return {
            lcp: metrics.lcp,
            cls: metrics.cls,
            inp: metrics.inp || null,
            ttfb: navigation ? navigation.responseStart : 0,
            usefulState: measuredUsefulState,
          };
        }, usefulState),
      );
    } finally {
      await page.close();
    }
  }

  return results;
}
