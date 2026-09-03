# Launch Truth Defects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This dispatch requires inline execution and forbids delegation.

**Goal:** Fix four launch-critical truth defects and record the deliberate withdrawal of the No-alcohol correction.

**Architecture:** Keep each shipped fix at its existing pure boundary. Map readiness distinguishes a painted tile from full-source settlement; Today names its earlier listing check; weather headlines retain rule cause; legacy drink provenance preserves source URL and publisher. The No-alcohol revision-publication attempt is rolled back additively and retained only as evidence of an unresolved boundary.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, MapLibre GL 6

## Global Constraints

- Reproduce each defect before implementation and record exact observed state.
- Write and run each regression test against unfixed code first.
- Commit each defect separately.
- Do not refactor `components/PubMap.tsx`; report its line delta.
- Preserve real map-background failure reporting.
- Do not restyle, change pricing rules, identity, or contribution policy.
- Copy and state must derive from authoritative state.

---

### Task 1: Painted basemap readiness

**Files:**
- Modify: `components/map/canvas/pinRevealCoordinator.ts`
- Modify: `components/PubMapCanvas.tsx`
- Modify: `e2e/helpers/mapNetworkFixtures.ts`
- Test: `__tests__/pinRevealCoordinator.test.ts`
- Test: `e2e/map-gl.spec.ts`
- Modify: `docs/evidence/prelaunch-smoke/launch-truth-repro/README.md`

**Interfaces:**
- Consumes: MapLibre raster/vector tile-loaded events and next render frame.
- Produces: coordinator reveal reason `tiles` after at least one basemap tile can paint; `timeout` only when no basemap tile painted by ceiling.

- [ ] **Step 1: Write failing unit and Playwright regressions**

```ts
it("does not report timeout after one basemap tile painted while another source remains pending", () => {
  const h = harness();
  h.coordinator.arm();
  h.setBasemapPainted(true);
  h.fireRender();
  h.flushFrame();
  h.fireCeiling();
  expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
});
```

Add deterministic Playwright style containing one visible raster source and one permanently pending tiled source. Assert canvas paints and `.mapSoftRetry` stays absent past ceiling. Retain existing all-tile failure test asserting Retry.

- [ ] **Step 2: Run tests and record expected red**

Run:

```bash
npx vitest run __tests__/pinRevealCoordinator.test.ts
PW_PORT=3211 npx playwright test e2e/map-gl.spec.ts --project=chromium-gl --grep "painted basemap"
```

Expected: coordinator lacks painted-tile input; rendered map shows false Retry with pending secondary source.

- [ ] **Step 3: Implement painted-tile authority**

Track current style generation's first loaded basemap tile in `PubMapCanvas`, reset it before each scene build, and let coordinator reveal only after that signal crosses a render frame. Keep full-source settlement for recovery clearing, not first-paint truth.

- [ ] **Step 4: Run focused green tests**

Run same commands. Expected: normal painted map has no toast; all-tile failure retains toast.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(map): report background failure only before a painted tile"
```

Commit body guarantee: visible painted basemap is authoritative for first-paint success; a genuine no-tile failure still reports.

### Task 2: Revert No-alcohol revision publication

**Files:**
- Modify: `components/map/canvas/donutClusters.ts`
- Modify: `components/PubMapCanvas.tsx`
- Delete: `components/map/canvas/pubSourceRevision.ts`
- Test: `__tests__/canvas-donutClusters.test.ts`
- Modify: `docs/evidence/prelaunch-smoke/launch-truth-repro/README.md`

**Interfaces:**
- Consumes: Firstmate decision after fourth same-revision review finding.
- Produces: additive rollback of shared revision publication without changing
  painted-basemap timeout recovery.

- [ ] **Step 1: Reproduce stale donut reactivation**

```ts
sync.invalidate();
pubsSourceDataHandler(previousSnapshot);
expect(markerInstances).toHaveLength(1);
```

- [ ] **Step 2: Run tests and record expected red**

Run:

```bash
npx vitest run __tests__/canvas-donutClusters.test.ts
```

Expected: old `sourcedata` snapshot creates another donut after invalidation.

- [ ] **Step 3: Revert shared revision publication**

Remove coordinator, invalidation API, publication claims, state-level proof,
mobile proof, and dedicated screenshots. Preserve every timeout-only
late-paint recovery change and genuine error notice.

- [ ] **Step 4: Record decision and learning**

Record old renderable tiles, event tagging limits, source settlement limits,
render boundary limits, and donut reactivation in launch-truth evidence.

- [ ] **Step 5: Commit**

```bash
git commit -m "revert(map): remove revision publication coupling"
```

Commit body guarantee: false-toast and late-paint recovery remain independent.

### Task 3: Today and Tonight source boundary

**Files:**
- Modify: `lib/dayGreeting.ts`
- Test: `__tests__/dayGreeting.test.ts`
- Modify: `docs/evidence/prelaunch-smoke/launch-truth-repro/README.md`

**Interfaces:**
- Consumes: Today's baseline-only `picks.length`.
- Produces: empty sentence explicitly scoped to the list Today renders.

- [ ] **Step 1: Write failing contradiction regression**

```ts
expect(PICKS_EMPTY_LINE.night).toBe(
  "Nothing left on tonight's list. Open Tonight for live listings.",
);
expect(PICKS_EMPTY_LINE.night).not.toBe("Nothing left confirmed tonight.");
```

- [ ] **Step 2: Run test and record expected red**

Run:

```bash
npx vitest run __tests__/dayGreeting.test.ts
```

Expected: current absolute sentence contradicts live Tonight inventory. A
follow-up reader-language regression also rejects plumbing terms such as
`snapshot` and `check`.

- [ ] **Step 3: Scope empty copy**

Make each daypart state that nothing remains on the list Today renders. Keep
Tonight's live `2 listings tonight` statement unchanged.

- [ ] **Step 4: Run focused green test**

Run same command. Expected: source-scoped Today empty state and live Tonight count can both be true.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(today): scope empty picks to today's list"
```

