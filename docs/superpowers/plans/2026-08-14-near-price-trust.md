# Near Price Trust Implementation Plan

> **For Codex:** Execute each task in order. Keep price ranking, price authority, and trust display as separate contracts.

**Goal:** Let a Pubmaxxer understand where each `/near` baseline Pint Price came from, then measure answer-to-open conversion without collecting venue identity, coordinates, or free text.

**Architecture:** Keep `rankNearMe` and the slim Venue Dataset unchanged. After an answer selects at most five cards, `/near` asks a bounded server route for matching full-detail price evidence. A pure resolver chooses the same exact-price row used by the Venue sheet and returns only display-safe publisher state. The client binds evidence only when venue ID and price still match the current card, aborts stale requests, and treats unavailable evidence as degraded rather than as missing. Analytics use closed, low-cardinality source and position bands.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright.

---

### Task 1: Lock the price-trust resolver with failing unit tests

**Files:**
- Create: `__tests__/nearPriceTrust.test.ts`
- Create: `lib/nearPriceTrust.ts`

**Step 1: Write resolver tests**

Cover:

- an exact-price row with a named publisher and valid URL
- an exact-price row with no acceptable publisher
- deterministic first-row selection when exact-price rows tie
- no evidence when the full-detail price does not match the card price
- display states for loading, named, unrecorded, and degraded reads
- one shared `Prices last collected 3 July 2026.` dataset stamp

**Step 2: Run RED**

Run `npx vitest run __tests__/nearPriceTrust.test.ts --maxWorkers=1`.

Expected: fail because `lib/nearPriceTrust.ts` does not exist.

**Step 3: Implement the pure contract**

Return a small DTO. Do not expose source URLs, raw rows, contributor claims, or a per-row observation date. Baseline trust copy must use publisher disclosure rules from `docs/VOICE.md`.

**Step 4: Run GREEN**

Run the focused test again.

### Task 2: Add a bounded server read

**Files:**
- Create: `app/api/near-price-trust/route.ts`
- Create: `__tests__/nearPriceTrustRoute.test.ts`
- Reuse: `lib/venueDetailIndex.ts`

**Step 1: Write route tests**

Require:

- `venueId` may occur at most five times
- IDs are trimmed, validated, and deduplicated
- malformed or oversized requests return 400
- a successful read returns `status: "ready"`, shared dataset stamp, and one result per resolved Venue
- a detail-read failure returns `status: "degraded"` without claiming no publisher exists
- response uses `Cache-Control: private, max-age=0, no-store`

**Step 2: Run RED**

Run `npx vitest run __tests__/nearPriceTrustRoute.test.ts --maxWorkers=1`.

**Step 3: Implement route**

Use `lookupVenueDetail`. Keep request and response bounded. Do not accept price from client as evidence authority.

**Step 4: Run GREEN**

Run resolver and route tests together.

### Task 3: Render trust without delaying useful prices

**Files:**
- Modify: `components/nearme/NearMeNow.tsx`
- Modify: `components/nearme/nearMeNow.css`
- Modify: `components/nearme/NearPageClient.tsx`
- Create: `components/nearme/useNearPriceTrust.ts`
- Create: `__tests__/nearPriceTrustClient.test.ts`
- Create: `__tests__/nearPriceTrustLifecycle.test.ts`
- Create: `__tests__/nearPriceTrustRows.test.ts`

**Step 1: Write row-rendering tests**

Pin these states:

- `On record · Checking publisher`
- `On record · Pint Prices`
- `On record · Publisher not recorded`
- `On record · Publisher could not be checked`
- trust text never replaces, reorders, or changes the shown Pint Price
- dataset stamp appears once per answer, not once per row

**Step 2: Run RED**

Run `npx vitest run __tests__/nearPriceTrustRows.test.ts --maxWorkers=1`.

**Step 3: Add `/near`-only trust loading**

Enable the server trust read from `NearPageClient`. Keep embedded map mode unchanged. Fetch after cards resolve. Abort the previous request and use an answer-generation guard so an old response cannot decorate a new area.

**Step 4: Implement compact mobile copy**

Add a wrapping trust line under row metadata. Preserve 44 px targets, row de-boxing, long Venue names, and price-column width.

**Step 5: Run GREEN**

Run row, ranker, locality, and de-box tests.

### Task 4: Add privacy-safe answer and open analytics

**Files:**
- Modify: `lib/analyticsEvents.ts`
- Create: `lib/nearAnalytics.ts`
- Modify: `components/nearme/NearMeNow.tsx`
- Modify: `__tests__/analyticsEvents.test.ts`
- Create: `__tests__/nearAnalytics.test.ts`

**Step 1: Write failing sanitizer tests**

Register:

- `near_answer_ready`: source `location | remembered-area | picked-area | default-area`; result band `0 | 1-3 | 4+`
- `near_venue_opened`: source from the same closed set; position band `1 | 2-3 | 4+`

Reject venue IDs, names, coordinates, price, borough, patch, and free text.

**Step 2: Write lifecycle tests**

Require one answer event for the latest completed answer and one open event before navigation or in-place selection. A stale answer must emit nothing.

**Step 3: Implement and run GREEN**

Keep telemetry independent from the `intentWrite` acceptance event.

### Task 5: Prove the journey in a real mobile browser

**Files:**
- Modify: `e2e/near-venue-acceptance.spec.ts` or create `e2e/near-price-trust.spec.ts`
- Create proof only when stable: `docs/proof/near-price-trust/`

**Step 1: Exercise `/near?patch=soho` at 390 x 844**

Confirm:

- prices render before trust fetch completes
- each visible row gains an honest trust state
- one collection stamp appears
- no horizontal overflow
- at least 44 px of the first result remains above fixed mobile navigation
- opening a Venue still selects the correct map sheet
- no console errors

**Step 2: Check light, dark, and 1440 x 900**

Capture stable screenshots without development framework chrome.

### Task 6: Verify and review

Run focused ESLint, TypeScript, unit tests, and Playwright. Run `npm run verify` only when disk headroom permits. Report any baseline or resource failure separately.

Review data minimisation, publisher wording, stale-response safety, route bounds, mobile wrapping, and unchanged rank order before selecting the next slice.
