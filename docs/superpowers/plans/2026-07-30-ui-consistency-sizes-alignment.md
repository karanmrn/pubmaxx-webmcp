# UI Consistency, Sizes, and Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centre desktop page content and make map control rows, floating-panel edges, alignment, Tonight Arc border meaning, and first-visit analytics placement consistent at 390px, 768px, 1280px, and 1440px.

**Architecture:** Use existing shared width tokens and map chrome variables. Measure real rendered boxes through Playwright, record immutable before and after evidence, then protect layout contracts with browser assertions. Keep `components/PubMap.tsx` structurally unchanged unless a selector hook proves unavoidable.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Playwright, Vitest

## Global Constraints

- Preserve colour palette, typeface, brand, control behaviour, bottom navigation, and topbar structure.
- Do not add dependencies.
- Do not refactor `components/PubMap.tsx`; report its line delta.
- Phone chrome above map stays at or below 164px.
- Filters remain on one row.
- Price and trust captions remain uncut.
- Map attribution remains reachable.
- Write every claimed pixel measurement from Playwright `getBoundingClientRect()` output.
- Commit before evidence before production changes, then commit coherent implementation and after evidence.

---

### Task 1: Baseline capture and route audit

**Files:**
- Create: `e2e/ui-consistency-layout.spec.ts`
- Create: `docs/evidence/ui-consistency/before/measurements.json`
- Create: `docs/evidence/ui-consistency/before/*.png`
- Create: `docs/evidence/ui-consistency/README.md`

**Interfaces:**
- Consumes: existing route DOM, current CSS, keyless E2E auth boundary
- Produces: `LayoutMeasurements` JSON with viewport, route, surface, selector, left, right, top, bottom, width, and height

- [ ] **Step 1: Add deterministic browser setup**

Create a Playwright setup helper that:

```ts
await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
await page.addInitScript(() => {
  localStorage.setItem("pubmax-tour-v1-done", "1");
  localStorage.setItem("pubmax_onboarding_dismissed", "1");
  sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
});
```

For signed-in profile evidence, seed existing E2E Supabase storage shape and intercept only E2E Supabase and identity boundaries, following `e2e/price-submission.spec.ts`.

- [ ] **Step 2: Capture requested surfaces**

At 390x844, 768x900, 1280x800, and 1440x900, capture:

```text
landing
map
map venue sheet
plan
signed-in profile
```

Store viewport screenshots below `docs/evidence/ui-consistency/before/`. Verify each file exists with `ls -la`.

- [ ] **Step 3: Measure map controls and floating panels**

Record rendered rectangles for:

```text
.mobileMapRail > button
.mobileMapTopbar
.mobileMapChrome
.tonightArcChips
.mobilePlanActivation
.analyticsConsentPrompt
.mapToolbar
.siteNavBarFloating
```

Record phone map chrome bottom edge and whether filters wrap. Open MapLibre attribution and record its rectangle plus plan-control top edge.

- [ ] **Step 4: Audit desktop routes**

Enumerate app routes from filesystem and supply stable fixtures for dynamic paths. At 1280px and 1440px, record primary content shell left and right offsets. Mark routes as centred when offset difference is at most 2px, full-bleed when content intentionally spans viewport, or affected when a capped shell hugs one side.

- [ ] **Step 5: Commit baseline evidence**

Run:

```bash
git add docs/evidence/ui-consistency e2e/ui-consistency-layout.spec.ts docs/superpowers/plans/2026-07-30-ui-consistency-sizes-alignment.md
git commit -m "test(ui): capture layout consistency baseline"
```

Expected: committed screenshots, measurements, route audit, and capture contract. No production CSS changes.

### Task 2: Desktop content centring contract

**Files:**
- Modify: `e2e/ui-consistency-layout.spec.ts`
- Modify: `app/globals.css`
- Modify: `app/u/[handle]/profile.css`
- Modify only affected route styles identified in Task 1

**Interfaces:**
- Consumes: `--content-max`, `--content-max-wide`, `--page-gutter`
- Produces: centred capped shells with balanced desktop gutters

- [ ] **Step 1: Write failing browser assertions**

For each affected capped route at 1280px and 1440px, assert:

```ts
expect(Math.abs(rect.left - (viewportWidth - rect.right))).toBeLessThanOrEqual(2);
expect(rect.width).toBeLessThanOrEqual(1240);
```

Full-bleed map routes assert left `0` and right `viewportWidth` instead.

- [ ] **Step 2: Run assertions and verify red**

Run:

```bash
PW_PORT=3217 PW_SKIP_WEBSERVER=1 npx playwright test e2e/ui-consistency-layout.spec.ts --project=chromium --grep "desktop route centring"
```

