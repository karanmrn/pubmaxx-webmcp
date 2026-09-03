# Session Persistence and Password Manager Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep authenticated PUBMAXX accounts alive across browser storage loss and make handle-password forms recognisable to Safari and Chrome password managers.

**Architecture:** Keep the durable HttpOnly resume cookie as the server-owned refresh-token mirror. Change the browser bootstrap so `AuthProvider` does not publish a signed-out state until local storage and the cookie-only restore path have settled, while retaining a bounded fail-soft timeout. Keep authentication as a real HTML form, give fields conventional credential names, and do not clear or collapse the successful sign-in form before browser credential heuristics can inspect it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth, Vitest, Playwright.

## Global Constraints

- Use British English in product copy.
- Never add an em dash to product copy or communication.
- Do not add production logging. Use deterministic tests as diagnostics.
- The password is created only through the signed-in Supabase Auth session.
- The durable resume cookie remains HttpOnly, Secure in production, SameSite=Lax, path-scoped to `/`, and without a cross-site Domain attribute.
- Run no more than one full test suite and keep the full run within 30 minutes.
- Immediately before opening the PR, run `git fetch origin main && git rebase origin/main`.
- Commit browser evidence at 390x844 for the sign-in form and changed account-password flow.

---

### Task 1: Lock cold-boot resume ordering

**Files:**
- Create: `lib/authSessionBootstrap.ts`
- Modify: `components/auth/AuthProvider.tsx`
- Test: `__tests__/authSessionBootstrap.test.ts`
- Test: `__tests__/authSessionRoute.test.ts`

**Interfaces:**
- Consumes `fetchResumeHint` and `redeemPersistedSession` from `lib/authSessionResumeClient.ts`.
- Produces a typed bootstrap result that distinguishes local session, restored session, expired cookie, no cookie, and unavailable resume states.

- [x] **Step 1: Write the failing bootstrap test.** Exercise a null local session, a delayed resume hint, and a restored cookie session. Assert that the bootstrap result does not settle before redemption and calls `setSession` with the restored tokens.
- [x] **Step 2: Run `npx vitest run __tests__/authSessionBootstrap.test.ts` and confirm it fails because the bootstrap seam does not exist.**
- [x] **Step 3: Implement the smallest bootstrap helper.** Read local Supabase state first. If no local session exists, read the cookie hint, redeem only when the hint exists, await `auth.setSession`, and return a typed outcome. Treat failed reads and unavailable services as unavailable, never as proof that the account is signed out.
- [x] **Step 4: Wire `AuthProvider` to await the helper before `setSessionLoading(false)`.** Do not clear loading for `INITIAL_SESSION` with no session. Keep the bounded timeout as a fail-soft ceiling longer than the two resume requests, and clear it when local or restored state settles.
- [x] **Step 5: Add production cookie attribute coverage.** Stub production mode in `authSessionRoute.test.ts` and assert `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, the 30-day `Max-Age`, and no `Domain`, which is correct for canonical `https://pubmaxxing.com` and avoids a broader cookie scope.
- [x] **Step 6: Run the bootstrap and route tests and confirm they pass.**

### Task 2: Make both credential forms browser-recognisable

**Files:**
- Modify: `components/auth/HandlePasswordSignIn.tsx`
- Modify: `components/auth/SetAccountPassword.tsx`
- Test: `__tests__/credentialForms.test.ts`

**Interfaces:**
- Consumes the existing form submit handlers and shared password policy.
- Produces real `method="post"` forms with conventional `username`, `password`, `current-password`, and `new-password` field names plus existing autocomplete tokens.

- [x] **Step 1: Write failing source and render-contract tests.** Assert the handle form has a real `form` with `onSubmit`, `method="post"`, `autocomplete="on"`, a `username` field with `autocomplete="username"`, a password field with `autocomplete="current-password"`, and a `type="submit"` button. Assert account password creation/change keeps `type="submit"`, uses `autocomplete="new-password"` for new and confirmation fields, and gives current-password its own autocomplete token.
- [x] **Step 2: Run `npx vitest run __tests__/credentialForms.test.ts` and confirm it fails on the missing conventional form attributes and immediate success cleanup.**
- [x] **Step 3: Add conventional form metadata and field names.** Keep the API JSON request in the intercepted submit handler. Do not add a password route for creation. Preserve the visible error and success states.
- [x] **Step 4: Stop clearing the successful handle-password form before the browser can record credentials.** Leave the submitted values in the mounted form; the authenticated account state replaces the login wall on success, while failed and offline submissions keep their visible form state.
- [x] **Step 5: Run the credential form tests and the existing password policy, handle route, and account-password tests.**

### Task 3: Browser evidence and closeout

**Files:**
- Create: `docs/proof/session-persistence-password-manager/README.md`
- Create: `docs/proof/session-persistence-password-manager/sign-in-390x844.png`
- Modify: PR description only if needed for evidence links.

- [x] **Step 1: Run the keyless app using the repository command and capture the signed-out sign-in form at 390x844.** State that local keyless mode cannot complete a real sign-in.
- [x] **Step 2: Capture the signed-in account password form through the existing signed-in browser harness, or record the exact external dependency if no durable signed-in fixture is available.** The local app has no durable signed-in fixture, so the proof README records the production confirmation required.
- [x] **Step 3: Document one manual production confirmation after deployment.** On `https://pubmaxxing.com`, use a real test account in Safari and Chrome, sign in, inspect that `pubmax_session_resume` is Secure, HttpOnly, SameSite=Lax, host-only on `pubmaxxing.com`, reload after clearing site storage, and confirm the account restores. Confirm the browser offers to save and later autofills the handle-password credential on both desktop and mobile.
- [x] **Step 4: Run targeted lint, typecheck, and tests.** Use one full suite only if no parallel crewmate is running one.
- [ ] **Step 5: Review the diff against the PUBMAXX code-review checklist, remove debug artefacts, commit, rebase, push `fm/fix-session-persistence`, open a PR with `gh-axi`, and append `done: PR {url}` to the status file.**
