# Local Refresh Scheduler Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make review publication fail closed before remote mutation, keep provider secrets out of Git and GitHub subprocesses, and prove one validated row reaches a review branch without changing `main`.

**Architecture:** Keep publication in `scripts/local-refresh/scheduler.mjs`, but give every Git and `gh-axi` call an explicit provider-safe environment. Check the PR executable before branch creation and push. Exercise the complete validation-to-review path against a temporary repository, bare remote, pre-push hook, and fake `gh-axi`, then validate generated launch agents on this macOS account and unload them.

**Tech Stack:** Node.js ESM, Git, `gh-axi`, launchd, Vitest, TypeScript, ESLint.

## Global Constraints

- Never merge, push to `main`, deploy, or apply a migration.
- Do not weaken `ALLOWED_REFRESH_PATHS` or any no-op publication gate.
- Do not touch page copy.
- Strip Exa, Browserbase, Tavily, Ticketmaster, and Skiddle provider keys from Git and PR subprocess environments.
- Prove `npx tsc --noEmit`, `npm run lint`, and at least 7,530 unit tests pass.
- Unload every launch agent loaded during account validation and remove generated temporary plists.

---

### Task 1: Fail closed before remote push

**Files:**
- Modify: `__tests__/localRefreshScheduler.test.ts`
- Modify: `scripts/local-refresh/scheduler.mjs`
- Modify: `scripts/local-refresh/scheduler.d.mts`

**Interfaces:**
- Consumes: `ghAxiPath` passed to `publishPreparedChanges`.
- Produces: an executable-readiness failure before branch creation, commit, or push.

- [x] **Step 1: Write failing publication test**

Add a changed allowlisted row to a temporary Git repository, call `publishPreparedChanges` without `ghAxiPath`, and assert rejection plus unchanged local branches and remote refs.

- [x] **Step 2: Verify RED**

Run: `npm test -- __tests__/localRefreshScheduler.test.ts`

Expected: test fails because current code creates a branch and attempts a push before rejecting the missing PR tool.

- [x] **Step 3: Implement preflight**

Before branch creation, verify `ghAxiPath` is present and executable with `accessSync(path, X_OK)`. Throw an actionable error before any publication mutation.

- [x] **Step 4: Verify GREEN**

Run the focused test and confirm local and remote branches remain unchanged.

### Task 2: Remove provider secrets from external command environments

**Files:**
- Modify: `__tests__/localRefreshScheduler.test.ts`
- Modify: `scripts/local-refresh/scheduler.mjs`
- Modify: `scripts/local-refresh/scheduler.d.mts`

**Interfaces:**
- Consumes: scheduler child environment and optional publication environment.
- Produces: `providerSafeEnvironment(environment)`, preserving ordinary variables and deleting provider secret keys.

- [x] **Step 1: Write failing environment test**

Pass all provider keys plus a safe variable to `providerSafeEnvironment`; expect keys absent, safe variable preserved, and input unchanged.

- [x] **Step 2: Verify RED**

Run the focused test. Expected: import or assertion fails because sanitizer does not exist.

- [x] **Step 3: Implement and route safe environment**

Add a pure sanitizer. Use it for fetch, worktree creation/removal, branch, commit, push, and `gh-axi`; keep acquisition and validation commands on the provider-bearing child environment.

- [x] **Step 4: Verify GREEN**

Run the focused test and confirm sanitizer behavior.

### Task 3: Prove validated review publication without merge

**Files:**
- Modify: `__tests__/localRefreshScheduler.test.ts`

**Interfaces:**
- Consumes: one changed row under `public/data/drink_price_updates/latest.json`, a fixture validation script, a bare Git remote, a pre-push hook, and fake `gh-axi`.
- Produces: assertions that validation ran, only allowlisted data was committed, review PR creation was requested, provider keys were invisible to Git hooks and `gh-axi`, review branch was pushed, and remote `main` remained at its original commit.

- [x] **Step 1: Add full-path integration test**

Create temporary repository and remote, commit original row, modify exactly one row, validate fixture, call `publishPreparedChanges`, and capture Git hook and fake PR command evidence.

- [x] **Step 2: Verify RED**

Run the focused test. Expected: current implementation exposes provider keys or cannot accept an explicit sanitized environment.

- [x] **Step 3: Complete minimal publication wiring**

Pass explicit safe environment through publication helpers without changing allow-list or no-op conditions.

- [x] **Step 4: Verify GREEN and mutation resistance**

Run the focused test. Confirm removing sanitizer, PR call, push, validation, or no-merge assertion makes its corresponding expectation fail.

### Task 4: Validate launchd and repository gates

**Files:**
- Create temporarily, then remove: generated plist directory under the worktree
- Modify only if checks expose defects: scheduler or tests above

**Interfaces:**
- Consumes: `render-launchd`, `/usr/bin/plutil`, and `/bin/launchctl`.
- Produces: captured lint/load/list/unload output with neither scheduler label left registered.

- [x] **Step 1: Render and lint**

Run scheduler `render-launchd` into a temporary worktree directory and run `plutil -lint` on both plists.

- [x] **Step 2: Load and inspect**

Load both plists, run `launchctl list` for both labels, and capture real output.

- [x] **Step 3: Unload and clean up**

Unload both plists in a guaranteed cleanup path, verify both labels are absent, and remove generated files.

- [x] **Step 4: Run required gates**

Run focused integration test, full `npm test`, `npx tsc --noEmit`, and `npm run lint`. Require exit 0 and at least 7,530 passing tests.

- [x] **Step 5: Review and commit**

Review diff, run project `check-work` and verification playbooks, commit only scheduler, declarations, tests, and this plan, then report completion to firstmate.