Expected: profile or other affected route fails with unequal left and right offsets.

- [ ] **Step 3: Implement shared shell centring**

Use existing tokens and explicit box sizing:

```css
width: 100%;
max-width: var(--content-max-wide);
margin-inline: auto;
padding-inline: var(--page-gutter);
box-sizing: border-box;
```

Apply through the narrowest existing shared shell selector that covers affected routes. Do not patch unrelated child cards.

- [ ] **Step 4: Run assertions and verify green**

Run same Playwright grep. Expected: affected capped routes have balanced offsets within 2px at both desktop widths.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css 'app/u/[handle]/profile.css' e2e/ui-consistency-layout.spec.ts
git commit -m "fix(ui): centre desktop content on one shared shell"
```

### Task 3: Honest profile Options affordance

**Files:**
- Modify: `components/nav/SiteNavMore.tsx`
- Modify: `components/profile/PubmaxxAccountHub.tsx`
- Modify: `app/u/[handle]/ProfilePageClient.tsx`
- Modify: `app/u/[handle]/profile.css`
- Modify: `__tests__/siteNav.test.ts`
- Modify: `e2e/ui-consistency-layout.spec.ts`

**Interfaces:**
- Consumes: existing `SiteNavMore` portal, focus, keyboard, active-state, and positioning behaviour; existing `useAuth().signOut`; existing profile editor and analytics controls
- Produces: one desktop `Options` trigger with working Edit profile, Analytics choice, Sign out, About, Privacy, and Terms actions

- [ ] **Step 1: Write failing menu contract tests**

Assert configurable `SiteNavMore` items can be links or actions while the default navigation links remain unchanged. Browser assertion opens Profile Options and verifies exact labels:

```text
Edit profile
Analytics choice
Sign out
About
Privacy
Terms
```

Assert `Help` is absent.

- [ ] **Step 2: Verify red**

Run:

```bash
npm test -- __tests__/siteNav.test.ts
PW_PORT=3217 PW_SKIP_WEBSERVER=1 npx playwright test e2e/ui-consistency-layout.spec.ts --project=chromium --grep "profile options"
```

Expected: configurable trigger and profile menu do not exist yet.

- [ ] **Step 3: Generalise existing overflow menu**

Keep `SiteNavMore` as the one menu implementation. Add typed props for trigger label, menu label, and link or action items. Preserve default `More` behaviour and existing CSS classes, portal positioning, Escape handling, arrow-key navigation, outside-click close, and active route state.

- [ ] **Step 4: Wire only working profile actions**

Place one desktop Options affordance at the profile shell's top-right. Wire:

```text
Edit profile -> existing setEditing state and ProfileEditor
Analytics choice -> #analytics-settings on existing PubmaxxAccountHub controls
Sign out -> existing useAuth().signOut
About -> /about
Privacy -> /privacy
Terms -> /terms
```

Add `id="analytics-settings"` to existing analytics controls. Do not add `/settings`, `/help`, Help copy, or placeholder actions.

- [ ] **Step 5: Verify actions and sizing**

Open menu through real browser. Click each action in isolated runs, verify editor visibility, analytics controls scroll target, signed-out nav state, and route destinations. Assert Options trigger height matches its row and stays inside centred profile shell.

- [ ] **Step 6: Commit**

```bash
git add components/nav/SiteNavMore.tsx components/profile/PubmaxxAccountHub.tsx 'app/u/[handle]/ProfilePageClient.tsx' 'app/u/[handle]/profile.css' __tests__/siteNav.test.ts e2e/ui-consistency-layout.spec.ts
git commit -m "feat(profile): add working account options menu"
```

Commit body lists Edit profile, Analytics choice, Sign out, About, Privacy, and Terms as verified actions, and notes no Help route exists.

### Task 4: Map control rhythm, boundaries, and border meaning

**Files:**
- Modify: `e2e/ui-consistency-layout.spec.ts`
- Modify: `components/mobile/mobileMapShell.css`
- Modify: `components/map/tonightArcChips.css`
- Modify if baseline proves desktop stack mismatch: `components/map/mapToolbar.css`

**Interfaces:**
- Consumes: `--mobile-map-bar-h`, `--mobile-map-rail-h`, `--mobile-map-corner-lane`, `--control-radius`
- Produces: equal-height shared-row controls, common stack boundary, left-aligned mobile map actions, neutral Tonight Arc container

- [ ] **Step 1: Write failing equal-height assertions**

At all four widths, group controls by rendered row. Assert each visible control height equals the first control height within 0.5px.

- [ ] **Step 2: Write failing boundary and alignment assertions**

At phone widths, assert topbar, contextual rail, Tonight Arc host, and primary plan action use one declared alignment system. For panels intended to share the stack, assert left and right edges match within 1px. At desktop widths, assert centred floating hosts have balanced offsets.

- [ ] **Step 3: Verify red**

Run:

```bash
PW_PORT=3217 PW_SKIP_WEBSERVER=1 npx playwright test e2e/ui-consistency-layout.spec.ts --project=chromium --grep "control heights|stacked panel edges|surface alignment"
```

Expected: current mismatched heights or edges fail with measured rectangles.

- [ ] **Step 4: Implement minimal CSS**

Set one explicit control block size per row, keep emphasis in fill and weight, bind stacked panels to existing chrome inset or max-width, and remove accent colour from Tonight Arc container border:

```css
border-color: var(--color-border);
```

Keep accent on active controls and focus states only.

- [ ] **Step 5: Verify green and mobile regressions**

Run layout grep plus existing mobile control, collision, and chrome tests. Confirm phone chrome bottom is at most 164px, filters stay one row, and map attribution opens clear of plan action.

- [ ] **Step 6: Commit**

```bash
git add components/mobile/mobileMapShell.css components/map/tonightArcChips.css components/map/mapToolbar.css e2e/ui-consistency-layout.spec.ts
git commit -m "fix(map): align control heights and floating panel edges"
```

Commit body states alignment system: left-aligned phone stack and centred capped desktop stack.

### Task 5: First-visit analytics notice hierarchy

**Files:**
- Modify: `e2e/analytics-consent.spec.ts`
- Modify: `e2e/ui-consistency-layout.spec.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: unchanged `AnalyticsConsentPromptContent` copy and actions
- Produces: honest, dismissible, lower-dominance notice that does not cover primary map controls

