# UK Place Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people search for a curated city or another UK place, then open an honestly framed map at that place.

**Architecture:** Build a compact place index from locality tags already attached to the committed UK OpenStreetMap pub snapshots. Keep nine curated city cards unchanged and first-class, while a lazy-loaded chooser search returns curated routes first and uncovered place deep links second. Parse uncovered-place links through one pure validation seam, use their coordinates only for initial map camera state, and render a dismissible coverage notice above the unchanged map canvas and UK base-streaming layer.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, MapLibre, committed OpenStreetMap data under ODbL 1.0.

## Global Constraints

- Existing geolocation behaviour and copy stay unchanged.
- All nine enabled city cards remain visible when search is idle.
- Uncovered results never claim a pub count or price coverage.
- No new dependency or upstream geography source.
- Map canvas, UK base-layer streaming rules, and payload budgets stay unchanged.
- Search and map notice retain 44px tap targets and fit a 390px viewport.
- Product copy follows `docs/VOICE.md`, including British spelling, no em dash, and no exclamation mark.

---

### Task 1: UK place index and search contract

**Files:**
- Create: `scripts/lib/ukPlaceIndex.mjs`
- Create: `scripts/build_uk_place_index.mjs`
- Create: `lib/ukPlaceSearch.ts`
- Create: `__tests__/ukPlaceSearch.test.ts`
- Create: `__tests__/ukPlaceIndexBuilder.test.ts`
- Generate: `public/data/uk_base/places.json`
- Modify: `package.json`
- Modify: `public/data/uk_base/README.md`

**Interfaces:**
- Produces `buildUkPlaceIndex(elements)` for hermetic generator tests.
- Produces `parseUkPlaceIndex(raw): UkPlace[]`.
- Produces `searchUkPlaces(query, places, cityIds, limit): UkPlaceSearchResult[]`.
- Generated payload declares OpenStreetMap, ODbL 1.0, generator path, and locality-tag basis.

- [ ] **Step 1: Write failing parser, ranking, deduplication, and generator tests**

Use literal fixtures for Sheffield, Bath, and two geographically separate places sharing one name. Assert malformed coordinates are dropped, curated Bath wins and removes the uncovered duplicate, prefix matches beat substring matches, and separated names do not collapse to a midpoint.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- __tests__/ukPlaceSearch.test.ts __tests__/ukPlaceIndexBuilder.test.ts`

Expected: FAIL because place-index modules do not exist.

- [ ] **Step 3: Implement minimal pure generator and runtime search**

Read only existing raw `amenity=pub` elements. Accept `addr:city`, `addr:town`, `addr:village`, `addr:place`, and `addr:suburb`; cluster equal names that are geographically separate; choose a real observation nearest each cluster median as navigation point; never emit pub counts. Parse defensively inside UK bounds and rank exact, prefix, then substring matches.

- [ ] **Step 4: Generate committed index and document provenance**

Run: `node scripts/build_uk_place_index.mjs`

Expected: `public/data/uk_base/places.json` contains Sheffield and metadata naming OpenStreetMap contributors and ODbL 1.0. Wire generation into `build:uk-base` without changing shard generation.

- [ ] **Step 5: Run tests to verify GREEN**

Run: `npm test -- __tests__/ukPlaceSearch.test.ts __tests__/ukPlaceIndexBuilder.test.ts`

Expected: PASS.

### Task 2: Searchable city chooser

**Files:**
- Modify: `components/city/CityChooser.tsx`
- Modify: `components/city/cityChooser.css`
- Create: `__tests__/cityChooserSearch.test.ts`

**Interfaces:**
- Consumes `parseUkPlaceIndex` and `searchUkPlaces`.
- Curated result links continue through `cityMapShareUrl(city.id)`.
- Uncovered result links use `/map?place=<name>&lat=<lat>&lng=<lng>`.

- [ ] **Step 1: Write failing chooser behaviour and mobile CSS tests**

Assert search input and result semantics, curated-first routing, uncovered honesty copy, idle visibility of all nine cards, 44px result/input floors, and 390px single-column containment. Guard existing geolocation copy verbatim.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- __tests__/cityChooserSearch.test.ts`

Expected: FAIL because chooser has no search UI.

- [ ] **Step 3: Implement minimal lazy search UI**

Fetch `/data/uk_base/places.json` only after a two-character query. Show curated matches before uncovered results. Keep the existing city navigation outside the conditional search panel so all nine remain first-class at rest. Give loading, failure, and empty states literal copy that makes no coverage claim.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- __tests__/cityChooserSearch.test.ts`

Expected: PASS.

### Task 3: Honest uncovered-place map arrival

**Files:**
- Create: `components/map/UkPlaceArrivalBanner.tsx`
- Create: `components/map/ukPlaceArrivalBanner.css`
- Modify: `components/PubMap.tsx`
- Modify: `lib/explicitMapIntent.ts`
- Modify: `lib/ukPlaceSearch.ts`
- Create: `__tests__/ukPlaceMapArrival.test.ts`

**Interfaces:**
- Produces `parseUkPlaceMapArrival(search): UkPlaceMapArrival | null`.
- Produces `ukPlaceMapView(arrival, cityMapView): MapViewportSnapshot` at zoom 12.5 or higher.
- `PubMap` uses that view for initial state and `PubMapCanvas.mapView`.

- [ ] **Step 1: Write failing deep-link validation, map-view, and copy tests**

Assert valid Sheffield links open inside UK bounds at base-layer zoom, malformed/out-of-UK coordinates fall back, `place=` suppresses first-run onboarding, and notice says pubs are present while no price has been logged and invites the first report.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- __tests__/ukPlaceMapArrival.test.ts __tests__/explicitMapIntent.test.ts`

Expected: FAIL because uncovered-place arrival is not parsed.

- [ ] **Step 3: Implement arrival camera and banner**

Freeze validated arrival at mount. Prefer its camera over city defaults, preserve existing pitch/bearing, label map context with place name, suppress London-only ambient data, and render a dismissible notice. Do not alter `PubMapCanvas` or `useUkBaseStreaming`.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- __tests__/ukPlaceMapArrival.test.ts __tests__/explicitMapIntent.test.ts`

Expected: PASS.

### Task 4: Real-browser and repository verification

**Files:**
- No production files unless verification finds a defect.

**Interfaces:**
- Validates complete acceptance criteria.

- [ ] **Step 1: Verify chooser at 390px**

Open `/choose-city`, emulate `390x844x3,mobile,touch`, reload, search Sheffield, confirm honest uncovered result, check focus order and 44px targets, then capture screenshot.

- [ ] **Step 2: Verify curated routing and existing location control**

Search Bath and confirm `/map/bath`. Confirm “Use my location” remains present and existing unit tests pass.

- [ ] **Step 3: Verify Sheffield map**

Open Sheffield result, confirm camera is in Sheffield, base-pub shard requests succeed, base-pub count is non-zero, notice is visible, and browser console has no errors or warnings.

- [ ] **Step 4: Run full gate**

Run: `npm run verify`

Expected: exit 0 with data validation, lint, typecheck, coverage, and resilient audit green.

- [ ] **Step 5: Review diff and commit**

Restore local tooling churn in `next-env.d.ts` or `package.json` if generated, review `git diff --check`, then commit on `fm/city-search-anywhere`.
