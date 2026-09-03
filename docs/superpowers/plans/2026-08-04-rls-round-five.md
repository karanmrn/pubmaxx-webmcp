# RLS Round Five Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute every RLS wave-2 migration and every effective session case on local PostgreSQL 16 plus PostgREST 14, prove full rollback restores pre-wave policy and privilege state, and verify private Pint Drop storage remains server-signed and client-denied.

**Architecture:** Reuse real repository migration history as test setup: a small Supabase bootstrap creates only platform-owned roles, `auth.uid()`, `auth.users`, Storage objects, and Realtime publication, then all 80 pre-wave migrations establish prior state. Harness snapshots effective policies and privileges, applies exact 0065 through 0069 files, runs SQL and PostgREST assertions, applies rollback, and compares full catalog snapshot. Exact migrations become sole policy owner; reduced 0067 and 0068 copies are deleted.

**Tech Stack:** PostgreSQL 16.14, PostgREST 14.16, SQL RLS policies, Node.js 24.19.0, Vitest, TypeScript.

## Global Constraints

- Never connect to or apply migration to live Supabase project.
- Do not merge, push to `main`, or deploy.
- Run locally because GitHub Actions fails before job allocation.
- Preserve friends-gated Pint Drop reads, hidden-row SELECT and DELETE denial, and service-only private identity writes.
- Private `pint-drops` bucket remains server-owned: service-role code creates signed URLs; anon and authenticated direct object reads remain denied.
- Report exactly which tables have effective session tests. Never count migration application or inventory assertions as policy tests.

---

### Task 1: Carry round-four security fixes onto required base

**Files:**
- Modify by cherry-pick: `.github/workflows/ci.yml`
- Modify by cherry-pick: `.github/workflows/rls-session.yml`
- Create by cherry-pick: `__tests__/rlsSessionRunner.test.ts`
- Modify by cherry-pick: `__tests__/rlsWave2Session.test.ts`
- Create by cherry-pick: `scripts/rls/run-session-tests.mjs`
- Modify by cherry-pick: `scripts/rls/session-fixture.sql`
- Modify by cherry-pick: `scripts/rls/session-harness.mjs`
- Modify by cherry-pick: `scripts/rls/session-owner-policies.sql`
- Modify by cherry-pick: `supabase/migrations/20260803202000_0067_rls_wave2_owner_policies.sql`
- Modify by cherry-pick: `supabase/migrations/rollback/20260803200000_rls_wave2_rollback.sql`

**Interfaces:**
- Consumes: `origin/fm/rls-r4-resume` commits `72ab6dcf` and `f266b5e9`.
- Produces: 34-case round-four suite with PostgREST boundary tests and split Night Story read/write policies.

- [x] **Step 1: Cherry-pick both reviewed round-four commits**

Run: `git cherry-pick 72ab6dcf f266b5e9`

Expected: both commits apply cleanly on `9d5bafce`; `git log -3` shows round-four commits above required base.

- [x] **Step 2: Verify inherited source-level runner tests**

Run: `npm test -- --run __tests__/rlsWave2Policies.test.ts __tests__/rlsSessionRunner.test.ts`

Expected: 37 tests pass. This is not session proof because Postgres/PostgREST cases have not run yet.

### Task 2: Make exact migration history the only test policy owner

**Files:**
- Modify: `scripts/rls/session-fixture.sql`
- Modify: `scripts/rls/session-harness.mjs`
- Delete: `scripts/rls/session-owner-policies.sql`
- Delete: `scripts/rls/session-service-role.sql`
- Modify: `__tests__/rlsSessionRunner.test.ts`

**Interfaces:**
- Consumes: sorted `supabase/migrations/*.sql` before `20260803200000`, followed by exact `WAVE2` filenames.
- Produces: `startRlsSession()` result with `appliedForwardMigrations: string[]`, `preWaveCatalogSnapshot: string`, and `catalogSnapshot(): string`.

- [x] **Step 1: Write failing migration-execution regression**

Add an effective session assertion that `appliedForwardMigrations` equals the five literal 0065 through 0069 filenames. Current reduced runner returns no applied-file evidence, so this observes real harness behavior rather than grepping source.

Run: `npm run test:rls`

Expected: FAIL because harness does not expose exact applied migrations.

- [x] **Step 2: Reduce fixture to platform bootstrap**

Keep only `anon`, `authenticated`, and `service_role` roles; `auth.users`; `auth.uid()`; `supabase_realtime`; and private `storage.objects` with RLS enabled. Remove copied public application tables and copied prior policies because real pre-wave migrations own them.

- [x] **Step 3: Apply real history and exact wave files**

Read migration directory with `readdirSync`, sort filenames, apply all files before first wave filename, capture pre-wave catalog snapshot, then apply every `WAVE2` filename through same `sqlFile` path. Delete reduced SQL copies.

