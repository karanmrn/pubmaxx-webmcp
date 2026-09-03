# Nine-city Capability Entry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make city entry and map promises match shipped evidence before the wider nine-city night loop expands.

**Architecture:** Keep `CityCapabilityProfile` as the single product contract. Derive release labels and reader copy from profiles. Do not add a second city registry. London remains the flagship. Manchester, Liverpool, Oxford, Durham, Glasgow, Bristol, Cambridge, and Bath are the eight other V1 core cities. Llandudno remains browseable as a labelled preview. Provider-specific code can keep provider gates, but reader-facing availability must come from the capability profile.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, existing CSS modules and global design tokens.

**Spec:** `docs/MASTER_PRD.md`, sections 1, 8, 12, and 13. GitHub issue `#287` is the execution ticket.

---

## Execution boundary

Start from `origin/main` in an isolated worktree. Do not edit active lanes for native release, UK base first load, public RSVP membership, Social account isolation, Social moderation, About, or one-tap price entry.

Resource gate for 2026-08-31: run one focused test process at a time. Do not run a production build, full browser suite, or browser proof until disk and memory headroom recover.

### Task 1: Lock V1 release cohort and truthful chooser copy

**Files:**
- Modify: `lib/cityCapabilities.ts`
- Modify: `lib/cityChooserSearch.ts`
- Modify: `components/city/CityChooser.tsx`
- Test: `__tests__/cityCapabilities.test.ts`
- Test: `__tests__/cityChooserSearch.test.ts`

- [ ] Add a failing test that expects Llandudno to have release tier `preview`.
- [ ] Run `npm test -- __tests__/cityCapabilities.test.ts` and confirm failure reports `core` instead of `preview`.
- [ ] Add a failing test that expects chooser coverage copy to count map, price, crawl, and preview support from real profiles.
- [ ] Run `npm test -- __tests__/cityChooserSearch.test.ts` and confirm the existing all-guides-have-prices claim fails.
- [ ] Make the smallest implementation change: give `mapOnlyCity` an explicit tier and derive chooser copy from the enabled city list plus `CityCapabilityProfile`.
- [ ] Pass the city list into the chooser copy helper. Do not type a fixed city count.
- [ ] Run both focused test files and confirm they pass.
- [ ] Commit: `fix(city): make release promises match capability evidence`

### Task 2: Label preview entry without adding card clutter

**Files:**
- Modify: `components/city/CityChooser.tsx`
- Modify: `components/city/cityChooser.css`
- Test: `__tests__/cityChooserSearch.test.ts`

- [x] Add a failing render test that expects one concise `Preview` label for Llandudno and no preview label for nine V1 cities.
- [x] Run the focused test and confirm the label is missing.
- [x] Read release tier from `getCityCapabilityProfile(city.id)` while rendering each city link.
- [x] Add one compact badge beside city name. Do not add a subtitle or repeat the tagline.
- [x] Keep link target at least 44 px and contain long names at 390 px.
- [x] Run focused unit tests. Save browser proof for Task 6.
- [x] Commit: `feat(city): label map previews at entry`

### Task 3: Add one capability-driven map notice

**Files:**
- Create: `components/map/CityCapabilityNotice.tsx`
- Create: `components/map/cityCapabilityNotice.css`
- Modify: `components/PubMap.tsx`
- Modify: `lib/cityCapabilities.ts`
- Test: `__tests__/cityCapabilityNotice.test.ts`

- [ ] Define pure notice output for flagship, core with crawls but no prices, and map-only preview states.
- [ ] Add failing tests with hand-written expected text for London, Manchester, Bath, and Llandudno.
- [ ] Confirm failures occur because notice output does not exist.
- [ ] Implement one concise notice. It must state only capability facts that affect the current map.
- [ ] Do not show a notice for London when all relevant map promises are available.
- [ ] Use capability states, never city-name checks, to choose reader copy.
- [ ] Add the notice to existing map chrome without creating a new surface trail.
- [ ] Run focused tests.
- [ ] Commit: `feat(map): explain limited city capability`

### Task 4: Replace reader-facing city-name gates

**Files:**
- Audit: `components/map/ControlRail.tsx`
- Audit: `components/map/LastTrainCard.tsx`
- Audit: `components/map/inspector/VenueGettingHomeTab.tsx`
- Audit: `components/map/inspector/VenueOverviewTab.tsx`
- Audit: `components/map/CityPlaceStrip.tsx`
- Audit: `components/map/CityStatusBanner.tsx`
- Modify only files where a reader action or promise is gated by city name.
- Test: add or update the closest existing focused test for each changed surface.

- [ ] Classify each city-name check as provider plumbing or reader-facing product availability.
- [ ] Keep provider plumbing explicit when a service is London-only.
- [ ] For each reader-facing gate, first add a failing test that changes profile availability while keeping city identity stable.
- [ ] Replace the reader-facing gate with the matching `prices`, `events`, `routes`, `transport`, or `heritage` capability.
- [ ] Preserve useful fallbacks for limited and unavailable states.
- [ ] Run each focused test after its change. Do not combine unrelated surfaces in one commit.
- [ ] Commit each surface separately with `fix(city): derive <surface> from capability`.

### Task 5: Pin nine-city core journey coverage

**Files:**
- Create: `lib/cityCoreJourney.ts`
- Create: `__tests__/cityCoreJourney.test.ts`
- Modify: existing Plan, arrival, Moment, completion, and recap helpers only when a failing contract test proves a city-scoping gap.

- [ ] Define the nine V1 city IDs from existing profiles: one flagship plus eight core cities. Exclude previews.
- [ ] Add table-driven tests for `discover -> plan -> invite -> arrive -> capture -> complete -> recap -> return` route ownership in every V1 city.
- [ ] Use real domain helpers and literal expected city IDs. Do not assert on mocks.
- [ ] Run the test and record each real break by journey stage.
- [ ] Fix one stage at a time with RED, GREEN, REFACTOR cycles.
- [ ] Keep qualifying arrival and completion idempotency authoritative. Do not create a second completion path.
- [ ] Commit each repaired stage separately.

### Task 6: Verification and evidence

**Files:**
- Update: `docs/WAYFINDER_MASTER_V1.md` only after shipped evidence exists.
- Add proof under an existing city proof folder, or create `docs/proof/nine-city-capability/`.

- [ ] Run focused city tests.
- [ ] Run `npm run typecheck` when the machine resource gate permits one validation process.
- [ ] Run `npm run verify` only when disk, memory, and swap trend permit it.
- [ ] Use Codex in-app browser at 390x844 and 1440 px for city chooser and map notice proof.
- [ ] Check London, Manchester, Bath, and Llandudno in light and dark modes.
- [ ] Confirm 44 px targets, no horizontal scroll, no map-control overlap, correct preview label, and truthful limited-state copy.
- [ ] Record exact commit and verification state. Keep hosted CI failures separate from local results.
- [ ] Request code review before merge.

## Next plan queue

Write separate plans after this capability boundary is green:

1. Nine-city data and Night Area coverage. Add reviewed local areas, late food, event supply, and freshness per city without synthetic claims.
2. Nine-city SEO and local discovery. Add evidence-backed city and drink landing pages, structured data, sitemap policy, Search Console, and Bing launch steps.
3. Soft-launch operations. Close issue `#392` with demo-off checks, analytics go-live order, first-user invites, and rollback steps.
4. Mobile and desktop visual certification. Measure 390x844, 430x932, and London desktop surfaces after active UI PRs land.
5. Architecture debt. Execute issue `#727` only after release lanes are stable. Keep policy-heavy stores explicit.

Do not start these plans in parallel on the current 8 GB machine.
