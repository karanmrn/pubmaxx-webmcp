# Mobile Map Chrome Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make phone map controls reachable, aligned, and no taller than 164px at 390px, 430px, and 320px without changing desktop or control behaviour.

**Architecture:** Keep existing mobile shell and controls. Add rendered Playwright contracts for real tap delivery and measured geometry, then adjust only phone CSS so existing 12px shell gutters define one balanced boundary. Preserve existing 44px control rhythm, horizontal scrolling, and TfL corner lane by reserving that lane inside its row instead of creating another outer boundary.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Playwright, Vitest

## Global Constraints

- Mobile only. Do not touch desktop.
- Every control stays fully visible and tappable at 390px and 320px.
- Rows that cannot fit scroll horizontally and never clip.
- Stacked floating rows share one left and one right edge.
- Primary action uses same alignment system as stack.
- Chrome height stays at or below 164px.
- No component, dependency, map, bottom-navigation, topbar-structure, or behaviour changes.
- Do not refactor `components/PubMap.tsx` or `components/PubMapCanvas.tsx`.
- Commit real phone-sized journey evidence under `docs/evidence/mobile-map-chrome/`.

---

### Task 1: Rendered Regression Contract

**Files:**
- Create: `e2e/mobile-map-chrome-fit.spec.ts`

**Interfaces:**
- Consumes: existing `.mobileMapTopbar`, `.mobileMapRail`, `.tonightArcChips`, `.mobileMapUtilityCorner`, `.mobilePlanActivation`, and sheet semantics
- Produces: rendered box, hit-test, tap-delivery, scrolling, shared-edge, and 164px budget assertions

- [x] **Step 1: Write focused Playwright assertions**

Add literal viewport cases for 390x844, 430x932, and 320x568. Read actual `getBoundingClientRect()` boxes. Assert controls remain inside viewport, stacked outer surfaces share left and right edges, chrome height is at most 164px, and horizontal rows use `overflow-x: auto`.

For each top-row button, scroll it into view only when needed, compute its centre point, verify `document.elementFromPoint()` belongs to that button, and click the centre through Playwright mouse input. Assert each distinct sheet or state change opens.

- [x] **Step 2: Run test against current code**

Run:

```bash
PW_PORT=32171 npx playwright test e2e/mobile-map-chrome-fit.spec.ts --project=chromium --workers=1
```

Expected: FAIL on current mismatched right edges or clipped control geometry. Save measured 390px and 430px boxes before editing production CSS.

- [x] **Step 3: Commit red regression contract**

```bash
git add e2e/mobile-map-chrome-fit.spec.ts docs/superpowers/plans/2026-07-31-mobile-map-chrome-overflow.md
git commit -m "test(map): lock phone chrome fit and tap delivery"
```

### Task 2: Minimal Mobile CSS Correction

**Files:**
- Modify: `components/mobile/mobileMapShell.css`
- Modify: `components/map/tonightArcChips.css`
- Modify only if CSS source assertions need the new shared-boundary contract: `__tests__/mobileChromeFit.test.ts`

**Interfaces:**
- Consumes: existing `--mobile-map-stack-left`, `--mobile-map-stack-right`, `--mobile-map-corner-lane`, and 44px control sizes
- Produces: balanced 12px phone shell gutters, one outer row boundary, internally reserved TfL lane, and unchanged desktop rules

- [x] **Step 1: Apply smallest CSS change**

Use existing 12px stack inset on both outer edges. Make topbar, contextual rail, Tonight Arc outer shell, and primary action share those edges. Keep TfL in its existing row and reserve its existing corner lane within that row. Keep rows non-wrapping and horizontally scrollable. Do not add a height, component, dependency, or desktop selector.

- [x] **Step 2: Run focused red-green test**

Run:

```bash
PW_PORT=32171 npx playwright test e2e/mobile-map-chrome-fit.spec.ts --project=chromium --workers=1
```

Expected: PASS for 390px, 430px, and 320px with tap delivery, equal edges, and height at most 164px.

- [x] **Step 3: Run nearby contracts**

Run:

```bash
npm test -- __tests__/mobileChromeFit.test.ts
PW_PORT=32172 npx playwright test e2e/mobile-map-shell-matrix.spec.ts e2e/drink-chip-controls.spec.ts --project=chromium --workers=1
```

Expected: PASS with no desktop-file changes and no altered control behaviour.

- [x] **Step 4: Commit implementation**

```bash
git add components/mobile/mobileMapShell.css components/map/tonightArcChips.css __tests__/mobileChromeFit.test.ts
git commit -m "fix(map): align phone controls to one centred shell"
```

Commit body states: `Alignment system: centred phone shell with balanced 12px gutters.`

### Task 3: Journey Evidence and Closeout

**Files:**
- Create: `docs/evidence/mobile-map-chrome/README.md`
- Create: `docs/evidence/mobile-map-chrome/mobile-map-chrome.webm`

**Interfaces:**
- Consumes: fixed rendered UI and dedicated Playwright journey
- Produces: committed recording of map open, Filters open, filter change, dismiss, and pin tap

- [x] **Step 1: Record real journey**

Create evidence directory explicitly with `mkdir -p`. Run dedicated 390px Playwright journey with video enabled. Exercise map open, Filters tap, one filter change, sheet dismissal, and a real painted pin tap. Copy resulting WebM into evidence directory and verify it with `ls -la` and `ffprobe`.

- [x] **Step 2: Inspect recording**

Extract representative frames with `ffmpeg` and inspect them. Confirm no clipped controls, sheet transition settles, filter selection is visible, and pin tap opens venue sheet.

- [x] **Step 3: Record measured evidence**

Document exact measured 390px, 430px, and 320px boundaries and chrome heights from passing Playwright output. Record `components/PubMap.tsx` and `components/PubMapCanvas.tsx` complexity delta as zero because neither file changed.

- [x] **Step 4: Run final verification**

Run:

```bash
npm run lint
npm run typecheck
npm test -- __tests__/mobileChromeFit.test.ts
PW_PORT=32173 npx playwright test e2e/mobile-map-chrome-fit.spec.ts --project=chromium --workers=1
git diff --check
git status --short
```

Expected: every command exits zero and only scoped files remain.

- [x] **Step 5: Commit evidence**

```bash
git add docs/evidence/mobile-map-chrome
git commit -m "docs: record aligned phone map journey"
```

- [ ] **Step 6: Report**

Append one `done:` line to Firstmate status with branch, commits, measured fit, and recorded journey summary.
