# Permanent Venue Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development` for each task. Keep tests red before implementation and run focused verification after each green step.

**Goal:** Make explicit Venue acceptance a permanent, mobile-first path from Near and Tonight through Map to a Plan whose Stop 1 cannot be silently lost.

**Architecture:** Keep existing two-stage handoff. Near and Tonight persist a strict `PlanningIntent`, then open an accepted Map receipt. Map preserves that rich intent and only moves to Plan after the user selects `Make it Stop 1`. Plan always arbitrates the accepted Venue against saved work. Empty Plan state seeds accepted Venue as provisional Stop 1. Existing Plan work wins and shows a conflict. Anchored generation receives the exact accepted anchor. Every success event and navigation happens only after storage confirms the write.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, CSS modules and route CSS.

**Spec:** `docs/MAP_URL_PARAMS.md`, `docs/MOBILE_FLOW_SPEC.md`, `docs/VOICE.md`, `CONTEXT.md`.

## Global Constraints

- Use `Venue`, `Crawl Route`, `Crawl Stop`, and `Planned Night` from `CONTEXT.md`.
- Browsing a Venue must never create or replace a PlanningIntent.
- Storage failure must stay on current surface, show `Couldn’t keep this pub on this device. Try again.`, and emit no acceptance or handoff event.
- Existing Plan or Route draft keeps Stop 1. Accepted Venue may replace it only through explicit replacement.
- Accepted anchor must remain Stop 1 through generation and Plan creation.
- Keep `mapRouteTransfer`, `tonightGrouping`, and unrelated flags unchanged.
- Use 44px minimum targets, visible focus, no horizontal overflow at 320px or 390px, and reduced-motion-safe feedback.
- Do not add hidden identity, precise viewer location, or new analytics properties.

---

## Task 1: Make Map acceptance write-confirmed

**Files:**

- Modify: `lib/mapAcceptance.ts`
- Modify: `__tests__/mapAcceptance.test.ts`
- Modify: `components/PubMap.tsx`

1. Add failing tests for a pure `acceptMapVenue` result.
2. Prove successful persistence returns `accepted: true`, Plan destination, and exact `venue_accepted` properties.
3. Prove denied or thrown storage returns `accepted: false`, no telemetry, and no navigation destination.
4. Prove accepted Map arrivals preserve richer Near or Tonight area, date, and evidence instead of replacing them with a directory envelope.
5. Implement helper by reading existing intent only when Venue and source match accepted arrival. Otherwise write minimal Map intent.
6. Update `PubMap` to track and navigate only after success.
7. On failure, remain on selected Venue and render one `role="alert"` message next to Venue actions.

## Task 2: Make producer acceptance permanent and honest

**Files:**

- Modify: `components/nearme/NearMeNow.tsx`
- Modify: `components/nearme/NearPageClient.tsx`
- Modify: `app/near/page.tsx`
- Modify: `app/tonight/TonightClient.tsx`
- Modify: `app/tonight/tonight.css`
- Modify: `e2e/near-venue-acceptance.spec.ts`
- Modify or add: `e2e/venue-acceptance.spec.ts`

1. Replace flag-off browser expectations with default browse versus explicit acceptance tests.
2. Near browse card must open `?sel=` and leave PlanningIntent empty.
3. Near explicit action must persist `source: near` and open `accept=1&src=near`.
4. Tonight browse row must leave PlanningIntent empty.
5. Tonight explicit action must persist `source: tonight` and open `accept=1&src=tonight`.
6. Remove `intentWrite` props and branches.
7. Use visible copy `Keep for tonight` on Near and `Keep this venue` on Tonight. Accessible names include Venue name.
8. Replace pre-action receipt text with `Choose a pub to keep for tonight.`
9. Add `min-height: 44px` to Tonight acceptance action.
10. Surface shared storage failure copy and do not navigate on failure.

## Task 3: Make Plan consume accepted Venue

**Files:**

- Modify: `lib/planComposerHandoff.ts`
- Modify: `__tests__/planComposerHandoff.test.ts`
- Modify: `__tests__/planComposerRender.test.ts`
- Modify: `components/plan/PlanComposer.tsx`
- Modify: `app/plan/plan.css`

