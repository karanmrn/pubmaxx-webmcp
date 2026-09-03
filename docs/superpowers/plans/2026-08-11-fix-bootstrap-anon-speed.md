# Anonymous Bootstrap and Quiet-Night Vibes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visitors without a durable resume hint reach truthful signed-out surfaces immediately, keep hinted session recovery awaited and safe, and remove quiet-night vibe controls that cannot act.

**Architecture:** Keep `bootstrapAuthSession` as the single auth seam. It will return `none` after the cheap hint says no cookie, await redemption when a hint exists, and convert rejected redemption to `unavailable`. `AuthProvider` will settle from that outcome and catch the async bootstrap boundary. Tonight will derive visible vibe chips from available What's-On kinds, so kind-backed chips disappear when no matching listing exists while rank-backed links remain usable.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Playwright/Chrome DevTools.

## Global Constraints

- Preserve durable resume redemption when a hint exists.
- Never let a rejected bootstrap promise produce an unhandled rejection.
- Use British English and no em dash in product copy.
- Do not add supporting copy below labels unless it prevents misunderstanding.
- Follow `CONTEXT.md` and `AGENTS.md`; do not modify generated files or `CHANGELOG.md`.
- Run at most one full suite and run `memory_pressure -Q` before it.
- Before PR creation, run `git fetch origin main && git rebase origin/main`.

---

### Task 1: Reproduce and lock auth bootstrap behaviour

**Files:**
- Modify: `__tests__/authSessionBootstrap.test.ts`
- Inspect: `lib/authSessionBootstrap.ts`, `components/auth/AuthProvider.tsx`

**Interfaces:**
- Consumes: `bootstrapAuthSession(auth, deps)` and `AuthProvider` source contract.
- Produces: tests proving no-hint fast settlement, hinted redemption wait, and rejected redemption safety.

- [ ] **Step 1: Run the existing auth test and reproduce the browser timing.**

Run `npm test -- __tests__/authSessionBootstrap.test.ts` and the keyless dev/browser timing loop from the Sol report. Record before timings and console errors in the task report.

- [ ] **Step 2: Add a no-hint test that measures elapsed fake time.**

Use a deferred hint promise plus `vi.useFakeTimers()` and assert the bootstrap resolves to `{ status: "none" }` immediately after the hint resolves, with elapsed fake time far below `AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS` and no redemption call.

- [ ] **Step 3: Add a rejected-redemption test.**

Make `redeem` reject with an `Error`, then assert `bootstrapAuthSession` resolves to `{ status: "unavailable" }` instead of rejecting.

- [ ] **Step 4: Run the focused test and confirm the new tests fail for the current implementation or source contract.**

Run `npm test -- __tests__/authSessionBootstrap.test.ts`; correct only test setup errors before implementation.

### Task 2: Fix anonymous auth settlement without weakening restore

**Files:**
- Modify: `lib/authSessionBootstrap.ts`
- Modify: `components/auth/AuthProvider.tsx`
- Test: `__tests__/authSessionBootstrap.test.ts`

**Interfaces:**
- Consumes: the Task 1 bootstrap outcome contract.
- Produces: a caught bootstrap invocation that always settles session loading for no-hint, restored, expired, and unavailable outcomes.

- [ ] **Step 1: Implement the smallest bootstrap fix.**

Keep the no-hint return immediate, keep the hint path awaiting `redeem`, and retain the rejection catch returning `unavailable`. Remove only any remaining timeout-based anonymous hold that is unnecessary after bootstrap has a fast no-hint result.

- [ ] **Step 2: Catch the AuthProvider bootstrap boundary.**

Wrap the async bootstrap call in `try/catch` or attach a rejection handler so an unexpected rejection becomes `{ status: "unavailable" }`, clears loading, and cannot reach the browser as `Uncaught (in promise)`.

- [ ] **Step 3: Run the focused auth test and typecheck the changed files.**

Run `npm test -- __tests__/authSessionBootstrap.test.ts` and `npm run typecheck`.

### Task 3: Hide inapplicable quiet-night kind vibes

**Files:**
- Modify: `app/tonight/TonightClient.tsx`
- Modify: `__tests__/tonight.test.ts` or add a focused test beside the existing Tonight tests.

**Interfaces:**
- Consumes: `VIBE_CHIPS`, `laneKindFacets`, and the current `status`/`facets` model.
- Produces: a visible chip list where filter-backed vibes appear only when their kind is present, while rank-backed links remain visible.

- [ ] **Step 1: Add a pure visibility test.**

Assert that an empty listing set exposes no filter-backed vibes but still exposes honest rank-backed choices such as Quiet pint, and that a ready set exposes only filter-backed kinds present in its facets.

- [ ] **Step 2: Run the focused test and confirm it fails.**

Run the selected Tonight/Vibe test file and verify the failure is the missing visibility policy.

- [ ] **Step 3: Implement the visibility filter in `TonightClient`.**

Derive visible `VIBE_CHIPS` from `status` and `facets`; do not disable dead-looking buttons or add copy that implies an unavailable listing. Render the existing rank-backed links unchanged.

- [ ] **Step 4: Run Tonight/Vibe focused tests and typecheck.**

Run the selected test files and `npm run typecheck`.

### Task 4: Verify, document evidence, and deliver PR

**Files:**
- Modify: `/Users/karanmanoharan/karan-agent-workspace/data/sol-deep-review/report.md` only if the task report is the requested external report and is writable; otherwise write the requested evidence to the task report path without changing project docs.
- Modify: `report.md` in the requested workspace path with timings, screenshots, tests, and commit/PR details.

- [ ] **Step 1: Run the exact browser proof on keyless build.**

Use clean storage, `390x844`, device scale `3`, mobile/touch emulation, Fast 4G, warm `/`, then poll `/u/you` for `Make the night yours` and `/social` for `Sign in to use Social`. Capture before/after timings, console errors, and screenshots with `chrome-devtools-axi`.

- [ ] **Step 2: Run a short regression sweep.**

Check `/tonight` quiet state and assert hidden inapplicable vibes, retained rank-backed link behaviour, no dead control, and no new unhandled rejection.

- [ ] **Step 3: Run the required validation budget.**

Run `memory_pressure -Q`; run targeted tests and lint/typecheck. Run at most one full suite if memory is above the threshold and time permits.

- [ ] **Step 4: Re-read the diff, run `git fetch origin main && git rebase origin/main`, then verify the rebased worktree.**

- [ ] **Step 5: Commit, push `fm/fix-bootstrap-anon-speed`, open a PR with `gh-axi`, append the PR URL to the status file, and stop.**
