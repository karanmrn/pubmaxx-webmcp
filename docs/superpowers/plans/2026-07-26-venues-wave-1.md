# Venues Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 39 curated London bars and 25 high-confidence late-food institutions as fully sourced, price-aware map pins with type glyphs and Tonight arc filters.

**Architecture:** Hand-authored seed packs follow one strict row contract. Build script validates and merges them into existing London slim index, assigning type-relative price buckets without changing map density or collision layers. Existing slim-to-pin and GeoJSON paths carry optional venue kind to shared map layers, while controlled Tonight arc state filters ordinary source features and always preserves the selected or deep-linked pin.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL, Node ESM build scripts, Vitest, Playwright.

## Global Constraints

- London only: 39 bars and 25 late-food venues, accepting the smaller food set because quality beats count.
- Each venue clears at least two fame gates: recognition, longevity, cultural weight, distinct experience.
- Every row includes current geometry, `sourceUrl`, `observedAt`, anchor price, and sourced story.
- Venue type uses glyph, never colour. Pin colour retains per-type price-band meaning.
- No OSM bulk import, ratings, review text, ranked-list republication, new tabs, clubs, restaurants, venue-detail redesign, or new price submission.
- Keep existing MapLibre zoom, cluster, and collision contract unchanged.

---

### Task 1: Seed contract and curated packs

**Files:**
- Create: `__tests__/famousVenuesSeed.test.ts`
- Create: `data/famous_venues/bars.json`
- Create: `data/famous_venues/late_food.json`

**Interfaces:**
- Consumes: fame and provenance rules from expansion plan sections 1-3.
- Produces: rows shaped as `{id,name,address,borough,lat,lng,kind,fameGates,sourceUrl,observedAt,anchor,story}`.

- [ ] Write test asserting accepted counts, unique IDs, London coordinates, allowed kinds, two distinct allowed fame gates, valid current HTTPS evidence, positive anchor price, ISO observation date, and non-empty sourced story.
- [ ] Run `npm test -- __tests__/famousVenuesSeed.test.ts`; expect missing-file failure.
- [ ] Research venue-owned or award pages, verify current trading status, and author 39 bar plus 25 high-confidence food rows.
- [ ] Run seed test; expect pass with no duplicate IDs or contract failures.

### Task 2: Slim build and runtime type

**Files:**
- Modify: `scripts/build_slim_index.mjs`
- Modify: `lib/venuesSlim.ts`
- Modify: `lib/venues.ts`
- Modify: `lib/slimPins.ts`
- Modify: `__tests__/venuesSlim.test.ts`
- Modify: `__tests__/slimPins.test.ts`

**Interfaces:**
- Consumes: Task 1 seed rows.
- Produces: `VenueKind = "pub"|"bar"|"club"|"food"|"restaurant"`, optional `SlimVenue.kind`, pin `kind`, and type-relative `priceBand`.

- [ ] Add failing runtime normalization tests proving valid kinds survive, absent kind stays absent/pub-compatible, and unknown kinds are rejected.
- [ ] Add failing conversion test proving kind reaches map pin.
- [ ] Run focused tests and confirm expected failures.
- [ ] Load both seed packs in build script, validate rows, compute bar and food tercile price bands independently, append slim rows, and emit `kind` only for non-pubs.
- [ ] Extend runtime types and normalization, then regenerate slim/shard artifacts with `node scripts/build_slim_index.mjs`.
- [ ] Run focused tests; expect pass.

### Task 3: Coupe/skewer glyphs and map feature contract

**Files:**
- Modify: `lib/mapIcons.ts`
- Modify: `components/map/canvas/geojson.ts`
- Modify: `__tests__/mapIcons.test.ts`
- Modify: `__tests__/mapSymbolCollision.test.ts`

**Interfaces:**
- Consumes: pin `kind` and build-time type price band from Task 2.
- Produces: registered `coupe-{0..3}` and `skewer-{0..3}` drink icons and GeoJSON `kind`.

- [ ] Add failing tests for coupe/skewer registry keys and bar/food GeoJSON icon selection.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add coupe and skewer silhouettes to existing drink icon registry. Select glyph from venue kind before drink lens fallback.
- [ ] Run focused tests, including collision test; expect pass and unchanged overlap constants.

### Task 4: Tonight arc filter row

**Files:**
- Create: `lib/venueKindFilters.ts`
- Create: `components/map/TonightArcChips.tsx`
- Create: `components/map/tonightArcChips.css`
- Modify: `components/PubMap.tsx`
- Modify: `components/PubMapCanvas.tsx`
- Modify: `components/map/MapLayersControl.tsx`
- Create: `__tests__/venueKindFilters.test.ts`
- Modify: `__tests__/pubMap.test.ts`

**Interfaces:**
- Consumes: optional `Venue.kind`, absent meaning pub.
- Produces: controlled state for `pub`, `bar`, and `food`; disabled `club` chip; MapLibre filter composed with existing source/layer filters.

- [ ] Add failing pure tests for defaults, toggling, absent-kind pub semantics, and MapLibre filter expression.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement pure state/filter helpers and accessible `Pints · Bars · Clubs · Food` chip row.
- [ ] Place row in existing map chrome/layers surfaces without adding a tab. Filter ordinary source features while forcing the selected or deep-linked pin visible even when its kind chip is off.
- [ ] Run focused UI and collision tests; expect pass.

### Task 5: Verification and visual QA

**Files:**
- Modify only defects exposed by checks.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: verified 390x844 experience and clean repository gates.

- [ ] Run `npm test -- __tests__/famousVenuesSeed.test.ts __tests__/venuesSlim.test.ts __tests__/mapSymbolCollision.test.ts`.
- [ ] Run `npm run verify`; fix every lint, type, test, coverage, or flaky failure.
- [ ] Run app and inspect at 390x844: all three enabled chips toggle, bar/food glyphs are distinct, price colours vary within each type, and labels remain collision-managed.
- [ ] Run `npm run verify` again and confirm pristine output.
- [ ] Review diff for scope traps, generated-file churn, source quality, and no density constant changes.
- [ ] Commit all intended files on `fm/venues-wave-1b`; after the rebase, the rename was required because the clean internal gate ref only accepted fast-forward updates.
