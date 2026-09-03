# Mobile Map Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 390px map its vertical space back while keeping venue filters, unavailable-state truth, and map attribution fully usable.

**Architecture:** Keep filter behavior in `TonightArcChips` and use a single mobile horizontal scroller with 44px hit boxes around 34px visual pills. Keep MapLibre as attribution owner, force its built-in compact disclosure, and reserve a separate bottom-right lane above the plan action. Add browser assertions at rendered-box level because CSS source checks cannot prove row count, equal heights, or collision freedom.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, MapLibre GL, Playwright, Vitest, ESLint.

## Global Constraints

- Keep `unavailableReason` as filter data and keep its exact reason discoverable.
- Preserve selected versus unselected state without depending on colour.
- Keep every mobile press target at least 44px while making each visible pill 34px tall.
- Keep attribution text legally unchanged and reachable from MapLibre's info control.
- Do not change filter behavior, topbar, bottom navigation, venue sheet, map colours, or price bands.
- Add no dependency.
- Capture evidence only with Playwright in this worktree on port 37651 and verify each file with `ls -la`.
- Keep `components/PubMap.tsx` unchanged and report its ESLint complexity before and after.
- Do not manually edit generated files.

---

### Task 1: Single-row Tonight Arc controls

**Files:**

- Modify: `components/map/TonightArcChips.tsx`
- Modify: `components/map/tonightArcChips.css`
- Modify: `e2e/drink-chip-controls.spec.ts`
- Modify: `__tests__/mobileChromeFit.test.ts`

**Interfaces:**

- Consumes: `VenueKindVisibility`, `toggleVenueKind`, and existing `unavailableReason` chip data.
- Produces: `.tonightArcRow` as one nowrap horizontal scroller, `.tonightArcChip::before` as the 34px visual pill, and `.tonightArcUnavailableReason` as an on-demand explanation.

- [ ] **Step 1: Replace the existing 390px tick test with rendered behavior assertions**

