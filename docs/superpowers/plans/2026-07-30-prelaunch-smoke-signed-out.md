# Signed-out Prelaunch Smoke Plan

> **For agentic workers:** Execute inline, one journey at a time. Keep live-site actions read-only and checkpoint every journey in Git.

**Goal:** Verify eight signed-out visitor journeys on `https://pubmaxxing.com` at 390x844 and 1440x900, preserve visual evidence, report observed defects, and fix only small obvious low-risk problems.

**Architecture:** Use one named, isolated Chrome DevTools session so no existing browser state leaks into the walk. For each journey, reproduce the visitor path independently at both viewports, capture the resulting state, inspect browser console and failed network requests, update the evidence report, verify capture files, and commit. Complete the full walk before deciding whether any defect is safe to change.

**Tech Stack:** Chrome DevTools, Markdown, Git, Next.js 16, React 19, TypeScript.

## Global Constraints

- Test live site signed out at exactly 390x844 and 1440x900.
- Do not sign in, create an account, submit a contribution, or mutate live data.
- Do not change identity, pricing, data, or map behaviour.
- Do not refactor or restyle beyond an observed overlap or unreadable element.
- Record only behaviour directly seen in browser.
- Name console errors and failed requests per journey, or explicitly record none.
- Keep all captures under `docs/evidence/prelaunch-smoke/`.

---

### Task 1: Home

**Files:**
- Create: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/01-home-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/01-home-desktop.png`

- [ ] Open `/` in a fresh signed-out session at 390x844, wait for the stable page, capture the first screen, and record visible proposition and diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify both PNGs with `ls -la`, update report, and commit journey 1.

### Task 2: Map and key

**Files:**
- Modify: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/02-map-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/02-map-desktop.png`

- [ ] Open `/map` at 390x844, wait for map stability, inspect pins and key, capture, and record diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify both PNGs, update report, and commit journey 2.

### Task 3: Venue sheet

**Files:**
- Modify: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/03-venue-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/03-venue-desktop.png`

- [ ] Select a visible pub at 390x844, inspect sheet price, source, and trust wording, capture, and record diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify both PNGs, update report, and commit journey 3.

### Task 4: Filter

**Files:**
- Modify: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/04-filter-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/04-filter-desktop.png`

- [ ] Apply one available map filter at 390x844, confirm visible map response and key meaning, capture, and record diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify both PNGs, update report, and commit journey 4.

### Task 5: Plan signed-out boundary

**Files:**
- Modify: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/05-plan-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/05-plan-desktop.png`

- [ ] Follow Plan as far as a signed-out visitor can at 390x844 without entering disposable data, capture the stop, and record diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify both PNGs, update report, and commit journey 5.

### Task 6: Contribute price signed-out boundary

**Files:**
- Modify: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/06-contribute-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/06-contribute-desktop.png`

- [ ] Try to start a price contribution at 390x844, confirm sign-in request appears before any contribution field, capture, and record diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify both PNGs, update report, and commit journey 6.

### Task 7: Discover, Today, Tonight

**Files:**
- Modify: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/07-discover-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/07-today-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/07-tonight-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/07-discover-desktop.png`
- Create: `docs/evidence/prelaunch-smoke/07-today-desktop.png`
- Create: `docs/evidence/prelaunch-smoke/07-tonight-desktop.png`

- [ ] Open each surface at 390x844, verify real content or explicit empty copy, capture each, and record diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify all six PNGs, update report, and commit journey 7.

### Task 8: Map credit and privacy

**Files:**
- Modify: `docs/evidence/prelaunch-smoke/README.md`
- Create: `docs/evidence/prelaunch-smoke/08-map-credit-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/08-privacy-mobile.png`
- Create: `docs/evidence/prelaunch-smoke/08-map-credit-desktop.png`
- Create: `docs/evidence/prelaunch-smoke/08-privacy-desktop.png`

- [ ] Follow map credit and privacy links at 390x844, confirm destinations resolve, capture each, and record diagnostics.
- [ ] Repeat at 1440x900.
- [ ] Verify all four PNGs, update report, and commit journey 8.

### Task 9: Defect triage and closeout

**Files:**
- Modify only source and focused tests required by a small, obvious, low-risk observed defect.
- Modify: `docs/evidence/prelaunch-smoke/README.md`

- [ ] Order first-visitor findings worst first and mark larger or uncertain defects as report-only.
- [ ] For each eligible small fix, read `diagnosing-bugs`, `test-driven-development`, and relevant voice or UI contract before changing implementation.
- [ ] Reproduce each eligible defect locally, add a focused failing test, implement minimum fix, and verify in browser and automated checks.
- [ ] Read `verification-before-completion` and `check-work`, verify report claims, PNG dimensions, capture inventory, clean diagnostics, and repository status.
- [ ] Commit closeout and report final branch state.
