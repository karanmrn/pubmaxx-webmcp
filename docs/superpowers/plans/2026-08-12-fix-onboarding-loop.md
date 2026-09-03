# Account Onboarding Status Loop Implementation Plan

**Goal:** Keep signed-in account onboarding status reads single-flight and bounded when an incomplete 200 response updates the component.

**Architecture:** Stabilise the account-auth snapshot at the component boundary so ordinary status state changes cannot restart its effect. Keep the existing bounded retry ladder, ignore abort results from an obsolete load, and add a component regression test that renders an incomplete response and proves request count stays bounded.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest.

## Global Constraints

- Status reads wait for `identityResolved`.
- Authenticated status reads send the current account bearer token.
- Retry attempts remain bounded and abort-safe.
- An aborted obsolete read must not render account setup unavailable.
- No production API or persistence change.

### Task 1: Lock the parent-rerender loop

**Files:**
- Modify: `__tests__/accountOnboardingRace.test.ts`
- Modify: `__tests__/accountOnboarding.test.ts`

- [x] Add a test with `identityResolved: true` and repeated complete responses carrying a handle. Re-render the parent five times to model the identity event and assert the request count remains at one.
- [x] Add a client test proving an aborted status read returns `interrupted`, not `unavailable`.
- [x] Run the focused race test and confirm the new test fails because each parent render starts another request.

### Task 2: Stabilise status-load dependencies

**Files:**
- Modify: `components/identity/AccountOnboarding.tsx`
- Modify: `lib/accountOnboardingClient.ts`

- [x] Memoise `captureAccountAuth` from stable user id, session user id, and access token primitives.
- [x] Keep the status effect keyed by stable auth values, `identityResolved`, and explicit retry attempt only.
- [x] Preserve the existing bounded retry ladder and active-load guard so obsolete aborts remain silent.
- [x] Return `interrupted` for an aborted read and leave that result out of unavailable UI state.
- [x] Run the focused race test and the existing account onboarding test suite.

### Task 3: Review and validate

**Files:**
- Review: `components/identity/AccountOnboarding.tsx`, `__tests__/accountOnboardingRace.test.ts`

- [x] Run lint and typecheck.
- [x] Run the signed-in production reproduction against the isolated mobile session and capture the paused card plus repeated status requests.
- [ ] Re-read the diff, run the required post-rebase verification command set, commit, fetch `origin main`, rebase, push the branch, and open the direct PR with `gh-axi`.
