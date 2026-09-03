import { expect, test } from "@playwright/test";

// Mobile map performance budget (perf/mobile-map-budget).
//
// The mobile /map loop must feel app-like: LCP < 2.5s on mid-tier 4G at
// 390×844. Wall-clock LCP under network+CPU throttling on a real GPU is not
// reproducible on a headless, GPU-less CI box (the browser suite here runs
// software WebGL via SwiftShader, which paints the basemap far slower than any
// phone). So this smoke locks the budget by the lever we actually control and
// that DID move the LCP: the weight of JavaScript the map route makes the
// browser download and parse before it can boot.
//
// The current measurement and route ceiling live in perf/route-budgets.json.
// Keep off-path panels and data out of the eager map chunk. Reintroducing a
// static import for a surface that mounts only after interaction or on desktop
// must trip this test. Slim index, MapLibre, and pin-price paths stay eager.
const EAGER_JS_DECODED_BUDGET_KB = 3400;

// Map-boot sanity: the mobile chrome must appear and the loading skeleton must
// clear. WebGL-agnostic on purpose — on a no-GPU box the canvas takes the
// honest fallback path, which still retires the skeleton, so this asserts the
// map route boots without depending on a painted WebGL canvas.
const MAP_BOOT_TIMEOUT_MS = 45_000;

test("mobile /map stays within the eager-JS budget and boots", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // Suppress first-run tour / onboarding so their chunks and overlays don't
  // colour the boot path (same durable keys the app writes on dismissal).
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  await page.goto("/map");

  // Boot proxy: mobile map chrome visible + loading skeleton retired.
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({
    timeout: MAP_BOOT_TIMEOUT_MS,
  });
  await expect(page.locator(".mapLoading")).toBeHidden({
    timeout: MAP_BOOT_TIMEOUT_MS,
  });

  // Let any remaining eager first-load chunks settle before we weigh them.
  await page.waitForLoadState("networkidle").catch(() => {});

  // Sum decoded (uncompressed = parse cost) bytes of the same-origin JavaScript
  // the map route pulled in. Same-origin only, so third-party tiles/analytics
  // never count. decodedBodySize is deterministic and GPU-independent.
  const eagerJsDecodedKB = await page.evaluate(() => {
    const origin = location.origin;
    let bytes = 0;
    for (const e of performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[]) {
      if (!e.name.startsWith(origin)) continue;
      const isJs = e.initiatorType === "script" || /\.js(\?|$)/.test(e.name);
      if (isJs) bytes += e.decodedBodySize || 0;
    }
    return Math.round(bytes / 1024);
  });

  console.log(`[map-perf-budget] eager same-origin JS decoded: ${eagerJsDecodedKB} KB (budget ${EAGER_JS_DECODED_BUDGET_KB} KB)`);
  expect(eagerJsDecodedKB).toBeLessThan(EAGER_JS_DECODED_BUDGET_KB);
});
