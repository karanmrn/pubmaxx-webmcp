# Design Craft D1-D8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give landing, venue, and map surfaces clear hierarchy through interruptible spring motion, translucent sheet material, one price-stamp signature, and restrained interaction feedback.

**Architecture:** Put motion calculations in a pure `lib/springMotion.ts` module, then expose them through a small React animation hook used by mobile sheets and desktop drawers. Keep visual craft in existing token and component style files, reuse `PriceBadge` as the price-stamp owner, and preserve MapLibre's single collision-indexed symbol layer for pin figures.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS custom properties, Vitest, Playwright, MapLibre GL

## Global Constraints

- Do not redefine locked brand colours from `PRODUCT.md` or `DESIGN.md`.
- Do not add purple glow, cream direct-to-consumer styling, or card-dashboard first viewports.
- Do not touch six-tab navigation.
- Preserve call-to-action contrast of at least 5.96:1, keyboard venue-list operation, and desktop drawer focus trapping.
- Honour `prefers-reduced-motion` and `prefers-reduced-transparency`.
- Preserve pin collision policy and keep pin figures on the existing `pubs-point` symbol layer.
- Do not change `--panel-raised`; D4 is already complete.
- Use British spelling, no exclamation marks, and no em dashes in visible copy.
- Avoid dependency changes and unrelated audit work.

---

### Task 0: Restore Product Hierarchy on the Desktop Map

**Files:**
- Modify: `lib/mapBasemapTaste.ts`
- Modify: `lib/donutClusterGeometry.ts`
- Modify: `components/map/canvas/buildScene.ts`
- Modify: `__tests__/mapBasemapTaste.test.ts`
- Modify: `__tests__/donutClusterGeometry.test.ts`
- Modify: `__tests__/mapSymbolCollision.test.ts`

**Interfaces:**
- Consumes: existing dark basemap palette, product tokens, and clustered pub source.
- Produces: subordinate road geometry and labels plus stronger clustered pub marks, without changing zoom gates or collision policy.

- [ ] **Step 1: Add failing hierarchy assertions**

Assert dark major roads stay below muted UI text luminance, road labels are quieter than place labels, and the largest cluster footprint still fits within the existing supercluster grouping radius.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- __tests__/mapBasemapTaste.test.ts __tests__/mapSymbolCollision.test.ts`

Expected: FAIL because roads and labels currently carry near-primary visual weight.

- [ ] **Step 3: Rebalance map context and product marks**

Keep three warm road tiers but pull every tier below product marks. Reduce dark road-label opacity independently from place labels. Increase cluster radius, count size, stroke, and resting opacity while keeping the existing source, zoom gates, sort order, and collision-index reservation.

- [ ] **Step 4: Verify with focused tests and one-browser screenshot review**

Run: `npm test -- __tests__/mapBasemapTaste.test.ts __tests__/mapSymbolCollision.test.ts __tests__/mapPinBandContrast.test.ts`

Expected: PASS. At 1440 by 900 in dark mode, pub clusters read before road geometry while the street network remains usable.

- [ ] **Step 5: Commit**

```bash
git add lib/mapBasemapTaste.ts lib/donutClusterGeometry.ts components/map/canvas/buildScene.ts __tests__/mapBasemapTaste.test.ts __tests__/donutClusterGeometry.test.ts __tests__/mapSymbolCollision.test.ts docs/screenshots/design-craft/before-map-1440-dark.png docs/superpowers/plans/2026-07-29-design-craft-d1-d8.md
git commit -m "feat: restore pub hierarchy on desktop map"
```

### Task 1: Interruptible Spring Motion Primitive

**Files:**
- Create: `lib/springMotion.ts`
- Create: `lib/useSpringValue.ts`
- Create: `__tests__/springMotion.test.ts`

**Interfaces:**
- Consumes: browser `requestAnimationFrame`, React state and refs.
- Produces: `stepSpring(state, target, deltaSeconds, config)`, `projectMomentum(value, velocity, deceleration)`, `isSpringSettled(state, target)`, and `useSpringValue(initialValue, options)`.

- [ ] **Step 1: Write failing physics tests**

```ts
import {
  isSpringSettled,
  projectMomentum,
  stepSpring,
} from "@/lib/springMotion";

