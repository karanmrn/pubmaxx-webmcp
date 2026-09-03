# Loaded Route Browser Back Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commit Firefox proof that browser Back restores a populated loaded-crawl planner and that immediate browser Back after a surface transition lands on the correct venue when a genuine predecessor exists.

**Architecture:** Keep `useMapSurfaceNavigation` unchanged. Extend its existing real-browser contract in `e2e/map-surface-history.spec.ts`, and adjust only Playwright production-server configuration if a reproduced Firefox startup failure proves that necessary.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright Firefox, Vitest.

## Global Constraints

- Branch from `origin/fm/history-single-owner` on `fm/history-loaded-route-proof`.
- Use browser Back, never an in-app control, for loaded-route proof.
- Race proof must start from a real previous page and press Back in same task as surface transition.
- Both proof tests must fail against `origin/main` and pass on this branch.
- Do not redesign history owner, weaken assertions, touch page copy, merge, push to `main`, or deploy.
- `npx tsc --noEmit` must exit 0 and unit suite must report at least 7495 passing tests.
- Commit Firefox screenshots at 390x844 and 1440x900 in light and dark.

---

### Task 1: Reproduce Firefox proof boundary

**Files:**
- Inspect: `playwright.config.ts`
- Inspect: `e2e/map-surface-history.spec.ts`

**Interfaces:**
- Consumes: `PW_FIREFOX_DESKTOP_MAP_CHROME_FIT=1`, `webServer.env`, Firefox Playwright project.
- Produces: exact pass/fail command and captured startup or assertion symptom.

- [ ] **Step 1: Free configured e2e ports after resolving current listeners.**

- [ ] **Step 2: Run existing Firefox history spec through Playwright-owned production server.**

Run:

```bash
PW_FIREFOX_DESKTOP_MAP_CHROME_FIT=1 npx playwright test e2e/map-surface-history.spec.ts --project=firefox-desktop-map-chrome-fit --workers=1
```

Expected: command either reaches browser assertions or exposes exact keyless production startup blocker.

- [ ] **Step 3: If startup is blocked, add only missing `webServer.env` value and rerun.**

Expected: Firefox reaches `/map`; no hand-started server supplies different env.

### Task 2: Lock browser Back behavior

**Files:**
- Modify: `e2e/map-surface-history.spec.ts`
- Test: `e2e/map-surface-history.spec.ts`

**Interfaces:**
- Consumes: loaded Victorian Soho route, planner and venue drawer selectors, real browser history.
- Produces: browser-Back assertion for five populated stops and immediate-Back assertion with `/tonight` predecessor.

- [ ] **Step 1: Name mutation caught.**

Loaded-route test must fail if Back is routed only through `SurfaceNav` click or planner state resets during `popstate`. Race test must fail if transition and browser Back compete while no genuine predecessor exists.

- [ ] **Step 2: Replace in-app loaded-route Back click with Playwright browser Back.**

Use `page.goBack()` after loaded route opens venue. Assert planner is sole drawer and `.routeList > li` count remains literal `5`.

- [ ] **Step 3: Run both tests against `origin/main` and record expected failures.**

Expected: loaded-route browser Back does not restore populated planner, and immediate-Back race does not keep venue.

- [ ] **Step 4: Run both tests on feature branch.**

Expected: both pass in Firefox.

### Task 3: Refresh visual proof and validate

**Files:**
- Update: `docs/proof/history-single-owner/history-owner-390-light-firefox.png`
- Update: `docs/proof/history-single-owner/history-owner-390-dark-firefox.png`
- Update: `docs/proof/history-single-owner/history-owner-1440-light-firefox.png`
- Update: `docs/proof/history-single-owner/history-owner-1440-dark-firefox.png`

**Interfaces:**
- Consumes: screenshot test in `e2e/map-surface-history.spec.ts`.
- Produces: four committed Firefox PNGs at exact requested dimensions and themes.

- [ ] **Step 1: Run screenshot proof and copy its four PNG outputs into existing proof directory.**

- [ ] **Step 2: Inspect image dimensions and all four rendered images.**

- [ ] **Step 3: Run required validation.**

Run:

```bash
npx tsc --noEmit
npm test
```

Expected: exit 0 and at least 7495 passing unit tests.

- [ ] **Step 4: Review diff, confirm no tooling churn, and commit scoped changes.**

Expected: proof-only commit on `fm/history-loaded-route-proof`.
