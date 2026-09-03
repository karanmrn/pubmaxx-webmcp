# Drink-Priced Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make map colour, pin figures, and cheapest-area results follow selected drink while keeping pint default and Pint Index pint-only.

**Architecture:** Keep beer on existing `VenueSignal` path. Read trusted community prices for selected non-beer category through existing cross-venue category index, derive separate `MapLensPrice` map, and hand that map to category-aware presentation seams. Missing category prices remain null and use neutral bucket.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, MapLibre GL, Playwright/CDP browser QA.

## Global Constraints

- Default map remains pint-priced.
- Every non-pint pin figure names selected drink.
- Missing selected-drink price is unknown, never borrowed from pint or anchor data.
- Corroboration and max-age gates apply per category.
- Pint Index remains pint-only and receives no lens input.
- British register, no em dash, no exclamation mark.

---

### Task 1: Selected-category trusted price index

**Files:**
- Modify: `app/api/price-submit/route.ts`
- Modify: `components/map/useCommunityPrices.ts`
- Modify: `lib/mapExperienceLens.ts`
- Test: `__tests__/priceSubmitRoute.test.ts`
- Test: `__tests__/mapExperienceLens.test.ts`

**Interfaces:**
- Consumes: `readCommunityPriceCategoryIndex(categories)`, `drivesMap`, `mapCandidateOf`.
- Produces: `loadDrinkCategoryIndex(category: DrinkCategory): void`, `trustedDrinkLensPrices(rowsByVenue, category, now): Map<string, MapLensPrice>`.

- [x] **Step 1: Write failing tests**

```ts
it("reads only requested drink category across venues", async () => {
  const response = await GET(get("?drinkCategory=whisky"));
  expect((await response.json()).prices.every(
    (row: { drinkCategory: string }) => row.drinkCategory === "whisky",
  )).toBe(true);
});

it("keeps only trusted selected-category prices", () => {
  const prices = trustedDrinkLensPrices(rows, "whisky", NOW);
  expect(prices.get("trusted")?.category).toBe("whisky");
  expect(prices.has("uncorroborated")).toBe(false);
  expect(prices.has("wine-only")).toBe(false);
});
```

- [x] **Step 2: Run tests and confirm expected failures**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/mapExperienceLens.test.ts`

- [x] **Step 3: Implement category query, client loader, and pure trusted projection**

Validate query with `isDrinkCategory`. Merge index rows into existing `byVenueId`. Keep loader once-per-category and fail soft.

- [x] **Step 4: Run focused tests**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/mapExperienceLens.test.ts`

### Task 2: Honest category-aware pin and list presentation

**Files:**
- Modify: `components/PubMap.tsx`
- Modify: `components/PubMapCanvas.tsx`
- Modify: `components/map/canvas/geojson.ts`
- Modify: `components/map/FavoritePintPicker.tsx`
- Modify: `lib/mapVenueList.ts`
- Test: `__tests__/canvas-geojson.test.ts`
- Test: `__tests__/mapVenueList.test.ts`
- Test: `__tests__/pintIndex.test.ts`

**Interfaces:**
- Consumes: selected `filters.drinkCategory`, category index state, `MapLensPrice`.
- Produces: `activeLensPrices: ReadonlyMap<string, MapLensPrice> | null`, explicit non-pint pin labels, neutral unknown pins.

- [x] **Step 1: Write failing tests**

```ts
it("labels a whisky figure as whisky and leaves missing whisky unknown", () => {
  const [known, unknown] = pubsToGeoJSON(
    venues, pintSignals, null, "whisky", null, null, whiskyPrices,
  ).features;
  expect(known.properties).toMatchObject({ bucket: priceBucket(6), priceLabel: "£6 Whisky" });
  expect(unknown.properties).toMatchObject({ bucket: 3 });
  expect(unknown.properties?.priceLabel).toBeUndefined();
});

it("does not let drink-lens state enter Pint Index validation", () => {
  expect(validatePintIndexSnapshot(nonPintSnapshot).ok).toBe(false);
});
```

- [x] **Step 2: Run tests and confirm expected failures**

Run: `npm test -- __tests__/canvas-geojson.test.ts __tests__/mapVenueList.test.ts __tests__/pintIndex.test.ts`

- [x] **Step 3: Implement active category lens**

Load category index when non-beer category becomes active. Build lens map from trusted rows. Pass it to canvas, list, hover, and selected venue. In GeoJSON, use selected-category price for bucket and explicit label. Use bucket 3 and no figure when absent. Keep beer/default path unchanged.

- [x] **Step 4: Make picker default visibly pint**

Render `Pint` as empty/default choice, offer all other categories including `other`, and retain favourite beer control.

- [x] **Step 5: Run focused tests**

Run: `npm test -- __tests__/canvas-geojson.test.ts __tests__/mapVenueList.test.ts __tests__/pintIndex.test.ts`

### Task 3: Category-aware cheapest area results

**Files:**
- Modify: `lib/areaButton.ts`
- Modify: `components/map/AreaSheet.tsx`
- Modify: `components/PubMap.tsx`
- Test: `__tests__/areaButton.test.ts`

**Interfaces:**
- Consumes: `activeLensPrices`, active drink category label.
- Produces: area rows ranked by selected drink price, with unknown rows last and category-specific copy.

- [x] **Step 1: Write failing test**

```ts
it("ranks selected drink prices and never borrows pint price", () => {
  const rows = cheapestDrinksInArea(area, venues, center, 10, whiskyPrices);
  expect(rows.map((row) => row.id)).toEqual(["whisky-cheap", "whisky-dear", "pint-only"]);
  expect(rows[2].price).toBeNull();
  expect(rows[2].priceLabel).toBe("no whisky price yet");
});
```

- [x] **Step 2: Run test and confirm expected failure**

Run: `npm test -- __tests__/areaButton.test.ts`

- [x] **Step 3: Implement lens-price ranking and copy**

Accept optional lens price map and noun in pure area functions. Preserve current pint behavior when absent. Pass props through `AreaSheet`, and name heading/aria/empty copy for active drink.

- [x] **Step 4: Run focused tests**

Run: `npm test -- __tests__/areaButton.test.ts`

### Task 4: Verification and closeout

**Files:**
- Review all changed files.

**Interfaces:**
- Consumes: completed implementation.
- Produces: browser evidence, green verification, committed branch.

- [x] **Step 1: Run focused regression suite**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/mapExperienceLens.test.ts __tests__/canvas-geojson.test.ts __tests__/mapVenueList.test.ts __tests__/areaButton.test.ts __tests__/pintIndex.test.ts`

- [x] **Step 2: Run app and verify at 390px**

Run dev server, open `/map`, then `chrome-devtools-axi emulate --viewport "390x844x3,mobile,touch"` and reload in place. Check default pint, switch to non-pint, inspect explicit figure, unknown pin, list, and area sheet without overlap or clipping.

- [x] **Step 3: Run full gate**

Run: `npm run verify`

- [x] **Step 4: Review diff and generated-file churn**

Run: `git diff --check`, `git status --short`, and restore only known tooling churn if present.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: price map by selected drink"
```
