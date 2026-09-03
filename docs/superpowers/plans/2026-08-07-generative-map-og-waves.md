# Generative Map OG Waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate `/map` share-card waves from current, map-authoritative pint price-band counts.

**Architecture:** A pure module converts three price-band counts into deterministic SVG wave geometry. A server-only reader loads one city pack, applies current corroborated community pint prices through existing map authority rules, and supplies counts to `/api/city-map-card`. Rendering stays in the existing three-colour ink, warm paper, and coral palette. No Pint Index route imports this feature.

**Tech Stack:** Next.js 16 metadata routes, React 19, TypeScript, `next/og`, Vitest

## Global Constraints

- Every wave layer must derive from real band counts. Do not use random values.
- Community prices must pass existing corroboration and age rules before they affect a band.
- Use only ink near-black, warm paper, and coral accent in the new composition.
- Apply the composition to `/map` through `app/api/city-map-card/route.tsx` first.
- Keep frozen Pint Index edition cards unchanged.
- Do not add dependencies.
- Do not modify `components/landing/ThamesHero.tsx`, `components/landing/LandingPage.tsx`, `components/plan/PlanInviteNextStep`, `components/onboarding/`, `app/u/`, or `components/identity/`.
- Do not commit from this orchestrated worktree.

---

### Task 1: Deterministic wave geometry

**Files:**

- Create: `lib/ogPriceWaves.ts`
- Test: `__tests__/ogPriceWaves.test.ts`

**Interfaces:**

- Consumes: `PriceBandCounts`, a readonly tuple for cheap, middle, and dear pint bands.
- Produces: `deriveOgPriceWaveLayers(counts, size)`, returning visible layers with `band`, `count`, `share`, and a closed SVG `path`.

- [ ] **Step 1: Write failing distribution tests**

```ts
expect(
  deriveOgPriceWaveLayers([2, 1, 1], { width: 1200, height: 630 }),
).toMatchObject([
  { band: 0, count: 2, share: 0.5 },
  { band: 1, count: 1, share: 0.25 },
  { band: 2, count: 1, share: 0.25 },
]);
expect(
  deriveOgPriceWaveLayers([0, 4, 0], { width: 1200, height: 630 }),
).toHaveLength(1);
```

- [ ] **Step 2: Run test to verify missing module failure**

Run: `npx vitest run __tests__/ogPriceWaves.test.ts`

Expected: FAIL because `@/lib/ogPriceWaves` does not exist.

- [ ] **Step 3: Implement minimal pure derivation**

```ts
export function deriveOgPriceWaveLayers(
  counts: PriceBandCounts,
  size: OgWaveSize,
): OgPriceWaveLayer[] {
  const clean = counts.map(normalizeCount) as [number, number, number];
  const total = clean.reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];
  return clean.flatMap((count, band) => {
    if (count === 0) return [];
    const share = count / total;
    return [
      { band, count, share, path: buildClosedWavePath(band, share, size) },
    ];
  });
}
```

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run __tests__/ogPriceWaves.test.ts`

Expected: PASS.

### Task 2: Map-authoritative city band counts

**Files:**

- Create: `lib/ogCityPriceBands.server.ts`
- Test: `__tests__/ogCityPriceBands.test.ts`

**Interfaces:**

- Consumes: city slim venues plus `readCommunityPriceCategoryIndex(["beer"], now)`.
- Produces: `readOgCityPriceBandCounts(cityId, now): Promise<PriceBandCounts>`.

- [ ] **Step 1: Write failing authority tests**

```ts
expect(countOgCityPriceBands(venues, communityRows, now)).toEqual([1, 1, 1]);
expect(countOgCityPriceBands(venues, uncorroboratedRows, now)).toEqual([
  2, 0, 1,
]);
```

Fixtures must prove three rules: pub baseline uses the shared `priceBucket`, a corroborated in-window beer row overrides its venue, and stale or uncorroborated rows cannot move a count.

- [ ] **Step 2: Run test to verify missing module failure**

Run: `npx vitest run __tests__/ogCityPriceBands.test.ts`

Expected: FAIL because `@/lib/ogCityPriceBands.server` does not exist.

- [ ] **Step 3: Implement city pack reader and authority merge**

```ts
const priceRows = await readCommunityPriceCategoryIndex(["beer"], now);
return countOgCityPriceBands(slimVenues, priceRows.prices, now);
```

Use existing `drivesMap`, `mapCandidateOf`, pub-kind guard, and map `priceBucket`. Do not count non-pub anchor figures as pint bands.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run __tests__/ogCityPriceBands.test.ts __tests__/communityPrice.test.ts`

Expected: PASS.

### Task 3: Render waves on `/map` card

**Files:**

- Modify: `app/api/city-map-card/route.tsx`
- Test: `__tests__/cityMapCardRoute.test.tsx`

**Interfaces:**

- Consumes: `readOgCityPriceBandCounts` and `deriveOgPriceWaveLayers`.
- Produces: existing 1200 by 630 PNG response with a data-derived SVG background.

- [ ] **Step 1: Write failing route render test**

```ts
const response = await GET(
  new Request("https://pubmaxxing.com/api/city-map-card?city=london"),
);
expect(response.status).toBe(200);
expect(await response.arrayBuffer()).not.toHaveLength(0);
```

Add a boundary assertion through an exported composition builder that proves different band distributions produce different SVG paths without asserting `next/og` internals.

- [ ] **Step 2: Run test to verify missing composition failure**

Run: `npx vitest run __tests__/cityMapCardRoute.test.tsx`

Expected: FAIL because the route has no wave composition.

- [ ] **Step 3: Add layered SVG composition**

```tsx
<svg width="1200" height="630" viewBox="0 0 1200 630">
  {layers.map((layer) => (
    <path key={layer.band} d={layer.path} fill={waveColour(layer.band)} />
  ))}
</svg>
```

Keep all card text legible above the waves. Keep existing rate limiting, cache headers, URL, and trusted copy.

- [ ] **Step 4: Run route and voice tests**

Run: `npx vitest run __tests__/cityMapCardRoute.test.tsx __tests__/emDashLaw.test.ts __tests__/frictionVoice.test.ts __tests__/landingPriceHonesty.test.ts`

Expected: PASS.

### Task 4: Browser proof and release gate

**Files:**

- Create: `docs/proof/og-cards-generative/map-london.png`

**Interfaces:**

- Consumes: local production build and `/api/city-map-card?city=london`.
- Produces: visual proof plus verified feature branch ready for PR.

- [ ] **Step 1: Run full verification**

Run: `npm run verify`

Expected: exit 0.

- [ ] **Step 2: Build in isolated output directory**

Run: `NEXT_DIST_DIR=.next-prod npm run build`

Expected: exit 0.

- [ ] **Step 3: Inspect the card at 1200 by 630**

Confirm text contrast, no clipping, no overflow, and a visibly different composition for two fixture distributions. Stop server after capture.

- [ ] **Step 4: Run final voice fences**

Run: `npx vitest run __tests__/emDashLaw.test.ts __tests__/frictionVoice.test.ts __tests__/landingPriceHonesty.test.ts`

Expected: PASS.

## Self-Review

- Spec coverage: Tasks cover deterministic data derivation, existing map authority, first `/map` application, palette, no dependencies, and Pint Index isolation.
- Placeholder scan: no TODO, TBD, or undefined implementation step remains.
- Type consistency: Task 2 produces `PriceBandCounts`; Task 1 consumes it; Task 3 consumes both outputs.
