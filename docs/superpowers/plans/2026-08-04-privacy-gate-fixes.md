# Privacy Gate Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close privacy gate gaps by using one three-decimal coordinate seam at every first-party boundary and proving rate-limit expiry against a real PostgreSQL database.

**Architecture:** `coarsenViewerPoint` in `lib/geo.ts` remains sole precision owner. Browser callers and first-party API parsers invoke it after numeric validation. Rate-limit migration proof starts a throwaway local PostgreSQL cluster, applies actual migration, inserts expired and fresh rows, invokes expiry through real SQL functions, and checks stored rows.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, PostgreSQL 16, Supabase SQL migrations.

## Global Constraints

- Branch from `origin/fm/privacy-628`; do not merge, deploy, or push to `main`.
- Viewer coordinates use `coarsenViewerPoint`; no caller-owned rounding.
- PostgreSQL absence produces explicit skipped tests plus visible reason, never passed tests.
- Do not add RLS policies.
- Privacy copy changes only when required for factual accuracy.
- Required closeout: `npx tsc --noEmit`, `npm run lint`, and at least 7,513 unit tests.

---

### Task 1: Browser and route coordinate boundaries

**Files:**
- Modify: `__tests__/viewerCoordinateEgress.test.ts`
- Modify: `app/today/TodayTubeCard.tsx`
- Modify: `lib/whatsOnHandler.ts`
- Modify: `app/api/tonight-conditions/route.ts`
- Modify: `app/api/tfl-disruption/route.ts`

**Interfaces:**
- Consumes: `coarsenViewerPoint(point: { lat: number; lng: number })` from `lib/geo.ts`.
- Produces: three-decimal points before Today fetch construction and before each route passes parsed coordinates into application logic.

- [ ] **Step 1: Extend shared-seam regression coverage**

Add Today card, What's On handler, Tonight Conditions route, and TfL disruption route to `VIEWER_COORDINATE_EGRESS_FILES`. This catches removing `coarsenViewerPoint` from any boundary and fails on both current candidate and `origin/main`.

- [ ] **Step 2: Run test and verify expected failure**

Run: `npx vitest run __tests__/viewerCoordinateEgress.test.ts`

Expected: four failures naming missing shared-seam calls.

- [ ] **Step 3: Route every boundary through shared point seam**

In Today card, coarsen `rememberedAreaCentre` result before URL construction. In What's On handler, coarsen validated `near`. In Tonight Conditions and TfL disruption routes, coarsen validated `lat` and `lng` together before constructing point arrays or resolving a patch. Do not add `toFixed`, `Math.round`, or another precision constant.

- [ ] **Step 4: Run focused coordinate tests**

Run: `npx vitest run __tests__/viewerCoordinateEgress.test.ts __tests__/whatsOnStoreRoute.test.ts __tests__/tonightConditionsRoute.test.ts __tests__/tflDisruption.test.ts __tests__/venueJourney.test.ts __tests__/lastTrainDestination.test.ts`

Expected: all pass.

### Task 2: Runtime PostgreSQL expiry proof

**Files:**
- Replace: `__tests__/rateLimitExpiryMigration.test.ts`

**Interfaces:**
- Consumes: `supabase/migrations/20260804120000_0070_rate_limit_expiry.sql` as executable SQL.
- Produces: runtime assertions for `prune_expired_rate_limits`, `check_rate_limit`, and `charge_round_price_line` deletion behavior.

- [ ] **Step 1: Replace source regex checks with PostgreSQL behavior tests**

Build an ephemeral-cluster harness inside test file using `initdb`, `postgres`, and `psql`. Create only prerequisite roles and table shapes, apply actual migration with `psql -f`, then expose SQL execution for assertions. If binaries are missing, print visible skip banner naming required binaries and mark every behavior case skipped.

- [ ] **Step 2: Prove old-row deletion and fresh-row survival**

Insert `expired` with `expires_at = now() - interval '1 minute'` and `fresh` with `expires_at = now() + interval '1 hour'`. Call `public.prune_expired_rate_limits()` and assert query returns only `fresh`.

- [ ] **Step 3: Prove both durable writer paths trigger cleanup**

Repeat old/fresh seed before `public.check_rate_limit(...)`, then before a valid `public.charge_round_price_line(...)`. Assert old row is gone and fresh row remains after each function call.

- [ ] **Step 4: Run runtime test**

Run: `npx vitest run __tests__/rateLimitExpiryMigration.test.ts --reporter=verbose --silent=false`

Expected with PostgreSQL: three passed behavior tests. Expected without PostgreSQL: three skipped tests plus explicit `RATE-LIMIT EXPIRY TESTS SKIPPED - THIS IS NOT A PASS` banner and missing-binary reason.

### Task 3: Truthfulness, review, and verification

**Files:**
- Review: `app/privacy/page.tsx`
- Review: all changed files

**Interfaces:**
- Consumes: implemented coordinate and expiry behavior.
- Produces: truthful privacy notice and verified branch commit.

- [ ] **Step 1: Recheck privacy notice against implementation**

Confirm three-decimal Today statement and expiry statement match shipped code. Edit only inaccurate factual sentences.

- [ ] **Step 2: Run required gates**

Run: `npx tsc --noEmit`, `npm run lint`, and `npm test`.

Expected: exit 0, lint 0 errors, and at least 7,513 tests.

- [ ] **Step 3: Review scope and diff quality**

Run: `git diff --check`, inspect `git diff origin/fm/privacy-628...HEAD`, and verify no hand-rolled coordinate rounding entered changed egress files.

- [ ] **Step 4: Commit**

Commit implementation and tests on `fm/privacy-628-r2`. Do not push or create PR.
