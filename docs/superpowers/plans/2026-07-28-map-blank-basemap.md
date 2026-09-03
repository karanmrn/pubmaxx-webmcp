# Blank Basemap Recovery and Fast Arrival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve successful OpenFreeMap responses when browser cache writes fail, expose an honest retry when basemap tiles never settle, and remove deferred MapLibre download from warm in-app Map taps.

**Architecture:** Keep OpenFreeMap and existing service-worker scope. Split network response delivery from best-effort Cache Storage writes so storage pressure cannot turn HTTP 200 tiles into `ERR_FAILED`. Reuse `PubMapCanvas` soft-retry UI when pin reveal reaches its tile ceiling, and preload the existing dynamically split canvas chunk only on normal connections from existing map-intent warmup.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MapLibre GL 5, service workers, Vitest, Playwright, Chrome DevTools Protocol.

## Global Constraints

- OpenFreeMap stays. No provider, API key, or paid tile plan change.
- Do not decompose `components/PubMap.tsx`.
- Keep MapLibre in its dynamically split chunk.
- Honour `Save-Data`, `2g`, `slow-2g`, and `prefers-reduced-motion`.
- Preserve current service-worker scope and offline capability.
- Add no em dash to source or copy.
- Verify at 390 by 844 and report cold plus Today, Tonight, Stories, and You arrival medians.

---

### Task 1: Lock down successful network responses under cache-write failure

**Files:**
- Create: `__tests__/serviceWorkerCache.test.ts`
- Create: `e2e/map-service-worker.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `public/sw.js`

**Interfaces:**
- Consumes: shipped `fetch` event listener and `staleWhileRevalidate(event, request)`.
- Produces: best-effort cache writes that can fail without changing the fetched `Response`.

- [x] **Step 1: Write failing service-worker regression test**

Build a worker harness from the real `public/sw.js`, with `fetch()` resolving a CORS HTTP 200 tile response and `cache.put()` rejecting with `QuotaExceededError`. Dispatch a GET for `https://tiles.openfreemap.org/planet/revision/11/1023/680.pbf`.

```ts
expect(await responsePromise).toBe(networkResponse);
expect(cache.put).toHaveBeenCalledOnce();
```

Also assert cross-origin OpenFreeMap requests are intercepted, opaque responses pass through without cache writes, and a true network rejection still returns an error response.

Add a service-worker-enabled SwiftShader Playwright project and exact 390 by 844 regression: activate the pre-fix worker, install a second pre-fix worker until it waits, poison the active cache, then cap origin quota at current usage plus one byte. Assert the pre-fix controller converts a direct-provider HTTP 200 into `ERR_FAILED`, install the target worker, verify immediate takeover and superseded-cache removal, reload once, and require a real `tiles` reveal.

- [x] **Step 2: Run test and verify red**

Run:

```bash
npm test -- __tests__/serviceWorkerCache.test.ts
PW_SKIP_WEBSERVER=1 PW_PORT=3217 npx playwright test e2e/map-service-worker.spec.ts --project=chromium-sw-gl
```

Expected: unit test receives `Response.error()`. Browser test reproduces flat field and times out because worker changes valid tile responses into `ERR_FAILED`.

- [x] **Step 3: Separate network response from best-effort cache write**

Change `staleWhileRevalidate` so one promise owns network response and a separate caught promise owns `cache.put()` plus `trimCache()`. Return network response as soon as fetch resolves.

```js
const network = fetch(request).catch(() => undefined);
const update = network.then(async (response) => {
  if (!isCacheable(response)) return;
  try {
    await cache.put(request, response.clone());
    await trimCache(SWR_CACHE, MAX_SWR_ENTRIES);
  } catch {
    // Cache Storage is progressive enhancement.
  }
});
```

Apply same non-poisoning rule to data-cache writes whose current `cache.put()` rejection can turn valid JSON into a 503 fallback.

- [x] **Step 4: Run focused tests and verify green**

