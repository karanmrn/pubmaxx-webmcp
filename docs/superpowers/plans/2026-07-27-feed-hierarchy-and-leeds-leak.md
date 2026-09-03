# Pint Feed Hierarchy and Leeds Leak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep unresolved or out-of-city sourced prices out of London feed, rank each valid row around drink and price, and prevent ambient London fallback under `Yours`.

**Architecture:** Enforce city-index membership while adapting raw price updates into feed DTOs at server boundary. Keep ambient-placement policy in `lib/feedSightings.ts`, passing active filter from feed client. Preserve source distinction through one section heading, visible provenance, and accessible row wording rather than repeated badge.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Vitest, Playwright, Chrome DevTools AXI.

## Global Constraints

- No animation library.
- No redesign or new visual language.
- Preserve source, date, corroboration, and price-lane integrity rules.
- Non-pint or non-London figures must never masquerade as London pint prices.
- Keep changes limited to Pint Feed data integrity, row hierarchy, and ambient-placement filter policy.
- Use British spelling, no exclamation marks, and no em dashes.

---

### Task 1: Drop unresolved sourced observations at server boundary

**Files:**
- Modify: `app/feed/feedSightings.server.ts`
- Test: `__tests__/feedSightingsServer.test.ts`

**Interfaces:**
- Consumes: raw price update, `stableVenueIdFromKey`, and London city venue index lookup.
- Produces: `SightingDTO[]`; `buildSightings` drops records whose resolver returns `null` before sorting and slicing.

- [ ] **Step 1: Write failing regression test**

Add fixture with venue key `bundobust|6, mill hill, leeds, ls1 5dq|53.79548|-1.54556` and assert server feed output contains no `venue-fla5g9` record and no fabricated London venue.

- [ ] **Step 2: Verify test fails for exact leak**

Run:

```bash
npx vitest run __tests__/feedSightingsServer.test.ts
```

Expected: failure showing unresolved Bundobust observation still appears in server feed result.

- [ ] **Step 3: Implement boundary filter**

In update-to-DTO resolver, derive venue id, look it up in city index, and return `null` when lookup misses. Remove `A London pub` fallback. Compact null values before sorting and limiting returned sightings.

- [ ] **Step 4: Verify focused regression**

Run:

```bash
npx vitest run __tests__/feedSightingsServer.test.ts
```

Expected: unresolved observation absent; resolved London fixtures remain.

### Task 2: Make ambient placement filter-aware

**Files:**
- Modify: `lib/feedSightings.ts`
- Modify: `app/feed/FeedPageClient.tsx`
- Test: `__tests__/feedSightings.test.ts`

**Interfaces:**
- Consumes: social tab, active feed filter, loading status, row count, and sighting count.
- Produces: existing ambient placement result, with primary London fallback eligible only for `latest`.

- [ ] **Step 1: Write failing policy test**

Assert empty London feed with active `for-you` filter returns no primary ambient placement, while otherwise identical `latest` input remains eligible.

- [ ] **Step 2: Verify policy test fails**

Run:

```bash
npx vitest run __tests__/feedSightings.test.ts
```

Expected: `for-you` currently returns primary placement because filter is not part of policy input.

- [ ] **Step 3: Pass and enforce active filter**

Add active filter to placement input, return no placement unless filter is `latest`, and pass current filter from `FeedPageClient`.

- [ ] **Step 4: Verify policy tests**

Run:

```bash
npx vitest run __tests__/feedSightings.test.ts
```

Expected: `Yours` has no ambient rows; `Latest` retains ambient fallback.

### Task 3: Rank sourced-price rows

**Files:**
- Modify: `components/feed/FeedSightings.tsx`
- Modify: `components/feed/feedSightings.css`
- Test: `__tests__/feedSightingsComponent.test.ts`
- Test: `__tests__/feedSightingsCss.test.ts`

**Interfaces:**
- Consumes: existing valid sighting DTO fields for drink, price, venue, source domain, age, and map link.
- Produces: one `Recent sourced prices` section; rows ordered as drink plus price, venue, then source plus age; accessible wording begins `Sourced price`.

- [ ] **Step 1: Add behaviour test at existing render seam**

Render representative long drink fixture and assert section heading plus accessible `Sourced price` wording, visible source and age, and absence of repeated `Spotted` text.

- [ ] **Step 2: Verify render test fails**

Run focused Vitest file selected from existing feed component tests. Expected: current row exposes `Spotted` and lacks section heading.

- [ ] **Step 3: Implement semantic hierarchy**

Remove visible kicker. Add one section heading. Put drink and price in primary row, venue second, provenance third. Keep whole link tap target.

- [ ] **Step 4: Implement 390px CSS hierarchy**

Use two-column row with flexible content and fixed right-aligned price. Apply two-line wrapping to drink via line clamp, preserve price, and quiet venue/provenance. Replace per-row card borders with list dividers.

- [ ] **Step 5: Verify focused render and CSS contract tests**

Run focused tests and confirm row semantics plus wrapping rules.

### Task 4: Browser and repository verification

**Files:**
- Create: before/after screenshot files only where existing repository convention and PR workflow require them.
- Verify: feed at 390 by 844 mobile viewport.

**Interfaces:**
- Consumes: local keyless app.
- Produces: browser evidence and green project gate.

- [ ] **Step 1: Capture before evidence**

Use existing shipped screenshot from scout evidence as visual baseline in PR body.

- [ ] **Step 2: Run local app and emulate phone**

Run `npm run dev`, then:

```bash
chrome-devtools-axi open http://localhost:3000/feed
chrome-devtools-axi emulate --viewport "390x844x3,mobile,touch"
chrome-devtools-axi eval '()=>location.reload()'
```

- [ ] **Step 3: Verify exact browser outcomes**

Confirm zero visible `SPOTTED`, no `A London pub`, drink wraps before truncating, source and age remain visible, and selecting `Yours` removes ambient section.

- [ ] **Step 4: Capture after evidence**

Save 390px screenshot for PR body.

- [ ] **Step 5: Run full gate**

```bash
npm run verify
```

Expected: data validation, lint, typecheck, coverage, and audit all exit zero.

- [ ] **Step 6: Review diff and commit**

Confirm only scoped files changed, restore local tooling churn if present, then commit with root-cause-focused message.

## Expected drain of the ambient surface (call this out in the PR body)

The `Recent sourced prices` heading is gated on a 336h observation window
(`SIGHTING_MAX_AGE_HOURS`), so the surface empties as its rows age out. Against
the shipped overlay that is a known schedule, not a surprise:

- 69 venue keys in `public/data/drink_price_updates/latest.json`; one is the
  Leeds row the city fence drops.
- 60 carry a best observation of 2026-07-11 and are already outside the window.
- The newest London observation is 2026-07-18T11:03:58Z, so it leaves the window
  on **2026-08-01T11:03:58Z**. After that the London cold start shows zero
  sightings and falls back to the plain `No pints logged yet tonight.` empty
  state.

That outcome is correct and deliberate: a fortnight-old price under a heading
that says recent was the lie, and an honest empty surface beats a loosened
claim. The cause of the drain is the drink-price refresh having no working
parser (issue #635), which is fixed there, never by widening this window.
