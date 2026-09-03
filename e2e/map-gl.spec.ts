import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function changedPixelRatio(first: Buffer, second: Buffer): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(first).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(second).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  expect(b.info.width).toBe(a.info.width);
  expect(b.info.height).toBe(a.info.height);

  let changed = 0;
  const pixels = a.info.width * a.info.height;
  for (let index = 0; index < a.data.length; index += 3) {
    const delta =
      Math.abs(a.data[index] - b.data[index]) +
      Math.abs(a.data[index + 1] - b.data[index + 1]) +
      Math.abs(a.data[index + 2] - b.data[index + 2]);
    if (delta > 24) changed += 1;
  }
  return changed / pixels;
}

const MOBILE_CLUSTER_COLOURS = [
  [24, 167, 109],
  [242, 167, 27],
  [255, 90, 95],
] as const;

async function mobileClusterColourPixelCount(frame: Buffer): Promise<number> {
  const { data } = await sharp(frame)
    .extract({ left: 0, top: 180, width: 390, height: 510 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let count = 0;
  for (let index = 0; index < data.length; index += 3) {
    if (
      MOBILE_CLUSTER_COLOURS.some(
        ([red, green, blue]) =>
          Math.abs(data[index] - red) <= 26 &&
          Math.abs(data[index + 1] - green) <= 26 &&
          Math.abs(data[index + 2] - blue) <= 26,
      )
    ) {
      count += 1;
    }
  }
  return count;
}

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbChannels(cssColour: string): [number, number, number] {
  const channels = cssColour.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Could not parse computed colour: ${cssColour}`);
  }
  return [channels[0], channels[1], channels[2]];
}

async function zoomThroughHiddenMobileControl(page: Page, steps = 3): Promise<void> {
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
  for (let step = 0; step < steps; step += 1) {
    await zoomIn.evaluate((button: HTMLButtonElement) => button.click());
    // MapLibre animates zoomIn. Let each level settle so rapid synthetic
    // clicks cannot coalesce into one camera transition and only three tiles.
    await page.waitForTimeout(600);
  }
}

// GPU-present contract. Runs only under the `chromium-gl` project, which launches
// Chromium with SwiftShader (a software GL implementation) so a real WebGL2
// context exists even on a GPU-less CI box. Where smoke.spec.ts asserts
// canvas-OR-fallback (WebGL-agnostic), this spec asserts the *success* half: a
// browser with a working GL stack must paint the MapLibre canvas and NEVER show
// the "Map renderer unavailable" fallback. It is the regression guard for the
// real-browser fallback reports.

test("/map phone handoff contains real price clusters before loading retires", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });

  await page.goto("/map");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as typeof window & {
              __pubmaxPinRevealTrace: Array<{ reason: string; generation: number }>;
            }).__pubmaxPinRevealTrace.length,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  await expect(page.locator(".mapLoading")).toHaveCount(0);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  const frame = await page.screenshot();
  expect(
    await mobileClusterColourPixelCount(frame),
    "settled phone frame must contain the shipped price-cluster colours",
  ).toBeGreaterThanOrEqual(500);
});

test("three-stop invite handoff fits the mobile map canvas", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 300 });
  const cameraWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Map cannot fit within canvas")) {
      cameraWarnings.push(message.text());
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  await page.goto(
    "/map?mode=build&pubs=venue-xjf3n0%2Cvenue-lrz4u2%2Cvenue-1f5ygjb",
  );

  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 20_000 });
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  if ((await planner.count()) === 0) await page.locator(".mobilePlanActivation").click();
  await expect.poll(() => planner.locator("ol.routeList > li").count()).toBeGreaterThan(1);
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();
  expect(cameraWarnings).toEqual([]);
});

test("/map renders the MapLibre canvas with real size and never falls back", async ({
  page,
}) => {
  // This test deliberately waits out the full tile-timeout window (see the
  // second assertion block), which alone exceeds the 30s project default.
  test.setTimeout(60_000);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The map is a dynamic import (ssr:false) behind a loading shell; the wrapper
  // appears first, then either the canvas or the fallback. Give MapLibre room to
  // construct + acquire its context under parallel load.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20000 });

  // Success assertion: the MapLibre container's <canvas> exists, is visible, and
  // has non-zero paint area. MapLibre creates the canvas synchronously on a
  // successful construct, so its presence + size is the honest "GL works" signal.
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // The whole point: with a working GL stack the fallback must never render.
  // Assert it after the canvas is up AND after the component's one silent
  // auto-retry window (1500ms) could have elapsed, so a late fallback can't slip
  // through green.
  await page.waitForTimeout(2000);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();

  // Tile-timeout regression guard (the "Map tiles unavailable" report). The
  // canvas can construct fine while the *style* silently fails to load its
  // tiles: PubMapCanvas waits STYLE_LOAD_TIMEOUT_MS (8s), swaps to the CARTO
  // fallback style, then waits another 8s before surfacing the kind:"tiles"
  // .mapFallback. A short wait (above) passes green even if that's about to
  // fire — and a CSP that blocks the CARTO fallback (basemaps.cartocdn.com /
  // tiles.basemaps.cartocdn.com must be in connect-src) guarantees it fires.
  // Wait out the full 8s+8s window so a tile/CSP failure can't hide behind an
  // early green. Either OpenFreeMap loads directly, or the CARTO fallback does;
  // either way the fallback must never appear and the canvas must stay up.
  await page.waitForTimeout(18_000);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();
});

test("/map does not report a background failure after one basemap source paints", async ({
  page,
}) => {
  test.setTimeout(75_000);
  await installDeterministicMapBasemap(page, {
    primaryRasterDelayMs: 28_000,
    secondaryRasterDelayMs: 75_000,
    stallSecondaryRaster: true,
  });

  await page.goto("/map");
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 30_000,
  });
  await expect(notice).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map stays visually stable for a reduced-motion viewer while idle", async ({ page }) => {
  test.setTimeout(75_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 30_000 });

  const map = page.locator(".maplibreMap");
  let settledFrame: Buffer | null = null;

  // Tile arrival is network-dependent even after MapLibre removes its loading
  // chrome. Wait for one genuinely stable visual interval instead of sampling a
  // still-loading basemap at a fixed wall-clock delay. This does not mask any
  // pixels or relax the 2% contract: the complete rendered map must settle.
  await expect
    .poll(
      async () => {
        const first = await map.screenshot();
        await page.waitForTimeout(500);
        const second = await map.screenshot();
        const ratio = await changedPixelRatio(first, second);
        if (ratio < 0.02) settledFrame = second;
        return ratio;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBeLessThan(0.02);

  // Once settled, reduced-motion mode must remain stable across a longer
  // untouched interval while allowing finite tile loading to complete.
  await page.waitForTimeout(1_200);
  const finalFrame = await map.screenshot();
  expect(await changedPixelRatio(settledFrame!, finalFrame)).toBeLessThan(0.02);
});

test("/map reveals pins only for the final rapid theme style generation", async ({ page }) => {
  test.setTimeout(60_000);
  const sourcesErrors: string[] = [];
  const recordSourcesError = (text: string) => {
    if (/Cannot read properties of undefined.*sources/i.test(text)) {
      sourcesErrors.push(text);
    }
  };
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      recordSourcesError(message.text());
    }
  });
  page.on("pageerror", (error) => recordSourcesError(error.message));
  await installDeterministicMapBasemap(page, { styleDelayMs: 150 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  const readTrace = () => page.evaluate(() => (
    window as typeof window & {
      __pubmaxPinRevealTrace: Array<{ reason: string; generation: number }>;
    }
  ).__pubmaxPinRevealTrace);
  await expect.poll(async () => (await readTrace()).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const initialGeneration = (await readTrace()).at(-1)!.generation;

  await page.evaluate(async () => {
    const root = document.documentElement;
    const initial = root.dataset.theme === "dark" ? "dark" : "light";
    const alternate = initial === "dark" ? "light" : "dark";
    for (const theme of [alternate, initial, alternate]) {
      root.dataset.theme = theme;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });

  await expect.poll(async () => (
    await readTrace()
  ).filter(({ generation }) => generation > initialGeneration).length, { timeout: 25_000 }).toBe(1);
  await page.waitForTimeout(500);
  expect((await readTrace()).filter(({ generation }) => generation > initialGeneration)).toHaveLength(1);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  expect(
    sourcesErrors,
    `Rapid style replacement raised the historical sources exception:\n${sourcesErrors.join("\n")}`,
  ).toEqual([]);
});

// Phone readiness-ceiling contract when the BASEMAP is the signal that missed.
// The ceiling never unmounts the canvas: the 3s fallback has already un-gated
// the pin layers on the live style, so tearing it down here would replace pubs
// that were about to paint with a "Map couldn't draw" card. What the reader
// gets instead is the pins plus ONE toast that names the background.
test("/map keeps its pins and names the basemap when tiles miss the phone readiness ceiling", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });
  let holdTiles = true;
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    // Hold every vector tile until THIS SPEC releases it, not for a fixed
    // window: once tiles land, `markBasemapRecovered` retires the timeout-owned
    // notice, so a wall-clock hold would race its own assertions off the
    // screen. Browser contexts are fresh and service workers are blocked for
    // this project, so the timeout path cannot be defeated by cache timing.
    while (holdTiles) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  const trace = () => page.evaluate(() => (
    window as typeof window & {
      __pubmaxPinRevealTrace: Array<{ reason: string; generation: number }>;
    }
  ).__pubmaxPinRevealTrace);

  // The ceiling reveals rather than reporting a dead map.
  await expect
    .poll(async () => (await trace()).at(-1)?.reason ?? null, { timeout: 25_000 })
    .toBe("timeout");
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible();
  await expect(page.locator(".mapLoading")).toHaveCount(0);

  // The background is what never painted, so the background is what the toast
  // names — and it is the only toast on the surface.
  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toHaveAttribute("data-kind", "tiles");
  await expect(notice).toContainText("Map background couldn't load");
  await expect(page.locator(".ukPlaceArrival")).toHaveCount(0);

  const retry = notice.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible();
  const [retryBox, tabBarBox] = await Promise.all([
    retry.boundingBox(),
    page.locator(".mobileTabBar").boundingBox(),
  ]);
  expect(retryBox).not.toBeNull();
  expect(tabBarBox).not.toBeNull();
  // The phone tap floor is 44px and this is a recovery button, so it is the
  // last control that may fall under it.
  expect(retryBox!.height).toBeGreaterThanOrEqual(44);
  expect(retryBox!.y + retryBox!.height).toBeLessThanOrEqual(tabBarBox!.y);
  // One toast owns the surface: the first-visit arrival card is 256px of opaque
  // panel over this exact band and stands down while a failure is on screen.
  await expect(page.locator(".mapArrivalCard")).toHaveCount(0);

  // A dead background is worth a full re-init, and the recovered map settles on
  // a real painted reveal.
  holdTiles = false;
  await retry.click();
  await expect
    .poll(async () => (await trace()).at(-1)?.reason, { timeout: 25_000 })
    .toMatch(/^(tiles|idle)$/);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map keeps the honest retry visible while basemap tiles keep failing", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/\.pbf(?:\?|$)/, (route) => route.abort("failed"));

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000);
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map surfaces a concurrent post-paint tile outage despite one successful tile", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });
  let failTiles = false;
  let outageRequests = 0;
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    if (!failTiles) {
      await route.continue();
      return;
    }
    outageRequests += 1;
    const requestNumber = outageRequests;
    await new Promise((resolve) =>
      setTimeout(resolve, requestNumber === 5 ? 1_250 : 1_000),
    );
    if (requestNumber === 5) {
      await route.continue();
      return;
    }
    await route.abort("failed");
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace: Array<{
                  reason: string;
                  generation: number;
                }>;
              }
            ).__pubmaxPinRevealTrace.at(-1)?.reason ?? null,
        ),
      { timeout: 30_000 },
    )
    .toMatch(/^(tiles|idle)$/);

  failTiles = true;
  // Mobile CSS deliberately hides MapLibre's built-in control group. Invoke
  // its real button handler in place so this outage test can force fresh tile
  // requests without weakening the phone chrome contract.
  await zoomThroughHiddenMobileControl(page);
  await expect.poll(() => outageRequests).toBeGreaterThanOrEqual(5);

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 20_000,
  });
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map surfaces Retry when the automatic style reload also fails", async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push(
        (event as CustomEvent<{ reason: string; generation: number }>).detail,
      );
    });
  });
  let failTiles = false;
  let failStyles = false;
  await page.route(
    /tiles\.openfreemap\.org\/styles\/|basemaps\.cartocdn\.com\/gl\/.*\/style\.json/,
    async (route) => {
      if (failStyles) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    },
  );
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    if (!failTiles) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.abort("failed");
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace: Array<{
                  reason: string;
                  generation: number;
                }>;
              }
            ).__pubmaxPinRevealTrace.at(-1)?.reason ?? null,
        ),
      { timeout: 30_000 },
    )
    .toMatch(/^(tiles|idle)$/);

  failTiles = true;
  failStyles = true;
  await zoomThroughHiddenMobileControl(page);

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 30_000,
  });
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

// Acceptance criterion 2 (v0 map reliability), half one: lib/mapTileFailure.ts
// owns ONE bounded style reload, and this is the caller-level proof that
// `evaluateTileFailure` in PubMapCanvas issues exactly one style request on a
// real tile-source failure and then stops, however long the source keeps
// failing. WHICH surface it settles on is `surfaceBasemapFailure`'s own
// decision and it turns on one thing: whether anything ever drew. Here the
// basemap painted first, so replacing a working map with the full card would
// be the silent-grey defect in reverse - the toast is the honest surface. The
// card lane of the same function is proven by the spec below it, where the
// style never loads and no frame ever lands.
test("/map spends exactly one style reload on a tile-source failure, then surfaces the honest retry", async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 390, height: 844 });
  let styleRequests = 0;
  await page.route(
    /tiles\.openfreemap\.org\/styles\/|basemaps\.cartocdn\.com\/gl\/.*\/style\.json/,
    async (route) => {
      styleRequests += 1;
      await route.continue();
    },
  );
  let failTiles = false;
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    if (!failTiles) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.abort("failed");
  });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push(
        (event as CustomEvent<{ reason: string; generation: number }>).detail,
      );
    });
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace: Array<{
                  reason: string;
                  generation: number;
                }>;
              }
            ).__pubmaxPinRevealTrace.at(-1)?.reason ?? null,
        ),
      { timeout: 30_000 },
    )
    .toMatch(/^(tiles|idle)$/);

  const styleRequestsBeforeOutage = styleRequests;
  failTiles = true;
  await zoomThroughHiddenMobileControl(page);

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 30_000,
  });
  await expect(notice).toHaveAttribute("data-kind", "tiles");
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(
    styleRequests - styleRequestsBeforeOutage,
    "the tile-failure lane must spend its one bounded style reload",
  ).toBe(1);

  // Keep failing. No second retry loop is ever invented.
  await page.waitForTimeout(8_000);
  expect(
    styleRequests - styleRequestsBeforeOutage,
    "a spent retry stays spent while the source keeps failing",
  ).toBe(1);
  await expect(notice).toBeVisible();
});

// Acceptance criterion 2, half two: ONE bounded style reload, THEN the honest
// error card. Both basemap style URLs are refused, so nothing ever draws: the
// primary style is requested, the bounded protection spends its single reload
// onto the fallback style, that refuses too, and only then does
// `surfaceBasemapFailure` report the `kind: "tiles"` card. Never a third style
// request, and never an unmounted canvas on a map that IS drawing - which is
// why `surfaceBasemapFailure` still prefers the soft toast once a style has
// loaded (the spec above it holds that half). A MapLibre render event is
// not a loaded style.
test("/map spends its one bounded style reload, then surfaces the honest tile card", async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const styleRequests: string[] = [];
  await page.route(
    /tiles\.openfreemap\.org\/styles\/|basemaps\.cartocdn\.com\/gl\/.*\/style\.json/,
    async (route) => {
      styleRequests.push(route.request().url());
      await route.abort("failed");
    },
  );

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });

  // The reload is spent BEFORE anything is claimed: primary, then exactly one
  // fallback, and the two are different styles rather than the same one twice.
  await expect.poll(() => styleRequests.length, { timeout: 40_000 }).toBe(2);
  expect(styleRequests[0]).not.toBe(styleRequests[1]);
  await expect(page.locator(".mapFallback")).toHaveCount(0);

  const fallback = page.locator(".mapFallback");
  await expect(fallback).toBeVisible({ timeout: 40_000 });
  await expect(fallback).toContainText("Map tiles unavailable");
  await expect(fallback).toContainText("The map couldn't load its tiles right now.");
  // SETTLED, not transient. Nothing drew, so the 10s first-frame watchdog lapses
  // too - and it must not overwrite this diagnosis with "this browser cannot
  // show the map", which blames the device for a server that refused.
  await page.waitForTimeout(8_000);
  await expect(fallback).toContainText("Map tiles unavailable");
  await expect(fallback).not.toContainText("did not draw anything");
  // Retryable: a re-init can reach a source that has come back.
  await expect(page.locator(".mapFallbackRetry")).toBeVisible();
  // The map going dark never takes the venue content with it.
  await expect(page.locator(".mapFallbackBrowse")).toBeVisible();
  await expect
    .poll(async () => page.locator(".mapFallbackVenue").count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // No second retry loop: the spent reload stays spent while the source keeps
  // refusing, and one surface owns the failure.
  expect(styleRequests).toHaveLength(2);
  await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
});

test("/map states a TileJSON metadata failure instead of revealing a blank field", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    /tiles\.openfreemap\.org\/planet(?:\?|$)/,
    (route) => route.abort("failed"),
  );

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000);
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

// Dead-frame-loop contract. A browser can grant WebGL while its render loop
// never produces a frame at all. Stubbing rAF keeps every MapLibre "render"
// event from firing, so the 10-second first-frame watchdog — not the pin
// readiness ceiling, which never unmounts anything — owns the honest, readable
// no-frame fallback.
test("/map shows a readable fallback when the phone render loop never draws a frame", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Frame loop never runs: rAF registers callbacks but never invokes them.
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
  });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The map constructs (context granted) — the canvas exists…
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });

  // No frame ever renders, so the first-frame watchdog must surface the honest
  // fallback (10s watchdog + render slack) and keep it: the later pin readiness
  // ceiling has no card of its own to overwrite this one with.
  const fallback = page.locator(".mapFallback");
  await expect(fallback).toBeVisible({ timeout: 25_000 });
  await expect(fallback).toContainText("Map couldn't draw");
  await expect(fallback).toContainText("The map opened but did not draw anything.");
  await page.waitForTimeout(6_000);
  await expect(fallback).toContainText("The map opened but did not draw anything.");
  await expect(page.locator(".mapSoftRetry")).toHaveCount(0);
  await expect(fallback.getByRole("button", { name: "Technical details" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // A dead frame loop is retryable (a re-init can recover a crashed GPU
  // process), so Retry stays visible — unlike the confirmed-no-WebGL case.
  await expect(page.locator(".mapFallbackRetry")).toBeVisible();

  // Venue content survives: static list rows + the directory link.
  await expect(page.locator(".mapFallbackBrowse")).toBeVisible();
  await expect
    .poll(async () => page.locator(".mapFallbackVenue").count(), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const fallbackBackground = rgbChannels(
    await fallback.evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  for (const [label, control] of [
    ["heading", fallback.locator("strong")],
    ["explanation", fallback.locator("p")],
    ["venue", fallback.locator(".mapFallbackVenueName").first()],
    ["Browse link", fallback.locator(".mapFallbackBrowse")],
    ["Retry", fallback.locator(".mapFallbackRetry")],
  ] as const) {
    const foreground = rgbChannels(
      await control.evaluate((node) => getComputedStyle(node).color),
    );
    expect(
      contrastRatio(foreground, fallbackBackground),
      `${label} contrast against fallback surface`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("/map reuses granted location after an explicit Near me action", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.513, longitude: -0.125 });
  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Near me" }).click();
  await expect(page.getByRole("button", { name: "Nearby" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-user-location='shown']")).toBeAttached({ timeout: 20_000 });
});

test("/map keeps Manchester cluster markers mounted after granted location settles", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 53.4808, longitude: -2.2426 });

  // Load Manchester with permission already granted, then invoke the attached
  // control directly. Banner staging may hide it, but HTMLElement.click still
  // exercises the same checkNearby/onLocationFound path as a painted control.
  await page.goto("/map/manchester");
  const nearMe = page.locator("button.citySuggestBannerSwitch");
  await expect(nearMe).toBeAttached({ timeout: 20_000 });
  await expect(nearMe).toBeEnabled({ timeout: 20_000 });
  await nearMe.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("[data-user-location='shown']")).toBeAttached({
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000);
  const showAll = page.getByRole("button", {
    name: "Show all of Manchester",
  });
  await expect(showAll).toBeVisible({ timeout: 20_000 });
  await showAll.click();

  const donuts = page.locator(".donut-cluster-marker");
  // fitCityBounds runs an 800 ms cinematic. Let that intentional transition
  // finish, then require a stable non-empty cluster count before observing for
  // the ongoing empty/non-empty loop this regression targets.
  await page.waitForTimeout(1_000);
  await expect
    .poll(
      async () => {
        const counts = [await donuts.count()];
        for (let sample = 0; sample < 4; sample += 1) {
          await page.waitForTimeout(150);
          counts.push(await donuts.count());
        }
        return counts[0] > 0 && counts.every((count) => count === counts[0]);
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Once the city camera has settled, transient source snapshots must not
  // unmount every donut and hand the same clusters back to the GL fallback.
  // That DOM-empty/GL-visible alternation is the reported desktop flicker.
  const counts: number[] = [];
  for (let sample = 0; sample < 30; sample += 1) {
    counts.push(await donuts.count());
    await page.waitForTimeout(75);
  }
  expect(counts, `cluster marker counts after settle: ${counts.join(",")}`).not.toContain(0);
});

// Issue #35 — optimistic-pins perf guard. The map paints pins from the ~116 KB
// slim index BEFORE the ~5.6 MB full dataset lands; PubMap drops a
// `pubmax:first-pins` performance.mark the instant those slim pins are set.
// Asserting the mark exists and fires early is a WebGL-flake-free proxy for
// "first interactive pin is fast" (the PRD's map-click → first pin target),
// since it measures the data path, not the GPU. Threshold is a generous CI
// ceiling (4s) well under the old full-dataset-only path.
test("/map paints optimistic pins from the slim index quickly", async ({ page }) => {
  test.setTimeout(60_000);
  const fullDatasetRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/data/pint_prices_app_dataset.json") {
      fullDatasetRequests.push(request.url());
    }
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // Wait until PubMap has set its first-pins mark. It's dropped in a client
  // effect after loadSlimVenues() resolves, so poll the Performance timeline.
  await expect
    .poll(
      () =>
        page.evaluate(() => performance.getEntriesByName("pubmax:first-pins")[0]?.startTime ?? 0),
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);

  const startTime = await page.evaluate(() => {
    const [mark] = performance.getEntriesByName("pubmax:first-pins");
    return mark ? mark.startTime : Number.POSITIVE_INFINITY;
  });

  // startTime is ms since navigation start — the time to the first optimistic
  // pin paint. The network assertion below is the hard regression guard against
  // reintroducing the full-dataset path; this ceiling stays CI-safe under
  // SwiftShader and a cold production server.
  expect(startTime).toBeLessThan(10000);
  expect(fullDatasetRequests).toEqual([]);
});

test("desktop area search resolves a gazetteer locality and fits the map", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents = [];
    window.addEventListener("pubmax:camera-intent", (event) => {
      const detail = (event as CustomEvent<{ kind: string; sequence: number }>).detail;
      (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents?.push(detail);
    });
  });
  await page.route("**/data/london_localities.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        localities: [
          { name: "Willesden", lat: 51.549, lng: -0.229, borough: "Brent" },
        ],
      }),
    }),
  );
  await page.route("**/api/area-news**", (route) => {
    const area = new URL(route.request().url()).searchParams.get("area");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: area === "brent"
          ? [{
              id: "brent-search-context",
              kind: "opening",
              title: "Brent search context",
              sourceUrl: "https://example.com/brent",
              sourceName: "Example Times",
              observedAt: "2026-07-23T18:00:00.000Z",
            }]
          : [],
      }),
    });
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });

  const search = page.locator("#mapSearchInput");
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.fill("Willesden");

  const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  await expect(listbox).toBeVisible();
  const willesden = listbox.getByRole("option", { name: /Willesden.*Brent/i });
  await expect(willesden).toBeVisible();
  await expect(willesden).toContainText(/from centre/i);
  await expect(willesden.locator(".mapSearchSuggestCoverage")).toHaveCount(0);

  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(listbox).toHaveCount(0);

  await expect.poll(async () => page.evaluate(() => (
    window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }
  ).__cameraIntents?.filter((intent) => intent.kind === "area").length ?? 0)).toBe(1);

  await expect.poll(async () => page.evaluate(() => {
    const raw = window.localStorage.getItem("pubmaxx.mobile-map-session.v1");
    if (!raw) return null;
    const session = JSON.parse(raw) as { viewport?: { center?: [number, number]; zoom?: number } };
    return session.viewport ?? null;
  }), { timeout: 10_000 }).toMatchObject({
    center: [expect.closeTo(-0.229, 2), expect.closeTo(51.549, 2)],
    zoom: expect.closeTo(14.5, 1),
  });

  await expect(page.locator(".desktopRail.mapRail")).toContainText("Brent search context");
  await expect(page.locator(".mapDrawer.right.open")).toHaveCount(0);
});

test("/map lazy-loads full venue detail only when a pub is selected", async ({ page }) => {
  test.setTimeout(30_000);
  const fullDatasetRequests: string[] = [];
  const venueDetailRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/data/pint_prices_app_dataset.json") {
      fullDatasetRequests.push(request.url());
    }
    if (path.startsWith("/api/venue/")) {
      venueDetailRequests.push(request.url());
    }
  });

  const selectedVenueId = "venue-16pnwmm";
  const response = await page.goto(`/map?sel=${selectedVenueId}`);
  expect(response?.status()).toBe(200);

  await expect
    .poll(
      () =>
        page.evaluate(() => performance.getEntriesByName("pubmax:first-pins")[0]?.startTime ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  await expect(page.getByRole("heading", { name: /Prospect of Whitby/i })).toBeVisible();
  await expect
    .poll(() => venueDetailRequests.filter((url) => url.includes(selectedVenueId)).length)
    .toBeGreaterThan(0);
  expect(fullDatasetRequests).toEqual([]);
});
