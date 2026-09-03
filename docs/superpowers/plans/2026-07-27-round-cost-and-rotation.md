# Round Cost and Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a live Round keep each buying turn's payer, pub, total, optional drink lines, and timestamp while making current rotation obvious on a 390px phone.

**Architecture:** Add immutable spend records to `RoundState`, with rotation derived from member join order and latest payer. Store total money as integer pence and optional drink lines as a bounded JSON snapshot; line validation delegates to `validateCommunityPrice`, while a plain total stays Round-only. The Round API publishes eligible account-owned drink lines through the existing community-price store under the same stable profile actor identity as `/api/price-submit`, leaving anonymous lines in the diary and map authority entirely behind `mergeCommunityPriceSignals`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, Supabase/Postgres, existing CSS tokens.

## Global Constraints

- Record spending only. Never compute, display, or imply what one member owes another.
- Keep community corroboration and max-age policy unchanged.
- A lone Round drink line must remain provisional and must not change pin colour, pin figures, cheapest-pint buckets, or Pint Index data.
- Plain aggregate totals never enter the per-drink community-price stack.
- Every mutating domain behavior follows test-first red, green, refactor.
- Product copy follows `docs/VOICE.md`: British spelling, no exclamation marks, no em dash.
- Mobile controls have at least 44px tap targets and no horizontal overflow at 390x844.

---

### Task 1: Money Model and Rotation

**Files:**
- Modify: `lib/rounds.ts`
- Test: `__tests__/rounds.test.ts`

**Interfaces:**
- Consumes: `validateCommunityPrice(input)` and `DrinkCategory` from existing price taxonomy.
- Produces: `RoundSpendItemDTO`, `RoundSpendDTO`, `NewRoundSpend`, `cleanNewRoundSpend(input)`, `roundTurn(members, spends)`, and additive `RoundState.spends`.

- [x] **Step 1: Write failing model tests**

Add literal behavior cases proving:

```ts
expect(
  cleanNewRoundSpend({
    payerHandle: "@Ken",
    recordedByHandle: "ale",
    venueId: "venue-1",
    venueName: "The Ship",
    clientRef: "spend-1",
    totalGbp: "26.80",
  }),
).toMatchObject({ totalPence: 2680, items: [] });

expect(
  cleanNewRoundSpend({
    payerHandle: "ken",
    recordedByHandle: "ale",
    venueId: "venue-1",
    venueName: "The Ship",
    clientRef: "spend-2",
    items: [
      { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
      { drinkName: "Lime and soda", drinkCategory: "soft-drink", priceGbp: 2.4 },
    ],
  }),
).toMatchObject({ totalPence: 860 });
```

Add rejection cases for zero/negative/overlarge totals, invalid item categories/prices, missing identities/pub/client reference, and more than 20 lines. Add rotation cases for no spend, latest payer, wraparound, and an empty crew.

- [x] **Step 2: Run tests and confirm expected red**

Run: `npm test -- __tests__/rounds.test.ts`

Expected: fail because spend types/helpers and `RoundState.spends` do not exist.

- [x] **Step 3: Implement minimal model**

Use integer pence for totals. When item lines exist, derive total solely from their validated prices. When no lines exist, accept a plain total from £1.00 through £1,000.00. Clean drink names and identity fields with existing text/handle helpers. Derive current turn from ordered members and latest spend payer without persisting debt or balance data.

- [x] **Step 4: Run focused tests green**

Run: `npm test -- __tests__/rounds.test.ts`

Expected: pass.

### Task 2: Durable Spend Store and API Trust Boundary

**Files:**
- Create: `supabase/migrations/20260727130000_0057_round_spends.sql`
- Modify: `lib/roundsStore.ts`
- Modify: `app/api/price-submit/route.ts`
- Create: `lib/communityPriceActor.ts`
- Modify: `app/api/rounds/[code]/route.ts`
- Test: `__tests__/roundsStore.test.ts`
- Test: `__tests__/roundsRoute.test.ts`

**Interfaces:**
- Consumes: `cleanNewRoundSpend`, `submitCommunityPrice`, `deriveCommunityPriceActor(request)`, canonical pub lookup, existing `RoundWriteError`.
- Produces: `RoundsStore.recordSpend(code, input)`, POST action `recordSpend`, durable `public.round_spends`, and Round GET responses containing `spends`.

- [x] **Step 1: Write failing store tests**

Cover member-only recording, payer membership, existing-stop requirement, closed-Round refusal, server-derived item total, chronological history, and idempotent `clientRef`.

- [x] **Step 2: Run store tests and confirm expected red**

Run: `npm test -- __tests__/roundsStore.test.ts`

Expected: fail because `recordSpend` and `spends` are absent.

- [x] **Step 3: Implement both stores and migration**

Add `round_spends` with `round_id`, `client_ref`, payer/recorder handles, canonical venue id/name, `total_pence`, bounded item JSON, and `recorded_at`. Add unique `(round_id, client_ref)`, total/item shape checks, public read, service-role-only write, and indexed chronological reads. Mirror membership, stop, open-Round, and idempotency rules in memory and Supabase backends.

- [x] **Step 4: Run store tests green**

Run: `npm test -- __tests__/roundsStore.test.ts`

Expected: pass.

- [x] **Step 5: Write failing API and map-gate tests**

Add handler cases for canonical venue resolution, actor/payer membership, invalid totals/items, closed Round, and store outage. Record one itemised Round from one eligible account, read its community price, call `mergeCommunityPriceSignals`, and assert returned signals are unchanged with `corroborations: 1`. Also prove a plain total and an anonymous itemised Round create no community observation.

- [x] **Step 6: Run route tests and confirm expected red**