```ts
for (const width of [390, 320]) {
  test(`${width}px Tonight Arc stays one row with equal controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map");

    const arc = page.getByRole("group", { name: "Tonight arc venue types" });
    const chips = arc.locator(".tonightArcChip");
    const boxes = await chips.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      }),
    );
    expect(new Set(boxes.map(({ top }) => Math.round(top))).size).toBe(1);
    expect(new Set(boxes.map(({ height }) => Math.round(height))).size).toBe(1);
  });
}
```

Add assertions that:

- Clubs has `aria-disabled="true"` and accessible name `Clubs are not mapped yet`.
- Pressing Clubs reveals a visible tooltip containing `Clubs are not mapped yet`.
- Turning Bars off changes `aria-pressed`, font weight, and `::before` border width.
- No chip contains a tick.
- Row computed `overflow-x` is `auto`.
- At 390px last chip ends inside row client box.
- At 320px `scrollWidth` is greater than `clientWidth`.

- [ ] **Step 2: Update the CSS contract test**

Replace source assertions for `flex-wrap: wrap` with assertions for:

```ts
expect(mobile).toMatch(/\.tonightArcRow\s*{[^}]*flex-wrap:\s*nowrap/);
expect(mobile).toMatch(/\.tonightArcRow\s*{[^}]*overflow-x:\s*auto/);
expect(mobile).toMatch(/\.tonightArcChip::before\s*{[^}]*inset-block:\s*5px/);
expect(mobile).toMatch(/\.tonightArcChip\s*{[^}]*min-height:\s*44px/);
expect(arcChipsTsx).not.toContain("✓");
```

- [ ] **Step 3: Run the focused browser test and observe the expected failure**

Run:

```bash
PW_PORT=37661 PW_NEXT_DIST_DIR=.next-e2e-map-controls npx playwright test e2e/drink-chip-controls.spec.ts --project=chromium --workers=1 --grep "Tonight Arc"
```

Expected: failure because rendered chips occupy two top coordinates, Clubs contains its reason, and selected chips contain ticks.

- [ ] **Step 4: Implement the compact controls**

In `TonightArcChips.tsx`:

- Remove `tonightArcChipSelected`.
- Keep `aria-pressed`.
- Use `aria-disabled="true"` instead of native `disabled` for unavailable chips so they remain focusable and can explain themselves.
- Track the revealed unavailable reason locally.
- Pressing an unavailable chip only toggles its explanation and never calls `onChange`.
- Render the explanation outside `.tonightArcRow` with `role="tooltip"`.

In `tonightArcChips.css`:

- Reduce desktop pill height from 38px to 34px, horizontal padding from 10px to 8px, and type from 0.75rem to 0.7rem.
- At phone width, hide only the visible `Tonight arc` caption while retaining the group's accessible name.
- Keep each button at 44px for touch, but draw its pill through `::before` with `inset-block: 5px`, producing a 34px visible shape.
- Use `flex-wrap: nowrap`, `overflow-x: auto`, hidden scrollbars, and `scroll-snap-type: x proximity`.
- Make selected pills use heavier type and a 2px pseudo-element border. Make unselected pills use lighter type and a 1px border.
- Keep unavailable pills visually quiet at identical geometry.

- [ ] **Step 5: Run focused tests and verify green**

Run:

```bash
npm test -- __tests__/mobileChromeFit.test.ts
PW_PORT=37661 PW_NEXT_DIST_DIR=.next-e2e-map-controls npx playwright test e2e/drink-chip-controls.spec.ts --project=chromium --workers=1 --grep "Tonight Arc"
```

Expected: both pass with one rendered row at 390px and 320px.

- [ ] **Step 6: Commit the chip change**

```bash
git add components/map/TonightArcChips.tsx components/map/tonightArcChips.css e2e/drink-chip-controls.spec.ts __tests__/mobileChromeFit.test.ts
git commit -m "fix: keep Tonight Arc controls to one row"
```

---

### Task 2: Compact, collision-free attribution

**Files:**

- Modify: `components/PubMapCanvas.tsx`
- Modify: `components/mobile/mobileMapShell.css`
- Modify: `e2e/drink-chip-controls.spec.ts`
- Modify: `__tests__/mapOsmAttribution.test.ts`

**Interfaces:**

- Consumes: `OSM_ATTRIBUTION` and MapLibre's built-in compact attribution disclosure.
- Produces: `attributionControl: { compact: true, customAttribution: OSM_ATTRIBUTION }` and a mobile attribution lane above `.mobilePlanActivation`.

- [ ] **Step 1: Add failing attribution assertions**

Add browser assertions that:

```ts
const attribution = page.locator(".maplibregl-ctrl-attrib");
await expect(attribution).toHaveClass(/maplibregl-compact/);
await attribution.locator(".maplibregl-ctrl-attrib-button").click();
const fullCredit = attribution.locator(".maplibregl-ctrl-attrib-inner");
await expect(fullCredit).toContainText("Pub data © OpenStreetMap contributors (ODbL)");
```

Measure the expanded attribution and `.mobilePlanActivation` boxes, then assert:

```ts
expect(attributionBox.bottom).toBeLessThanOrEqual(planBox.top);
expect(attributionBox.left).toBeGreaterThanOrEqual(0);
expect(attributionBox.right).toBeLessThanOrEqual(390);
expect(fullCreditText).not.toMatch(/\u2026$/);
```

Update `mapOsmAttribution.test.ts` to require `compact: true` beside unchanged `customAttribution`.

- [ ] **Step 2: Run focused tests and observe expected failure**

Run:

```bash
npm test -- __tests__/mapOsmAttribution.test.ts
PW_PORT=37662 PW_NEXT_DIST_DIR=.next-e2e-map-attribution npx playwright test e2e/drink-chip-controls.spec.ts --project=chromium --workers=1 --grep "attribution"
```

Expected: failure because MapLibre is not forced compact and its expanded 44px box overlaps the plan action.

- [ ] **Step 3: Implement compact attribution**

Change the existing constructor option to:

```ts
attributionControl: {
  compact: true,
  customAttribution: OSM_ATTRIBUTION,
},
```

At phone width:

- Move `.maplibregl-ctrl-bottom-right` above the 48px plan action plus a 10px gap.
- Cap expanded attribution width to `calc(100vw - 24px)`.
- Permit ordinary word wrapping in `.maplibregl-ctrl-attrib-inner`.
- Keep MapLibre's native info button as the disclosure.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
npm test -- __tests__/mapOsmAttribution.test.ts
PW_PORT=37662 PW_NEXT_DIST_DIR=.next-e2e-map-attribution npx playwright test e2e/drink-chip-controls.spec.ts --project=chromium --workers=1 --grep "attribution"
```

