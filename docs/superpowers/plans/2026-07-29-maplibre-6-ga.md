# MapLibre GL 6 GA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase PR 229 onto current main, replace its prerelease dependency with stable MapLibre GL 6.0.0, adopt native vertical building shading, remove private style readiness checks, and record production-grade map evidence.

**Architecture:** Preserve PR 229's namespace-import and structural typing work while resolving it against current map modules. Replace the interim data-driven building colour massing with MapLibre 6's native `fill-extrusion-vertical-gradient`. Track structural style readiness from supported `style.load` and local `setStyle` lifecycle state instead of reading `map.style._loaded`.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL JS 6.0.0, Vitest, Playwright

## Global Constraints

- Pin `maplibre-gl` exactly at `6.0.0`; regenerate only dependency changes required by that pin.
- Work from PR 229 and rebase it onto current `main`.
- Keep map density, clustering, and symbol collision constants unchanged.
- Do not implement a new fix for the reported `reading 'sources'` exception in this lane.
- Use `.next-prod` for isolated production build and start.
- Verify the named e2e suites, 390 by 844 pin-to-sheet-to-Tonight flow, both themes, and pin-rim contrast.

---

### Task 1: Rebase PR 229

**Files:**
- Preserve from PR: `components/PubMapCanvas.tsx`
- Preserve from PR: `components/map/canvas/buildScene.ts`
- Preserve from PR: `components/map/canvas/donutClusters.ts`
- Preserve from PR: `components/map/canvas/filters.ts`
- Preserve from PR: `components/map/canvas/interactions.ts`
- Preserve from PR: `components/map/canvas/tokens.ts`
- Preserve from PR: `components/map/canvas/useMapCamera.ts`
- Preserve from PR: `lib/mapBasemapTaste.ts`
- Preserve from PR: `package.json`
- Preserve from PR: `package-lock.json`

**Interfaces:**
- Consumes: PR 229 commit `c27189a1` and current `main`
- Produces: PR work replayed on current main with conflict resolutions limited to MapLibre 6 compatibility

- [ ] **Step 1: Rebase the PR commit**

Run: `git rebase main`

Expected: conflicts in map modules and dependency manifests.

- [ ] **Step 2: Resolve conflicts deliberately**

Keep current main's map behavior and data contracts. Reapply PR 229's namespace imports and MapLibre 6 typing adaptations without restoring obsolete code.

- [ ] **Step 3: Continue the rebase**

Run: `git rebase --continue`

Expected: branch based on current main with PR 229 represented by a rebased commit.

### Task 2: Lock Stable MapLibre 6

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: npm registry package `maplibre-gl@6.0.0`
- Produces: exact root dependency and matching npm lock graph

- [ ] **Step 1: Establish the compatibility red signal**

Run: `npm install --package-lock-only --ignore-scripts maplibre-gl@6.0.0 --save-exact && npm run typecheck`

Expected: dependency resolves to stable `6.0.0`; typecheck identifies any remaining 6.x import or API incompatibilities.

- [ ] **Step 2: Regenerate installed dependencies**

Run: `npm install --ignore-scripts`

Expected: `node_modules/maplibre-gl/package.json` reports version `6.0.0`.

- [ ] **Step 3: Confirm dependency scope**

Run: `git diff -- package.json package-lock.json`

Expected: MapLibre and its required transitive graph change; unrelated direct dependencies stay unchanged.

### Task 3: Use Native Building Vertical Gradient

**Files:**
- Modify: `__tests__/buildingExtrusionPolicy.test.ts`
- Modify: `components/map/canvas/buildScene.ts`
- Modify: `lib/mapBasemapTaste.ts`
- Modify: `__tests__/mapBasemapTaste.test.ts`

**Interfaces:**
- Consumes: MapLibre 6 `fill-extrusion-vertical-gradient` paint property
- Produces: native vertical gradient on both style-native and app-created extrusion layers, with obsolete data-driven colour massing removed

- [ ] **Step 1: Write the failing behavior test**

Extend `buildingExtrusionPolicy.test.ts` so `tameFillExtrusionLayers` must set `fill-extrusion-vertical-gradient` to `true` for every extrusion and the app-created `buildings-3d` paint must use the native property.

- [ ] **Step 2: Run the test red**

Run: `npx vitest run __tests__/buildingExtrusionPolicy.test.ts`

Expected: failure because current main does not set the native property.

- [ ] **Step 3: Implement the native property**

