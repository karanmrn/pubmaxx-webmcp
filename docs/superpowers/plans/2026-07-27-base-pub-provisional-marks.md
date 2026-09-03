# UK Base Pub Provisional Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing provisional community-price badge on a UK base pub after its first in-window pint report, without granting price authority or expanding base shard payloads.

**Architecture:** Keep base identity as the stable salted `venue-uk-<OSM ref>` used by submissions. Add a bounded viewport read that returns provisional base IDs only, union those visibility IDs with optimistic local submission IDs, and encode one boolean onto in-memory GeoJSON after shard download. Draw the badge from the existing visual tokens and dimensions on a dedicated base-source layer; no base price enters `VenueSignal`, venue rows, buckets, labels, or Pint Index data.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MapLibre GL, Vitest, Playwright browser QA.

## Global Constraints

- Base identity remains `venue-uk-<OSM ref>` from `lib/ukBasePubs.ts`.
- Visibility remains ungated and separate from price authority.
- Base shards and shard builder remain byte-for-byte unchanged.
- Only pubs in the current visible viewport are requested.
- Badge uses existing provisional badge visual language.
- Verify at 390x844 mobile viewport in a real browser.
- `npm run verify` must pass.

---

### Task 1: Bind provisional visibility to base identity

**Files:**
- Modify: `__tests__/ukBasePubs.test.ts`
- Modify: `lib/ukBasePubs.ts`

**Interfaces:**
- Consumes: stable `UkBasePub.id` values decoded by `ukBaseIdFor(osmRef)`.
- Produces: `ukBasePubsToGeoJSON(pubs, provisionalVenueIds)` with a boolean `provisional` property and no price properties.

- [x] **Step 1: Write failing identity and authority test**

```ts
const features = ukBasePubsToGeoJSON(
  pubs,
  new Set(["venue-uk-w2"]),
).features;
expect(features[0]?.properties?.provisional).toBe(false);
expect(features[1]?.properties?.provisional).toBe(true);
expect(features[1]?.properties).not.toHaveProperty("bucket");
expect(features[1]?.properties).not.toHaveProperty("priceLabel");
```

- [x] **Step 2: Run test and verify missing property failure**

Run: `npx vitest run __tests__/ukBasePubs.test.ts`

Expected: FAIL because `ukBasePubsToGeoJSON` ignores provisional IDs.

- [x] **Step 3: Add minimal salted-ID lookup**

```ts
export function ukBasePubsToGeoJSON(
  pubs: UkBasePub[],
  provisionalVenueIds: ReadonlySet<string> | null = null,
): GeoJSON.FeatureCollection
```

Each feature gets `provisional: Boolean(provisionalVenueIds?.has(pub.id))`. No price-shaped property is added.

- [x] **Step 4: Run focused test**

Run: `npx vitest run __tests__/ukBasePubs.test.ts`

Expected: PASS.

### Task 2: Read provisional IDs for visible base pubs

**Files:**
- Modify: `__tests__/communityPriceStore.test.ts`
- Modify: `__tests__/priceSubmitRoute.test.ts`
- Modify: `__tests__/communityPriceClientState.test.ts`
- Modify: `lib/communityPriceStore.ts`
- Modify: `app/api/price-submit/route.ts`
- Modify: `components/map/useCommunityPrices.ts`
- Modify: `components/PubMap.tsx`

**Interfaces:**
- Consumes: at most `MAX_PROVISIONAL_BASE_VENUE_IDS` stable base IDs from current viewport.
- Produces: `readProvisionalCommunityPriceVenueIds(ids)`, `GET ?scope=provisional-base&venueId=...`, and `loadProvisionalBaseVenues(ids)`.

- [x] **Step 1: Add failing store test**

Submit one fresh beer report, one corroborated beer price, one non-beer report, and one report for a non-requested base ID. Assert only requested lone fresh beer ID is returned.

- [x] **Step 2: Add failing route test**

Call `GET ?scope=provisional-base&venueId=<base-a>&venueId=<base-b>`. Assert response is `{ venueIds: [<base-a>] }`, contains no price figure, and rejects non-base IDs or an over-limit list.

- [x] **Step 3: Add failing client reader test**

Add a pure response reader that accepts only valid base IDs and ignores malformed or curated IDs.

- [x] **Step 4: Run red tests**

Run: `npx vitest run __tests__/communityPriceStore.test.ts __tests__/priceSubmitRoute.test.ts __tests__/communityPriceClientState.test.ts`

Expected: FAIL because bounded provisional viewport read does not exist.

- [x] **Step 5: Implement bounded visibility-only store read**

Add `latestProvisionalVenueIds` to both store backends. Memory groups only requested IDs. Supabase performs a bounded, paged query for in-window beer rows across requested IDs and derives marks with `marksMapProvisionally`. Return IDs only and fail soft with `degraded: true`.

