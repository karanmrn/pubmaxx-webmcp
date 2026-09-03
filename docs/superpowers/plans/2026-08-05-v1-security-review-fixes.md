# V1 Security Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all round-one security review findings without weakening the Task 1 release boundary.

**Architecture:** Keep server ownership at existing seams. Reserved-handle policy remains centralized in profile ownership, Clerk visibility derives from product-session state, RLS proof executes real PostgreSQL and PostgREST catalogs, and voice compensation emits bounded server diagnostics for reconciliation.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, PostgreSQL 16, PostgREST, Supabase SQL migrations.

## Global Constraints

- Use strict red-green-refactor for every behavior change.
- Never modify applied migration `0067`.
- Keep owner identity server-derived and provider secrets server-only.
- Preserve keyless local operation.
- Do not add a second identity model.
- Never use an em dash.
- Captain applies migrations. Agent ships SQL only.

---

### Task 1: Reserved Handle Denial

**Files:**
- Modify: `lib/profileOwnership.ts`
- Modify: `__tests__/profileOwnership.test.ts`
- Modify: focused public identity route or gate tests under `__tests__/`

**Interfaces:**
- Consumes: existing reserved-handle predicate and anonymous-account allowance.
- Produces: reserved handles return unavailable before any anonymous allowance.

- [ ] Add a test where anonymous ownership resolution requests a reserved handle and expects denial.
- [ ] Run the focused test and confirm current code returns anonymous allowance.
- [ ] Move reserved-handle rejection before anonymous allowance in both ownership paths.
- [ ] Re-run profile ownership, gate action, and public route tests to green.

### Task 2: Shared Clerk Product-Session Gate

**Files:**
- Modify: `components/auth/SignInButton.tsx`
- Modify: `components/auth/ClerkAccountControls.tsx`
- Modify: `components/identity/IdentityNudge.tsx`
- Modify or create: focused auth component tests under `__tests__/`

**Interfaces:**
- Consumes: product Supabase `user` from `useAuth()` and Clerk configuration.
- Produces: one visible-availability condition, `Boolean(user) && isClerkConfigured()`.

- [ ] Add a signed-in product-session test expecting reachable Clerk secondary controls.
- [ ] Add signed-out Identity Nudge test proving publishable-key-only Clerk cannot make auth available.
- [ ] Run both tests and confirm dead-control and stale-availability failures.
- [ ] Render Clerk secondary controls from signed-in branch and derive nudge Clerk availability from product session.
- [ ] Re-run all focused Clerk, sign-in, and identity-nudge tests to green.

### Task 3: Effective Migration Proof

**Files:**
- Modify: `__tests__/rlsWave2Policies.test.ts` or its PostgreSQL/PostgREST harness helpers.
- Modify: `__tests__/v1ReleaseSecurityMigration.test.ts` only to label shape checks accurately.

**Interfaces:**
- Consumes: every pre-wave migration, migrations `0065` through `0070`, rollback SQL, PostgreSQL 16, and PostgREST JWT sessions.
- Produces: effective browser denial, service-role success, and real catalog rollback comparison.

- [ ] Extend executable migration list through `0070` and add browser mutation denial plus service-role mutation success for all protected tables.
- [ ] Add real `pg_policy` and privilege catalog snapshots before `0070`, after `0070`, and after rollback.
- [ ] Run `npm run test:rls` and confirm old harness or policies fail the new assertions.
- [ ] Make minimal harness or SQL corrections until executable proof passes.
- [ ] If dependencies are unavailable, capture exact prerequisite failure and report this as external gate, never as passing effective proof.

### Task 4: Voice Compensation Reconciliation

**Files:**
- Modify: `app/api/pub-pal/voice-token/route.ts`
- Modify: `__tests__/pubPalVoiceTokenRoute.test.ts`

**Interfaces:**
- Consumes: Supabase release RPC response and server logger.
- Produces: one bounded actionable error log when compensation throws or returns `{ error }`.

- [ ] Add tests for release RPC error-result and thrown-error paths, asserting canonical response plus bounded reconciliation log.
- [ ] Add keyless in-memory provider success and failure coverage.
- [ ] Run route tests and confirm missing diagnostics and keyless gaps fail.
- [ ] Add minimal server-only reconciliation logging without exposing identity or secrets.
- [ ] Re-run route tests to green.

### Task 5: Verification and Handoff

**Files:**
- Modify: release `task-1-report.md` in parent release worktree.

**Interfaces:**
- Consumes: all focused suites and review findings.
- Produces: exact red-green evidence, effective-RLS status, commit SHA, and remaining operational gates.

- [ ] Run focused migration, RLS, voice, handle, Clerk, and identity-nudge suites.
- [ ] Run `npm run typecheck`, focused ESLint, and `git diff --check`.
- [ ] Review final diff for stale comments, dead paths, and generated-file churn.
- [ ] Commit fixes and update release report with exact commands and exits.

### Task 6: Round-Two Clerk Configuration Boundary

**Files:**
- Modify: `app/layout.tsx`
- Modify: `components/auth/AuthProvider.tsx`
- Modify: `components/auth/ClerkAccountControls.tsx`
- Modify: `components/auth/SignInButton.tsx`
- Modify: `components/identity/IdentityNudge.tsx`
- Modify: `lib/clerkIdentity.ts`
- Create: `lib/clerkAvailability.ts`
- Modify or create: focused Clerk and identity-nudge component tests under `__tests__/`

**Interfaces:**
- Consumes: server-only two-key Clerk configuration, product Supabase session, and existing auth context.
- Produces: one safe `clerkIntegrationConfigured` boolean for client visibility, while Clerk session copy remains distinct from PUBMAXX identity.

- [x] Add red tests proving publishable-key-only configuration cannot expose Clerk controls.
- [x] Add component-level Identity Nudge coverage without mocking the availability boundary.
- [x] Add copy assertions that distinguish a Clerk session from PUBMAXX User ID and handle.
- [x] Derive the two-key boolean in the server layout and pass it through AuthProvider without exposing the secret.
- [x] Make every client visibility decision consume the server-derived boolean and product session.
- [x] Run focused tests, typecheck, focused ESLint, and `git diff --check`.
- [x] Commit round-two fix and update the Task 1 release report with exact evidence.

### Task 7: Round-Three Compact Signed-In Account Disclosure

**Files:**
- Modify: `components/auth/SignInButton.tsx`
- Modify: `app/auth/auth.css`
- Create: `__tests__/signInButtonLayout.test.ts`

**Interfaces:**
- Consumes: existing `compact` host mode, signed-in product user, two-key Clerk availability, and compact auth menu state.
- Produces: one bounded account trigger in compact headers; signed-out Clerk controls and disclosure copy render only inside the absolute account popover.

- [x] Add mounted red coverage proving compact signed-in headers initially contain one trigger and no Clerk action column.
- [x] Add mounted interaction coverage proving the trigger opens Clerk controls under `.authMenu`, outside header flow.
- [x] Add non-compact coverage proving standalone signed-in account controls remain visible.
- [x] Route the signed-in compact branch through the existing disclosure state before rendering full controls.
- [x] Add only the account-popover CSS needed for a full-width sign-out row and readable identity summary.
- [x] Run focused tests, typecheck, focused ESLint, and `git diff --check`.
- [x] Commit round-three fix and update the Task 1 release report with exact evidence.
