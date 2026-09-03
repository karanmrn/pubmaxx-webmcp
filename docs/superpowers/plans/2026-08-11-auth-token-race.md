# Auth Token Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent signed-in PUBMAXX users from sending auth-required requests without a bearer token while preserving anonymous behaviour for genuinely signed-out users and public reads.

**Architecture:** Keep `authedFetch` as the graceful read transport. Add `authedActionFetch` with a bounded wait for the existing `AuthProvider` identity resolution signal, bounded token retries, and a typed session-waking failure. Publish the existing `identityResolved` and signed-in state from `AuthProvider` to the transport seam. Move auth-required mutations, private reads, messaging requests, invite/follow requests, and profile image writes to the strict transport.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Supabase browser auth.

## Global Constraints

- Use British English in product copy.
- Never use an em dash in product copy or communication.
- Auth-required actions must never make an anonymous request while the auth state says signed in.
- Genuinely signed-out calls keep anonymous fallback behaviour.
- Profile avatar and cover uploads must show an actionable error when auth or file processing fails.
- Run at most one full test suite. Use targeted tests for iteration.
- Rebase immediately before opening the PR with `git fetch origin main && git rebase origin/main`.

---

### Task 1: Lock the strict transport race contract

**Files:**
- Modify: `__tests__/authedFetch.test.ts`
- Modify: `lib/authedFetch.ts`
- Modify: `components/auth/AuthProvider.tsx`

**Interfaces:**
- Produces `AuthActionSessionError`, `authedActionFetch`, and the transport readiness bridge fed by the existing `identityResolved` value.

- [ ] **Step 1: Write failing tests** for token-null-then-token, signed-out anonymous fallback, and signed-in token exhaustion with no fetch call.
- [ ] **Step 2: Run `npx vitest run __tests__/authedFetch.test.ts` and confirm the new tests fail for the missing strict transport.
- [ ] **Step 3: Implement readiness publication, bounded token retry, abort handling, and typed `Still waking your session - try again` failure.
- [ ] **Step 4: Run the targeted transport tests and confirm all pass.

### Task 2: Migrate auth-required browser callers

**Files:**
- Modify: auth-required callers currently importing or invoking `authedFetch`.
- Modify: direct bearer callers in `components/profile/ProfileEditor.tsx` and `components/profile/ProfileCoverPhotosEditor.tsx`.
- Modify: targeted caller tests and source fences where needed.

**Interfaces:**
- Consumes `authedActionFetch` from Task 1.
- Produces no auth-required caller that can issue a request without the strict transport.

- [ ] **Step 1: Add the upload regression test for a token that becomes available after the first lookup, including avatar and cover request headers.
- [ ] **Step 2: Run the targeted profile tests and confirm the regression test fails before migration.
- [ ] **Step 3: Migrate mutations, uploads, messaging opens/sends, password endpoints, invite-link, follows, social actions, private identity reads, and other bearer-gated callers identified by the audit.
- [ ] **Step 4: Render typed session-waking errors in profile upload and other user-facing action catch paths.
- [ ] **Step 5: Run targeted transport, profile, auth, messaging, social, and caller-fence tests.

### Task 3: Audit and close direct-fetch gaps

**Files:**
- Modify: direct client fetch callers identified by the auth-gated route and bearer audit.
- Test: add or update the source audit that proves no auth-required client write bypasses the strict transport.

- [ ] **Step 1: Enumerate every direct client fetch to a bearer-gated route and classify public reads separately.
- [ ] **Step 2: Migrate remaining auth-required direct fetches.
- [ ] **Step 3: Run the audit test and targeted caller tests.

### Task 4: Review, validate, rebase, and ship

**Files:**
- Modify: PR-facing documentation only if required by the repository workflow.

- [ ] **Step 1: Run the required shape, diff, and documentation review pass.
- [ ] **Step 2: Run fresh targeted verification and one full suite at most, recording any PostgreSQL contention.
- [ ] **Step 3: Inspect the diff, remove generated tooling churn, commit the branch, and verify the commit.
- [ ] **Step 4: Run `git fetch origin main && git rebase origin/main` immediately before PR creation.
- [ ] **Step 5: Push `fm/fix-auth-token-race`, open the PR with `gh-axi`, include every migrated site in the PR body, then append the PR URL to the status file.
