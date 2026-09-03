# Reconnect Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public people, TfL live status, and account onboarding status recover automatically after a mobile connectivity gap or foreground wake.

**Architecture:** Add one small client hook that observes `online` and visible `visibilitychange` events, debounces them, and invokes a caller-provided reload at most once per event. Keep public people and TfL reads in `surfaceDataCache` with short snapshot ages, while keep account onboarding uncached and identity-gated. All surfaces retain their current loading, ready, and error presentations, with offline-aware error copy.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, React DOM test roots.

## Global Constraints

- Do not touch service worker or PWA caching.
- Never cache or persist `/api/identity/onboarding`.
- Keep `AccountOnboarding` identity resolution and owned-handle arrival policy unchanged.
- Retry at most once per reconnect or foreground event, with abort-safe cleanup.
- Use British English and no em dashes in product copy.
- Run targeted tests while iterating and at most one full-suite validation run.
- Before opening the PR, run `git fetch origin main && git rebase origin/main`.

---

### Task 1: Shared reconnect recovery hook

**Files:**
- Create: `lib/useReconnectRecovery.ts`
- Test: `__tests__/useReconnectRecovery.test.ts`

**Interface:**
- Produces `useReconnectRecovery(enabled: boolean, reload: () => void, options?: { debounceMs?: number }): void`.
- The hook listens to `window` `online` and `document` `visibilitychange` while enabled.
- It schedules one reload after the debounce window. Cleanup removes listeners, cancels the pending timer, and aborts no caller-owned controller.

- [x] Write tests for one debounced reload on `online`, one on visible `visibilitychange`, coalescing a flapping pair, no call while disabled, and cleanup.
- [x] Run `npm test -- __tests__/useReconnectRecovery.test.ts` and confirm the new tests fail because the module is missing.
- [x] Implement the hook with refs for the latest callback and an event-local scheduled flag.
- [x] Run the targeted test and confirm it passes.

### Task 2: People list recovery and cached public reads

**Files:**
- Modify: `app/u/[handle]/people/[relation]/PeopleListClient.tsx`
- Modify: `lib/surfaceReadPolicy.ts`
- Test: `__tests__/peopleListClient.test.ts`

**Interface:**
- Each read uses `loadSurfaceJson` with `maxAgeMs: 60_000` and an abort signal.
- The list response validates the relation array. The lot response may fail without failing the list.
- A failed cold load keeps `error` state. The reconnect hook changes the load attempt and shows the existing skeleton while reloading.

- [x] Add component tests for rejected reads producing the error card, `online` recovery without clicking, snapshot paint after remount, and offline versus online copy.
- [x] Run the targeted test and confirm it fails against the bare fetch implementation.
- [x] Replace both bare fetches with `loadSurfaceJson`, preserve skeleton/ready/error UI, and connect the shared hook.
- [x] Remove the PeopleListClient exemption.
- [x] Run the component and fence tests.

### Task 3: Account onboarding recovery without caching identity

**Files:**
- Modify: `lib/accountOnboardingClient.ts`
- Modify: `components/identity/AccountOnboarding.tsx`
- Test: `__tests__/accountOnboardingRace.test.ts`
- Test: `__tests__/accountOnboarding.test.ts`

**Interface:**
- The onboarding retry ladder remains bounded at two retries and three reads, with `250ms` then `1.5s` delays.
- The component registers reconnect recovery only for the `unavailable` state and reloads through the existing identity-gated status effect.
- The response remains memory-only. No session storage access is added.

- [x] Add a test where both ladder attempts reject, then `online` reloads to `complete`, and assert the session storage namespace remains empty.
- [x] Run the targeted race test and confirm it fails because no reconnect listener exists and the second delay is missing.
- [x] Widen the retry ladder with an abort-safe delay and add the recovery hook without changing identity semantics.
- [x] Add offline and online render assertions for the onboarding error copy.
- [x] Run the targeted onboarding tests.

### Task 4: TfL status recovery and honest offline state

**Files:**
- Modify: `components/mobile/MobileTflPanel.tsx`
- Modify: `lib/surfaceReadPolicy.ts`
- Test: `__tests__/mobileTflPanel.test.ts`

**Interface:**
- `useMobileTflStatus` reads `/api/citymcp/status` through `loadSurfaceJson` with a 60 second snapshot age.
- Failed status reads retain the existing failed state, then retry through the shared reconnect hook.
- The failed copy says that the viewer is offline when `navigator.onLine` is false.

- [x] Add tests for failed status and offline versus online copy, plus source fences for the shared read and recovery layers.
- [x] Run the targeted test and confirm it fails against the module cache and bare fetch implementation.
- [x] Replace the module cache and fetch with the shared read layer, preserving the live status projection and issue count.
- [x] Remove the MobileTflPanel exemption.
- [x] Run the targeted TfL and fence tests.

### Task 5: Review and delivery

**Files:**
- Modify only files required by review findings.

- [x] Run lint, typecheck, targeted tests, and one full `npm test` run within the validation budget.
- [x] Run the browser proof with `chrome-devtools-axi`, capture before and after screenshots, and record the result for the PR body.
- [x] Inspect diff, remove debug artifacts, and verify no service worker or PWA files changed.
- [ ] Run `git fetch origin main && git rebase origin/main` immediately before commit/PR preparation.
- [ ] Commit the completed change on `fm/fix-reconnect-recovery`.
- [ ] Push the branch and open the PR with `gh-axi`.
