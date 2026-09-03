# Venues Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 25 provenance-backed iconic London restaurant pins and an anchor-priced, distance-ordered crawl-ending food handoff.

**Architecture:** Extend Wave 1 seed, slim-index, venue-kind, and glyph contracts with `restaurant` and `signature_dish`. Keep anchor prices on non-pint presentation paths. Enrich existing late-food evidence with sourced anchors, then rank and render no more than three terminals from final-stop coordinates.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, MapLibre GL, JSON seed artifacts.

## Global Constraints

- Exactly 25 hand-curated restaurants with real London coordinates and boroughs.
- Every restaurant has source, observation date, signature-dish anchor, and independent fame evidence.
- Fork glyph uses existing MapLibre icon registry and existing price-band colours.
- Non-pub anchors never enter bare pint-price pin labels or pub-only crawl workflows.
- Food handoff returns at most three options ordered by walking estimate from final stop.
- No bookings, broad menus, cuisine filters, ratings, reviews, bulk imports, separate feed, dependency work, or unrelated refactors.

---

### Task 1: Restaurant seed contract

**Files:**

- Create: `data/famous_venues/restaurants.json`
- Modify: `__tests__/famousVenuesSeed.test.ts`
- Modify: `lib/nightOutPlaceContract.mjs`

**Interfaces:**

- Consumes: Wave 1 row fields and `nightOutPlaceRowValidationErrors`.
- Produces: 25 `kind: "restaurant"` rows with `category: "restaurant"`, `job: "near_pub_food"`, and `anchor.kind: "signature_dish"`.

- [ ] Add failing seed assertions for exact count, uniqueness, provenance, fame gates, London coordinates, and signature-dish anchors.
- [ ] Run `npx vitest run __tests__/famousVenuesSeed.test.ts` and confirm failure because `restaurants.json` and restaurant contract support are absent.
- [ ] Add restaurant contract values and 25 fully sourced rows.
- [ ] Re-run seed test and confirm pass.

### Task 2: Slim index and fork pins

**Files:**

- Modify: `scripts/build_slim_index.mjs`
- Modify: `scripts/build_slim_index.d.mts`
- Modify: `scripts/validate-data.mjs`
- Modify: `lib/venueKindFilters.ts`
- Modify: `components/map/TonightArcChips.tsx`
- Modify: `lib/mapIcons.ts`
- Modify: `components/map/canvas/geojson.ts`
- Modify: focused tests for seed loading, kind visibility, icon registry, GeoJSON selection, and slim artifact counts.
- Regenerate: slim and venue-detail artifacts through `node scripts/build_slim_index.mjs`.

**Interfaces:**

- Consumes: restaurant seed rows.
- Produces: type-relative restaurant price bands, visible restaurant pins, and `drink:fork-{0..3}` images.

- [ ] Add failing focused tests asserting 25 restaurant artifact rows, restaurant visibility, fork icon registration, fork GeoJSON assignment, and absence of a bare pin price.
- [ ] Run focused Vitest files and confirm expected failures.
- [ ] Extend seed loading, bands, hints, visibility, chip, and icon registry minimally.
- [ ] Rebuild slim/detail artifacts and re-run focused tests.

### Task 3: Anchor-priced crawl-ending handoff

**Files:**

- Modify: `public/data/late_food_evidence.json`
- Modify: `scripts/lib/validateLateFoodEvidence.mjs`
- Modify: `lib/venueFoodMenu.ts`
- Modify: `lib/lateFood.ts`
- Modify: `lib/tonightGetHome.ts`
- Modify: `components/night/NightModeCard.tsx`
- Modify: `__tests__/lateFoodEvidence.test.ts`
- Modify: `__tests__/lateFood.test.ts`
- Modify: `__tests__/venueMenu.test.ts`
- Modify: `__tests__/nightModeCard.test.ts`

**Interfaces:**

- Consumes: official late-food evidence plus final-stop coordinates.
- Produces: `LateFoodTerminal.anchor`, distance-first ranking, maximum three UI choices, and visible label/price/source/date.

- [ ] Add failing tests for required anchor provenance, distance-first order, three-item cap, inspector anchor item, and handoff presentation.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add anchor fields to evidence and terminal model, shared anchor-to-food-item helper, deterministic ranking, and sourced UI copy.
- [ ] Re-run focused tests and confirm pass.

### Task 4: Validation and browser evidence

**Files:**

- Modify only task-related code or tests if verification exposes task regressions.

**Interfaces:**

- Produces: verified mobile map and crawl-ending handoff.

- [ ] Run targeted tests including `__tests__/mapSymbolCollision.test.ts`.
- [ ] Run `npm run verify`.
- [ ] Start keyless app, emulate `390x844x3,mobile,touch`, capture restaurant fork pins and Food handoff with anchor prices.
- [ ] Run `git diff --check`, inspect scoped diff, restore local tooling churn, and commit on `fm/venues-wave-3`.
