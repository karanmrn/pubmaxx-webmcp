# Community Venue Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let phone users report and read community-observed pub character, step-free access, door policy, and eating activity without presenting one report as fact or crowding the venue sheet.

**Architecture:** Extend the existing community-price observation seam rather than adding an API or parallel trust system. Browser-safe signal vocabulary and copy live in a focused domain module; the current server-derived actor, `/api/price-submit` route, rate limiter, store backend selector, `community_prices` table, timestamp, replacement rule, and corroboration threshold serve both prices and venue signals. The venue sheet adds one compact disclosure inside the existing price contribution card, with access status visible even while collapsed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Supabase/Postgres, existing CSS tokens, chrome-devtools-axi.

## Global Constraints

- No new dependency, API, scraping path, or `PubMap.tsx` decomposition.
- Character always reads as drinkers' judgement.
- One report remains one person's observation; established copy requires `COMMUNITY_PRICE_CORROBORATION_THRESHOLD`.
- Step-free venue access and toilet access remain separate. Unknown is visible and never rendered as no.
- Authoring works one-handed at 390px with 44px controls.
- Existing payload budgets, reduced-motion behavior, price policy, and keyless mode remain intact.
- Contribution totals remain server-only and keyed by the existing opaque contributor actor for a future leaderboard.

---

### Task 1: Signal vocabulary and trust copy

**Files:**
- Create: `lib/communityVenueSignals.ts`
- Create: `__tests__/communityVenueSignals.test.ts`

**Interfaces:**
- Consumes: `COMMUNITY_PRICE_CORROBORATION_THRESHOLD`, `COMMUNITY_PRICE_MAX_AGE_MS`, and `isWithinMaxAge` from `lib/communityPrice.ts`.
- Produces: `CommunityVenueSignalKey`, `CommunityVenueSignalValue`, `CommunityVenueSignal`, `validateCommunityVenueSignal`, `communityVenueSignalStanding`, and signal question/value metadata.

- [ ] **Step 1: Write failing domain tests**

Cover valid key/value pairs, mismatched values, cleaned venue ids, client-supplied trust fields being ignored by validation, one-person wording, corroborated wording, aged-out wording, explicit character judgement wording, and access unknown/yes/no copy for entrance and toilets.

- [ ] **Step 2: Run domain test and verify RED**

Run: `npm test -- __tests__/communityVenueSignals.test.ts`

Expected: failure because `lib/communityVenueSignals.ts` does not exist.

- [ ] **Step 3: Implement minimal browser-safe domain**

Use closed literal maps:

```ts
type CommunityVenueSignalKey =
  | "character"
  | "step-free-venue"
  | "step-free-toilets"
  | "door-policy"
  | "people-eating";
```

Store categorical values only. Return explicit access unknown copy when no established report exists, while retaining a separate one-person note such as `One drinker reported a step-free entrance.` Character output starts with `Drinkers called it...` or `One drinker called it...`.

- [ ] **Step 4: Run domain test and verify GREEN**

Run: `npm test -- __tests__/communityVenueSignals.test.ts`

Expected: pass with no warnings.

---

### Task 2: Shared storage, attribution, corroboration, and counts

**Files:**
- Modify: `lib/communityPriceStore.ts`
- Create: `supabase/migrations/20260728130000_0060_community_venue_signals.sql`
- Modify: `__tests__/communityPriceStore.test.ts`

**Interfaces:**
- Consumes: validated `CommunityVenueSignalInput` and existing `CommunityPriceWrite.actor`.
- Produces: `submitCommunityVenueSignal`, `readCommunityVenueSignalsWithStatus`, and `listCommunityContributorCounts`.

- [ ] **Step 1: Write failing store tests**

Pin one live signal per `(venue, signal key, actor)`, two independent actors corroborating the same value, disagreement not corroborating, best-backed candidate surviving a lone fresh contradiction, unattributed rows counting as at most one voice, actor removal from public DTOs, and contribution counts combining price plus venue-signal rows per opaque actor.

- [ ] **Step 2: Run store test and verify RED**

Run: `npm test -- __tests__/communityPriceStore.test.ts`

