# Desktop Taste Wave 1 Implementation Plan

> **For implementer:** Use `executing-plans` and complete each task in order.

**Goal:** Correct desktop hero scale, enforce one-accent discipline, and convert plain-text eyebrows to sentence case without layout recomposition or Map, Plan, Messages, or wave-2 changes.

**Architecture:** Keep changes in existing page components and CSS. Use existing semantic design tokens. Add browser tests for rendered geometry and computed styles, then retain 1440px light and dark proof images.

**Tech stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, Playwright.

---

### Task 1: Pin rendered wave-1 contracts

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Create: `e2e/design-taste-wave-1.spec.ts`

1. Add a 1440px landing test that measures H1 font size and rendered line count.
2. Add computed-style checks for Today price and music hues, Stories empty CTA, Discover action chips, and sentence-case eyebrows.
3. Run focused tests and confirm they fail for current UI.

### Task 2: Correct landing hero scale

**Files:**
- Modify: `components/landing/LandingPage.tsx`
- Modify: `components/landing/landing.css`

1. Shorten H1 to one clear product promise.
2. Clamp desktop type to 56-64px and allow enough width for at most two lines at 1440px.
3. Keep existing responsive composition and CTA structure.

### Task 3: Enforce one-accent discipline

**Files:**
- Modify: `app/today/today.css`
- Modify: `app/tonight/tonight.css`
- Modify: `app/feed/FeedPageClient.tsx`
- Modify: `components/EmptyState.tsx`
- Modify: `components/emptyState.css`
- Modify: `app/discover/discover.css`
- Modify: `app/discover/DiscoverPageClient.tsx`

1. Move pint prices to semantic price ink.
2. Move music kickers to neutral text hue and sentence case.
3. Make Stories empty primary action coral and its eyebrow neutral.
4. Replace Discover coral gradients with flat hairline action chips.
5. Give four heritage route actions distinct labels.

### Task 4: Convert plain-text eyebrows to sentence case

**Files:**
- Modify: page and component styles that define unframed `*Eyebrow` text.

1. Remove uppercase transforms from plain-text eyebrow selectors outside excluded surfaces.
2. Reduce display-letter spacing to normal sentence-case tracking.
3. Keep bordered or filled stamp chips uppercase.

### Task 5: Verify and record proof

**Files:**
- Create: `docs/proof/design-taste-wave-1/README.md`
- Create: `docs/proof/design-taste-wave-1/after/*.png`

1. Run focused tests, voice fences, lint, typecheck, and full verification gate.
2. Inspect affected pages at 1440px in light and dark themes.
3. Save before and after screenshots and document coverage.
4. Review diff, run project memory maintenance script, and commit on `fm/design-taste-wave-1`.