it("converges without overshoot when critically damped", () => {
  let state = { value: 0, velocity: 0 };
  const values: number[] = [];
  for (let frame = 0; frame < 120; frame += 1) {
    state = stepSpring(state, 100, 1 / 60, {
      response: 0.34,
      dampingRatio: 1,
    });
    values.push(state.value);
  }
  expect(values.every((value) => value >= 0 && value <= 100.01)).toBe(true);
  expect(isSpringSettled(state, 100)).toBe(true);
});

it("projects release velocity into a farther endpoint", () => {
  expect(projectMomentum(200, 0.8, 0.998)).toBeGreaterThan(500);
  expect(projectMomentum(200, -0.8, 0.998)).toBeLessThan(0);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- __tests__/springMotion.test.ts`

Expected: FAIL because `lib/springMotion.ts` does not exist.

- [ ] **Step 3: Implement pure spring functions and React hook**

Use a semi-implicit integrator with bounded substeps, response in seconds, damping ratio `1` by default, and velocity in pixels per second. `useSpringValue` must expose:

```ts
type SpringValueController = {
  value: number;
  running: boolean;
  animateTo: (
    target: number,
    options?: { velocity?: number; dampingRatio?: number; onRest?: () => void },
  ) => void;
  jumpTo: (value: number) => void;
  stop: () => { value: number; velocity: number };
};
```

Retargeting must start from current presentation value and velocity. Reduced motion must jump to target and invoke `onRest` synchronously.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- __tests__/springMotion.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/springMotion.ts lib/useSpringValue.ts __tests__/springMotion.test.ts
git commit -m "feat: add interruptible spring motion primitive"
```

### Task 2: Spring-Driven Mobile Sheet and Desktop Drawer

**Files:**
- Modify: `lib/sheetSnap.ts`
- Modify: `components/mobile/useSheetHeightDrag.ts`
- Modify: `components/mobile/MobileSharedSheet.tsx`
- Create: `components/map/useDrawerSpring.ts`
- Modify: `components/PubMap.tsx`
- Modify: `components/mobile/mobileMapShell.css`
- Modify: `__tests__/sheetSnap.test.ts`
- Modify: `e2e/landmark-and-sheet.spec.ts`

**Interfaces:**
- Consumes: `useSpringValue`, `projectMomentum`, existing snap labels and sheet height bounds.
- Produces: spring-settled mobile snap changes, animated dismissal, interruptible pointer drag, and spring-settled desktop drawer transforms.

- [ ] **Step 1: Add failing projected-snap and reduced-motion assertions**

Add a snap resolver case where a high upward release from peek projects past half to full, plus a Playwright case that emulates reduced motion and expects a detent change to settle immediately without a CSS `max-height` transition.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- __tests__/sheetSnap.test.ts && npx playwright test e2e/landmark-and-sheet.spec.ts --project=chromium`

Expected: projected-snap assertion and CSS-transition assertion fail.

- [ ] **Step 3: Wire mobile sheet to spring presentation value**

On pointer down, call `stop()` and capture pointer. On move, call `jumpTo(clampedHeight)` for one-to-one tracking. On release, resolve snap from projected height, then call `animateTo(targetHeight, { velocity, dampingRatio })`. Use damping ratio `0.8` only for momentum releases and `1` for ordinary state changes. Animate dismissal to zero before `onClose`, while allowing a new pointer down to cancel it.

- [ ] **Step 4: Wire desktop drawers to spring transforms**

Use `useDrawerSpring(open, side)` to animate from the current transform towards `0` or the off-screen side. Apply the hook only to desktop drawers, retain focus-trap activation from `detailOpen`, and jump under reduced motion.

- [ ] **Step 5: Remove competing CSS settle transitions**

Remove `max-height var(--duration-slow) var(--ease-out)` from mobile shared sheet. Keep pointer capture, touch action, and drag affordances unchanged.

- [ ] **Step 6: Run focused unit, end-to-end, and accessibility tests**

Run: `npm test -- __tests__/sheetSnap.test.ts && npx playwright test e2e/landmark-and-sheet.spec.ts e2e/map-accessibility.spec.ts --project=chromium`

Expected: PASS, including keyboard venue list and desktop focus trap.

- [ ] **Step 7: Commit**

```bash
git add lib/sheetSnap.ts components/mobile/useSheetHeightDrag.ts components/mobile/MobileSharedSheet.tsx components/map/useDrawerSpring.ts components/PubMap.tsx components/mobile/mobileMapShell.css __tests__/sheetSnap.test.ts e2e/landmark-and-sheet.spec.ts
git commit -m "feat: spring sheets and desktop drawers"
```

### Task 3: Translucent Sheet Material and Surface Hierarchy

**Files:**
- Modify: `app/globals.css`
- Modify: `app/theme.css`
- Modify: `components/mobile/mobileMapShell.css`
- Modify: `components/map/venueSheet.css`
- Modify: `components/landing/landing.css`
- Test: `__tests__/mobileChromeFit.test.ts`

**Interfaces:**
- Consumes: existing neutral and locked accent tokens.
- Produces: `--sheet-material`, `--sheet-material-border`, `--sheet-material-shadow`, and a reduced-transparency solid fallback.

- [ ] **Step 1: Add failing static material assertions**

Assert shipped CSS declares a dark-first translucent `--sheet-material`, applies `backdrop-filter` to mobile and desktop sheets, and supplies solid fallbacks inside `prefers-reduced-transparency` and `prefers-contrast: more`.

- [ ] **Step 2: Run test and verify RED**

Run: `npm test -- __tests__/mobileChromeFit.test.ts`

Expected: FAIL because sheet material tokens and filters are absent.

- [ ] **Step 3: Implement sheet material**

Derive translucent surfaces from existing neutral RGB channels. Use a subtle inner hairline plus two low-opacity shadow layers. Keep route-panel and venue-sheet descendants transparent enough that one sheet reads as one material.

- [ ] **Step 4: Subordinate equal-weight boxes**

Make landing signal lead item dominant and turn the other two items into shorter editorial support rows. Remove decorative card chrome from the venue tab panel and current-price rows while retaining separators and every interactive boundary. Increase landing hero and venue-title contrast through existing display/body typefaces and size tokens.

- [ ] **Step 5: Add handle and control pointer feedback**

Keep global button feedback. Add targeted `:active` feedback for sheet handles and detents without overwriting their positional transforms. Disable transitions under reduced motion.

- [ ] **Step 6: Verify CSS contract and mobile budget**

Run: `npm test -- __tests__/mobileChromeFit.test.ts __tests__/emDashLaw.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css app/theme.css components/mobile/mobileMapShell.css components/map/venueSheet.css components/landing/landing.css __tests__/mobileChromeFit.test.ts
git commit -m "feat: clarify sheet and landing hierarchy"
```

### Task 4: One Price-Stamp Signature

**Files:**
- Modify: `components/PriceBadge.tsx`
- Modify: `components/PriceBadge.module.css`
- Modify: `components/landing/PintDropStrip.tsx`
- Modify: `components/landing/landing.css`
- Modify: `app/borough/page.tsx`
- Modify: `app/borough/[slug]/page.tsx`
- Modify: `app/borough/borough.css`
- Modify: `components/plan/RecapDetail.tsx`
- Modify: `app/recap/[storyId]/page.tsx`
- Modify: `components/map/inspector/VenueOverviewTab.tsx`
- Modify: `components/mobile/MobileSharedSheet.tsx`
- Modify: `components/map/canvas/tokens.ts`
- Modify: `components/map/canvas/buildScene.ts`
- Modify: `__tests__/priceBadge.test.ts`
- Modify: `__tests__/mapSymbolCollision.test.ts`

**Interfaces:**
- Consumes: global `.price-plaque` and `.ink-stamp--tilt` signatures.
- Produces: `PriceBadge` as canonical DOM price stamp plus matching MapLibre ink, surface halo, and tilt.

- [ ] **Step 1: Make price signature tests fail**

Change `priceBadge.test.ts` to require `price-plaque` and `ink-stamp--tilt`. Add map-scene assertions requiring price ink, plaque-surface halo, and a small `text-rotate` while retaining `text-optional: true` and no overlap exemptions.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- __tests__/priceBadge.test.ts __tests__/mapSymbolCollision.test.ts`

Expected: FAIL because current badges suppress stamp styling and pins lack plaque treatment.

- [ ] **Step 3: Make PriceBadge canonical**

Apply the same brass surface, dark ink, border, mono weight, padding, radius, and slight stamp tilt to every variant. Keep variant class names as semantic hooks without changing visual signature.

- [ ] **Step 4: Replace duplicate DOM stamps**

Render `PriceBadge` in landing feed, borough cards and detail, recap total and pints, venue overview price rows, and mobile venue peek. Remove local duplicate price-stamp CSS.

- [ ] **Step 5: Match pin figures without breaking collisions**

Add canvas tokens for existing price-plaque ink and surface. Apply them as text colour and halo on current `pubs-point` text fields, with a small fixed text rotation. Do not create another layer or enable overlap.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- __tests__/priceBadge.test.ts __tests__/mapSymbolCollision.test.ts __tests__/canvas-geojson.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/PriceBadge.tsx components/PriceBadge.module.css components/landing/PintDropStrip.tsx components/landing/landing.css app/borough/page.tsx 'app/borough/[slug]/page.tsx' app/borough/borough.css components/plan/RecapDetail.tsx 'app/recap/[storyId]/page.tsx' components/map/inspector/VenueOverviewTab.tsx components/mobile/MobileSharedSheet.tsx components/map/canvas/tokens.ts components/map/canvas/buildScene.ts __tests__/priceBadge.test.ts __tests__/mapSymbolCollision.test.ts
git commit -m "feat: unify price stamp across surfaces"
```

### Task 5: Browser Evidence and Accessibility Measurement

**Files:**
- Create: `docs/screenshots/design-craft/before-landing-390-light.png`
- Create: `docs/screenshots/design-craft/before-landing-390-dark.png`
- Create: `docs/screenshots/design-craft/before-landing-1440-light.png`
- Create: `docs/screenshots/design-craft/before-landing-1440-dark.png`
- Create: `docs/screenshots/design-craft/before-sheet-390-light.png`
- Create: `docs/screenshots/design-craft/before-sheet-390-dark.png`
- Create: `docs/screenshots/design-craft/before-sheet-1440-light.png`
- Create: `docs/screenshots/design-craft/before-sheet-1440-dark.png`
- Create: corresponding eight `after-*.png` files in the same directory.
- Create: `docs/design-craft-d1-d8-evidence.md`

**Interfaces:**
- Consumes: local production surfaces at 390 by 844 and 1440 by 900 in both themes.
- Produces: reviewable evidence, measured contrast ratio, box-count comparison, and focus/motion verification notes for PR body.

- [ ] **Step 1: Capture after images through Chrome**

Open each surface, apply exact viewport and theme, capture under `/tmp`, move into `docs/screenshots/design-craft`, and confirm each file exists with non-zero size.

- [ ] **Step 2: Measure contrast**

Read computed foreground and background colours for core landing and plan calls to action. Calculate WCAG relative luminance and record the lowest ratio, which must remain at least 5.96:1.

- [ ] **Step 3: Record hierarchy count and interaction evidence**

Document that two of three landing signal boxes are subordinated, and count visible venue overview boxes removed or subordinated in the same selected venue. Record spring interruption, reduced-motion jump, keyboard venue-list, and desktop focus-trap results.

- [ ] **Step 4: Commit**

```bash
git add docs/screenshots/design-craft docs/design-craft-d1-d8-evidence.md
git commit -m "docs: add design craft comparison evidence"
```

### Task 6: Full Verification and Branch Closeout

**Files:**
- Modify only files required by failures caused by this branch.

**Interfaces:**
- Consumes: all earlier task deliverables.
- Produces: committed branch that passes project verification and browser quality review.

- [ ] **Step 1: Run complete project gate**

Run: `npm run verify`

Expected: PASS with validation, lint, typecheck, coverage, and resilient audit green.

- [ ] **Step 2: Run production build separately from development server**

Run: `NEXT_DIST_DIR=.next-prod npm run build`

Expected: PASS without clobbering `.next`.

- [ ] **Step 3: Inspect dirty files and tooling churn**

Run: `git status --short && git diff --check`

Revert only the documented local `next-env.d.ts` development route-types rewrite if present. Do not touch user or unrelated changes.

- [ ] **Step 4: Run project memory guard**

Run: `/Users/karanmanoharan/karan-agent-workspace/bin/fm-ensure-agents-md.sh .`

Expected: existing project instructions remain valid; no broad knowledge entry is required for a craft-only change.

- [ ] **Step 5: Commit any verification-only corrections**

```bash
git add app components lib __tests__ e2e docs
git commit -m "fix: close design craft verification gaps"
```

- [ ] **Step 6: Confirm clean committed branch**

Run: `git status --short && git log --oneline main..HEAD`

Expected: clean status and coherent design-craft commits on `fm/design-craft-d1-d8`.
