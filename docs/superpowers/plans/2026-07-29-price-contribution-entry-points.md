# Price Contribution Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding a drink price obvious from every venue-sheet tab, with an account-first path that returns to the same venue and opens the existing price form.

**Architecture:** Reuse the mobile venue sheet's persistent action bar as its one clear contribution entry point. `VenueInspector` owns auth-aware routing and opens the existing `VenuePriceSubmit`; a small URL intent survives OAuth or magic-link navigation and is consumed after auth returns. `VenuePriceEntryPanel` keeps the signed-in and signed-out destinations injectable for tests without simulating Supabase transport in a browser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, existing Supabase auth context.

## Global Constraints

- Do not redesign the venue sheet or build a second submission form.
- Keep one clear primary contribution action per surface.
- Do not add landing-page content or lengthen the Overview panel.
- Signed-out people see account requirement before any price field.
- Preserve the selected venue through sign-in and open the existing form on return.
- Copy follows `docs/VOICE.md`: British spelling, no em dashes, no exclamation marks.
- Keep edits narrow around venue-sheet actions, auth intent, tests, and evidence.

---

### Task 1: Lock the missing entry and auth return path with regression tests

**Files:**
- Create: `e2e/price-contribution-entry.spec.ts`
- Create: `e2e/price-contribution-auth.spec.ts`
- Create: `__tests__/venuePriceEntryPanel.test.ts`
- Create: `__tests__/priceContributionIntent.test.ts`

**Interfaces:**
- Consumes: venue sheet selected by `/map?sel=<venueId>`, existing `.venuePriceSubmit`, `AuthProvider` Supabase browser-session restoration.
- Produces: a keyless browser test for the real venue action and injectable render tests for signed-out and signed-in destinations.

- [x] **Step 1: Reproduce the missing browser entry**

At 390×844, drive the selected venue sheet and prove no explicit price action exists.

- [x] **Step 2: Drive the real action without browser auth mocking**

In the keyless browser E2E, assert `Add a price at <venue>` opens and focuses the existing price form. Do not configure, intercept, or emulate Supabase in Playwright.

- [x] **Step 3: Cover auth destinations where session state is injectable**

Render `VenuePriceEntryPanel` with explicit signed-out and signed-in states. Assert signed out sees the account explanation and email sign-in before any price field; assert signed in receives the real `VenuePriceSubmit`; assert unopened signed-out Overview adds no content.

**PR body testing note:** Browser console errors seen during the discarded auth E2E came from the fake Supabase settings endpoint itself. Chrome reported the failed resource before `loadSocialAuthProviders` caught the failure and degraded normally. This was mock-only transport noise, not an uncaught application error. Browser auth mocking was removed. Signed-in branching is tested at `VenuePriceEntryPanel`, where session permission is injectable, while Playwright drives the real venue action and existing form without auth transport.

### Task 2: Add the auth-aware entry point without lengthening Overview

**Files:**
- Create: `lib/priceContributionIntent.ts`
- Create: `components/map/inspector/VenuePriceSignInGate.tsx`
- Create: `components/map/inspector/VenuePriceEntryPanel.tsx`
- Modify: `components/map/VenueInspector.tsx`
- Modify: `components/map/inspector/VenueStickyBar.tsx`
- Modify: `components/map/inspector/VenueOverviewTab.tsx`
- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `components/map/inspector/venueSheet.css`
- Test: `__tests__/priceContributionIntent.test.ts`

**Interfaces:**
- Consumes: `useAuth(): { user, loading, configured }`, `selectTab("overview")`, existing `VenuePriceSubmit`.
- Produces: `PRICE_CONTRIBUTION_INTENT_PARAM`, `withPriceContributionIntent(url)`, `withoutPriceContributionIntent(url)`, `hasPriceContributionIntent(url)`, and an auth-aware `onAddPrice`.

- [x] **Step 1: Write failing intent-helper tests**

