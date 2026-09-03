# V1 Final Shape Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four release-shape defects without importing unfinished Social Night Loop work into V1.

**Architecture:** Profile intent stays method-derived and two-argument so DELETE cannot claim a handle and later Fable integration cannot hide behind an arity mismatch. Reactions gain one browser-safe owner for bounded summary reads and local demo state. Drink updates carry a parsed semantic lane used by every display consumer. Generic product sign-in remains Supabase-owned while Clerk stays inside its explicit account controls.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest

## Global Constraints

- Preserve V1 first-authenticated-write `linkUser` semantics. Do not cherry-pick `ecddfe6f5` or migration `0071`.
- Reserved handles fail before anonymous or owner allowance.
- DELETE never claims a handle. Atomic delete authorization remains security lane ownership.
- Write each behavioral test first and observe its expected failure.
- Do not modify security migrations, mobile CSS, or release handoff owned by parallel agents.

---

### Task 1: Method-derived profile action intent

**Files:**
- Modify: `lib/profileOwnership.ts`
- Modify: `app/api/profiles/[handle]/route.ts`
- Test: `__tests__/profileOwnership.test.ts`
- Test: `__tests__/profileOwnershipRoute.test.ts`

**Interfaces:**
- Consumes: `Request.method`, `profileStore().getByHandle`, `profileStore().linkUser`
- Produces: `handleActionIntent(method): "read" | "write" | "delete"`; two-argument `gateHandleAction(request, handle)`

- [ ] Add a test proving authenticated DELETE of an unlinked row leaves `userId` unset, while authenticated POST still links on first touch.
- [ ] Run `npx vitest run __tests__/profileOwnership.test.ts` and confirm DELETE test fails because current method inference claims it.
- [ ] Add method-to-intent owner, remove `claimOnUnlinked`, and make only `write` eligible for `linkUser`.
- [ ] Remove the route's third gate argument and run both profile ownership suites green.
- [ ] Compare the result with Fable head `9f8c67bee` using `git merge-tree`; record the deliberate `0071` semantic boundary in the handoff through the docs owner.

### Task 2: Shared retryable reaction summaries

**Files:**
- Create: `lib/reactionClient.ts`
- Delete: `lib/profileReactionSummaries.ts`
- Modify: `components/profile/ProfileTimeline.tsx`
- Modify: `app/feed/FeedPageClient.tsx`
- Test: `__tests__/profileTimelineReactions.test.ts`
- Test: `__tests__/profileTimelineEffect.test.ts`

**Interfaces:**
- Consumes: reaction GET limit `100`, `postReactionToggle`, browser `localStorage`
- Produces: `loadReactionSummaries(ids, actorId, signal)` returning `summaries`, `retryableIds`, and `aborted`; shared local summary helpers under `pubmax:reactions:`

- [ ] Change failed-batch test to require retryable IDs and no local-only classification, then run it red.
- [ ] Implement minimal failed-read behavior and run batching tests green.
- [ ] Move batching and local demo state to `lib/reactionClient.ts`; update profile and feed to consume it directly and delete copied owners.
- [ ] Keep local-only transition behind confirmed POST `unknown-drop`; use shared POST outcome helper from both surfaces.
- [ ] Run reaction, feed, and optimistic-toggle focused suites green.

### Task 3: Semantic demo lane at every drink-overlay surface

**Files:**
- Modify: `lib/drinkPriceUpdates.ts`
- Modify: `app/feed/feedSightings.server.ts`
- Test: `__tests__/demoContent.test.ts`
- Test: `__tests__/drinkPriceUpdates.test.ts`
- Test: `__tests__/feedSightingsServer.test.ts`

**Interfaces:**
- Consumes: raw update source metadata and `demoContentEnabled()`
- Produces: parsed `DrinkPriceUpdate.lane`; exported `visibleDrinkPriceUpdates(updates)` used before menu and feed presentation

- [ ] Add server-boundary test proving an in-window demo overlay is absent when `NEXT_PUBLIC_DEMO_CONTENT=off`; run it red.
- [ ] Stamp one semantic lane during parsing and filter feed through the shared visibility owner.
- [ ] Change menu provenance to consume lane instead of repeating source-label classification.
- [ ] Run demo, drink-update, venue-menu, and feed-sightings suites green.

### Task 4: Supabase-owned generic social sign-in

**Files:**
- Modify: `components/auth/AuthProvider.tsx`
- Test: `__tests__/contributionAuthProvider.test.ts`
- Test: `__tests__/clerkAccountControls.test.ts`

**Interfaces:**
- Consumes: Supabase provider capability and OAuth starters
- Produces: generic `signInWithGoogle` and `signInWithApple` that always target product auth; Clerk remains owned by `ClerkAccountControls`

- [ ] Replace direct-context Clerk routing test with a test requiring Supabase routing even when both product and Clerk sessions are available; run it red.
- [ ] Remove Clerk hooks, capability loading, and redirect selection from `AuthProvider`.
- [ ] Run auth-provider, sign-in layout, identity nudge, and Clerk-account suites green.

### Task 5: Integration verification and commit

**Files:**
- Verify all modified files from Tasks 1-4

**Interfaces:**
- Consumes: combined diff from `2274227e`
- Produces: one reviewed commit on `codex/v1-final-shape-fixes`

- [ ] Run focused Vitest suites for profile ownership, reactions, demo/feed, and auth.
- [ ] Run `npm run typecheck`, `npm run lint`, and `git diff --check`.
- [ ] Verify merge-tree behavior against Fable head and inspect any conflict for explicit semantic reconciliation.
- [ ] Request code review when a concurrency slot becomes available, fix Critical and Important findings, then re-run verification.
- [ ] Commit with a normal message and no co-author.