Set `fill-extrusion-vertical-gradient: true` on app-created `buildings-3d` and in `tameFillExtrusionLayers`. Replace `buildingMassingColorExpr(...)` with the theme's existing flat building massing colour and remove obsolete helper/tests.

- [ ] **Step 4: Run focused tests green**

Run: `npx vitest run __tests__/buildingExtrusionPolicy.test.ts __tests__/mapBasemapTaste.test.ts __tests__/mapPinBandContrast.test.ts`

Expected: all focused building and contrast tests pass.

### Task 4: Remove Private Style Readiness Reads

**Files:**
- Modify: `components/PubMapCanvas.tsx`
- Test: `e2e/map-console-health.spec.ts`
- Test: `e2e/map-gl.spec.ts`

**Interfaces:**
- Consumes: supported MapLibre `style.load` event and app-owned `setStyle` lifecycle
- Produces: app-owned structural readiness state used by route writes, stale-event protection, style protection, and pin entrance

- [ ] **Step 1: Inventory private reads**

Run: `rg -n 'map\\.style|style\\._loaded|_loaded' components lib`

Expected: all current private style readiness reads are identified before editing.

- [ ] **Step 2: Replace readiness checks**

Add one app-owned readiness ref. Mark it false immediately before each app-owned `setStyle`, set it true at the accepted `style.load`, and use it anywhere that needs structural style readiness without waiting for tiles.

- [ ] **Step 3: Prove no private dependency remains**

Run: `rg -n 'map\\.style|style\\._loaded|_loaded' components lib`

Expected: no private MapLibre field access remains.

- [ ] **Step 4: Run type and focused unit gates**

Run: `npm run typecheck && npx vitest run __tests__/buildingExtrusionPolicy.test.ts __tests__/mapBasemapTaste.test.ts __tests__/mapPinBandContrast.test.ts`

Expected: all pass.

### Task 5: Production and Browser Validation

**Files:**
- Modify: PR 229 body through GitHub
- Preserve: `next-env.d.ts`
- Preserve: `package.json`

**Interfaces:**
- Consumes: isolated `.next-prod` build and Playwright Chromium GL project
- Produces: gate evidence and explicit result for the `reading 'sources'` exception on MapLibre 6

- [ ] **Step 1: Run repository verification**

Run: `npm run verify`

Expected: validate-data, lint, typecheck, coverage, and resilient audit pass.

- [ ] **Step 2: Build isolated production output**

Run: `NEXT_DIST_DIR=.next-prod npm run build`

Expected: production build completes with `.next-prod/BUILD_ID`.

- [ ] **Step 3: Run named map suites**

Run the Playwright projects that execute `e2e/map-gl.spec.ts`, `e2e/map-console-health.spec.ts`, and `e2e/map-fallback.spec.ts` against the isolated production build.

Expected: all named suites pass with zero critical map console errors.

- [ ] **Step 4: Reproduce theme switching**

Use a real production browser, toggle light and dark repeatedly, and collect `pageerror` and console evidence specifically for `Cannot read properties of undefined (reading 'sources')`.

Expected: record whether error occurs on 6.x, without changing its separate-lane fix.

- [ ] **Step 5: Run 390 by 844 acceptance**

Use `chrome-devtools-axi open`, then `chrome-devtools-axi emulate --viewport "390x844x3,mobile,touch"`, reload in place, tap a pin, open the venue sheet, and reach Tonight.

Expected: complete interaction works in both themes; pin rims remain visible against the basemap.

- [ ] **Step 6: Restore tooling artifacts**

Restore any `next-env.d.ts` dev/build rewrite and reject unrelated `package.json` install-script churn.

- [ ] **Step 7: Update PR 229 body**

Replace prerelease/hold text with stable 6.0.0 evidence. Include exact verify, build, e2e, mobile, theme, rim, private-field, and `reading 'sources'` results.

### Task 6: Review, Commit, and Handoff

**Files:**
- Review every changed file

**Interfaces:**
- Consumes: verified diff and PR evidence
- Produces: committed `fm/maplibre-6-ga` branch and firstmate status

- [ ] **Step 1: Review scope**

Run: `git diff --check && git diff --stat main...HEAD && git status --short`

Expected: only upgrade, tests, plan, and required dependency graph changes.

- [ ] **Step 2: Run check-work verifier**

Use `/check-work` focused on MapLibre 6 compatibility, private API removal, building paint policy, and required gates.

Expected: verifier returns `VERDICT: PASS`.

- [ ] **Step 3: Commit**

Commit normal prose without an agent co-author.

- [ ] **Step 4: Report done**

Append one `done:` line to the firstmate status file with commit summary.
