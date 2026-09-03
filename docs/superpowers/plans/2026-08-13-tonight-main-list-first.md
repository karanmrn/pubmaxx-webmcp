# Tonight Main List First Implementation Plan

> **For Codex:** Execute each task in order. Keep `tonightGrouping` and `intentWrite` behaviour independent from visual lane order.

**Goal:** Show confirmed Tonight listings before Deals and Music lanes for every user, including the default flag-off path used by installed-app cold starts.

**Architecture:** Keep one `/api/whats-on` fetch and the existing grouped row model. Remove the feature flag from presentation order only. Render secondary lanes through the existing `tonightSecondaryLanes` wrapper after the primary list. Do not change grouping, acceptance, filtering, provenance, or data fetching.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Playwright, Vitest.

---

### Task 1: Lock the mobile-first contract with a failing browser test

**Files:**
- Modify: `e2e/tonight-trusted-ui.spec.ts`
- Verify: `e2e/tonight-trusted-ui.flag-on.spec.ts`

**Step 1: Replace the flag-off shipped-order assertion**

Require the default path to place `[data-testid="tonight-list"]` before `.dealsTonight` in DOM order.

**Step 2: Add first-viewport proof at 390 x 844**

After the mocked listing data loads, assert the first `.tonightRow` starts above the fixed mobile tab bar. Use rendered bounding boxes, not source text.

**Step 3: Run the default Playwright file and confirm RED**

Run:

`npx playwright test e2e/tonight-trusted-ui.spec.ts --project=chromium`

Expected: the order test fails because Deals currently precede the primary list. Preserve the failure output as reproduction evidence.

### Task 2: Make main-list-first unconditional

**Files:**
- Modify: `app/tonight/TonightClient.tsx`
- Test: `e2e/tonight-trusted-ui.spec.ts`
- Test: `e2e/tonight-trusted-ui.flag-on.spec.ts`

**Step 1: Remove flag ownership from lane placement**

Make the existing secondary-lane placement helper always return lanes below the main list. Keep the wrapper used by desktop rail CSS.

**Step 2: Remove the above-list render slot**

Do not render Deals or Music between conditions and the primary list in any flag state.

**Step 3: Keep independent contracts unchanged**

Do not change:

- `groupTonightListings(..., { v2: flags.tonightGrouping })`
- `flags.intentWrite` (since retired: Venue acceptance is permanent and unflagged)
- the single-fetch lane reuse
- source and date copy
- filters, quiet-night actions, or links

**Step 4: Run both focused browser suites and confirm GREEN**

Run:

`npx playwright test e2e/tonight-trusted-ui.spec.ts --project=chromium`

Run:

`PUBMAX_TONIGHT_GROUPING=1 npx playwright test e2e/tonight-trusted-ui.flag-on.spec.ts --project=chromium-flag-on`

(`PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE` was retired with the `intentWrite` flag. Venue acceptance is permanent, so the flag-on project needs the grouping flag alone.)

Expected: both suites pass. Default and canonical paths use the same main-list-first order.

### Task 3: Prove mobile and desktop behaviour in real Chrome

**Files:**
- Create evidence only if new captures are useful: `docs/proof/tonight-main-list-first/`

**Step 1: Start keyless local app**

Run `npm run dev` and open `/tonight` at 390 x 844.

**Step 2: Inspect the actual journey**

Confirm:

- primary listing choices appear before Deals and Music
- first listing remains reachable above the mobile tab bar
- no horizontal overflow
- no blocked tap targets
- no console errors
- light and dark themes remain legible

**Step 3: Check desktop at 1440 x 900**

Confirm secondary lanes still use the intended right-rail treatment or clean below-list placement. No duplicated fetch.

### Task 4: Verify the slice and separate baseline failures

**Files:**
- No production changes unless checks expose a regression.

**Step 1: Run focused static checks**

Run:

`npm run lint -- --file app/tonight/TonightClient.tsx --file e2e/tonight-trusted-ui.spec.ts`

If the repository lint script does not accept file filters, run `npm run lint`.

Run:

`npm run typecheck`

**Step 2: Rerun the isolated baseline failure**

Run:

`npx vitest run __tests__/validateDrinkPriceUpdatesScript.test.ts`

Expected: determine whether full-suite resource pressure caused the eight baseline failures. Do not attribute unrelated failures to this slice.

**Step 3: Run repository verification when disk headroom permits**

Run `npm run verify`. Report exact passed and failed checks.

### Task 5: Review and choose the next product slice

Compare browser evidence and funnel value. Select one:

1. Near answer provenance and answer-to-open measurement.
2. Governed `/drink/beer` acquisition page with a trusted-data publication floor.

Write a new test-driven plan before implementation.