Run:

```bash
npm test -- __tests__/serviceWorkerCache.test.ts __tests__/serviceWorkerPush.test.ts __tests__/offlineCache.test.ts
PW_SKIP_WEBSERVER=1 PW_PORT=3218 npx playwright test e2e/map-service-worker.spec.ts --project=chromium-sw-gl
```

Expected: all pass.

### Task 2: Make tile-ceiling state honest and retryable

**Files:**
- Modify: `components/PubMapCanvas.tsx`
- Modify: `components/map/canvas/pinRevealCoordinator.ts`
- Modify: `lib/mapTileFailure.ts`
- Modify: `__tests__/mapTileFailure.test.ts`
- Modify: `__tests__/pinRevealCoordinator.test.ts`
- Modify: `e2e/map-gl.spec.ts`

**Interfaces:**
- Consumes: `PinRevealReason = "tiles" | "idle" | "timeout"` from `createPinRevealCoordinator`.
- Produces: existing `.mapSoftRetry` notice and Retry action for a timeout reveal, cleared when basemap sources later settle.

- [x] **Step 1: Write failing regression coverage**

Cover all failure signals: concentrated initial tile failures, a single initial
TileJSON metadata failure, and the pin-reveal ceiling. Assert each resolves to
existing soft-retry copy:

```ts
await expect(page.locator(".mapSoftRetry")).toContainText(
  "Map background couldn't load",
);
await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
```

The existing Retry action reinitialises the map. Cover its browser path with
delayed vector tiles: reach timeout, remove the delay, tap Retry, and require a
real tile reveal.

- [x] **Step 2: Run tests and verify red**

Run:

```bash
npm test -- __tests__/mapTileFailure.test.ts __tests__/pinRevealCoordinator.test.ts
```

Expected: initial failures are still treated as transient and timeout reveal
does not own an honest retry state.

- [x] **Step 3: Surface timeout and clear it on recovery**

Extract the current inline basemap-source readiness predicate into a local `areBasemapTilesLoaded()` function. When `onReveal` receives `timeout`, set:

```ts
setSoftRetry({
  kind: "tiles",
  message: "Map background couldn't load. Tap Retry to try again.",
});
```

Keep lightweight `render` and `idle` recovery listeners. If the basemap later
becomes ready, clear only the tile-owned notice, end initial-load classification,
and re-enable later failure handling without refunding the spent retry. Existing
Retry continues to increment `initAttempt` and fully reconstruct the map.

- [x] **Step 4: Run focused tests**

Run:

```bash
npm test -- __tests__/pinRevealCoordinator.test.ts __tests__/mapTileFailure.test.ts
PW_SKIP_WEBSERVER=1 PW_PORT=3218 npx playwright test e2e/map-gl.spec.ts --project=chromium-gl
```

Expected: all pass, failed basemap is stated, and successful recovery clears
only the tile-owned notice.

### Task 3: Warm deferred MapLibre chunk before in-app Map taps

**Files:**
- Modify: `lib/mapWarmup.ts`
- Modify: `__tests__/mapWarmup.test.ts`
- Modify: `__tests__/maplibreCodeSplit.test.ts`

**Interfaces:**
- Consumes: existing `shouldWarmMapIntent`, `warmNavRoute`, and `warmPrimaryTabRoutes`.
- Produces: session-deduped idle preload of `import("@/components/PubMapCanvas")` for map destinations.

- [x] **Step 1: Write failing warmup tests**

Add injectable scheduler and loader coverage showing:

```ts
scheduleMapCanvasWarmup({
  navigator: { connection: { effectiveType: "4g", saveData: false } },
  schedule,
  load,
  state: { status: "idle" },
});
expect(schedule).toHaveBeenCalledOnce();
```

Assert `Save-Data`, `2g`, and `slow-2g` do not schedule the 1.1 MB decoded canvas chunk. Assert successful warmup dedupes and rejected load can retry. Assert `warmNavRoute` requests canvas warmup only for `/map` and `/map/{city}`.

