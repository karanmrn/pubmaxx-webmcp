# Phone Price Meaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make map price data understandable from the phone filter sheet.

**Architecture:** `PubMap` will pass its existing active `MapPriceLegendModel` to `MobilePriceChoices`, which delegates all legend rendering to existing `MapKey` outside the all-only filter controls. `ZonePintIndexStrip` will expose one compact method note whose claims match `computeZonePintIndex`. Tonight Arc work moved to the [mobile map chrome plan](./2026-07-30-mobile-map-chrome.md).

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, local component CSS.

## Global Constraints

- Do not edit `components/map/DrinkShapeChips.tsx` or drink glyph component. Keep the authorised `components/PubMap.tsx` edit limited to the sheet's MapKey mount and active legend prop.
- Do not add another legend, colour list, filter behavior change, or price calculation change.
- Run each acceptance check against current code and observe expected failure before implementation.
- Prove phone behavior at 390px and 430px.
- Keep CSS changes minimal and local.
- Commit each coherent piece.

---

### Task 1: Reuse MapKey in MobilePriceChoices

**Files:**
- Modify: `__tests__/mobilePriceChoices.test.ts`
- Modify: `e2e/drink-chip-controls.spec.ts`
- Modify: `components/map/MobilePriceChoices.tsx`
- Modify: `components/PubMap.tsx`
- Modify: `components/mobile/mobileMapShell.css`

**Interfaces:**
- Consumes: `MapKey({ legend: MapPriceLegendModel })` and `activePriceLegend`
- Produces: phone filter sheet containing `aria-label="Map key"` and rows from the active derived legend in every experience lens

- [ ] **Step 1: Write failing rendered tests**

Render `MobilePriceChoices` with a sparse derived legend. Assert `MapKey` markup is present, only supplied rows appear, and old `mobilePriceBandLegend` markup is absent. Add Playwright coverage opening Prices and places at 390px and 430px, then assert Map key visibility and active rows for All, No alcohol, and Food.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/mobilePriceChoices.test.ts`

Run: `npx playwright test e2e/drink-chip-controls.spec.ts --grep "map key"`

Expected: unit test fails because no `.mapKey` exists; browser test fails because phone sheet has no `Map key`.

- [ ] **Step 3: Render existing MapKey**

Import `MapKey` in `MobilePriceChoices` and replace the custom legend section with `<MapKey legend={legend} />`. Pass `activePriceLegend` from `PubMap` and keep this component mounted outside the all-only filter controls. Remove obsolete `mobilePriceBandLegend` rules only.

- [ ] **Step 4: Verify green**

Re-run both commands. Expected: PASS.

- [ ] **Step 5: Commit**

Commit component, tests, and removed obsolete CSS together.

### Task 2: State Zone Pint Index meaning and basis

**Files:**
- Modify: `__tests__/zonePintIndexStrip.test.ts`
- Modify: `e2e/drink-chip-controls.spec.ts`
- Modify: `components/zones/ZonePintIndexStrip.tsx`
- Modify: `components/zones/zonePintIndex.css`

**Interfaces:**
- Consumes: `ZonePintIndex`, `MIN_PRICED_VENUES`, and guarantees from `computeZonePintIndex`
- Produces: compact sheet note describing median, cheapest recorded pint per pub, nearest-station zone assignment, and ten-pub publication floor without a recency claim

- [ ] **Step 1: Write failing rendered tests**

Render compact `ZonePintIndexStrip` and assert visible method copy identifies median, each pub's cheapest recorded pint, nearest-station TfL zone assignment, and `MIN_PRICED_VENUES`. Add phone sheet assertion for same note.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/zonePintIndexStrip.test.ts`

Run: `npx playwright test e2e/drink-chip-controls.spec.ts --grep "zone figures"`

Expected: FAIL because compact mode suppresses method copy.

- [ ] **Step 3: Add truthful compact basis**

Render concise method copy in compact mode. Reuse existing `.zonePintIndexMethod` styling with one compact size adjustment if needed. Do not state freshness or currency.

- [ ] **Step 4: Verify green**

Re-run both commands. Expected: PASS.

- [ ] **Step 5: Commit**

Commit component, tests, and local CSS together. Commit message names `computeZonePintIndex` as basis.

### Task 3: Make Tonight Arc state readable without colour

Superseded by the
[mobile map chrome plan](./2026-07-30-mobile-map-chrome.md), which owns the
current selection and unavailable-reason contract.

### Task 4: Closeout verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed price-meaning work
- Produces: clean validation evidence

- [ ] **Step 1: Run focused tests**

Run all new unit and Playwright checks together.

- [ ] **Step 2: Run project gates**

Run `npm run lint`, `npm run typecheck`, and relevant test files. Then run `npm run verify`.

- [ ] **Step 3: Review**

Inspect `git diff` and commit history. Confirm the authorised `PubMap` edit adds no branch, no prohibited files changed, no second legend or colour list exists, no generated-file churn occurred, and the worktree is clean.
