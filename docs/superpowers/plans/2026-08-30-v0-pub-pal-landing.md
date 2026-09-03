# V0 Pub Pal Landing Activation Implementation Plan

> **For agentic workers:** Execute inline with strict test-driven development. Each task must finish with focused verification and a clean commit.

**Goal:** Make Pub Pal the landing-page primary action and let a fresh visitor start the existing five-step Pal setup without first creating a Crawl Route.

**Architecture:** Reuse the existing `/pal` onboarding, account gate, and authenticated voice/text surface. Remove only the route-activation presentation gate. Keep one landing primary action and move Plan into the existing lower-weight action row.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, CSS.

**Spec:** User direction in the active V0 session: Pub Pal is the defining landing feature; a visitor chooses a Pal through five prompts, then creates an account before owned voice/text use.

## Global Constraints

- Keep Pub Pal factual, recommendation, moderation, and safety authority unchanged.
- Keep voice authenticated and server-tokened. Do not add guest voice credentials.
- Keep the existing five onboarding steps and final account gate.
- Keep one landing primary action.
- Keep all controls at least 44px on phone.
- Preserve the dirty primary checkout. Work only in this isolated worktree.

---

### Task 1: Fresh Visitor Pal Entry

**Files:**
- Modify: `__tests__/pubPalExperience.test.ts`
- Modify: `components/pal/PalExperience.tsx`

**Interfaces:**
- Consumes: existing anonymous Pal draft and five-step onboarding state.
- Produces: a fresh `/pal` visit renders the meeting surface without `PAL_ROUTE_ACTIVATION_KEY`.

- [x] **Step 1: Write the failing test**

Remove the test-only route activation from setup. Assert a fresh browser renders `Meet your Pub Pal` and does not render `First, describe your night.`

- [x] **Step 2: Verify RED**

Run `npx vitest run __tests__/pubPalExperience.test.ts`.

Expected: the fresh-browser assertion fails because `PalExperience` renders the route-first gate.

- [x] **Step 3: Write minimal implementation**

Delete the `routeActivated` presentation branch from `PalExperience`. Retain draft persistence, five onboarding steps, the adult confirmation, and the final account gate.

- [x] **Step 4: Verify GREEN**

Run `npx vitest run __tests__/pubPalExperience.test.ts`.

Expected: all tests pass.

### Task 2: Landing Primary Action

**Files:**
- Modify: `__tests__/landingFindMyPintHierarchy.test.ts`
- Modify: `components/landing/LandingPage.tsx`
- Modify: `lib/analyticsEvents.ts`
- Modify: relevant analytics test if the closed target vocabulary requires it.

**Interfaces:**
- Consumes: existing `landing_cta_clicked` event and `/pal` route.
- Produces: one primary `Meet your Pub Pal` link, with Plan, Map, and Find my pint as lower-weight links.

- [x] **Step 1: Write the failing test**

Assert the only `lpButtonPrimary` in the landing hero links to `/pal` with `Meet your Pub Pal`. Assert `Plan tonight together` remains in `lpHeroSecondaryRow` as a text link.

- [x] **Step 2: Verify RED**

Run `npx vitest run __tests__/landingFindMyPintHierarchy.test.ts`.

Expected: the primary-action assertion fails because Plan is still primary.

- [x] **Step 3: Write minimal implementation**

Change the hero primary link to `/pal`, add the closed analytics target `pal`, and place Plan in the existing secondary row. Keep Map and Find my pint visible in that row.

- [x] **Step 4: Verify GREEN**

Run `npx vitest run __tests__/landingFindMyPintHierarchy.test.ts __tests__/analyticsEvents.test.ts`.

Expected: all focused tests pass.

### Task 3: Review and Delivery

**Files:**
- Review every changed path from Tasks 1 and 2.

**Interfaces:**
- Produces: one focused commit and one pushed GitHub branch.

- [x] **Step 1: Run focused verification**

Run both focused test files, targeted ESLint on changed TypeScript files, and `git diff --check` serially.

- [x] **Step 2: Review the diff**

Confirm no voice-token, memory, moderation, recommendation, or account-ownership contract changed.

- [x] **Step 3: Commit and push**

Commit with `feat(pal): make Pub Pal the front door`, push `codex/v0-pub-pal-landing`, open a PR, and confirm its remote head.
