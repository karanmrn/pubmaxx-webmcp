# Map Landmark Visibility and Craft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make London landmarks reliably orient the normal mobile city view without taking collision priority from priced pubs, and keep first-run onboarding away from the map centre.

**Architecture:** Keep one landmark GeoJSON source and split its pictogram and name into two independent MapLibre symbol layers. Both layers remain below pub layers, participate in collision placement, and use shared importance ordering, allowing a nearby label to survive when a pub cluster owns the landmark coordinate. On phones, retain modal semantics and focus handling while docking the compact tour card above bottom navigation instead of centring it over Westminster.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL 5, CSS, Vitest, Playwright.

## Global Constraints

- No new dependency or animation library.
- Honour `prefers-reduced-motion`.
- Do not decompose `PubMap.tsx`.
- Do not touch price, pin-colour, or community-price systems.
- Pub pins and clusters remain above landmarks and win MapLibre collision placement.
- Every app symbol layer remains inside MapLibre's collision index.
- Do not change pin or cluster zoom boundaries, supercluster radius, or price-layer policy.

---

### Task 1: Independent landmark orientation candidates

**Files:**
- Modify: `__tests__/mapSymbolCollision.test.ts`
- Modify: `components/map/canvas/buildScene.ts`
- Modify: `components/PubMapCanvas.tsx`

**Interfaces:**
- Consumes: existing `landmarks` GeoJSON source with `icon`, `name`, and `priority` properties.
- Produces: `landmarks-label` and `landmarks-icon` symbol layers, both collision-aware and below `pubs-point`.

- [x] **Step 1: Write failing collision tests**

Add assertions that `landmarks-label` exists separately from `landmarks-icon`, that both use `symbol-sort-key: ["coalesce", ["get", "priority"], 999]`, that both keep `*-allow-overlap` and `*-ignore-placement` false below the existing inspector rule, and that both precede `pubs-point` in style order.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/mapSymbolCollision.test.ts`

Expected: FAIL because `landmarks-label` does not exist and `landmarks-icon` still owns `text-field`.

- [x] **Step 3: Split label and pictogram layers**

In `buildLandmarks`, add the restrained label layer first and icon layer second. Give labels eight variable anchors, a compact city-zoom size, theme-token colour and halo, and subdued low-zoom opacity. Preserve landmark icon sizing and inspector behavior. Keep pub construction after both landmark layers.

Update runtime landmark-source removal in `PubMapCanvas.tsx` to remove both layers before deleting the source.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/mapSymbolCollision.test.ts`

Expected: PASS with pub/cluster density constants unchanged.

### Task 2: Mobile first-run tour placement

**Files:**
- Create: `e2e/first-run-tour-placement.spec.ts`
- Modify: `components/onboarding/firstRunTour.css`

**Interfaces:**
- Consumes: existing `.tourScrim` and `.tourCard` modal DOM.
- Produces: phone-only bottom-edge card placement that leaves viewport centre uncovered while preserving desktop centring and 44px controls.

- [x] **Step 1: Write failing browser test**

At a 390x844 viewport with fresh tour storage, open `/map`, wait for the dialog, and assert its bounding box begins below 55% of viewport height and does not contain the viewport centre point. Assert dialog remains modal and Skip/Next remain at least 44px tall.

- [x] **Step 2: Run test to verify it fails**

Run against the already-running development server:

`PW_SKIP_WEBSERVER=1 PW_PORT=3002 npx playwright test e2e/first-run-tour-placement.spec.ts --project=chromium --workers=1`

Expected: FAIL because centred card contains the viewport centre and starts above the lower-map threshold.

- [x] **Step 3: Dock and compact phone tour**

Inside `@media (max-width: 640px)`, align the scrim to the bottom, reserve safe-area plus mobile navigation clearance, tighten card and step spacing, and keep all action floors at 44px. Leave desktop layout and reduced-motion rules unchanged.

- [x] **Step 4: Run browser test to verify it passes**

Run the same Playwright command.

Expected: PASS with centre point visible and controls thumb-sized.

### Task 3: Visual matrix and closeout

**Files:**
- Create: `docs/screenshots/map-landmarks/*.webp`
- Modify: none beyond implementation if visual tuning is needed.

**Interfaces:**
- Consumes: live MapLibre scene at mobile zooms 10.5, 11.5, and 12.5 in light and dark themes.
- Produces: before/after PR evidence and validated final scene.

- [x] **Step 1: Capture both themes at three zoom levels**

Use `chrome-devtools-axi` at `390x844x3,mobile,touch`, store tour key `"1"`, set `pubmax-theme`, and use focused-map `+`/`-` keyboard controls. Save corresponding before and after WebP screenshots.

- [x] **Step 2: Inspect every screenshot**

Confirm recognisable London names or pictograms appear at normal city zoom, labels remain restrained in both themes, and price clusters/pins remain unobscured. Tune only landmark symbol layout/paint and tour mobile CSS if needed.

- [x] **Step 3: Run focused and full verification**

Run:

`npm test -- __tests__/mapSymbolCollision.test.ts`

`PW_SKIP_WEBSERVER=1 PW_PORT=3002 npx playwright test e2e/first-run-tour-placement.spec.ts --project=chromium --workers=1`

`npm run verify`

Expected: all commands exit 0 with no failures.

- [x] **Step 4: Restore local tooling churn and commit**

Restore `next-env.d.ts`, inspect `git diff`, stage only task files, and commit with a normal project commit message.
