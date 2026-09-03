# Social Identity Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all five Task 2 review findings without reopening first-touch claims or breaking established profile creation flows.

**Architecture:** Every unowned profile remains frozen. Authenticated new handles are created with `user_id` set atomically, without a claimable intermediate state. The Social migration route exposes an explicit account authority boundary and beta-write gate, while the account migration RPC acquires identity and account locks in deterministic order.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Vitest, PostgreSQL 16, Supabase service-role RPCs.

## Global Constraints

- Do not modify `lib/clerkIdentity.ts`.
- Keep migration suffix `0071`; captain applies production SQL.
- Preview denies Social writes.
- Do not add Yoti hosted-session, result, or webhook integration without an official signed fixture.
- Never use an em dash in product copy.

---

### Task 1: Preserve legitimate profile linkage while freezing legacy rows

**Files:**
- Modify: `lib/profileStore.ts`
- Modify: `lib/identityHandleStore.ts`
- Modify: `lib/profileOwnership.ts`
- Modify: `supabase/migrations/20260805100000_0071_social_identity_assurance.sql`
- Modify: `supabase/migrations/rollback/20260805100000_0071_social_identity_assurance_rollback.sql`
- Test: `__tests__/profileStore.test.ts`
- Test: `__tests__/legacyHandleFreeze.test.ts`
- Test: `__tests__/profileOwnershipRoute.test.ts`
- Test: `__tests__/socialIdentityMigration.test.ts`

**Interfaces:**
- Consumes: `ProfileStore.ensure(handle)`, `ProfileStore.createOwned(handle, userId)`, and current-owner-only `ProfileStore.linkUser(handle, userId)`.
- Produces: atomic absent-handle ownership and frozen generic profile rows.

- [ ] Add red tests proving generic ensure cannot transfer ownership, atomic owned creation succeeds, and same-owner retry survives alias-cache loss.
- [ ] Run focused tests and capture expected failures from blanket existing-row rejection.
- [ ] Add the atomic creation transition to both stores and SQL without a second ownership state.
- [ ] Run all profile, ownership, visibility, and deletion/redaction callers green.

### Task 2: Gate and certify Social migration writes

**Files:**
- Modify: `app/api/social/access/route.ts`
- Modify: `lib/socialAccessServer.ts`
- Modify: `__tests__/socialAccessServer.test.ts`
- Modify: `__tests__/socialAccessRoute.test.ts`
- Modify: `__tests__/writeSurfaceCertification.test.ts`
- Modify: `docs/WRITE_SURFACE_CERTIFICATION.md`

**Interfaces:**
- Consumes: `verifyCallerAuth(request)` as route-level verified Supabase authority.
- Produces: migration helper accepting only server-derived Clerk and Supabase identities; `SOCIAL_BETA_DISABLED` refusal before any identity or storage work.

- [ ] Add red tests proving disabled beta performs no migration work and the write route is certified.
- [ ] Run focused route/certification tests and capture failures.
- [ ] Move Supabase authority resolution to the route, retain Clerk verification in the protected server seam, and deny preview writes.
- [ ] Update explicit inventory and route certification.

### Task 3: Make migration locking deterministic

**Files:**
- Modify: `supabase/migrations/20260805100000_0071_social_identity_assurance.sql`
- Modify: `__tests__/socialIdentityMigration.test.ts`

**Interfaces:**
- Consumes: `migrate_social_product_account(text, uuid)`.
- Produces: sorted advisory lock acquisition and sorted `private_social_accounts.id` row locking.

- [ ] Add a concurrent crossed-account PostgreSQL test with synchronized clients and bounded timeout.
- [ ] Run against current migration and capture deadlock failure.
- [ ] Acquire every lock in deterministic order and keep conflict output idempotent.
- [ ] Run migration test repeatedly to prove no deadlock.

### Task 4: Correct legal and evidence claims

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Modify: `__tests__/legalPages.test.ts`
- Modify: `.superpowers/sdd/2026-08-05-verified-social-night-loop/task-2-report.md`

**Interfaces:**
- Produces: current-state disclosure limited to service-only Yoti-shaped evidence storage and conditional future provider processing.

- [ ] Add red legal tests rejecting claims that hosted Yoti checks or callbacks operate.
- [ ] Rewrite privacy, terms, and report claims to distinguish shipped evidence foundations from deferred integration.
- [ ] Run legal tests green.

### Task 5: Verify and commit

**Files:**
- Modify: `.superpowers/sdd/2026-08-05-verified-social-night-loop/task-2-report.md`

- [ ] Run focused policy, route, store, migration, certification, legal, and every restored caller test.
- [ ] Run `npm test` to completion and record exact test/file counts.
- [ ] If only timeouts fail, rerun affected files single-worker and record both results.
- [ ] Run `npm run lint`, `npm run typecheck`, and `git diff --check`.
- [ ] Run shape, diff, and docs review passes; update report with exact evidence.
- [ ] Commit fixes and report separately. Do not push.
