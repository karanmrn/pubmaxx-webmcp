# RLS Round Four Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep rows hidden through SELECT and DELETE at PostgREST boundary, and make missing-Postgres skips impossible to mistake for passes.

**Architecture:** Extend throwaway PostgreSQL harness with local PostgREST process and signed authenticated requests. Keep read and write RLS policies separate wherever published rows are readable but writes remain owner-only. Test runner owns skip presentation and exposes one stable command for local and CI execution.

**Tech Stack:** PostgreSQL 16, PostgREST 14, SQL RLS policies, Node.js 22, Vitest, TypeScript.

## Global Constraints

- Never apply migration to live Supabase project.
- Do not merge, push to `main`, or deploy.
- Do not touch page copy.
- Preserve existing 21 real PostgreSQL session tests.
- `npx tsc --noEmit` must exit 0 and unit suite must remain at 7510+.

---

### Task 1: Real PostgREST regression seam

**Files:**
- Modify: `scripts/rls/session-harness.mjs`
- Modify: `scripts/rls/session-fixture.sql`
- Modify: `__tests__/rlsWave2Session.test.ts`
- Modify: `.github/workflows/rls-session.yml`

**Interfaces:**
- Consumes: throwaway PostgreSQL cluster and `anon` / `authenticated` roles.
- Produces: `Session.rest(path, options)` backed by real PostgREST and JWT claims.

- [ ] **Step 1: Write failing HTTP-boundary tests**

Add table-driven GET and DELETE cases for `night_moments`, `night_stories`, `night_story_moments`, `community_prices`, and `visit_reports`. Assert hidden GET returns no representation, hidden DELETE returns no representation, and owner-level SQL count proves row survived.

- [ ] **Step 2: Run focused suite and verify red**

Run: `npm run test:rls`

Expected: FAIL because current harness exposes only direct SQL and cannot drive PostgREST.

- [ ] **Step 3: Add minimal PostgREST lifecycle**

Launch pinned PostgREST against throwaway database, wait for HTTP readiness, sign HS256 test JWTs with Node crypto, expose request helper, and stop process during cleanup. Fail hard when PostgreSQL exists but PostgREST cannot start.

- [ ] **Step 4: Run focused suite and verify policy-specific red**

Run tests against pre-fix policy shape and confirm published story join DELETE removes row, while other protected rows survive.

### Task 2: Separate published reads from host writes

**Files:**
- Modify: `supabase/migrations/20260803202000_0067_rls_wave2_owner_policies.sql`
- Modify: `scripts/rls/session-owner-policies.sql`
- Modify: `supabase/migrations/rollback/20260803200000_rls_wave2_rollback.sql`

**Interfaces:**
- Consumes: `night_stories` host, status, and visibility fields.
- Produces: `night_story_moments_host_or_published_select` and `night_story_moments_host_write` policies.

- [ ] **Step 1: Implement minimal policy split**

Keep published or unlisted predicate only on `FOR SELECT`. Keep `FOR ALL` write policy restricted to story host in both `USING` and `WITH CHECK`.

- [ ] **Step 2: Mirror test policy and rollback inventory**

Apply same policy names and predicates to reduced session policy file. Ensure rollback drops both new policy names.

- [ ] **Step 3: Run regression suite green**

Run: `npm run test:rls`

Expected: all original 21 session tests plus new PostgREST cases pass against real PostgreSQL/PostgREST.

### Task 3: Loud missing-Postgres skip

**Files:**
- Modify: `scripts/rls/run-session-tests.mjs`
- Modify: `package.json`
- Create: `__tests__/rlsSessionRunner.test.ts`

**Interfaces:**
- Consumes: `PUBMAX_RLS_NO_PG=1` diagnostic override.
- Produces: stable banner naming suite, missing dependency, skipped state, and explicit `THIS IS NOT A PASS` warning.

- [ ] **Step 1: Write failing process-output test**

Spawn `npm run test:rls` with forced missing-Postgres environment. Assert exit 0 and literal output includes suite name, PostgreSQL reason, skipped count/context, and `THIS IS NOT A PASS`.

- [ ] **Step 2: Run test and verify red**

Run: `npm test -- --run __tests__/rlsSessionRunner.test.ts`

Expected: FAIL against quiet Vitest runner.

- [ ] **Step 3: Route command through loud wrapper**

Print banner to stdout before exiting skipped. When dependencies exist, run Vitest verbose with console output enabled and preserve exit status.

- [ ] **Step 4: Capture skip proof**

Run: `CI=true PUBMAX_RLS_NO_PG=1 npm run test:rls`

Expected: banner visibly says suite skipped, why, and not a pass.

### Task 4: Verification and closeout

**Files:**
- Modify only files required by failing checks.

**Interfaces:**
- Consumes: completed RLS and runner changes.
- Produces: committed branch with reproducible evidence.

- [ ] **Step 1: Run focused checks**

Run `npm run test:rls`, focused policy/session/runner Vitest files, and skip command.

- [ ] **Step 2: Run required project checks**

Run `npx tsc --noEmit` and full `npm test`. Confirm 7510+ tests.

- [ ] **Step 3: Review diff and repository state**

Check security-policy symmetry, rollback names, no page copy, no generated-file churn, and clean status except intended files.

- [ ] **Step 4: Commit**

Commit with message describing DELETE policy cause and PostgREST regression proof.