- [x] **Step 6: Implement route and client state**

Route validates every repeated `venueId` as a base ID and enforces `MAX_PROVISIONAL_BASE_VENUE_IDS`. Client fetches a sorted unique current-viewport set, ignores stale responses, and stores only returned IDs. `PubMap` requests IDs from `renderedBasePubs` and unions these IDs with local optimistic provisional IDs.

- [x] **Step 7: Run focused tests**

Run: `npx vitest run __tests__/communityPriceStore.test.ts __tests__/priceSubmitRoute.test.ts __tests__/communityPriceClientState.test.ts`

Expected: PASS.

### Task 3: Paint base badge with existing visual language

**Files:**
- Modify: `__tests__/mapSymbolCollision.test.ts`
- Modify: `components/map/canvas/buildScene.ts`
- Modify: `components/map/pubmap/useUkBaseStreaming.ts`
- Modify: `components/PubMapCanvas.tsx`

**Interfaces:**
- Consumes: `provisionalVenueIds` already passed to `PubMapCanvas`.
- Produces: updated `uk-base` GeoJSON and `uk-base-provisional-badge` layer.

- [x] **Step 1: Add failing scene test**

Assert base badge reads `provisional`, uses same colour, radius, offset, and stroke as curated badge, contains no price expression, and sits above `uk-base-point` but below curated pins.

- [x] **Step 2: Run scene test red**

Run: `npx vitest run __tests__/mapSymbolCollision.test.ts`

Expected: FAIL because `uk-base-provisional-badge` does not exist.

- [x] **Step 3: Share badge paint and wire stream**

Extract one badge-paint helper in `buildScene.ts`, add base badge layer, and pass provisional IDs into `ukBasePubsToGeoJSON` from `useUkBaseStreaming`. Keep base source unclustered and shard bytes unchanged.

- [x] **Step 4: Run focused map tests**

Run: `npx vitest run __tests__/mapSymbolCollision.test.ts __tests__/ukBasePubs.test.ts __tests__/ukBaseStreaming.test.ts`

Expected: PASS.

### Task 4: Make base receipt and trust copy truthful

**Files:**
- Modify: `__tests__/unverifiedPubSheet.test.ts`
- Modify: `components/map/UnverifiedPubSheet.tsx`

**Interfaces:**
- Consumes: existing `communityTrustNote` and `VenuePriceSubmit` default map-mark capability.
- Produces: base sheet wording that says a lone pint report is marked, while never saying its price drives the map.

- [x] **Step 1: Change test to require marked wording**

Assert a fresh lone pint report includes `Marked on the map` and excludes `On the map`.

- [x] **Step 2: Run test red**

Run: `npx vitest run __tests__/unverifiedPubSheet.test.ts`

Expected: FAIL while base sheet passes `canMarkMap={false}`.

- [x] **Step 3: Enable mark-only wording**

Replace the `canMarkMap` boolean with `CommunityPriceMapReach` (`paint` | `mark` | `page`) and pass `mark` from the base sheet. The boolean conflated two claims, so dropping it alone let the receipt promise a pin colour a base pin can never draw; the enum keeps the mark claim (true, and the whole point) and removes every map-move clause on the base path.

- [x] **Step 4: Run focused test**

Run: `npx vitest run __tests__/unverifiedPubSheet.test.ts`

Expected: PASS.

### Task 5: Verify product and close out

**Files:**
- Modify only if verification exposes defects.

**Interfaces:**
- Consumes: completed implementation.
- Produces: green gates, browser evidence, clean committed branch.

- [x] **Step 1: Run targeted suite and typecheck**

Run: `npx vitest run __tests__/ukBasePubs.test.ts __tests__/ukBaseStreaming.test.ts __tests__/communityPriceStore.test.ts __tests__/priceSubmitRoute.test.ts __tests__/communityPriceClientState.test.ts __tests__/mapSymbolCollision.test.ts __tests__/unverifiedPubSheet.test.ts`

Run: `npm run typecheck`

- [x] **Step 2: Run full verification**

Run: `npm run verify`

Expected: all validation, lint, typecheck, coverage, and audit gates pass.

- [x] **Step 3: Verify at 390px**

Start keyless dev server if needed, open map with `chrome-devtools-axi`, apply `390x844x3,mobile,touch`, reload in place, submit first base-pub beer price, and confirm badge appears without price colour or label.

- [x] **Step 4: Run project memory check**

Run: `/Users/karanmanoharan/karan-agent-workspace/bin/fm-ensure-agents-md.sh .`

- [x] **Step 5: Review and commit**

Run closeout review skills, confirm generated tooling churn is absent, then commit all task files on `fm/base-pub-provisional-marks`.