- [ ] **Step 1: Write failing browser assertion**

On fresh first visit at phone and desktop widths, assert notice:

```text
remains visible
contains current disclosure text and both decision buttons
does not overlap map control stack, plan action, map attribution, or venue sheet
occupies less than 24 percent of viewport height on phone
```

- [ ] **Step 2: Verify red**

Run:

```bash
PW_PORT=3217 PW_SKIP_WEBSERVER=1 npx playwright test e2e/analytics-consent.spec.ts e2e/ui-consistency-layout.spec.ts --project=chromium --grep "analytics"
```

- [ ] **Step 3: Implement placement-only CSS**

Retain copy, buttons, visibility, and dismiss actions. Reduce visual weight through compact responsive placement and existing neutral surface tokens. Do not hide, delay, collapse, or rewrite disclosure.

- [ ] **Step 4: Verify green**

Run same Playwright grep. Confirm both buttons remain at least 44px high and notice stays clear of product controls.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css e2e/analytics-consent.spec.ts e2e/ui-consistency-layout.spec.ts
git commit -m "fix(ui): lower first-visit analytics notice weight"
```

### Task 6: After evidence and closeout

**Files:**
- Create: `docs/evidence/ui-consistency/after/measurements.json`
- Create: `docs/evidence/ui-consistency/after/*.png`
- Modify: `docs/evidence/ui-consistency/README.md`

**Interfaces:**
- Consumes: final rendered app
- Produces: before and after comparison, route impact report, test evidence

- [ ] **Step 1: Capture after matrix**

Repeat Task 1 against unchanged routes, states, themes, and viewport heights. Verify output files with `ls -la`.

- [ ] **Step 2: Record measured comparison**

README table columns:

```text
viewport
surface or row
before heights or edges
after heights or edges
alignment system
```

List affected desktop routes from audit and `components/PubMap.tsx` line delta from `git diff --numstat`.

- [ ] **Step 3: Run focused browser suite**

```bash
PW_PORT=3217 PW_SKIP_WEBSERVER=1 npx playwright test e2e/ui-consistency-layout.spec.ts e2e/analytics-consent.spec.ts e2e/drink-chip-controls.spec.ts e2e/price-caption-integrity.spec.ts --project=chromium
```

- [ ] **Step 4: Run project verification**

```bash
npm run lint
npm run typecheck
npm test
npm run verify
```

Use fresh output and stop on any failure.

- [ ] **Step 5: Review and commit after evidence**

Inspect screenshots at each width, review diff, restore `next-env.d.ts` if Next rewrote it, then:

```bash
git add docs/evidence/ui-consistency e2e app components
git commit -m "test(ui): prove centred responsive layout"
```

Commit body states measured alignment systems and routes corrected.
