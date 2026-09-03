# Price Contribution Impact Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a credited Pubmaxxer from a successful Pint Price receipt to their public contribution impact in one tap.

**Architecture:** Add a small receipt component that owns credited versus anonymous rendering. Register one no-props analytics event. Keep VenuePriceSubmit focused on submission state and pass only the server-returned attribution into the receipt component.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright.

**Spec:** `CONTEXT.md` Provenance and Contributor Handle contracts.

## Global Constraints

- Build profile URL only from server-returned credited attribution.
- Anonymous attribution renders no profile link.
- Event carries no handle, Venue, price, category, or free text.
- Tap target is at least 44 px at 390 px viewport.
- Use one concise action label: `See your impact`.
- Use PUBMAXX language and no em dash.

---

### Task 1: Receipt component and analytics contract

**Files:**
- Create: `components/map/PriceContributionImpact.tsx`
- Create: `__tests__/priceContributionImpact.test.ts`
- Modify: `lib/analyticsEvents.ts`
- Modify: `__tests__/analyticsEvents.test.ts`

**Interfaces:**
- Consumes: `CommunityPriceAttribution`
- Produces: credited receipt text, `/u/{handle}` link, `price_impact_opened` event

- [x] **Step 1: Write failing component tests**

Render credited and anonymous attributions. Assert credited markup contains `Counted under @night_owl`, `href="/u/night_owl"`, and `See your impact`. Assert anonymous markup is empty.

- [x] **Step 2: Write failing analytics tests**

Assert `price_impact_opened` is registered and sanitizes every supplied property to an empty object.

- [x] **Step 3: Run RED tests**

```bash
npx vitest run __tests__/priceContributionImpact.test.ts __tests__/analyticsEvents.test.ts
```

Expected: FAIL because component and event do not exist.

- [x] **Step 4: Implement minimal component and event**

Create a client component. Return null unless attribution is credited. Build encoded profile URL, render existing attribution sentence plus the action link, and call `trackEvent("price_impact_opened")` on click. Add event with an empty prop allow-list.

- [x] **Step 5: Run GREEN tests**

Run the same Vitest command. Expected: PASS.

### Task 2: Submission receipt integration and mobile proof

**Files:**
- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `components/map/venuePriceSubmit.css`
- Modify: `e2e/price-submission.spec.ts`
- Modify: `docs/METRICS_FUNNEL.md`

**Interfaces:**
- Consumes: `logged.attribution`
- Produces: post-submit impact path with one tracked click

- [x] **Step 1: Replace inline credited sentence**

Render `PriceContributionImpact` after successful credited submission. Keep anonymous receipt free of profile links.

- [x] **Step 2: Style the action**

Add a wrapping receipt row and a 44 px action link with visible keyboard focus. Prevent horizontal overflow at 390 px.

- [x] **Step 3: Extend browser submission test**

Grant analytics consent, capture `/api/events`, submit as `@night_owl`, assert link destination and target height, click it, assert `/u/night_owl`, and assert exactly one `price_impact_opened` payload with no props.

- [x] **Step 4: Document metric**

Add event to community-price funnel registry section and define `price_impact_open_rate = price_impact_opened / price_submitted`.

- [x] **Step 5: Run focused browser proof**

```bash
PW_SKIP_WEBSERVER=1 PW_PORT=3128 npx playwright test e2e/price-submission.spec.ts --project=chromium --workers=1 --grep "logs tonight's price"
```

Expected: PASS.

### Task 3: Verification and commit

- [x] **Step 1: Run focused lint, typecheck, tests, and diff check**

- [x] **Step 2: Run full `npm run verify`**

- [x] **Step 3: Commit as `feat: link price receipts to contributor impact`**