Commit body guarantee: baseline-only Today never claims live Tonight inventory is empty.

### Task 4: Weather recommendation cause

**Files:**
- Modify: `lib/drinkWeather.ts`
- Modify: `lib/todayBrief.ts`
- Modify: `lib/dayGreeting.ts`
- Test: `__tests__/todayBrief.test.ts`
- Test: `__tests__/dayGreeting.test.ts`
- Modify: `docs/evidence/prelaunch-smoke/launch-truth-repro/README.md`

**Interfaces:**
- Consumes: exact drink-weather `ruleId` and displayed temperature from one weather observation.
- Produces: rain wording for warm hard-rain cases; cold wording only for cold-rule cases.

- [ ] **Step 1: Write failing warm and cold tests**

```ts
expect(warmRainGreeting.headline).not.toContain("Cold");
expect(warmRainGreeting.headline).toContain("Rain");
expect(coldGreeting.headline).toContain("Cold");
```

- [ ] **Step 2: Run tests and record expected red**

Run:

```bash
npx vitest run __tests__/todayBrief.test.ts __tests__/dayGreeting.test.ts
```

Expected: both hard-rain 24C and cold 6C map to `fireplace`, so headline calls both cold.

- [ ] **Step 3: Preserve verdict cause**

Type and carry `ruleId` into `WeatherBrief`. Select fireplace headline by rule: hard rain names rain, cold names cold, winter-porter names winter. Other lens copy stays unchanged.

- [ ] **Step 4: Run focused green tests**

Run same command. Expected: warm case never says cold; cold case still does.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(today): derive weather advice from displayed reading"
```

Commit body guarantee: recommendation retains rule from same reading used for displayed temperature.

### Task 5: Named baseline price source

**Files:**
- Modify: `lib/drinks.ts`
- Modify: `components/drinks/DrinkMenu.tsx`
- Modify: `components/map/inspector/VenueOverviewTab.tsx`
- Test: `__tests__/drinks.test.ts`
- Test: `__tests__/drinkMenu.test.ts`
- Create: `__tests__/venuePriceSource.test.ts`
- Modify: `docs/evidence/prelaunch-smoke/launch-truth-repro/README.md`

**Interfaces:**
- Consumes: each legacy price row's `pub_url`, including The Dove's Pint Prices page.
- Produces: named `Pint Prices` source link when recorded, or explicit
  `Publisher not recorded` status beside an unattributed price.

- [ ] **Step 1: Write failing provenance tests**

```ts
expect(doveDrink.provenance).toMatchObject({
  source: "Pint Prices",
  sourceUrl: "https://www.pint-prices.com/pub/example",
});
```

Render menu and overview seams. Require visible `Pint Prices` for The Dove and
`Publisher not recorded` for a record without a publisher, never generic `On
record` or a bare `Dataset price`.

- [ ] **Step 2: Run tests and record expected red**

Run:

```bash
npx vitest run __tests__/drinks.test.ts __tests__/drinkMenu.test.ts __tests__/venuePriceSource.test.ts
```

Expected: adapter discards `pub_url`; both UI surfaces show generic source
classes. Follow-up rendered regressions fail because the unattributed rows do
not say that their publisher is missing.

- [ ] **Step 3: Preserve and render named source**

Extend legacy price provenance with the validated source URL and publisher
already present on the row. Render that source link for baseline overview and
drink rows. When no publisher is recorded, keep the price visible and label
that state beside it. Keep image credit separate.

- [ ] **Step 4: Run focused green tests**

Run same command. Expected: The Dove £7.25 Asahi names Pint Prices on both surfaces.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(prices): preserve named source on baseline drink rows"
```

Commit body guarantee: every displayed baseline source claim carries publisher from its own price row.

### Task 6: Closeout verification

**Files:**
- Modify only if verification reveals a defect.

**Interfaces:**
- Consumes: four focused fixes plus the additive No-alcohol rollback.
- Produces: verified branch ready for Firstmate's no-mistakes gate.

- [ ] **Step 1: Run focused suites**

```bash
npx vitest run __tests__/pinRevealCoordinator.test.ts __tests__/canvas-donutClusters.test.ts __tests__/dayGreeting.test.ts __tests__/todayBrief.test.ts __tests__/drinks.test.ts __tests__/drinkMenu.test.ts __tests__/venuePriceSource.test.ts __tests__/priceSourcePresentation.test.ts
```

- [ ] **Step 2: Run rendered Playwright matrix**

```bash
PW_PORT=3213 npx playwright test e2e/map-gl.spec.ts --project=chromium-gl --grep "does not report a background failure|keeps the honest retry"
```

- [ ] **Step 3: Run project gate**

```bash
npm run verify
```

- [ ] **Step 4: Inspect scope**

```bash
git diff --stat main...HEAD
git diff --numstat main...HEAD -- components/PubMap.tsx
git status --short
```

Expected: `components/PubMap.tsx` delta is `0 0`; no tooling churn.

- [ ] **Step 5: Record final evidence and status**

Append exact red and green commands to reproduction README, verify capture files with `ls -la`, then append `done:` status only after commits and fresh verification.
