# Sol V0 Gate Truthfulness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep signed-out `/u/you` invitational after failed reads and make a changed crawl stop count visibly pending until its route preview is regenerated.

**Architecture:** Make profile surface selection an explicit pure decision so the sentinel invitation wins over public-read failure for a resolved signed-out viewer. Extend the existing PlanComposer stale-preview contract to include stop-count changes, preserving the old route until the existing single regenerate action produces a new preview.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Chrome DevTools.

## Global Constraints

- `/u/you` is a route sentinel, never a real PUBMAXX Handle.
- Signed-out identity remains tri-state until `identityResolved` is true.
- Product copy uses British English and no em dashes.
- Stop count remains 3 by default and accepts only 3, 4, 5, or 6.
- Use the existing stale-preview and regenerate controls. Do not invent a second refresh action.
- Commit browser evidence under `docs/proof/` and link it from the pull request.

---

### Task 1: Lock profile sentinel branch selection

**Files:**
- Modify: `app/u/[handle]/ProfilePageClient.tsx`
- Test: `__tests__/profileYouRoute.test.ts`

**Interfaces:**
- Consumes: route handle, auth resolution, viewer handle, and public profile load state.
- Produces: an explicit profile surface decision used by the page render and a component-level regression test for a failed signed-out sentinel read.

- [x] **Step 1: Write the failing test**

  Test `profileSurfaceFor({ routeHandle: "you", identityResolved: true, hasUser: false, viewerHandle: "", state: "error" })` and assert it chooses `you-invitation`. Render the invitation surface and assert it contains `Make the night yours.` and no `@you`, `Couldn't load pints`, or six-counter profile markup.

- [x] **Step 2: Run the focused test and confirm it fails for the branch-order reason**

  Run `npm test -- __tests__/profileYouRoute.test.ts`.

- [x] **Step 3: Implement the pure surface decision and move the invitation before gone/error rendering**

  Use the resolved signed-out sentinel condition as the first identity-bearing surface decision. Keep loading neutral while identity is unresolved or a known viewer handle is being redirected.

- [x] **Step 4: Run the focused test and confirm it passes**

  Run `npm test -- __tests__/profileYouRoute.test.ts`.

### Task 2: Lock stop-count preview truthfulness

**Files:**
- Modify: `components/plan/PlanComposer.tsx`
- Test: `__tests__/planComposerCoverage.test.ts`

**Interfaces:**
- Consumes: `NightContext.stopCount` and the existing `routeStale` / `Regenerate route` flow.
- Produces: stop-count changes that mark the old preview stale, with no silent mismatch between selected count and visible route.

- [x] **Step 1: Write the failing test**

  Extend the `nightContextChanged` coverage with a context whose `stopCount` changes from 3 to 4. Assert same-count contexts remain unchanged and the 3-to-4 change returns true.

- [x] **Step 2: Run the focused test and confirm it fails**

  Run `npm test -- __tests__/planComposerCoverage.test.ts`.

- [x] **Step 3: Compare normalised stop counts in `nightContextChanged`**

  Treat missing legacy counts as the default 3. The existing `updateNightContext` then sets `routeStale`, shows the existing pending copy, and exposes one `Regenerate route` action while preserving the old cards.

- [x] **Step 4: Run the focused test and inspect the rendered source contract**

  Run `npm test -- __tests__/planComposerCoverage.test.ts __tests__/planComposerRender.test.ts` and confirm the stale state still names regeneration and the route cannot lock while stale.

### Task 3: Validate and deliver

**Files:**
- Add: `docs/proof/sol-v0-you-signed-out-390x844.png`
- Modify: `docs/proof/sol-v0-you-signed-out-390x844.png` only if replacing a local proof with the final branch capture.

**Interfaces:**
- Consumes: targeted tests, local app, Chrome DevTools, memory-pressure guidance.
- Produces: committed mobile browser proof, validated branch, pushed branch, and direct pull request.

- [x] **Step 1: Reproduce both findings in the real browser and capture the fixed `/u/you` surface**

  Use `chrome-devtools-axi` at 390x844. Force the public read failure for `/u/you`, verify invitation copy remains visible with no `@you` or fake counters, and save the screenshot under `docs/proof/`.

- [x] **Step 2: Run targeted tests, lint, and typecheck**

  Run the focused Vitest files, `npm run lint`, and `npm run typecheck`.

- [x] **Step 3: Check memory pressure before any full suite**

  Run `memory_pressure -Q`. Below 35 percent means targeted validation only. Never run a second full suite while another crewmate may be running one.

- [ ] **Step 4: Commit, rebase, push, and open the pull request**

  Immediately before opening the PR run `git fetch origin main && git rebase origin/main`, then push only `fm/fix-sol-you-sentinel` and use `gh-axi pr create`. The PR body must state: “Stop-count choice: keep the previous preview selected while the new count is pending, because it preserves a usable route and makes the refresh requirement explicit.”