Expected: failure because signal store exports do not exist.

- [ ] **Step 3: Extend memory and Supabase backends**

Add signal methods to the existing `CommunityPriceStore` interface and both implementations. Reuse `submitterBucket`, `COMMUNITY_PRICE_CORROBORATION_THRESHOLD`, actor replacement semantics, `MAX_VENUES`, fail-soft reads, and durable-write guards. Public rows expose signal values, timestamps, corroboration counts, and established candidates, never actor tokens.

- [ ] **Step 4: Add additive migration**

Make `drink_category` and `price_pennies` nullable, add `signal_key` and `signal_value`, enforce exactly one valid price-or-signal shape, add closed key/value checks, and add unique `(venue_id, signal_key, actor)` plus signal venue/recent and actor indexes. Existing price rows remain valid and unchanged.

- [ ] **Step 5: Run store test and verify GREEN**

Run: `npm test -- __tests__/communityPriceStore.test.ts`

Expected: pass with existing price behavior unchanged.

---

### Task 3: Existing route and client state

**Files:**
- Modify: `app/api/price-submit/route.ts`
- Modify: `components/map/useCommunityPrices.ts`
- Modify: `__tests__/priceSubmitRoute.test.ts`
- Modify: `__tests__/communityPriceClientState.test.ts`

**Interfaces:**
- Consumes: store methods from Task 2 and shared validator from Task 1.
- Produces: `GET ?venueId=` payload containing `prices` and `signals`; `POST { kind: "venue-signal", venueId, signalKey, signalValue }`; `CommunityPricesState.signalsByVenueId` and `submitVenueSignal`.

- [ ] **Step 1: Write failing route and client parser tests**

Pin canonical pub validation, server-derived actor, shared actor/per-venue budgets, server timestamps, ignored client corroboration fields, 201 response, combined GET payload, degraded read status, cautious parser defaults, and optimistic rollback.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/communityPriceClientState.test.ts`

Expected: failure because venue-signal route and state branches do not exist.

- [ ] **Step 3: Implement route dispatch and shared venue lookup**

Dispatch `kind: "venue-signal"` before price validation, then use one canonical pub lookup helper and the same actor and limiter keys as prices. Return authoritative signal row after a store read-back. Include signals on venue GET without changing category-index or provisional-base payloads.

- [ ] **Step 4: Implement client parsing and submission**

Extend the existing hook rather than creating another fetch owner. Load price and signal rows together, optimistically show one voice, replace with server timestamp/trust count, and rollback only the matching optimistic signal on rejection.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/communityPriceClientState.test.ts`

Expected: pass with all existing price route cases green.

---

### Task 4: Quiet venue-sheet reader and phone authoring

**Files:**
- Create: `components/map/VenueCommunitySignals.tsx`
- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `components/map/venuePriceSubmit.css`
- Create: `__tests__/venueCommunitySignals.test.tsx`
- Modify: `__tests__/mobileChromeFit.test.ts`

**Interfaces:**
- Consumes: `CommunityPricesState.signalsByVenueId`, `submitVenueSignal`, and Task 1 display helpers.
- Produces: one compact `What drinkers noticed` disclosure inside the current price card.

- [ ] **Step 1: Write failing render and CSS contract tests**

