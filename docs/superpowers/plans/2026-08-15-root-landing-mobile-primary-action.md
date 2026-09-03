# Root Landing Mobile Primary Action Implementation Plan

**Goal:** Remove competing app chrome from exact root landing and restore it
after product handoff.

**Architecture:** A route-aware wrapper owns visibility. Existing tab component
owns all non-root hooks, warmups, and rendering. CSS reserves bottom space from
the non-root fallback marker before hydration and from rendered navigation after.

**Spec:** `specs/root-landing-mobile-primary-action.md`

## Task 1: Pin route visibility in RED

**Files:**

- Modify: `__tests__/mobileTabBar.test.ts`
- Modify: `e2e/mobile-landing-entry.spec.ts`

- [ ] Add pure exact-root visibility cases and preserve existing six-tab cases.
- [ ] Add browser assertions for no root bar, no root 64px body allowance,
  44px hero action, no overflow at 320, 390, and 430 pixels, and visible Primary
  navigation after Near handoff.
- [ ] Run focused Vitest and confirm RED from missing route decision.

## Task 2: Implement minimal route and layout gates

**Files:**

- Modify: `components/nav/MobileTabBar.tsx`
- Modify: `components/nav/mobileNav.css`
- Modify: `components/landing/landing.css`

- [ ] Export pure root visibility decision.
- [ ] Split pathname wrapper from existing hook-owning tab content.
- [ ] Reserve body clearance when non-root `.mobileTabBarClearance` or
  `.mobileTabBar` exists, and render neither on exact root.
- [ ] Remove landing footer tab-bar allowance.
- [ ] Run focused Vitest, lint, typecheck, and diff check.

## Task 3: Prove mobile handoff and close

- [ ] Run production Playwright at 320, 390, and 430 pixels and inspect saved
  screenshots in light mode plus 390 pixels in dark mode.
- [ ] Check desktop root remains unchanged.
- [ ] Review hook purity, assistive-technology visibility, route exactness, and
  CSS ownership.
- [ ] Run `NODE_OPTIONS=--max-old-space-size=4096 npm run verify`.
- [ ] Re-run exact production Playwright gate and confirm clean git status.