Expected: unchanged full credit is reachable and its rendered box stays above the plan action.

- [ ] **Step 5: Commit the attribution change**

```bash
git add components/PubMapCanvas.tsx components/mobile/mobileMapShell.css e2e/drink-chip-controls.spec.ts __tests__/mapOsmAttribution.test.ts
git commit -m "fix: tuck map credit behind its info control"
```

---

### Task 3: Evidence, measurement, and closeout

**Files:**

- Keep: `docs/evidence/map-controls-crowd-the-map/before-390x844.png`
- Create: `docs/evidence/map-controls-crowd-the-map/after-390x844.png`
- Create: `docs/evidence/map-controls-crowd-the-map/README.md`

**Interfaces:**

- Consumes: rendered `.mobileMapTopbar`, `.mobileMapRail`, `.tonightArcChips`, attribution, and plan-action boxes.
- Produces: checked-in screenshots and exact before/after geometry.

- [ ] **Step 1: Capture after screenshot and geometry through Playwright**

Use Chromium with viewport `{ width: 390, height: 844 }` against `http://localhost:37651/map`. Store:

```ts
const chromeHeight =
  arc.getBoundingClientRect().bottom -
  topbar.getBoundingClientRect().top;
```

Capture:

```ts
await page.screenshot({
  path: "docs/evidence/map-controls-crowd-the-map/after-390x844.png",
});
```

- [ ] **Step 2: Verify both files exist**

Run:

```bash
ls -la docs/evidence/map-controls-crowd-the-map/before-390x844.png
ls -la docs/evidence/map-controls-crowd-the-map/after-390x844.png
```

- [ ] **Step 3: Record exact evidence**

Write `README.md` with:

- Viewport and Playwright port.
- Before top, bottom, and height: 10px, 243.40625px, 233.40625px.
- After top, bottom, and height from the actual rendered page.
- Pixels and percentage reclaimed, calculated from those measurements.
- Collapsed and expanded attribution geometry.
- `components/PubMap.tsx` complexity before and after.

- [ ] **Step 4: Run project validation**

Run:

```bash
npm run lint
npm run typecheck
npm test -- __tests__/mobileChromeFit.test.ts __tests__/mapOsmAttribution.test.ts
PW_PORT=37663 PW_NEXT_DIST_DIR=.next-e2e-map-final npx playwright test e2e/drink-chip-controls.spec.ts --project=chromium --workers=1 --grep "Tonight Arc|attribution"
```

Expected: clean pass.

- [ ] **Step 5: Re-check complexity**

Run:

```bash
npx eslint components/PubMap.tsx --format json
```

Expected: `PubMap` remains complexity 233, delta 0.

- [ ] **Step 6: Restore local Next.js artifacts**

Run:

```bash
git checkout -- next-env.d.ts tsconfig.json
```

- [ ] **Step 7: Commit evidence**

```bash
git add docs/evidence/map-controls-crowd-the-map
git commit -m "docs: add measured mobile map chrome evidence"
```

Before running the command, replace its subject with the two literal heights
recorded in `README.md`. Shell placeholders are not permitted because the
commit must preserve the measured values as readable evidence.

- [ ] **Step 8: Verify clean branch**

Run:

```bash
git status --short
git log --oneline --decorate -5
```

Expected: no uncommitted files and all task commits on `fm/map-controls-crowd-the-map`.
