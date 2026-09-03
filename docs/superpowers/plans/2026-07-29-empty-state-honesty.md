# Empty State Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give drinkers a working contribution action from an empty Drinks tab and replace the live Pint Index league's technical empty copy with a short, honest explanation.

**Architecture:** Keep tab ownership in `VenueInspector`, pass one existing Pint Drop composer action through `VenueMenuTab` to `MenuCategoryGrid`, and render it only when the pub has no drinks data. Keep Pint Index logic unchanged and replace only its empty-state markup and copy.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Vitest, Chrome DevTools browser QA

## Global Constraints

- Two empty states only. No venue-sheet or Pint Index redesign.
- British spelling, no em dashes, no exclamation marks, no plumbing words, and no fabricated data.
- Capture both states at 390×844 in light and dark themes.
- Capture browser screenshots to `/tmp`, move them into the worktree, then verify each destination exists.
- Keep MapLibre and dependencies unchanged.

---

### Task 1: Drinks Empty Contribution Action

**Files:**
- Modify: `components/drinks/MenuCategoryGrid.tsx`
- Modify: `components/drinks/menuCategoryGrid.css`
- Modify: `components/map/inspector/VenueMenuTab.tsx`
- Modify: `components/map/VenueInspector.tsx`
- Test: `__tests__/menuEmptyState.test.ts`

**Interfaces:**
- Consumes: `selectTab("pints")` and `setComposerOpen(true)` from the existing venue inspector.
- Produces: optional `onAddDrink: () => void` callback rendered as the empty state's contribution button.

- [x] **Step 1: Write failing render regression**

Render `MenuCategoryGrid` with only a food link and an `onAddDrink` callback. Assert that the unavailable-drinks line and contribution button render beside the working food link.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/menuEmptyState.test.ts`

Expected: FAIL because no contribution button renders.

- [x] **Step 3: Add minimal production path**

Add the optional callback to the menu hub, render `Add what you’re drinking` only for the empty state, and connect it in `VenueInspector` to the existing Pints composer path.

- [x] **Step 4: Run regression test**

Run: `npm test -- __tests__/menuEmptyState.test.ts`

Expected: PASS with one contribution action and no fabricated menu content.

### Task 2: Pint Index Empty Copy

**Files:**
- Modify: `app/pint-index/page.tsx`

**Interfaces:**
- Consumes: existing `rows.length === 0` branch and `/map` destination.
- Produces: short copy that separately explains the fare-zone picture and evidence-qualified borough ranking.

- [x] **Step 1: Replace empty-state copy**

Use three short sentences: no borough league yet, zone strip purpose, and league eligibility. End with one map link to find a pub and log a price.

- [x] **Step 2: Run voice fences**

Run: `npm test -- __tests__/emDashLaw.test.ts __tests__/frictionVoice.test.ts`

Expected: PASS with no banned punctuation or plumbing language.

### Task 3: Browser Evidence and Verification

**Files:**
- Create: `docs/screenshots/empty-state-honesty/drinks-390x844-light.png`
- Create: `docs/screenshots/empty-state-honesty/drinks-390x844-dark.png`
- Create: `docs/screenshots/empty-state-honesty/pint-index-390x844-light.png`
- Create: `docs/screenshots/empty-state-honesty/pint-index-390x844-dark.png`

**Interfaces:**
- Consumes: local keyless Next.js app at `http://localhost:3000`.
- Produces: four PR-ready screenshots proving both states at 390×844 in both themes.

- [x] **Step 1: Exercise Drinks action at mobile width**

Open an unpriced pub, select Drinks, confirm the empty state, activate its action, and confirm the Pints composer opens.

- [x] **Step 2: Capture both themes safely**

For each state and theme, capture under `/tmp`, move to `docs/screenshots/empty-state-honesty/`, and verify with `test -s`.

- [x] **Step 3: Run project gate**

Run: `npm run verify`

Expected: validation, lint, typecheck, coverage, and audit complete with exit code 0.

- [x] **Step 4: Review scope and commit**

Confirm no dependency, generated-file, MapLibre, or unrelated changes. Commit only implementation, regression test, plan, and evidence.
