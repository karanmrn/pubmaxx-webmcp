# PRD — Map-First Redesign, Favorite Pint & Points of Interest

> Companion to `PRD_FINAL_FOR_FABLE.md`. That doc describes the map *engine* Fable built. This doc is the next chapter: turn the map into a **full-screen hero**, let people **pick their pint**, and add **real London points of interest**. The engine stays; this is layout choreography + two features on top.

**Status:** approved plan (2026-07-06). Branch `prd-implementation-review`.

---

## 1. Why

`/map` currently opens as a 3-column dashboard — a left filter/planner rail and a right route/detail panel are *always* on screen, and the MapLibre map is only the middle grid column (`app/globals.css` `.appShell` → `356px | 1fr | 372px`). The map — the best thing we have — never gets to fill the screen.

We flip it: **the map is the product**. On arrival you see a beautiful, full-bleed, gently-orbiting London with every pub and real landmarks. Chrome appears **only when you act**.

## 2. The experience

**On load (nothing selected):**
- Full-screen 3-D London (existing engine: pitch, idle orbit, extruded buildings, sky/fog, theme system).
- Every pub/bar pin visible (all ~1,194 venues — already the default), plus a **points-of-interest layer** (tube stations, major parks, tourist sights).
- **One minimal floating toolbar** — search, a **favorite-pint picker**, and a **"Plan a crawl"** button. Nothing else on screen.

**When you pick a favorite pint:**
- The map **re-prices to that beer**: every pin recolors by *that beer's* price at each pub; pubs that don't serve it **dim out**. Clear the choice → back to cheapest-pint coloring.
- The choice is **remembered across visits** (localStorage, no auth).

**When you click a pub pin:**
- Only the **right-side venue detail** drawer slides in (price, story, The Landlord, Pint Drops). The crawl planner stays hidden.

**When you click "Plan a crawl":**
- The **left planner** drawer slides in (filters, suggest/build mode, featured & near-me crawls) — today's ControlRail, now on demand. `Esc` closes drawers.

## 3. Confirmed decisions

1. Clean map keeps a **minimal floating toolbar only**: search + favorite-pint + "Plan a crawl".
2. Favorite pint **re-prices the map** (recolor to that beer; dim pubs that don't serve it).
3. **Add real non-pub POI pins** — tube / parks / sights — as a bundled static dataset.
4. Pin click → **right venue detail only**; the planner is a separate explicit action.

## 4. Scope & non-goals

- **No auth, no backend changes, no new runtime external APIs.** POI data ships as static JSON (keyless, matching the app's ethos). Favorite-pint pricing is a pure client-side derivation over each `Venue.prices[]`.
- **MapLibre instance stays mounted** across the layout change — never remount (loses camera, expensive).
- Preserve what works: URL crawl-sharing, localStorage crawl restore, mobile bottom-sheets, and codex's map hardening (theme-toggle `addLayerOnce` guard, WebGL fallback).

## 5. Data foundations (already present)

- **Per-beer pricing exists.** Each `Venue` keeps `prices: VenuePrice[]` where each carries `pint_name` + `price_gbp` (`lib/venues.ts`). 478 raw brand strings, case-variant → a canonical ~20-brand normalizer collapses them. No new pub data needed for favorite pint.
- **Persistence pattern to copy:** `lib/savedPubs.ts` / `lib/anonId.ts` (SSR-safe localStorage, `pubmax:*:v1` keys).
- **Selection plumbing exists:** `selectedVenueId` in `PubMap.tsx` already drives the inspector + cinematic fly-to. We gate *visibility*, not rebuild behavior.

## 6. Workstreams (decomposed by file ownership — avoids collision with the live tree)

- **WS-A — Layout** *(owns `PubMap.tsx`, `app/globals.css`, new `components/map/MapToolbar.tsx`)*: full-bleed map base + animated overlay drawers; `planningOpen` gate for the planner, `selectedVenueId` gate for the inspector; the floating toolbar.
- **WS-B — Favorite pint** *(owns new `lib/beers.ts`, `lib/favoritePint.ts`, `components/map/FavoritePintPicker.tsx`)*: canonical brands + `normalizeBeer` + `priceForBeer(venue, id) → number|null`; localStorage persistence; the picker.
- **WS-C — POI data** *(owns new `public/data/london_pois.json`, `lib/pois.ts`)*: static curated tube (~270) / parks (~25) / sights; typed loader + per-category style metadata.
- **WS-D — Canvas** *(single owner `components/PubMapCanvas.tsx`, after B & C)*: recolor pins by favorite-pint price + dim non-serving; tube/park/sight symbol layers + toggle, zoom-gated, reusing the `addLayerOnce` guard.
- **WS-E — Verify**: unit tests (normalizer, `priceForBeer`, favoritePint round-trip, POI loader); `eslint + tsc + vitest + build` green; live walkthrough.

## 7. Acceptance

1. Map loads full-bleed, all pins + POIs, toolbar only — no side panels.
2. Pick a beer → pins recolor to that beer's price, non-serving pubs dim; choice persists across reload.
3. Click a pub → right detail only; planner stays hidden.
4. "Plan a crawl" → left planner slides in; `Esc` closes; all existing planning still works and stays shareable via URL.
5. POI pins render, are categorized/toggleable, and don't clutter at low zoom.
6. Theme toggle safe; mobile bottom-sheets intact; `eslint + tsc + vitest + build` all green.