- [x] **Step 2: Run test and verify red**

Run:

```bash
npm test -- __tests__/mapWarmup.test.ts __tests__/maplibreCodeSplit.test.ts
```

Expected: canvas preload interface does not exist.

- [x] **Step 3: Implement guarded idle preload**

Add `scheduleMapCanvasWarmup` with injectable dependencies for tests and a production wrapper that uses `requestIdleCallback` with a bounded timeout, falling back to `setTimeout`. Loader is the existing dynamic module:

```ts
() => import("@/components/PubMapCanvas")
```

Call it from the map branch of `warmNavRoute` after route and slim-data warmup. Keep dynamic import in `PubMap.tsx`, preserving cold-route split and loading skeleton.

- [x] **Step 4: Run focused tests and verify green**

Run:

```bash
npm test -- __tests__/mapWarmup.test.ts __tests__/maplibreCodeSplit.test.ts
```

Expected: all pass.

### Task 4: Re-run exact reproduction, performance measurements, and full gate

**Files:**
- Create: `docs/evidence/map-blank-basemap/README.md`
- Create: `docs/evidence/map-blank-basemap/before-reproduced-390.png`
- Create: `docs/evidence/map-blank-basemap/after-quota-update-390.png`

**Interfaces:**
- Consumes: quota-limited active-worker plus waiting-update browser reproduction and `pubmax:pin-reveal`.
- Produces: PR-ready evidence, timings, root-cause note, and green repository gate.

- [x] **Step 1: Build fixed production bundle in isolated dist directory**

Run:

```bash
NEXT_DIST_DIR=.next-map-blank-fixed npm run build
NEXT_DIST_DIR=.next-map-blank-fixed npm run start -- --port 3218
```

- [x] **Step 2: Verify exact service-worker reproduction is green**

Repeat the 390 by 844 active-pre-fix plus waiting-pre-fix flow under the quota cap. Assert the direct tile request is HTTP 200 while the active worker reproduces `ERR_FAILED`, then assert the target worker activates, claims the page, purges old OpenFreeMap entries, preserves valid offline fallbacks, and reaches a real `tiles` reveal after the one required reload.

- [x] **Step 3: Capture before and after screenshots**

Use Playwright at 390 by 844 for deterministic file capture. Before frame is reproduced flat cream field. After frame uses same quota/update state and shows roads, Thames, parks, labels, and map overlays.

- [x] **Step 4: Repeat timing matrix**

Under 390 by 844, Slow 4G, and 4 times CPU, take three samples each. Report median `pubmax:pin-reveal` after navigation start for cold `/map`, and after Map tap from `/today`, `/tonight`, `/feed`, and `/u/you`.

- [x] **Step 5: Run repository verification**

Run:

```bash
npm run verify
```

Expected: validate-data, lint, typecheck, coverage, and resilient audit pass.

- [x] **Step 6: Restore build-only churn and review diff**

Restore any build rewrite to `next-env.d.ts`, `tsconfig.json`, or `package.json`. Read `verification-before-completion`, `check-work`, `code-review`, and `review` skills, then inspect complete diff and rerun relevant tests.

- [x] **Step 7: Commit**

```bash
git add public/sw.js app/globals.css components/PubMapCanvas.tsx components/map/canvas/pinRevealCoordinator.ts lib/mapTileFailure.ts lib/mapWarmup.ts playwright.config.ts e2e/map-gl.spec.ts e2e/map-service-worker.spec.ts __tests__/serviceWorkerCache.test.ts __tests__/mapTileFailure.test.ts __tests__/pinRevealCoordinator.test.ts __tests__/mapWarmup.test.ts __tests__/mobileChromeFit.test.ts docs/evidence/map-blank-basemap docs/superpowers/plans/2026-07-28-map-blank-basemap.md
git commit -m "fix(map): keep basemap available under storage pressure"
```