Run: `npm run test:rls`

Expected: exact migration execution regression passes.

### Task 3: Prove storage boundary and all earlier RLS defects

**Files:**
- Modify: `__tests__/rlsWave2Session.test.ts`
- Modify only if test proves need: `supabase/migrations/20260803205000_0070_private_pint_drop_storage.sql`

**Interfaces:**
- Consumes: actual schemas produced by pre-wave migrations; private `storage.objects`; existing `Session.sql` and `Session.rest` helpers.
- Produces: effective SQL/PostgREST proof for 8 policy tables plus deny-only Storage boundary.

- [x] **Step 1: Update seed for real schema**

Insert four IDs into `auth.users` before FK-backed profiles and Night Story rows. Keep existing public/friends/legacy/hidden/pending, community-price, identity, plan, message, saved-pub, structured-report, Round, and Night Story fixtures.

- [x] **Step 2: Write private Storage test before any storage policy**

Seed `storage.objects` as table owner. Assert anon and authenticated SQL sessions cannot select it, while `service_role` can. Re-run `__tests__/pintDropsStore.test.ts`, whose signed-URL output proves application reads use the server-side Storage client.

Run: `npm run test:rls`

Expected: direct client read denied and service-role read allowed. If authenticated read unexpectedly fails the product path, add owner-scoped SELECT policy only after proving key-to-user ownership from durable schema. Current server-signed path should require no permissive policy.

- [x] **Step 3: Run all earlier defect cases against exact migrations**

Run: `npm run test:rls`

Expected: author/follower/non-follower/stranger Pint Drop cases pass; authors cannot read hidden Pint Drops, community prices, or structured Visit Reports; authenticated identity INSERT/UPDATE/DELETE fail; protected PostgREST DELETEs preserve all five rows.

### Task 4: Make rollback catalog-exact

**Files:**
- Modify: `scripts/rls/session-harness.mjs`
- Modify: `__tests__/rlsWave2Session.test.ts`
- Modify: `supabase/migrations/rollback/20260803200000_rls_wave2_rollback.sql`

**Interfaces:**
- Consumes: `preWaveCatalogSnapshot` captured before exact 0065 through 0069 application.
- Produces: deterministic snapshot covering public/storage policies, anon/authenticated/service-role table privileges, public routine privileges, and definitions of wave helper/RPC functions.

- [x] **Step 1: Write failing full rollback comparison**

Replace one-policy/helper-count assertion with:

```ts
expect(() => s.sqlFile(s.rollbackPath)).not.toThrow();
expect(s.catalogSnapshot()).toBe(s.preWaveCatalogSnapshot);
```

Run: `npm run test:rls`

Expected: FAIL with concrete policy or privilege diff because existing rollback restores only selected objects.

- [x] **Step 2: Restore exact pre-wave policies and privileges**

Use red snapshot diff to write explicit idempotent SQL restoring every policy, table privilege, function definition, and execute privilege changed by 0065 through 0069. Remove rollback restorations absent immediately before wave, including any historical policy superseded before 0065. Keep script runnable with `to_regclass` and `to_regprocedure` guards.

- [x] **Step 3: Prove exact rollback green**

Run: `npm run test:rls`

Expected: all session cases pass, rollback executes, and post-rollback snapshot byte-matches pre-wave snapshot.

### Task 5: Local evidence, honest coverage, and commit

**Files:**
- Modify: `AGENTS.md` only if durable command/invariant is not already recorded.
- Create: `docs/proof/rls/round-five-local.md`

**Interfaces:**
- Consumes: installed PostgreSQL 16.14 and PostgREST 14.16.
- Produces: committed local evidence with commands, versions, unedited test output, rollback result, and exact tested-table statement.

- [x] **Step 1: Provision PostgREST and capture versions**

Run: `brew install postgrest`, `postgres --version`, and `postgrest --version`.

Expected: PostgreSQL 16.14 and PostgREST 14.16 available locally.

- [x] **Step 2: Capture focused proof**

Run `npm run test:rls`, focused policy/runner tests, `npm run typecheck`, and `npm run lint`. Paste actual command output into proof report. State that effective policy tests cover `visit_reports`, `community_prices`, `private_account_identities`, `plans`, `messages`, `saved_pubs`, `structured_visit_reports`, `rounds`, `night_moments`, `night_stories`, and `night_story_moments`; classify `storage.objects` separately as tested deny-by-default boundary with no permissive product policy.

- [x] **Step 3: Run project gate**

Run: `npm run verify`

Expected: data validation, lint, typecheck, coverage, and resilient audit pass.

- [x] **Step 4: Review and commit**

Inspect `git diff --check`, `git status`, and full branch diff. Revert generated `next-env.d.ts` or `package.json` tooling churn if present. Commit intended changes with message `fix(security): prove full RLS migration rollback locally`.