Assert adding the intent preserves `sel`, removing it preserves unrelated map state, and malformed input fails closed.

- [x] **Step 2: Run intent tests and verify RED**

Run:

```bash
npx vitest run __tests__/priceContributionIntent.test.ts
```

Expected: FAIL because `lib/priceContributionIntent.ts` does not exist.

- [x] **Step 3: Implement minimal URL intent helpers**

Use `URL` and same-origin relative output. Add only `contribute=price`, preserve every other parameter and hash, and return the unmodified fallback on invalid input.

- [x] **Step 4: Replace ambiguous sticky action**

Change the pub action from `Drop` / `Log a Pint Drop` to visible `Add price` / accessible `Add a price at <venue>`. Route it through a single `onAddPrice` callback. Keep Pint Drop composition on the Drinks and Stories surfaces where it already exists.

- [x] **Step 5: Gate before typing and restore after auth**

In `VenueInspector`, signed-in or keyless-local action selects Overview, scrolls the existing form into view, and focuses its price textbox. Signed-out configured action writes the contribution intent and opens `VenuePriceSignInGate`, whose copy says an account is needed and renders existing `SignInButton`. On auth return, consume the URL intent, keep `sel`, close the gate, and open the same form. Suppress `VenuePriceSubmit` while production auth is configured and no user is present.

- [x] **Step 6: Keep the form a stable destination**

Give `VenuePriceSubmit` a venue-specific DOM id and retain its existing form, fields, validation, submission, and trust copy unchanged. Add only scroll-margin/focus presentation needed by the entry jump.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run __tests__/priceContributionIntent.test.ts
PW_SKIP_WEBSERVER=1 PW_KEYLESS_PORT=3200 npx playwright test e2e/price-contribution-entry.spec.ts --project=chromium-keyless --workers=1
```

Expected: all tests pass.

- [ ] **Step 8: Commit coherent implementation**

```bash
git add lib/priceContributionIntent.ts components/map/inspector/VenuePriceSignInGate.tsx components/map/inspector/VenuePriceEntryPanel.tsx components/map/VenueInspector.tsx components/map/inspector/VenueStickyBar.tsx components/map/inspector/VenueOverviewTab.tsx components/map/VenuePriceSubmit.tsx components/map/inspector/venueSheet.css __tests__/priceContributionIntent.test.ts __tests__/venuePriceEntryPanel.test.ts e2e/price-contribution-entry.spec.ts e2e/price-contribution-auth.spec.ts playwright.config.ts docs/superpowers/plans/2026-07-29-price-contribution-entry-points.md
git commit -m "feat: make price contribution obvious"
```

### Task 3: Validate layout and complete evidence

**Interfaces:**
- Consumes: built venue-sheet flow at `/map?sel=<seed>`.
- Produces: fresh 390×844 layout evidence from the real keyless browser path, injectable auth-state evidence, and verification output.

- [x] **Step 1: Reject browser evidence built on mocked auth**

Discard screenshots made with a fabricated Supabase browser session. Do not use them in the PR.

- [x] **Step 2: Check both themes at 390×844**

Use the real keyless browser path to inspect the persistent action and existing form in light and dark themes. Use the injectable render test, not a browser auth fake, for the account gate and signed-in branch.

- [x] **Step 3: Check Overview height and landing**

Measure Overview scroll height signed in against the pre-change structure. Confirm no new landing-page content and no horizontal overflow at 390×844.

- [ ] **Step 4: Run focused and project gates**

Run:

```bash
npx vitest run __tests__/priceContributionIntent.test.ts __tests__/mobileChromeFit.test.ts __tests__/emDashLaw.test.ts
npm run lint
npm run typecheck
npm run verify
```

Expected: all commands exit 0.

- [ ] **Step 5: Review diff and commit**

Confirm `next-env.d.ts` and `package.json` contain no tooling churn. Review only task files, then commit screenshot evidence separately:

```bash
git commit -m "feat: make price contribution obvious"
```
