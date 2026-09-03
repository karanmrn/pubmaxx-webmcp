# Map Area Switcher and Fast Search Implementation Plan

> **For agentic workers:** Execute this plan inline in the existing recovery worktree. Steps use checkbox syntax for review.

**Goal:** Let map readers switch between every shipped city pack and find cities or venues from one fast client-side search field.

**Architecture:** Keep city coverage derived from `CITY_VENUE_PACKS` through `listEnabledCities`. Build one compact in-memory index from the shipped slim venue packs, cache its compact records through `surfaceDataCache`, and search it with deterministic prefix and fuzzy ranking. Reuse the existing `CitySwitcher`, `MapSearchSuggest`, `PubMap`, and `AreaSheet` seams for navigation, map flights, venue cards, and analytics.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, MapLibre.

## Global Constraints

- Use British English in product copy and never use an em dash.
- List only cities whose slim packs are enabled in `lib/cityVenuePacks.mjs`.
- Keep `Use my location` first in switcher lists.
- Search must avoid a network request per keystroke and keep index records to name, area, id, and city metadata.
- Keep mobile tap targets at least 44px and preserve safe-area layout.
- Track one `map_area_switched` event per changed area and one `map_search_jump` event per selected result.
- Run at most one full suite; check `memory_pressure -Q` first and use targeted suites when free memory is below 35 percent.

---

### Task 1: Search index policy and loader

**Files:**
- Create: `lib/mapSearchIndex.ts`
- Create: `lib/mapSearchIndexLoader.ts`
- Test: `__tests__/mapSearchIndex.test.ts`

- [x] Write failing tests for compact index construction, exact-prefix ranking over fuzzy matches, and city/area matches ranking above venue matches for the same area query.
- [x] Run `npm test -- __tests__/mapSearchIndex.test.ts` and confirm failure because the index module was absent.
- [x] Implement pure normalisation, compact records, deterministic ranking, and a lazy loader that reads each enabled slim pack once and caches the compact combined index with `surfaceDataCache`.
- [x] Run the targeted test and typecheck the new modules.

### Task 2: Map switcher and search integration

**Files:**
- Modify: `components/map/CitySwitcher.tsx`
- Modify: `components/map/AreaSheet.tsx`
- Modify: `components/PubMap.tsx`
- Modify: `components/map/MapSearchSuggest.tsx`
- Modify: `components/map/MapToolbar.tsx`
- Modify: `components/mobile/MobileMapShell.tsx`
- Modify: `lib/cities.ts`
- Modify: `lib/analyticsEvents.ts`
- Test: `__tests__/citySwitcherRender.test.tsx`

- [x] Render every derived enabled city and keep location first.
- [x] Connect city results to the existing map route and venue results to the existing selected-venue flow.
- [x] Keep current local area suggestions and merge indexed city and cross-city venue results without duplicate current-city venues.
- [x] Use deferred/debounced query work so typing remains responsive and fire the two fixed-schema analytics events at selection boundaries.
- [x] Run the switcher and search targeted tests.

### Task 3: Browser proof and delivery

**Files:**
- Modify: `components/map/areaSheet.css`
- Modify: `components/map/citySwitcher.css`
- Modify: `components/mobile/mobileMapShell.css`
- Add: PR body screenshots for the 390px switcher and search jump.

- [x] Run lint, typecheck, and targeted tests. Skip the full suite because `memory_pressure -Q` reported 34 percent free memory.
- [x] Start the app with the keyless path, capture mobile switcher and search-jump screenshots with Chrome DevTools, and inspect light-theme layout at 390x844 and desktop at 1440x900.
- [ ] Remove generated `next-env.d.ts` churn, review the diff, commit, fetch and rebase `origin/main` immediately before opening the PR, push the branch, and open the PR with `gh-axi`.
