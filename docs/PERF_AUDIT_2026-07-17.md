# Mobile map performance audit — 2026-07-17

Branch: `perf/mobile-map-budget`

## Mission / budget

The mobile map loop must feel app-like:

- **LCP < 2.5s** on mid-tier 4G at 390×844
- Instant back-nav
- No jank on sheet drag

## Method

- Production build served locally: `NEXT_DIST_DIR=.next-prod npm run build && npm run start`.
- Lighthouse is not installed in this environment, so measurement is a
  Playwright/Chromium harness driving a real production server with Chrome
  DevTools throttling: **mid-tier 4G** (≈9 Mbit down, 1.5 up, 170 ms RTT) +
  **4× CPU** slowdown, viewport **390×844**, cold context per run.
- Metrics from the Performance API: LCP via `PerformanceObserver`
  (`largest-contentful-paint`, buffered), FCP from paint timing, and **eager JS
  weight** from Resource Timing (`decodedBodySize` = uncompressed parse cost;
  `transferSize` = wire bytes). "First map paint" = wall-clock from navigation
  to the `canvas.maplibregl-canvas` element existing.
- Reported figures are the **median of 3 cold runs**. Before/after were captured
  with the identical script by stashing/​restoring the source changes and
  rebuilding each time, so the delta is apples-to-apples.

> Note on Next 16 + Turbopack: `next build` no longer prints per-route
> Size / First Load JS columns, so bundle weight is measured from what the
> browser actually downloads (Resource Timing), not the build log.

## Findings (before)

`/map` (mobile, throttled), median of 3:

| Metric | Value |
|---|---|
| **LCP** | **2940 ms — OVER the 2.5s budget** |
| FCP (loading skeleton) | 796 ms |
| First map paint (canvas present) | 4661 ms |
| **Eager JS decoded (parse cost)** | **5195 KB** |
| Eager JS wire (gzip) | 753 KB |
| Total transfer | 949 KB |

### Root cause

`components/PubMap.tsx` is the map route's client root (loaded `ssr:false` via
`PubMaxingShell`). It **statically imported ~60 modules**, including every heavy
panel that is *not* on the first mobile paint:

- **Interaction-gated** (only mount after the user opens them): `RoutePanel`,
  `ControlRail`, `VenueInspector`, `MobilePlanActivation` — behind
  `planningOpen` / `detailOpen`.
- **Desktop-only** (never mount on a 390-px viewport — all rendered behind
  `!mobileViewport`): `MapToolbar`, `MapPriceControl`, `CitySuggestBanner`,
  `CityStatusBanner`, `TonightLane`, `MapConciergeAsk`, `LogIntentFallback`.

Because they were static imports, their JS **and their transitive dependencies**
(chart lib, markdown, extra Supabase realtime surface, etc.) were fused into the
eager map chunk that the browser must download and parse *before* the map can
boot — inflating decoded JS to 5.2 MB and pushing LCP over budget.

- The single biggest legitimately-eager chunk is **maplibre-gl** itself
  (~1144 KB decoded / ~310 KB gzip). That is genuinely on the critical path (the
  map needs it) and is left alone.
- The basemap streams vector tiles/glyphs/sprite from a **cross-origin** host,
  `tiles.openfreemap.org` (`components/map/canvas/tokens.ts`), with **no
  preconnect** — so the DNS+TCP+TLS handshake didn't start until maplibre booted,
  serialising the two slowest steps on the path.
- Fonts are self-hosted by `next/font` (no Google Fonts runtime) — already
  optimal, `display: swap`, metric-matched fallbacks. No action.

## Fixes

### Fix 1 — Preconnect to the tile host (`app/layout.tsx`)

Added `<link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin>`
(+ `dns-prefetch` fallback) so the cross-origin handshake begins during initial
HTML parse instead of after the ~1 MB maplibre chunk finishes. Lets the first
tile fetch fire the instant the style loads. Cheap and harmless on non-map routes
(unused preconnects are dropped after ~10s). `crossOrigin` is required — tile and
glyph requests are CORS.

### Fix 2 — Dynamic-import off-critical-path panels (`components/PubMap.tsx`)

Converted the 11 modules above from static imports to `next/dynamic`
(`ssr:false` — the whole PubMap tree is already client-only). Each becomes its
own lazy chunk fetched on demand: on a cold mobile `/map` load none of them
mount, so their JS never downloads until the user opens the planner/inspector or
resizes to desktop. Type-only co-imports (`TabKey`, `GeneratedMobilePlan`) were
split to `import type` so they don't pull the runtime module back in.

## Results (after)

`/map` (mobile, throttled), median of 3:

| Metric | Before | After | Δ |
|---|---|---|---|
| **LCP** | 2940 ms | **2384 ms** | **−556 ms → under 2.5s budget ✅** |
| FCP | 796 ms | 768 ms | ~flat |
| First map paint | 4661 ms | 4209 ms | −452 ms (−10%) |
| **Eager JS decoded** | 5195 KB | **2212 KB** | **−2983 KB (−57%)** |
| Eager JS wire | 753 KB | 629 KB | −124 KB (−16%) |
| Total transfer | 949 KB | 812 KB | −137 KB |

Actual JS loaded on `/map` after the fix (top chunks, decoded / wire):

| Chunk | Decoded | Wire |
|---|---|---|
| maplibre-gl | 1144 KB | 310 KB |
| app/react-dom | 222 KB | 70 KB |
| map route code | 203 KB | 52 KB |
| supabase | 134 KB | 37 KB |
| (remaining ~15 chunks) | < 105 KB each | — |

## CI lock

`e2e/map-perf-budget.spec.ts` — a WebGL-agnostic smoke that runs in the default
`chromium` project. It asserts:

1. **Boot proxy**: mobile map chrome visible + loading skeleton retired.
2. **Eager-JS budget**: same-origin decoded JS on `/map` < **3400 KB** — generous
   headroom above the 2212 KB we ship today, but far below the 5195 KB
   regression cliff, so any accidental static re-import of a heavy panel fails
   the test. `decodedBodySize` is deterministic and GPU-independent, so it is a
   stable CI gate where wall-clock LCP under SwiftShader software rendering is
   not.

## Budget status

| Target | Status |
|---|---|
| LCP < 2.5s (throttled mobile lab) | ✅ 2384 ms |
| Eager JS on `/map` | ✅ 2212 KB (locked < 3400 KB) |
| First map paint | ⚠️ 4209 ms — gated on maplibre-gl init + first tile stream, not JS weight |

## What remains above budget / follow-ups

- **First map paint (~4.2s throttled)** is dominated by maplibre-gl parse +
  WebGL context init + first vector-tile stream — not by app JS anymore. LCP is
  already under budget because the loading skeleton paints early; the *canvas*
  finishing later is the honest cost of a real WebGL basemap. Further wins would
  need maplibre-side work (deferred/worker init, raster-first placeholder) and
  belong in `PubMapCanvas.tsx`, which this cycle avoided touching (pending
  first-frame-watchdog PR).
- **Supabase (~134 KB decoded) is still eager** on `/map`. If realtime/live-drops
  can tolerate a deferred connect, lazy-loading it would trim more eager JS.
  Not done here — it touches the data/auth layer and needs its own verification.
- **Instant back-nav** and **sheet-drag jank** were not separately instrumented
  in this pass; the dynamic-import change reduces main-thread parse pressure,
  which helps both, but they warrant their own trace-based follow-up.
