# Social Identity Review Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove creation-time ownership authority and refuse disabled Social migration before any identity or storage work.

**Architecture:** Generic profile creation always produces permanently unowned data. Authenticated new-handle creation uses one atomic `createOwned(handle, userId)` store operation, while `linkUser` is current-owner idempotency only. The route checks the beta flag before invoking Supabase verification or the protected migration seam.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, PostgreSQL 16, Supabase service client.

## Global Constraints

- Generic `ensure(handle)` rows can never become account-owned.
- Handle absence and owned creation form one atomic database operation.
- Identity comes only from verified server authority.
- `SOCIAL_INVITE_BETA_ENABLED !== "1"` returns 403 before Supabase, Clerk, or storage work.
- Captain applies migration SQL. No production migration execution or push.
- Use plain hyphens, British spelling, and no agent co-author.

---

### Task 1: Prove both trust-boundary defects

**Files:**
- Modify: `__tests__/profileOwnershipRoute.test.ts`
- Modify: `__tests__/legacyHandleFreeze.test.ts`
- Modify: `__tests__/socialAccessRoute.test.ts`

**Interfaces:**
- Consumes: `memoryProfileStore.ensure`, `memoryProfileStore.linkUser`, canonical onboarding, `POST` from `app/api/social/access/route.ts`.
- Produces: attack probes proving ensured unowned data cannot be claimed and disabled POST calls no verifier.

- [ ] **Step 1: Add attacker probe**

```ts
const anonymous = await memoryProfileStore.ensure("anonymous_night");
await expect(
  memoryProfileStore.linkUser("anonymous_night", "attacker"),
).rejects.toThrow("not available");
expect((await memoryProfileStore.getByHandle("anonymous_night"))?.id).toBe(anonymous.id);
```

- [ ] **Step 2: Add early-gate route probe**

```ts
process.env.SOCIAL_INVITE_BETA_ENABLED = "0";
await expect(POST(request())).resolves.toMatchObject({ status: 403 });
expect(authVerifierCalls).toBe(0);
expect(migrationCalls).toBe(0);
```

- [ ] **Step 3: Run focused tests and verify expected failures**

Run: `npm test -- __tests__/profileOwnershipRoute.test.ts __tests__/legacyHandleFreeze.test.ts __tests__/socialAccessRoute.test.ts`

Expected: attacker claim succeeds under old `ephemeral` authority and disabled route invokes auth verifier.

### Task 2: Replace ephemeral authority with atomic owned creation

**Files:**
- Modify: `lib/profileStore.ts`
- Modify: `lib/profileOwnership.ts`
- Modify: `lib/identityHandleStore.ts`
- Modify: `supabase/migrations/20260805100000_0071_social_identity_assurance.sql`
- Modify: `supabase/migrations/rollback/20260805100000_0071_social_identity_assurance_rollback.sql`
- Modify: focused profile and migration tests and trusted fixtures that directly seed ownership.

**Interfaces:**
- Consumes: normalized handle and authenticated user UUID.
- Produces: `ProfileStore.createOwned(handle: string, userId: string): Promise<ProfileRecord>`.

- [ ] **Step 1: Make generic ensure permanently unowned**

`ensure` leaves `user_id` unset. Delete `ephemeral` and its provenance column. `linkUser` returns only when existing `userId === caller`, otherwise refuses.

- [ ] **Step 2: Add atomic owned creation**

Memory implementation checks absence and inserts a record with `userId` synchronously in one operation. Supabase inserts `handle` and `user_id` together, returns same-owner success on retry, and refuses existing unowned or differently owned rows.

- [ ] **Step 3: Move authenticated creation callers**

Canonical onboarding and identity-handle claim use `createOwned`. Trusted tests that need an owned profile seed it with `createOwned`, never `ensure` then `linkUser`.

- [ ] **Step 4: Update migration proof**

Assert all unowned rows are frozen, atomic absent-handle ownership succeeds, current-owner retry succeeds, and competing ownership cannot inherit existing data.

- [ ] **Step 5: Run focused ownership and PostgreSQL suites**

Run the profile, onboarding, redaction, visibility, identity, and `socialIdentityMigration` suites. Expected: all pass.

### Task 3: Gate disabled migration before identity

**Files:**
- Modify: `app/api/social/access/route.ts`
- Modify: `lib/socialAccessServer.ts`
- Modify: `__tests__/socialAccessRoute.test.ts`
- Modify: `__tests__/socialAccessServer.test.ts`
- Modify: `docs/WRITE_SURFACE_CERTIFICATION.md` if authority wording changes.

**Interfaces:**
- Consumes: `SOCIAL_BETA_ENABLED` at request boundary.
- Produces: 403 `{ code: "SOCIAL_BETA_DISABLED" }` without invoking Supabase, Clerk, or storage dependencies.

- [ ] **Step 1: Add one shared beta predicate at policy owner**

Export the existing boolean policy predicate rather than duplicating environment parsing.

- [ ] **Step 2: Short-circuit route before `verifyCallerAuth`**

The route returns the existing disabled response first. Keep the server seam defence in depth for direct internal callers.

- [ ] **Step 3: Run route/server/certification tests**

Expected: early probe and prior explicit-authority certification pass.

### Task 4: Closeout and evidence

**Files:**
- Modify: `.superpowers/sdd/2026-08-05-verified-social-night-loop/task-2-report.md`

- [ ] **Step 1: Run shape, diff, and docs review**

Remove `ephemeral` ownership sediment, search every `ensure` plus `linkUser` caller, and confirm one atomic owner.

- [ ] **Step 2: Run fresh verification**

Run focused tests, complete `npm test`, `npm run lint`, `npm run typecheck`, and `git diff --check`. Record exact counts and elapsed time.

- [ ] **Step 3: Commit implementation and report separately**

Use normal commit messages. Do not push.