Server-render fixtures for no reports, one report, and corroborated reports. Assert collapsed access says unknown, entrance/toilets are separate, character names drinkers, no one-person report uses established copy, all four facts are available, controls have labels, and shipped CSS retains 44px targets plus reduced-motion handling.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test -- __tests__/venueCommunitySignals.test.tsx __tests__/mobileChromeFit.test.ts`

Expected: failure because component and CSS contract do not exist.

- [ ] **Step 3: Implement compact disclosure**

Keep closed state to one 44px summary row with visible `Access unknown` status. Expanded state uses a compact definition list, one signal question at a time, existing pill/radio language, and one submit button. Access question switches between entrance and toilets rather than merging them.

- [ ] **Step 4: Integrate under price authoring**

Render component at bottom of `VenuePriceSubmit`, inside existing section and below price receipt. Do not add four cards or change `PubMap.tsx`.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run: `npm test -- __tests__/venueCommunitySignals.test.tsx __tests__/mobileChromeFit.test.ts`

Expected: pass with no accessibility warnings.

---

### Task 5: Mobile evidence, legal honesty, and full gate

**Files:**
- Modify if required: `app/privacy/page.tsx`
- Modify if required: `__tests__/legalPages.test.ts`
- Create: `docs/screenshots/pub-character-signals-before-390.png`
- Create: `docs/screenshots/pub-character-signals-after-390.png`

**Interfaces:**
- Consumes: completed route, store, and venue sheet.
- Produces: review evidence and green project gate.

- [ ] **Step 1: Keep privacy notice aligned**

If new signal values materially widen stored data descriptions, update `/privacy` in same commit, naming community venue notes without exposing actor plumbing.

- [ ] **Step 2: Capture 390px before and after**

Use `chrome-devtools-axi open`, then `emulate --viewport "390x844x3,mobile,touch"`, reload in place, open same venue, and capture the contribution area. Before image comes from clean branch state; after image shows collapsed disclosure and expanded authoring without adding four boxes or obscuring price.

- [ ] **Step 3: Run focused suite**

Run: `npm test -- __tests__/communityVenueSignals.test.ts __tests__/communityPriceStore.test.ts __tests__/priceSubmitRoute.test.ts __tests__/communityPriceClientState.test.ts __tests__/venueCommunitySignals.test.tsx __tests__/mobileChromeFit.test.ts __tests__/legalPages.test.ts`

Expected: pass.

- [ ] **Step 4: Run full verification**

Run: `npm run verify`

Expected: validate-data, lint, typecheck, coverage, and resilient audit all pass.

- [ ] **Step 5: Review and commit**

Inspect `git diff --check`, `git status`, generated-artifact churn, and screenshot evidence. Restore local `next-env.d.ts` or `package.json` tooling churn if present. Commit implementation and evidence on `fm/pub-character-signals`.

---

### Task 6: Review follow-ups (post-implementation)

**Files:**
- Modify: `lib/communityVenueSignals.ts`, `components/map/VenueCommunitySignals.tsx`
- Modify: `lib/communityPriceStore.ts`, `app/api/admin/community-prices/route.ts`, `app/api/price-submit/route.ts`
- Modify: `components/map/useCommunityPrices.ts`
- Modify: `__tests__/communityVenueSignals.test.ts`, `__tests__/venueCommunitySignals.test.ts`, `__tests__/communityPriceStore.test.ts`, `__tests__/communityPriceClientState.test.ts`, `__tests__/communityPriceModeration.test.ts`, `__tests__/priceSubmitRoute.test.ts`

- [x] **Step 1: Access accuracy at every age**

An uncorroborated entrance or toilet report keeps its primary line at `Unknown`
however old it is; staleness appears only in the supporting detail. Reading
surfaces branch on `CommunityVenueSignalTrust` (`unknown` | `reported` |
`established`) instead of comparing copy, so a wording change cannot promote a
pub nobody has checked.

- [x] **Step 2: Durable scan and rolling-deploy fixes**

Price scans narrow to `drink_category is not null` (an existing column, so an
unapplied signals migration still reads prices), because a row cap is a window,
not a filter. A venue payload with no `signals` key is an older deployment
answering about prices alone, so it reads as an honest empty rather than
discarding that venue's prices.

- [x] **Step 3: Moderation through the existing path only**

No new subsystem, console or API. Signal observation ids ride on the read, the
existing `POST /api/price-submit { action: "report" }` accepts either shape, the
existing `/api/admin/community-prices` queue lists both (each row says its
`kind`), and the existing hide/restore action is the removal means: hiding drops
a signal from the sheet, the corroboration count and the established answer
together through the single `freshestVenueSignals` filter.

- [x] **Step 4: PR body must state the removal means**

The PR body has to say plainly that moderators use the existing
`/api/admin/community-prices` queue plus its hide/restore action to remove a
wrong character or step-free report, and that no separate moderation UI or API
was added.
