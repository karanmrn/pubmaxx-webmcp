# Password UI State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show password setup only for accounts known to have no password, and show a collapsed change-password disclosure for accounts known to have one.

**Architecture:** Keep `SetAccountPassword` as the single signed-in password owner. Use the existing tri-state `hasPassword` read from `/api/identity/handle/current`: `false` renders the existing create form, `true` renders one native collapsed disclosure containing the unchanged current/new/confirm verification flow, and `null` renders nothing password-related. Keep `PubmaxxAccountHub` as the single mount and update its existing account-area styles only as needed for the compact disclosure.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, existing Supabase browser auth and `authedActionFetch` seams.

## Global Constraints

- Password creation remains `supabase.auth.updateUser({ password })` from the signed-in browser.
- The existing old-password verification route and flow remain inside the change-password disclosure.
- Unknown password state renders neither setup nor change-password UI.
- The account hub keeps exactly one `SetAccountPassword` mount.
- Use British English and never add an em dash.
- Run no more than one full suite and keep validation within 30 minutes.
- Immediately before the PR, run `git fetch origin main && git rebase origin/main`.

---

### Task 1: Lock the three password UI states in browser coverage

**Files:**
- Modify: `e2e/account-password.spec.ts`
- Modify: `__tests__/setAccountPassword.test.ts`

**Interfaces:**
- Consumes: `installOwnedAccount(page, { hasPassword })` and the existing `SetAccountPassword` source checks.
- Produces: Regression coverage for false, true, and null state behaviour.

- [x] **Step 1: Add the failing true-state browser test.** Seed `hasPassword: true`, assert exactly one `details.accountHubPasswordChange`, assert its `summary` is `Change password`, assert the current-password field is hidden before expansion, click the summary, then assert current, new, and confirmation fields are visible.
- [x] **Step 2: Update the unknown-state browser test.** Seed `hasPassword: null`, assert `form.accountHubPassword` and `details.accountHubPasswordChange` both have count zero, and assert no password heading is rendered.
- [x] **Step 3: Strengthen source tests.** Assert the tri-state branch returns `null` before rendering a heading, true state uses a collapsed `details` disclosure, and the account hub still contains exactly one password mount.
- [x] **Step 4: Run the focused browser test before production edits.** Run `npm run test:e2e -- e2e/account-password.spec.ts` and confirm the new true-state and unknown-state expectations fail against the current full form and neutral section.

### Task 2: Implement minimal tri-state rendering

**Files:**
- Modify: `components/auth/SetAccountPassword.tsx`
- Modify: `app/u/[handle]/profile.css`

**Interfaces:**
- Consumes: Existing `hasPassword`, `handleLoaded`, `identityResolved`, `onSubmit`, password policy, and old-password verification logic.
- Produces: `false` create form, `true` collapsed change disclosure, `null` no password-related output.

- [x] **Step 1: Return `null` for unanswered password state.** Keep signed-out, unresolved, and not-yet-loaded guards. Treat failed or malformed reads as `hasPassword: null` and render nothing instead of a password heading or retry card.
- [x] **Step 2: Keep the existing create form for `hasPassword === false`.** Preserve policy hint, fields, submit action, copy, and owed-row class.
- [x] **Step 3: Wrap only the existing change form in a native collapsed disclosure.** Render one compact `summary` labelled `Change password`; put current-password, new-password, confirm, policy hint, submit, error, and success status inside its form. Do not alter verification requests or password update calls.
- [x] **Step 4: Add compact disclosure styles.** Keep summary keyboard accessible, avoid a second helper block outside the disclosure, and preserve mobile layout and the existing owed full-row treatment.
- [x] **Step 5: Run focused unit and browser tests.** Run the source test and the account-password Playwright spec; confirm all three states and expansion pass.

### Task 3: Review, verify, commit, and open the PR

**Files:**
- Modify: only files from Tasks 1 and 2 unless verification exposes a direct regression.

- [x] **Step 1: Review shape and diff.** Check the single mount, tri-state branches, unchanged verification path, copy, and CSS for unrelated changes.
- [x] **Step 2: Run targeted validation.** Run `npm test -- __tests__/setAccountPassword.test.ts` and `npm run test:e2e -- e2e/account-password.spec.ts`; run lint and typecheck if the targeted checks pass.
- [x] **Step 3: Run at most one full validation command.** Use `npm run verify` within the 30-minute budget, unless an earlier full command has already run.
- [ ] **Step 4: Rebase immediately before the PR.** Run `git fetch origin main && git rebase origin/main`, resolve only task-related conflicts, then rerun targeted checks if rebase changes files.
- [ ] **Step 5: Commit and push.** Commit on `fm/fix-password-ui-state`, push only that branch, and open a PR with `gh-axi`.
- [ ] **Step 6: Report completion.** Append `done: PR {url}` to `/Users/karanmanoharan/karan-agent-workspace/state/fix-password-ui-state.status`.
