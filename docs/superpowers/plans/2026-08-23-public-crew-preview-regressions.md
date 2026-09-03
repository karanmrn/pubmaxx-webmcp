# Public Crew Preview Regression Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep account-free Open Crew previews private and correct while supporting provider-neutral verified Social auth and the stacked 0114/0115 migration proof.

**Architecture:** Keep public preview data account-free and service-only. Bind private join state to the current account and crew, and make every deferred client response reject stale crew or identity generations. Preserve the existing 0114 queue migration and prove 0114 before 0115 in PostgreSQL tests.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Supabase PostgreSQL migrations.

**Spec:** PR #1140 review findings for `codex/issue-1081-public-open-crew`.

## Global Constraints

- Do not expose member lists, counts, request state, or plan details from the public preview.
- Use existing provider-neutral server auth and adult verification seams.
- Do not duplicate or rewrite the 0114 queue migration.
- Use failing tests before production changes.

### Task 1: Add failing client-state regression coverage

**Files:**
- Modify: `__tests__/publicCrewPreviewComponent.test.tsx` or the existing route-client test seam
- Create if needed: `__tests__/publicCrewRouteClient.test.tsx`

- [ ] **Step 1: Write failing tests** for Clerk-compatible protected reads, account-switch clearing, stale crew navigation, and stale deferred join responses.
- [ ] **Step 2: Run the focused tests** and confirm each failure is caused by the missing behavior.

### Task 2: Fix provider-neutral and generation-bound client state

**Files:**
- Modify: `components/social/PublicCrewRouteClient.tsx`
- Modify: `app/social/crews/[crewId]/page.tsx`

- [ ] **Step 1: Use identity readiness without requiring a Supabase session** for protected reads.
- [ ] **Step 2: Key or reset the route client by `crewId` and bind async results to the active crew generation.
- [ ] **Step 3: Bind join state and idempotency keys to the current account identity and reject stale responses.
- [ ] **Step 4: Run the route-client tests and the existing public preview tests.

### Task 3: Prove the complete migration stack

**Files:**
- Add from dependency branch: `supabase/migrations/20260823100000_0114_social_crew_join_request_queue.sql`
- Add from dependency branch: `supabase/migrations/rollback/20260823100000_0114_social_crew_join_request_queue_rollback.sql`
- Modify: `__tests__/openSocialCrewsMigration.test.ts`

- [ ] **Step 1: Bring in the exact 0114 migration and rollback without rewriting them.
- [ ] **Step 2: Make the effective PostgreSQL proof apply 0114 before 0115.
- [ ] **Step 3: Run migration tests and rollback coverage.

### Task 4: Verify and hand off

- [ ] **Step 1: Run focused Vitest tests.
- [ ] **Step 2: Run effective PostgreSQL migration proof if local PostgreSQL is available.
- [ ] **Step 3: Run lint and typecheck.
- [ ] **Step 4: Review the diff, commit, push `codex/issue-1081-public-open-crew`, and update PR #1140.
