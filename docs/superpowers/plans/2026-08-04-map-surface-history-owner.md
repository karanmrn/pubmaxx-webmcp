# Map Surface History Owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Map surface navigation one authority that records every drawer transition, restores exact prior surface state, and alone reads or moves browser history.

**Architecture:** Replace Map's independent selection-history and surface-depth hooks with one map-specific navigation controller. Controller owns logical `SurfaceStack`, stamps complete snapshots plus venue sentinel into each history entry, applies Back/Forward snapshots, and exposes synchronous `open` commands so batched planner-to-venue transitions cannot disappear between renders. `PubMap` state setters render controller decisions; pure `surfaceStack` remains navigation model.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright Firefox

## Global Constraints

- Branch starts at `origin/main` commit `fd637a6b`.
- Desktop drawers stay mutually exclusive.
- Back restores exact prior state and never reloads defaults.
- Drawer ownership changes stay synchronous.
- No fixed delays, animation timing guesses, or one-pop holds.
- Firefox browser proofs cover mutual exclusion, populated planner restore, real-predecessor immediate Back, Escape, and phone fling-dismiss.
- `npx tsc --noEmit` exits 0 and full Vitest count stays at least 7482.
- Commit screenshots at 390x844 and 1440x900 in light and dark themes.
- Never push, merge, deploy, or edit generated changelog files.

---

### Task 1: Lock Browser Failures

**Files:**
- Create: `e2e/map-surface-history.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: existing desktop toolbar, `SurfaceNav`, phone sheet drag handle, onboarding crawl fixture
- Produces: Firefox-only proof suite for five required interactions

- [ ] **Step 1: Add Firefox project coverage for new spec**

Extend conditional Firefox project's `testMatch` to include `map-surface-history.spec.ts`, retaining `Desktop Firefox` while individual phone tests set 390x844.

- [ ] **Step 2: Write failing transition tests**

Add literal assertions for:

```ts
expect(await page.locator(".mapDrawer.springDrawer.open").count()).toBe(1);
await expect(planner).toHaveAttribute("aria-hidden", "true");
await expect(venue).toHaveAttribute("aria-hidden", "false");
```

Cover venue to planner and planner to venue separately.

- [ ] **Step 3: Write failing restore and race tests**

Load Victorian Soho, assert venue owns screen, press Back, then require planner plus five real `.routeList > li` rows. Establish `/tonight` as real predecessor, open venue, and run click plus `history.back()` in same page task; require venue to win as sole drawer.

- [ ] **Step 4: Write Escape and phone fling tests**

Require Escape from venue-over-planner to restore populated planner. At 390x844, drag venue sheet down from header and require its parent planner to return.

- [ ] **Step 5: Verify red against origin/main behavior**

Run:

```bash
PW_FIREFOX_DESKTOP_MAP_CHROME_FIT=1 PW_PORT=3127 npx playwright test e2e/map-surface-history.spec.ts --project=firefox-desktop-map-chrome-fit --workers=1
```

Expected: failures name missing planner history, dual traversal race, or fling restoring Map instead of parent.

- [ ] **Step 6: Commit browser contract**

```bash
git add e2e/map-surface-history.spec.ts playwright.config.ts
git commit -m "test(map): lock single-owner surface history"
```

### Task 2: Build Pure History Snapshot Model

**Files:**
- Create: `lib/mapSurfaceHistory.ts`
- Create: `__tests__/mapSurfaceHistory.test.ts`
- Modify: `lib/mapSelectionHistory.ts`

**Interfaces:**
- Consumes: `SurfaceEntry<S>`, `SurfaceStack<S>`, selection URL and sentinel helpers
- Produces: `readMapSurfaceHistory`, `stampMapSurfaceHistory`, `clearMapSelectionHistory`, and owner-stamped full trail snapshots

- [ ] **Step 1: Write failing pure tests**

Test hand-written state objects. Venue snapshot must carry both full trail and `pubmaxSelection`; planner/root snapshot must remove stale selection keys while preserving Next.js keys. Malformed external state must return `null`.

- [ ] **Step 2: Run focused test red**

```bash
npx vitest run __tests__/mapSurfaceHistory.test.ts
```

Expected: module or exports missing.

- [ ] **Step 3: Implement minimal snapshot model**

Use one versioned key:

```ts
type MapSurfaceHistory<S> = {
  version: 1;
  stack: SurfaceStack<S>;
};
```

Clone only plain history state, validate entry `id` and `title` on read, preserve opaque entry `state`, and clear selection keys for non-venue snapshots.

- [ ] **Step 4: Run focused tests green**

```bash
npx vitest run __tests__/mapSurfaceHistory.test.ts __tests__/mapSelectionHistory.test.ts __tests__/surfaceStack.test.ts
```

- [ ] **Step 5: Commit model**

```bash
git add lib/mapSurfaceHistory.ts lib/mapSelectionHistory.ts __tests__/mapSurfaceHistory.test.ts
git commit -m "feat(map): model authoritative surface history"
```

### Task 3: Replace Competing Owners

**Files:**
- Create: `components/map/pubmap/useMapSurfaceNavigation.ts`
- Modify: `components/PubMap.tsx`
- Modify: `components/map/pubmap/useMapKeyboardShortcuts.ts`
- Delete: `components/map/pubmap/useMapSelectionHistory.ts`
- Delete: `components/map/pubmap/useMapSurfaceTrail.ts`
- Delete: `lib/useSurfaceStack.ts`

**Interfaces:**
- Consumes: `arrivalSearch`, current surface entry, selection hint, `onRestore`, `onHome`
- Produces: `open(entry)`, `back()`, `home()`, `backLabel`, `holdsSurface(id)`, `depth`

- [ ] **Step 1: Add focused hook contract tests where pure seams allow**

Keep browser mechanics in Playwright. Add Vitest cases for the controller's pure `openMapSurface` decision: push a new surface, replace the current venue, and traverse to a known parent.

- [ ] **Step 2: Implement one controller**

Controller rules:

```ts
open(entry)       // synchronously push or replace one complete owner snapshot
back()            // issue history.back only; popstate snapshot decides screen
home()            // close now, then traverse owned depth once
onPop(event)      // restore exactly event.state snapshot, never derive from rival state
```

Deep-linked venue initialization replaces arrival entry with stamped clean Map, then pushes one stamped venue entry. Same-surface venue changes replace URL/snapshot. Known lower surface uses one owner-issued traversal.

- [ ] **Step 3: Route all drawer intents through controller**

Use stable command ref so `openPlanning()` and `selectVenue()` announce in the same synchronous event before their mutually exclusive state mutations. `showLoadedRoute()` therefore records planner then venue even though React batches rendering.

- [ ] **Step 4: Route keyboard and phone gesture Back**

Change map keyboard Escape to call controller Back. Give `MobileSharedSheet` a distinct gesture-dismiss callback, so fling uses Back when a parent exists while its Home control still leaves every surface.

- [ ] **Step 5: Remove independent history owners**

Delete selection hook and generic history hook after imports reach zero. Keep pure `lib/surfaceStack.ts` and selection URL helpers.

- [ ] **Step 6: Run focused unit and Firefox suite**

```bash
npx vitest run __tests__/mapSurfaceHistory.test.ts __tests__/mapSelectionHistory.test.ts __tests__/surfaceStack.test.ts
PW_FIREFOX_DESKTOP_MAP_CHROME_FIT=1 PW_PORT=3127 npx playwright test e2e/map-surface-history.spec.ts --project=firefox-desktop-map-chrome-fit --workers=1
```

- [ ] **Step 7: Commit owner integration**

```bash
git add components lib e2e __tests__
git commit -m "fix(map): give surface history one owner"
```

### Task 4: Update Durable Contract and Capture Proof

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/proof/history-single-owner/390-light-firefox.png`
- Create: `docs/proof/history-single-owner/390-dark-firefox.png`
- Create: `docs/proof/history-single-owner/1440-light-firefox.png`
- Create: `docs/proof/history-single-owner/1440-dark-firefox.png`

