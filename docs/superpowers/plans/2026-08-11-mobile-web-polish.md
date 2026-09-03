# Mobile Web Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the four remaining mobile checklist gaps without changing the seven shipped checklist items.

**Architecture:** Keep mobile controls governed by shared rules in `app/globals.css`. Keep viewport-height choices local to each existing app shell, hero, map sheet, or page shell. Add one source-level regression test for the swept CSS and one focused test for shared control and lane contracts.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules/global CSS, Vitest, Playwright, Chrome DevTools mobile emulation.

## Global Constraints

- Use `100dvh` for app chrome and `100svh` only where stable hero height is required.
- Keep every input, select, and textarea at a computed mobile font size of at least 16px through shared styles.
- Apply `user-select: none` only to controls and control-like surfaces, with the WebKit property included.
- Apply `touch-action: pan-y` to horizontal lane gesture surfaces.
- Do not change the seven already shipped mobile checklist items.
- Use British English and no em dashes in new prose.
- Run at most one full suite. Check `memory_pressure -Q` before it.
- Immediately before opening the PR, run `git fetch origin main` and `git rebase origin/main`.

### Task 1: Lock the CSS contracts

**Files:**
- Modify: `__tests__/mobileWebPolish.test.ts`
- Modify: `app/globals.css`
- Modify: `app/contributors/contributors.css`
- Modify: `app/crawls/[slug]/story.css`
- Modify: `app/crawls/crawls.css`
- Modify: `app/feed/feed.css`
- Modify: `app/founders/founders.css`
- Modify: `app/invite/[token]/invite.css`
- Modify: `app/ledger/[id]/ledger.css`
- Modify: `app/messages/messages.css`
- Modify: `app/p/[id]/permalink.css`
- Modify: `app/pal/pal.css`
- Modify: `app/plan/plan.css`
- Modify: `app/rounds/[code]/round.css`
- Modify: `components/PubMapCanvas.tsx`
- Modify: `components/map/mapLayersControl.css`
- Modify: `components/map/mapPriceControl.css`
- Modify: `components/map/venueSheet.css`
- Modify: `components/pubs/pubsGallery.css`

**Interfaces:**
- The test reads source files and asserts mobile CSS invariants.
- Shared control selectors provide the input font floor and no-selection rule for native buttons, role buttons, pressable links, and plan controls.

- [ ] **Step 1: Write source-level failing assertions** for no `100vh` in `app/` and `components/`, shared input font floor, WebKit and standard control selection rules, and `pan-y` on every identified horizontal lane.
- [ ] **Step 2: Run the focused test and confirm it fails on the remaining source gaps.**
- [ ] **Step 3: Apply the smallest shared CSS changes.** Remove the old `100vh` declarations, use `100dvh` for app chrome, preserve existing `100svh` stable heroes, add the shared input floor, and add control selection rules.
- [ ] **Step 4: Run the focused test again and confirm it passes.**

### Task 2: Complete horizontal lane gesture surfaces

**Files:**
- Modify: `components/map/tonightLane.css`
- Modify: `components/map/mapToolbar.css`
- Modify: `components/map/venueSheet.css`
- Modify: `components/mobile/mobileMapShell.css`
- Modify: `components/pubs/pubsGallery.css`
- Modify: `components/drinks/categoryShowcase.css`
- Modify: `components/landing/landing.css`
- Modify: `app/discover/discover.css`
- Modify: `app/feed/feed.css`
- Modify: `app/pal/pal.css`
- Modify: `app/pint-index/pint-index.css`
- Modify: `components/ui/tabs.tsx`
- Exclude: `.mapToolbarSearch` because it is a text input host, not a lane.

**Interfaces:**
- Horizontal scrolling containers keep their existing `overflow-x` and snap behaviour and gain `touch-action: pan-y` or the project utility class.

- [ ] **Step 1: Add failing assertions for every horizontal lane surface identified by `overflow-x` or `overflow-x-auto`.**
- [ ] **Step 2: Run the focused test and confirm each missing gesture rule is reported.**
- [ ] **Step 3: Add `touch-action: pan-y` to the gesture surfaces only, not to body copy or non-scrolling containers.**
- [ ] **Step 4: Run the focused test and confirm it passes.**

### Task 3: Browser proof at 390 x 844

**Files:**
- No production files unless browser proof exposes a regression.
- Record: PR description with commands, screenshots, and observations.

**Interfaces:**
- Chrome DevTools mobile emulation at 390 x 844 verifies focus, long-press selection, and horizontal lane isolation.

- [ ] **Step 1: Start the keyless app with the repository command.**
- [ ] **Step 2: Set emulation to 390 x 844 with device scale factor 3 and verify an input's computed font size is 16px or greater before and during focus.**
- [ ] **Step 3: Long-press a button or chip and verify no label selection occurs, while ordinary venue or price text remains selectable.**
- [ ] **Step 4: Swipe a horizontal lane diagonally and verify lane scroll changes while page scroll does not take over.**
- [ ] **Step 5: Capture screenshots and write concise PR notes with the exact route and DevTools checks.**

### Task 4: Closeout and delivery

**Files:**
- Modify: only files required by the focused tests or browser proof.
- Modify: `AGENTS.md` only if `fm-ensure-agents-md.sh` reports a required maintenance change.

- [ ] **Step 1: Run targeted tests, lint, and typecheck.**
- [ ] **Step 2: Check `memory_pressure -Q`; run the one allowed full suite only when memory permits.**
- [ ] **Step 3: Review the complete diff and confirm no generated file or `CHANGELOG.md` changed.**
- [ ] **Step 4: Run `git fetch origin main` and `git rebase origin/main` immediately before PR creation, then re-run focused verification if the rebase changes files.**
- [ ] **Step 5: Commit on the task branch, push only that branch, open a PR with `gh-axi`, and append the PR URL to the status file.**