Run: `npm test -- __tests__/roundsRoute.test.ts`

Expected: fail because action `recordSpend` is unknown.

- [x] **Step 7: Implement API composition**

Resolve the same authenticated contributor identity used by `/api/price-submit`. Resolve venue canonically, call `recordSpend`, then submit each validated drink line through `submitCommunityPrice` with that stable profile actor, public handle, and recorded timestamp. Never send anonymous, ineligible, demo-sourced, or total-only records to community store; keep those lines in the Round diary.

- [x] **Step 8: Run API and price-policy tests green**

Run: `npm test -- __tests__/roundsRoute.test.ts __tests__/communityPriceSignals.test.ts __tests__/priceSubmitRoute.test.ts`

Expected: pass.

### Task 3: Beer-Mat Mobile UI

**Files:**
- Modify: `app/rounds/[code]/RoundPageClient.tsx`
- Modify: `app/rounds/[code]/round.css`
- Modify: `e2e/mobile-round-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `roundTurn`, `RoundState.spends`, current Round stop, `/api/venue/[id]`, `venueMenuForInspector`, POST action `recordSpend`.
- Produces: at-a-glance turn card, quick-total/itemised composer, immutable spend history, and 390px interaction coverage.

- [x] **Step 1: Extend mobile E2E with failing expectations**

After two members join and one pub is added, require:

```ts
await expect(page.getByText("Up now")).toBeVisible();
await expect(page.getByText(`@${host}`)).toBeVisible();
await page.getByRole("button", { name: "Put this round on the mat" }).click();
await page.getByLabel("Round total").fill("26.80");
await page.getByRole("button", { name: "Keep £26.80" }).click();
await expect(page.getByText("£26.80")).toBeVisible();
await expect(page.getByText(`@${mate}`, { exact: true })).toBeVisible();
```

Assert every composer control is at least 44px and document/body widths do not exceed 390px.

- [x] **Step 2: Run E2E and confirm expected red**

Run: `npx playwright test e2e/mobile-round-lifecycle.spec.ts --project=chromium --workers=1`

Expected: fail because money/turn UI is absent.

- [x] **Step 3: Implement glance card and spend history**

Place current payer and latest round figure high in `roundHead`, before join code. Show "First round" before spending exists, then latest total, payer, pub, and recorded day. Render history as immutable diary rows. Do not sum personal spending or use debt/balance/owe language.

- [x] **Step 4: Implement quick total and itemisation**

Default to one-field total entry for the current payer at current stop. Optional itemisation loads known drinks from existing venue detail/menu functions, supports manual category/name/price rows, and derives total from lines. Payer remains selectable among Round members. Use one clear primary action and 44px controls.

- [x] **Step 5: Style at 390px**

Use existing paper, ink, brass price, hairline, and radius tokens. Keep top glance compact, avoid dashboard/accounting visual language, wrap all metadata, and add a narrow media rule where needed.

- [x] **Step 6: Run mobile E2E green**

Run: `npx playwright test e2e/mobile-round-lifecycle.spec.ts --project=chromium --workers=1`

Expected: pass with no horizontal overflow.

### Task 4: Verification, Browser Evidence, and Commit

**Files:**
- Create: `docs/screenshots/round-cost-390-light.png`
- Create: `docs/screenshots/round-cost-390-dark.png`
- Modify only if checks expose defects: files above.

**Interfaces:**
- Consumes: completed Round feature.
- Produces: real-browser evidence, green repository gate, and committed branch.

- [x] **Step 1: Run focused regression suite**

Run: `npm test -- __tests__/rounds.test.ts __tests__/roundsStore.test.ts __tests__/roundsRoute.test.ts __tests__/communityPriceSignals.test.ts __tests__/priceSubmitRoute.test.ts`

Expected: pass.

- [x] **Step 2: Verify real phone UI**

Start keyless dev server, open the Round in Chrome, emulate `390x844x3,mobile,touch`, reload in place, record one quick total and one itemised round, and inspect light/dark screens. Check hierarchy, wrapping, tap targets, keyboard flow, price/source/date copy, and no horizontal overflow.

- [x] **Step 3: Capture screenshots**

Capture populated at-a-glance Round boards at 390px in light and dark themes into the two paths above for later PR-body attachment.

- [x] **Step 4: Run full gate**

Run: `npm run verify`

Expected: validate-data, lint, typecheck, coverage, and resilient audit all pass.

- [x] **Step 5: Run project closeout playbooks**

Read and follow `verification-before-completion`, `check-work`, `review`, and `requesting-code-review`. Fix every finding using a failing test first where behavior changes.

- [x] **Step 6: Preserve local tooling files**

Check `git status`. Restore only known generated local churn in `next-env.d.ts` or `package.json` if commands changed them. Do not touch unrelated user work.

- [x] **Step 7: Commit**

```bash
git add lib/rounds.ts lib/roundsStore.ts lib/communityPriceActor.ts \
  app/api/price-submit/route.ts 'app/api/rounds/[code]/route.ts' \
  'app/rounds/[code]/RoundPageClient.tsx' 'app/rounds/[code]/round.css' \
  supabase/migrations/20260727130000_0057_round_spends.sql \
  __tests__/rounds.test.ts __tests__/roundsStore.test.ts __tests__/roundsRoute.test.ts \
  e2e/mobile-round-lifecycle.spec.ts docs/screenshots/round-cost-390-light.png \
  docs/screenshots/round-cost-390-dark.png \
  docs/superpowers/plans/2026-07-27-round-cost-and-rotation.md
git commit -m "feat(rounds): record cost and buying rotation"
```

Expected: clean worktree after commit.
