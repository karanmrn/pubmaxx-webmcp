# Onboarding Cold-Open Race Implementation Plan

> **For agentic workers:** Execute this plan task by task with a fresh test checkpoint after each behavior change.

**Goal:** Prevent auth-dependent identity reads from running before the live account identity is resolved, and keep transient read failures from taking over the app surface.

**Architecture:** Use `useAuth().identityResolved` as the read gate for onboarding and other identity-owned cold-open readers. The onboarding status client retries one failed authenticated read once after a short delay, while the persistent state renders an inline notice without a backdrop or dialog semantics.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright.

## Global Constraints

- Preserve PUBMAXX tri-state identity: unresolved is not signed out and failed reads are not proof of absence.
- Never add a blocking error takeover, `role="dialog"`, `aria-modal`, or a backdrop for a failed identity read.
- Keep the retry bounded to one automatic retry and abort-safe.
- Use the existing auth bearer seams and do not change Supabase token-fragment handling.
- Validate with targeted Vitest tests, `npm run typecheck`, and scoped ESLint; run at most one full suite.

### Task 1: Reproduce the cold-open race

**Files:**
- Create: `__tests__/accountOnboardingRace.test.ts`
- Inspect: `components/identity/AccountOnboarding.tsx`, `components/auth/AuthProvider.tsx`, `lib/authSessionResumeClient.ts`

- [ ] Write a component test that mounts an authenticated user while `identityResolved` is false, asserts no onboarding status request occurs, then flips `identityResolved` true and asserts the request starts.
- [ ] Run `npx vitest run __tests__/accountOnboardingRace.test.ts` and confirm the test fails because the current component starts the request before identity resolution.
- [ ] Record the audit findings for `SetAccountPassword`, `useFoundingMembership`, `SocialPageClient`, `PrivateIdentityEditor`, `AccountHandleEditor`, and account-scoped Social access readers.

### Task 2: Fix onboarding read timing, retry, and failure presentation

**Files:**
- Modify: `components/identity/AccountOnboarding.tsx`
- Modify: `lib/accountOnboardingClient.ts`
- Modify: `components/identity/accountOnboarding.css`
- Modify: `__tests__/accountOnboarding.test.ts`, `__tests__/accountOnboardingRace.test.ts`

- [ ] Add `identityResolved` to the onboarding child seam and return before starting the status effect while it is false.
- [ ] Add an abort-safe one-retry helper with a bounded backoff and keep the component in loading state until both attempts fail.
- [ ] Change `AccountOnboardingLoadError` to an inline section with an alert and retry button, with no backdrop, dialog role, modal state, or fixed positioning.
- [ ] Add tests for wait-before-read, first-failure-then-success, persistent failure after exactly two calls, and inline non-blocking markup.
- [ ] Run the focused onboarding tests through red, green, and refactor checkpoints.

### Task 3: Apply the same identity gate to other cold-open identity reads

**Files:**
- Modify: `components/auth/SetAccountPassword.tsx`
- Modify: `components/founding/useFoundingMembership.ts`
- Modify: `components/identity/PrivateIdentityEditor.tsx`
- Modify: `components/profile/PubmaxxAccountHub.tsx`
- Modify: `app/social/SocialPageClient.tsx`
- Modify: `components/social/CrewsPanel.tsx`
- Modify: `app/social/crews/[crewId]/CrewDetailClient.tsx`
- Modify: related source-fence tests where needed

- [ ] Guard each authenticated identity or Social access read on `identityResolved` and keep unresolved UI neutral.
- [ ] Ensure account-hub child readers cannot display stale account data while a new account's canonical answer is pending.
- [ ] Keep user-triggered adult assertion and mutation paths unchanged.
- [ ] Run targeted identity, Social, founding, private identity, and account password tests.

### Task 4: Validate and deliver

**Files:**
- Modify: only files justified by failing validation.

- [ ] Run the targeted test set, `npm run typecheck`, and scoped ESLint for changed TypeScript files.
- [ ] Run one browser smoke or focused Playwright spec if the existing resume seam can be stubbed without a broad suite.
- [ ] Check generated-file churn, debug markers, diff, and worktree state.
- [ ] Rebase onto fresh `origin/main`, rerun required targeted validation, commit, push `fm/fix-onboarding-race`, open the PR with `gh-axi`, and append the PR URL to the status file.