**Interfaces:**
- Consumes: settled implementation and Firefox proof spec
- Produces: authoritative architecture pointer and four review artifacts

- [ ] **Step 1: Update project memory**

Run `fm-ensure-agents-md.sh`, then replace obsolete split-owner wording with pointer to `useMapSurfaceNavigation.ts` and full-snapshot history rule.

- [ ] **Step 2: Capture Firefox light and dark images**

Use Playwright output paths at exact viewport sizes, copy four settled screenshots into `docs/proof/history-single-owner`, and visually inspect every image.

- [ ] **Step 3: Run browser proof again after docs and capture changes**

```bash
PW_FIREFOX_DESKTOP_MAP_CHROME_FIT=1 PW_PORT=3127 npx playwright test e2e/map-surface-history.spec.ts --project=firefox-desktop-map-chrome-fit --workers=1
```

- [ ] **Step 4: Commit proof and contract**

```bash
git add AGENTS.md docs/proof/history-single-owner
git commit -m "docs(map): record single-owner history proof"
```

### Task 5: Closeout Verification

**Files:**
- Review: all branch changes against `fd637a6b`

**Interfaces:**
- Consumes: completed branch
- Produces: fresh evidence for required count, types, Firefox behavior, and clean worktree

- [ ] **Step 1: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Run full unit suite**

```bash
npm test
```

Require zero failures and at least 7482 tests.

- [ ] **Step 3: Run final Firefox proof**

Free port 3127 first, then run five browser proofs with one Firefox worker.

- [ ] **Step 4: Restore local tooling churn**

```bash
git checkout -- next-env.d.ts
```

- [ ] **Step 5: Review shape, diff, docs, and worktree**

Run required closeout review skills, inspect `git diff fd637a6b...HEAD`, verify four PNG dimensions, and require clean `git status --short`.

- [ ] **Step 6: Commit any verification-only correction coherently**

Do not amend prior commits. Create a final focused commit only if closeout changed tracked files.
