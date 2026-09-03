import { test, expect, type ConsoleMessage } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// Map console-health regression (review issue #5). Runs under the `chromium-gl`
// project (SwiftShader software WebGL2) so a real GL context exists and the map
// genuinely constructs — the only condition under which the style-load /
// layer-mutation races this guards against can actually fire. It complements
// map-gl.spec.ts (which asserts the canvas paints): this one asserts the SCENE
// stays healthy across repeated /map↔/feed navigation, failing on any critical
// console error or pageerror.
//
// The specific regressions it guards:
//   • "Style is not done loading" — a source/layer mutation (setData/setFilter/
//     setPaintProperty/addLayer) landing while a style is mid-load (initial load
//     or a theme setStyle({diff:false}) swap window).
//   • "Maximum call stack size exceeded" — pathological re-entrancy on repeated
//     mount/unmount of the map component across navigation.
//
// Benign console noise is allow-listed EXPLICITLY (not suppressed wholesale) so a
// genuinely new error still fails the test:
//   • tile/network fetch aborts — MapLibre aborts in-flight tile requests when
//     the component unmounts on navigation; these surface as failed/aborted
//     fetches and are expected churn, not a scene fault.
//   • favicon 404s — unrelated to the map.
// PubMap diagnostics are never allow-listed: each current message describes a
// recovery or failure and must remain visible to this gate.
//
// Expected navigation/tile churn only. `[pubmap]` diagnostics are deliberately
// NOT benign: every current diagnostic reports a renderer recovery or failure,
// so allowing the prefix would hide the exact production reload warning.
const BENIGN_PATTERNS: RegExp[] = [
  /^Service Worker registration blocked by Playwright$/i,
  /^\[\.WebGL-.*GPU stall due to ReadPixels/i,
  /favicon/i, // /favicon.ico 404s, unrelated to the map
  /Failed to load resource/i, // aborted tile/style fetches on unmount navigation
  /net::ERR_ABORTED/i, // MapLibre aborting in-flight tile requests on teardown
  /Failed to fetch/i, // glyph/font AJAX aborts in headless (Noto Sans pbf)
  /Unable to load glyph range/i, // MapLibre falls back to local codepoints
  /Rendering codepoint .* locally instead/i,
  /the server responded with a status of 404/i, // tile/sprite 404 on style fallback
  /AbortError/i, // fetch abort on navigation teardown
  // Pre-existing basemap/style evaluation noise observed on main WITHOUT the
  // L18 icon-size fix (still fires 2×/load with the old nested-zoom expression).
  // Not the named production warning (`zoom` may only be top-level input /
  // pubs-point icon-size) which CRITICAL_PATTERNS still fail on.
  /^Expected value to be of type number, but found null instead\.?$/i,
  // Vercel Web Analytics (app/layout.tsx <Analytics />, R3) requests
  // /_vercel/insights/script.js, which only exists on Vercel — `next start`
  // serves the 404 HTML page and Chromium logs a strict-MIME refusal. Pure
  // local-serve noise, unrelated to the map scene this spec guards.
  /_vercel\/insights/i,
  /was preloaded using link preload but not used/i,
];

// Errors we must NEVER tolerate regardless of the allow-list above.
// L18 named production warnings live here so they cannot be allow-listed away.
const CRITICAL_PATTERNS: RegExp[] = [
  /Style is not done loading/i,
  /Maximum call stack size exceeded/i,
  /tile failure burst, reloading style/i,
  /pubs-point.*icon-size/i,
  /icon-size.*zoom/i,
  /"zoom" expression may only be used as input to a top-level/i,
  /Cannot read properties of undefined.*sources/i,
];

function isCritical(text: string): boolean {
  if (CRITICAL_PATTERNS.some((re) => re.test(text))) return true;
  return !BENIGN_PATTERNS.some((re) => re.test(text));
}

test("/map stays console-healthy across repeated /map↔/feed navigation", async ({
  page,
}) => {
  // Two full round-trips plus tile settling exceeds the 30s project default.
  test.setTimeout(150_000);

  const critical: string[] = [];
  const primaryStyleRequests: string[] = [];
  const fallbackStyleRequests: string[] = [];
  const record = (text: string) => {
    if (isCritical(text)) critical.push(text);
  };

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.type() === "warning") record(msg.text());
  });
  page.on("pageerror", (err) => record(err.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === "https://tiles.openfreemap.org" &&
      /^\/styles\/(?:dark|positron)\/?$/.test(url.pathname)
    ) {
      primaryStyleRequests.push(request.url());
    }
    if (
      url.origin === "https://basemaps.cartocdn.com" &&
      /^\/gl\/(?:dark-matter|positron)-gl-style\/style\.json$/.test(url.pathname)
    ) {
      fallbackStyleRequests.push(request.url());
    }
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);

  // Initial load: the map must construct and paint a real canvas.
  const first = await page.goto("/map");
  expect(first?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // Let the style settle (buildScene runs on style.load) so a mutation racing
  // the initial load would already have thrown by now.
  await page.waitForTimeout(2_000);

  const builtInCompass = page.locator(".maplibregl-ctrl-compass");
  await expect(builtInCompass).toHaveCount(1);
  await expect(page.locator(".mapCompassBtn")).toHaveCount(0);
  const compassNeedle = builtInCompass.locator(".maplibregl-ctrl-icon");
  const bearingBeforeIdle = await compassNeedle.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await page.waitForTimeout(7_500);
  const bearingAfterIdle = await compassNeedle.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(
    bearingAfterIdle,
    "interactive map bearing must stay still without a gesture",
  ).toBe(bearingBeforeIdle);

  // Exercise the normal theme path in both directions. Page errors are
  // recorded above, so the historical MapLibre `sources` exception fails this
  // test even when the canvas remains superficially usable.
  for (let index = 0; index < 2; index += 1) {
    const themeToggle = page.locator(".themeToggle:visible").first();
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();
    await expect(page.locator(".maplibreMap canvas").first()).toBeVisible();
    await page.waitForTimeout(2_000);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(builtInCompass).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeHidden();
  await expect(page.locator(".maplibregl-ctrl-zoom-out")).toBeHidden();

  // Two full round-trips. Each remount reconstructs the map and re-runs the
  // style-load → buildScene path; the unmount aborts tiles and tears down
  // listeners. This is the churn that surfaces both target regressions.
  for (let i = 0; i < 2; i++) {
    const feed = await page.goto("/feed");
    expect(feed?.status()).toBe(200);
    await page.waitForTimeout(1_000);

    const map = await page.goto("/map");
    expect(map?.status()).toBe(200);
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
      timeout: 20_000,
    });
    // Give buildScene + any queued post-build mutations time to flush.
    await page.waitForTimeout(2_000);
  }

  // The map must still be up and no critical error may have surfaced.
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);

  expect(
    critical,
    `Critical map console errors:\n${critical.join("\n")}`,
  ).toEqual([]);

  // Three map mounts plus the two deliberate theme replacements may each fetch
  // the primary style once. More means recovery churn replaced a healthy style.
  expect(primaryStyleRequests.length).toBeGreaterThan(0);
  expect(
    primaryStyleRequests.length,
    `Primary style entrypoint fetched too often:\n${primaryStyleRequests.join("\n")}`,
  ).toBeLessThanOrEqual(5);
  expect(
    fallbackStyleRequests.length,
    `Fallback style entrypoint fetched too often:\n${fallbackStyleRequests.join("\n")}`,
  ).toBeLessThanOrEqual(5);
});