1. Add failing tests that PlanningIntent participates by default.
2. Add pure Stop 1 seed rule: accepted Venue seeds one provisional stop only when no recovered Route or Plan stops exist.
3. Preserve existing Route or Plan stops and existing `intent-preserved-existing` conflict.
4. Resolve provisional Stop 1 display name from Venue index without changing accepted Venue id.
5. Make composer visible for accepted context before intake completion.
6. Show `Carried over from what you accepted` and accepted Venue.
7. Keep fields editable, but never expose raw Venue id after Venue index settles.
8. Add explicit conflict copy when saved Plan work keeps its existing Stop 1.
9. Give accepted and conflict panels responsive CSS with no extra decorative copy.

## Task 4: Thread exact anchor through generation and creation

**Files:**

- Modify: `lib/planIntake.ts`
- Modify: `__tests__/planIntake.test.ts`
- Modify: `components/plan/PlanComposer.tsx`
- Modify: `app/api/plans/generate/route.ts`
- Modify: `app/api/plans/route.ts`
- Modify: `app/api/plans/[id]/route.ts`
- Modify: `app/api/plans/anchor/route.ts`
- Modify focused API tests that assert flag-off rollback.

1. Add failing tests that generation body includes exact `{ venueId, source, acceptedArea, startsAt }` anchor.
2. Add no-anchor tests for generic Plan.
3. Pass accepted anchor from composer to generation.
4. Keep returned anchor as Stop 1 and retain grounding proof for Plan creation.
5. Include anchor metadata in Plan creation payload when grounded generation returns it.
6. Remove `anchoredGeneration` rollout gates only after existing anchor, optimizer, proof, one-stop, and route tests pass under default configuration.
7. Keep rejection behaviour for invalid, mismatched, expired, or replayed proofs.

## Task 5: Retire completed rollout switches

**Files:**

- Modify: `lib/trustedHandoffFlags.ts`
- Modify: `lib/trustedHandoffFlags.server.ts`
- Modify: `__tests__/trustedHandoffFlags.test.ts`
- Modify: `playwright.config.ts`
- Modify: `.env.example`
- Modify: `app/plan/page.tsx`
- Modify: Map and Tonight flag plumbing as required.

1. Add failing registry tests that `intentWrite`, `intentRead`, and `anchoredGeneration` no longer exist.
2. Remove their environment definitions, DTO fields, server readers, Playwright pass-through, and example variables.
3. Remove dead all-off branches and stale comments.
4. Keep remaining trusted handoff flags and exact count tests correct.

## Task 6: Browser proof at phone and desktop widths

**Files:**

- Add or modify: `e2e/venue-acceptance.spec.ts`
- Modify: `e2e/mobile-venue-sticky-actions.spec.ts`
- Add proof images under: `docs/proof/venue-acceptance/`

1. At 390x844, prove Near browse does not write and explicit acceptance does.
2. Prove accepted Map receipt, `Make it Stop 1`, stored source and Venue id, Plan Stop 1, and reload persistence.
3. Patch `Storage.prototype.setItem` to throw for PlanningIntent. Prove Map stays put, error is announced, and analytics remain silent.
4. Seed existing Stop 1, accept another Venue, and prove existing work remains.
5. At 320px and 390px, assert Venue actions are at least 44px and document width does not overflow.
6. At 1440px, prove same semantic path and visible focus.
7. Capture light and dark 390px screenshots of accepted Map and Plan states.

## Task 7: Verification and closeout

1. Run focused Vitest files for acceptance, arbitration, Plan intake, anchored generation, and flags.
2. Run focused Playwright acceptance specs in Chromium.
3. Run `npm run lint`, `npm run typecheck`, and focused build/API tests.
4. Run `git diff --check`.
5. Restore `next-env.d.ts` to the `.next-prod` import if development rewrites it.
6. Review changed UI against `docs/VOICE.md`, 390px screenshots, 44px target floor, and no-overflow checks.
7. Commit one cohesive feature after every required test is green.
