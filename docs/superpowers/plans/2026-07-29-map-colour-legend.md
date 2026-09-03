# Map Colour Legend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain every price, pin, cluster, and map mark in plain language, while making price bands visible at Manchester's default zoom on desktop and phone.

**Architecture:** Keep current clustering, zoom, collision, and symbol layers. Make fallback cluster fill read existing `b0` to `b3` price counts instead of venue density, retain segmented desktop donut clusters, and render one reusable map-key body in current desktop price chrome and phone More sheet.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL 6, CSS, Vitest, Playwright.

## Global Constraints

- Do not change `PIN_MIN_ZOOM`, `CLUSTER_MAX_ZOOM`, `CLUSTER_RADIUS_PX`, `CLUSTER_COLLISION_PADDING`, symbol overlap, or symbol padding contracts.
- Do not add a phone top-chrome control.
- Keep every control keyboard-operable and every swatch paired with visible text.
- Follow `docs/VOICE.md`: British spelling, no exclamation marks, no em dashes.
- Run `no-ai-slop` checks over every new reader-facing line.
- Capture screenshots under `/tmp`, then move and confirm each file.

---

### Task 1: Price-aware cluster fallback

**Files:**
- Modify: `lib/mapBasemapTaste.ts`
- Modify: `__tests__/mapBasemapTaste.test.ts`

**Interfaces:**
- Consumes: existing supercluster properties `b0`, `b1`, `b2`, `b3`.
- Produces: `clusterCircleColorExpr(tokens, dark)` using most common known price band, or grey when no priced pub exists.

- [ ] **Step 1: Write failing expression test**

Assert that `clusterCircleColorExpr` reads `b0`, `b1`, `b2`, and `b3`, uses pint, amber, brick, and muted tokens, and does not branch on `point_count`.

- [ ] **Step 2: Run test and confirm red**

Run: `npm test -- __tests__/mapBasemapTaste.test.ts`

Expected: cluster expression test fails because current expression branches on cluster size and uses brass instead of price counts.

- [ ] **Step 3: Implement minimal expression**

Select most common known band from `b0` to `b2`, with stable low-to-high tie order. Use muted only when `b0 + b1 + b2` is zero. Leave cluster radius, opacity, stroke, count, collision, and zoom untouched.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- __tests__/mapBasemapTaste.test.ts __tests__/canvas-donutClusters.test.ts __tests__/mapSymbolCollision.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mapBasemapTaste.ts __tests__/mapBasemapTaste.test.ts
git commit -m "fix(map): colour fallback clusters by pint price"
```

### Task 2: Complete reusable map key

**Files:**
- Create: `components/map/MapKey.tsx`
- Create: `components/map/mapKey.css`
- Modify: `lib/mapPriceLegend.ts`
- Modify: `components/map/MapPriceControl.tsx`
- Modify: `components/map/mapPriceControl.css`
- Create: `__tests__/mapKey.test.tsx`
- Modify: `__tests__/mapPriceLegend.test.ts`

**Interfaces:**
- Consumes: scene-derived map price semantics and active drink context.
- Produces: `MapKey` with price rows, cluster reading, venue shapes, base-pub mark, landmark mark, provisional report dot, Pint Drop ring, tonight rings, selection ring, and route-stop mark.

- [ ] **Step 1: Write failing key tests**

Render the wished-for `MapKey` and assert four named price bands, cluster count meaning, each venue shape, hollow base pub, landmark, provisional dot, Pint Drop ring, tonight marks, selected pin, and route stop. Assert swatches are hidden from assistive technology while the text remains.

- [ ] **Step 2: Run tests and confirm red**

Run: `npm test -- __tests__/mapKey.test.tsx __tests__/mapPriceLegend.test.ts`

Expected: missing component and missing unpriced row fail.

- [ ] **Step 3: Implement model and component**

Add grey `No price on the map` row. Use concise copy checked against source behaviour. Use semantic headings and lists. Keep decorative marks `aria-hidden`, with every meaning repeated in text.

- [ ] **Step 4: Put key in desktop price panel**

Keep current bottom-left price key as trigger. Change expanded panel label and heading from price filters to map key, render `MapKey`, then retain maximum-pint-price controls below it.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- __tests__/mapKey.test.tsx __tests__/mapPriceLegend.test.ts __tests__/emDashLaw.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/map/MapKey.tsx components/map/mapKey.css lib/mapPriceLegend.ts components/map/MapPriceControl.tsx components/map/mapPriceControl.css __tests__/mapKey.test.tsx __tests__/mapPriceLegend.test.ts
git commit -m "feat(map): explain pin colours and marks"
```

### Task 3: Phone access through existing More sheet

**Files:**
- Modify: `components/PubMap.tsx`
- Modify: `components/mobile/MobileMapShell.tsx`
- Modify: `__tests__/mobileMapPriceChrome.test.ts`

**Interfaces:**
- Consumes: reusable `MapKey`.
- Produces: `Key` tab inside existing More map controls sheet, with no added top-chrome item.

- [ ] **Step 1: Write failing phone-placement test**

Assert phone key appears in `layersContent`, `mobileLayersTab` accepts `key`, and no `MapPriceControl placement="header"` is mounted as phone chrome.

- [ ] **Step 2: Run test and confirm red**

Run: `npm test -- __tests__/mobileMapPriceChrome.test.ts`

Expected: current test and implementation still describe the stale header placement.

- [ ] **Step 3: Add Key tab**

Make Key the first tab in existing More sheet. Pass current legend inputs to `MapKey`. Rename sheet title to `Map controls` so Key, Layers, Events, and Transit all match the heading.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- __tests__/mobileMapPriceChrome.test.ts __tests__/mobileChromeFit.test.ts __tests__/mapKey.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/PubMap.tsx components/mobile/MobileMapShell.tsx __tests__/mobileMapPriceChrome.test.ts
git commit -m "feat(map): add phone map key to existing controls"
```

### Task 4: Browser evidence and closeout

**Files:**
- Create: `docs/evidence/map-colour-legend/README.md`
- Add: exact screenshots selected for review under `docs/evidence/map-colour-legend/`

**Interfaces:**
- Consumes: Manchester `/map/manchester`, default zoom `11.2`, both themes.
- Produces: before and after evidence at 390 by 844 and desktop, with legend closed and open.

- [ ] **Step 1: Verify desktop in both themes**

At 1440 by 900, load `/map/manchester`, dismiss onboarding, capture default zoom and open key in dark and light themes. Confirm key opens by keyboard, Escape closes it, and browser console has no errors or warnings.

- [ ] **Step 2: Verify phone in both themes**

Run `emulate --viewport "390x844x3,mobile,touch"`, reload in place, open More, then Key. Capture default zoom and key in dark and light themes. Confirm no horizontal overflow and accessible names in snapshot.

- [ ] **Step 3: Record evidence**

Document default zoom `11.2`, individual-pin floor `12`, cluster maximum `13`, before/after behaviour, exact screenshot names, and map-state audit. Call out similar-looking blue dot versus blue ring, brass source ring versus selected double ring, and lack of a distinct no-alcohol pin.

- [ ] **Step 4: Run verification**

Run: `npm run lint`, `npm run typecheck`, focused Vitest suite, then `npm run verify`.

Expected: all commands PASS with clean output.

- [ ] **Step 5: Review and commit**

Run closeout review and check-work playbooks, restore `next-env.d.ts`, remove temporary files, then:

```bash
git add docs/evidence/map-colour-legend
git commit -m "docs(map): record colour legend evidence"
```
