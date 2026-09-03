# Permanent one-tap landing implementation plan

> Execute with test-driven development. Keep each behaviour independently verifiable.

**Goal:** Make `Find my pint` permanent landing primary and turn its explicit click into one location request on `/near`.

**Architecture:** Remove retired landing experiment flag from shared trusted-handoff schema and homepage render path. Keep `/near` idle-first for ordinary and poster entries. Interpret only exact `locate=1` as explicit auto-locate intent, then pass existing `autoLocate` prop into `NearMeNow`.

**Stack:** Next.js App Router, React 19, TypeScript, Vitest, Playwright.

## Task 1: Pin permanent landing hierarchy

**Files:**

- Modify: `__tests__/landingFindMyPintHierarchy.test.ts`
- Modify: `__tests__/trustedHandoffFlags.test.ts`
- Modify: `e2e/landing-find-my-pint.spec.ts`

1. Replace flag-off/flag-on assertions with permanent hierarchy assertions.
2. Require hero primary `Find my pint` link to target `/near?locate=1`.
3. Require Map and Plan to remain text links.
4. Require landing flag to be absent from homepage and flag schema.
5. Run focused tests and confirm RED.

## Task 2: Pin explicit `/near` location intent

**Files:**

- Add: `__tests__/nearEntry.test.ts`
- Modify: `e2e/mobile-landing-entry.spec.ts`

1. Require exact `locate=1` to enable auto-locate.
2. Require absent, `0`, and `true` values to keep `/near` idle-first.
3. Require `?patch=` to retain priority over location intent.
4. Run focused tests and confirm RED.

## Task 3: Implement permanent hierarchy and explicit location entry

**Files:**

- Modify: `components/landing/LandingPage.tsx`
- Modify: `components/landing/landing.css`
- Modify: `app/page.tsx`
- Modify: `components/nearme/NearPageClient.tsx`
- Modify: `lib/trustedHandoffFlags.ts`
- Modify: `lib/trustedHandoffFlags.server.ts`

1. Remove `landingFindMyPint` flag ownership and prop threading.
2. Render one permanent hero hierarchy.
3. Preserve landing CTA analytics for Near, Map, and Plan.
4. Add pure exact-query resolver and thread result to existing `NearMeNow.autoLocate`.
5. Preserve poster-session handling, patch priority, social launch gate, map warm-up, and static homepage contract.
6. Run focused tests and confirm GREEN.

## Task 4: Browser and quality proof

**Files:**

- Modify as needed: `e2e/landing-find-my-pint.spec.ts`
- Modify as needed: `e2e/mobile-landing-entry.spec.ts`

1. Run focused lint and TypeScript checks.
2. Run landing and mobile-entry Playwright tests.
3. Inspect real 390 x 844 and 1440 x 900 pages.
4. Confirm one dominant action, 44px targets, no horizontal overflow, valid focus, explicit location request, denied-location fallback, and patch-link priority.
5. Run diff review and relevant regression tests.

## Task 5: Repair browser-found quality defects

**Files:**

- Modify: `components/nav/MobileTabBar.tsx`
- Modify: `e2e/mobile-button-system.spec.ts`
- Modify: `docs/plans/LANDING_ACQUISITION.md`
- Modify: `docs/proof/landing-wave0/README.md`

1. Use the live route for the Moment return link on the server and client. The
   earlier stable `"/"` snapshot step is superseded because root no longer
   mounts the tab bar.
2. Update stale mobile button proof to test current landing and Pub Pal entry.
3. Mark retired landing experiment documents and screenshots as historical.
4. Re-run browser tests and confirm no hydration mismatch is logged.
