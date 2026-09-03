# Public Contributor Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Publish an all-time contributor record ranked by identity-backed visible community prices, Visit Reports, and weather Recommendations.

**Architecture:** Extend each existing contribution store with a private projection into one server-only counting layer. Community prices remain usable without a handle, but an existing public handle may be attached and counted. Ranking stays an unweighted sum while every projected contribution carries moderation, corroboration, and contradiction signals for a later weight-only policy change. A no-store API and server-rendered `/contributors` page distinguish ready, degraded, empty, and thin reads.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres, Vitest, existing CSS tokens, Playwright/browser QA.

## Global Constraints

- Rank on volume across prices posted, reviews written, and Recommendations made.
- Do not add referrals.
- Removed or hidden contributions never count.
- Equal totals share rank; no quality or recency tiebreak changes rank.
- Count window is all time and labelled plainly.
- Public attribution uses only the existing public handle model.
- Retired handle aliases resolve to the contributor's current public handle.
- Unattributed community prices remain valid but do not enter a named board.
- Store moderation, corroboration, and contradiction signals even though ranking ignores them.
- No new dependency or heavy client library.
- Honour `prefers-reduced-motion`; no confetti or animated counters.
- Do not touch `PubMap.tsx`.
- Follow `docs/VOICE.md`; no em dash or exclamation mark in product copy.

---

### Task 1: Pure contribution record and ranking core

**Files:**
- Create: `lib/contributorLeaderboard.ts`
- Test: `__tests__/contributorLeaderboard.test.ts`

**Interfaces:**
- Consumes: normalized public handles and per-source contribution records.
- Produces: `ContributionRecord`, `ContributionQualitySignals`, `ContributorLeaderboard`, and `rankContributors(records, status)`.

- [x] **Step 1: Write failing ranking tests**

```ts
it("adds all three visible lanes without weighting quality", () => {
  const board = rankContributors([
    record("sam", "price", { corroborated: false }),
    record("sam", "review"),
    record("alex", "recommendation"),
  ], "ready");
  expect(board.entries.map(({ handle, total }) => [handle, total])).toEqual([
    ["sam", 2],
    ["alex", 1],
  ]);
});

it("drops hidden records and gives equal totals equal rank", () => {
  const board = rankContributors([
    record("sam", "price"),
    record("alex", "review"),
    record("hidden", "recommendation", {}, false),
  ], "ready");
  expect(board.entries.map(({ handle, rank }) => [handle, rank])).toEqual([
    ["alex", 1],
    ["sam", 1],
  ]);
});
```

- [x] **Step 2: Run test and confirm RED**

Run: `npm test -- __tests__/contributorLeaderboard.test.ts`

Expected: FAIL because `lib/contributorLeaderboard.ts` does not exist.

- [x] **Step 3: Implement minimal pure core**

```ts
export type ContributionLane = "price" | "review" | "recommendation";
export type ContributionQualitySignals = {
  corroborated: boolean | null;
  moderation: "unreviewed" | "kept" | "hidden";
  contradicted: boolean | null;
};
export type ContributionRecord = {
  id: string;
  handle: string;
  lane: ContributionLane;
  contributedAt: number;
  visible: boolean;
  quality: ContributionQualitySignals;
};
export function rankContributors(
  records: readonly ContributionRecord[],
  status: "ready" | "degraded",
): ContributorLeaderboard;
```

Filter invalid/blank handles and non-visible records, sum lane counts, sort total descending, order tied rows by handle only for stable rendering, and assign competition ranks from total alone.

- [x] **Step 4: Run test and confirm GREEN**

Run: `npm test -- __tests__/contributorLeaderboard.test.ts`

Expected: PASS.

### Task 2: Project all three stores with durable quality signals

**Files:**
- Modify: `lib/communityPriceStore.ts`
- Modify: `lib/visitReportsStore.ts`
- Modify: `lib/weatherRecommendationStore.ts`
- Create: `supabase/migrations/20260728140000_0059_contributor_leaderboard.sql`
- Test: `__tests__/contributorLeaderboardStores.test.ts`
- Test: `__tests__/weatherRecommendationStoreSupabase.test.ts`

**Interfaces:**
- Consumes: `ContributionRecord` and existing source rows.
- Produces: `listLeaderboardContributions()` on each store; recommendation `moderate(id, visible)`; optional community-price `contributorHandle`.

- [x] **Step 1: Write failing store projection tests**

```ts
it("projects price quality without exposing an anonymous row", async () => {
  await memoryCommunityPriceStore.submit({
    venueId: "v1", drinkCategory: "beer", priceGbp: 5,
    actor: "a", contributorHandle: "sam",
  }, 1_000);
  await memoryCommunityPriceStore.submit({
    venueId: "v1", drinkCategory: "beer", priceGbp: 5,
    actor: "b", contributorHandle: "alex",
  }, 2_000);
  await memoryCommunityPriceStore.submit({
    venueId: "v2", drinkCategory: "beer", priceGbp: 4,
    actor: "c",
  }, 3_000);
  expect(await memoryCommunityPriceStore.listLeaderboardContributions()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ handle: "sam", quality: expect.objectContaining({ corroborated: true }) }),
      expect.objectContaining({ handle: "alex", quality: expect.objectContaining({ corroborated: true }) }),
    ]),
  );
  expect(JSON.stringify(await memoryCommunityPriceStore.listLeaderboardContributions()))
    .not.toContain("actor");
});

it("projects hidden reviews and recommendations as non-visible", async () => {
  // Create one row in each store, moderate both hidden, then assert visible false
  // and quality.moderation === "hidden".
});
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- __tests__/contributorLeaderboardStores.test.ts __tests__/weatherRecommendationStoreSupabase.test.ts`

Expected: FAIL because projection and recommendation moderation methods do not exist.

- [x] **Step 3: Implement source projections**

Community prices normalize an optional existing public handle. The memory row records it beside the private actor. Projection derives corroboration from independent agreeing actors, later contradiction from a newer visible disagreeing price, and moderation from `moderatedAt`/`hidden`. Anonymous rows are omitted.

Visit Reports project every row, including hidden rows, with `corroborated: null`, `contradicted: null`, and moderation from existing status/decision fields.

Weather Recommendations gain reversible `visible`/`hidden` moderation in both backends. Venue reads and contributor counts filter hidden rows. Projection includes hidden rows so the counting layer can prove it filtered them.

- [x] **Step 4: Add durable schema**

```sql
alter table public.community_prices
  add column if not exists contributor_handle text,
  add column if not exists corroborated_at timestamptz,
  add column if not exists contradicted_at timestamptz;

alter table public.weather_recommendations
  add column if not exists status text not null default 'visible',
  add column if not exists moderated_at timestamptz,
  add column if not exists moderator_note text;
```

Add handle/status checks and indexes. Define `public_contributor_leaderboard()` as an exact, security-definer, all-time aggregation over non-hidden attributed prices, visible structured Visit Reports, and visible weather Recommendations. Revoke public execution and grant service role only.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- __tests__/contributorLeaderboardStores.test.ts __tests__/weatherRecommendationStoreSupabase.test.ts`

Expected: PASS.

### Task 3: Attribute existing-handle price posts and add moderator pull

**Files:**
- Modify: `app/api/price-submit/route.ts`
- Modify: `components/map/useCommunityPrices.ts`
- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `app/api/weather-recommendations/route.ts`
- Test: `__tests__/priceSubmitRoute.test.ts`
- Test: `__tests__/weatherRecommendationsRoute.test.ts`

**Interfaces:**
- Consumes: existing `pubmax_handle`, `authedFetch`, `resolveMessageHandle`, and `gateHandleAction`.
- Produces: attributed price writes when an existing handle is present; anonymous writes otherwise; admin-only recommendation hide/restore.

- [x] **Step 1: Write failing route tests**

```ts
it("attaches an existing public handle but still accepts no handle", async () => {
  // POST one valid price with contributorHandle and one without.
  // Assert first projection names the contributor and second projection omits it.
});

it("stops a pulled recommendation counting and restores it", async () => {
  // Create, hide with moderator token, assert visible count 0, restore, assert 1.
});
```

- [x] **Step 2: Run focused route tests and confirm RED**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/weatherRecommendationsRoute.test.ts`

Expected: FAIL because price attribution and recommendation moderation do not exist.

- [x] **Step 3: Implement price attribution**

Read optional `contributorHandle`. If present, resolve the JWT-linked or asserted handle and apply the existing ownership gate. If absent, preserve anonymous logging. Send the browser's existing handle using `authedFetch`; never create a handle during price submission.

Show a plain note in `VenuePriceSubmit`: an existing public handle makes the log count under that handle on the public contributor record; no handle leaves the price anonymous.

- [x] **Step 4: Implement recommendation moderation route**

Add admin-only `action: "hide" | "restore"` handling before normal authoring validation. Call the store's reversible moderation method. Preserve the row and its quality trail.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/weatherRecommendationsRoute.test.ts`

Expected: PASS.

### Task 4: No-store counting seam and API

**Files:**
- Create: `lib/contributorLeaderboardStore.ts`
- Create: `app/api/contributors/route.ts`
- Test: `__tests__/contributorLeaderboardRoute.test.ts`

**Interfaces:**
- Consumes: three store projections in memory/keyless mode; exact Supabase RPC in durable mode.
- Produces: `readContributorLeaderboard(): Promise<ContributorLeaderboard>` and `GET /api/contributors`.

- [x] **Step 1: Write failing API tests**

```ts
it("returns an exact all-time board with no-store headers", async () => {
  // Seed all lanes and assert combined totals, lane counts, shared ranks,
  // window.kind === "all-time", and Cache-Control contains no-store.
});

it("returns degraded instead of an answered empty board when one lane fails", async () => {
  // Force one source projection to fail and assert status === "degraded".
});
```

- [x] **Step 2: Run test and confirm RED**

Run: `npm test -- __tests__/contributorLeaderboardRoute.test.ts`

Expected: FAIL because route/store do not exist.

- [x] **Step 3: Implement counting seam**

In keyless mode, read all three projections with `Promise.allSettled`. Any failed or degraded lane makes the entire board degraded, preventing a partial total from posing as exact. In Supabase mode, call the exact RPC. Never memoise or cache the result.

- [x] **Step 4: Implement no-store route**

Return the board through `jsonNoStore`. Keep source records and quality signals server-only; public payload contains ranks, handles, lane counts, total, window, and status.

- [x] **Step 5: Run test and confirm GREEN**

Run: `npm test -- __tests__/contributorLeaderboardRoute.test.ts`

Expected: PASS.

### Task 5: Record-style public surface and profile entry point

**Files:**
- Create: `app/contributors/page.tsx`
- Create: `app/contributors/contributors.css`
- Modify: `components/profile/YourContributionsCard.tsx`
- Modify: `components/profile/yourContributionsCard.css`
- Test: `__tests__/contributorLeaderboardPage.test.ts`

**Interfaces:**
- Consumes: public board API/store shape.
- Produces: `/contributors` record surface and profile-area link.

- [x] **Step 1: Write failing render tests**

```tsx
it("labels all-time totals and keeps ties visibly joint", () => {
  // Render ready fixture, assert "All time", two rank 1 rows, and lane totals.
});

it("does not turn degraded or early data into an absence claim", () => {
  // Render degraded and empty fixtures; reject "no contributors" copy.
});
```

- [x] **Step 2: Run test and confirm RED**

Run: `npm test -- __tests__/contributorLeaderboardPage.test.ts`

Expected: FAIL because page surface does not exist.

- [x] **Step 3: Implement server-rendered record**

Use restrained table-like rows, tabular numerals, app tokens, public profile links, and no motion. Heading: `Contributor record`. Window: `All visible identity-backed contributions, all time`. Degraded state: `We couldn't check the full record right now.` Empty ready state describes how the record will fill without claiming nobody contributes. Thin state labels the record as early while preserving real counts.

- [x] **Step 4: Add profile entry point**

Add `See the contributor record` to `YourContributionsCard`, including loading/error states, so access does not depend on a successful private-stats read.

- [x] **Step 5: Run test and confirm GREEN**

Run: `npm test -- __tests__/contributorLeaderboardPage.test.ts`

Expected: PASS.

### Task 6: Privacy notice and legal fence

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `__tests__/legalPages.test.ts`

**Interfaces:**
- Consumes: actual public attribution and retention behaviour.
- Produces: notice explaining public ranking and optional price attribution.

- [x] **Step 1: Write failing legal assertions**

```ts
expect(privacy).toMatch(/public contributor record/i);
expect(privacy).toMatch(/prices.*Visit Reports.*Recommendations/is);
expect(privacy).toMatch(/without a handle.*anonymous/is);
expect(privacy).toMatch(/hidden.*do not count/is);
```

- [x] **Step 2: Run test and confirm RED**

Run: `npm test -- __tests__/legalPages.test.ts`

Expected: FAIL because notice does not describe the public board.

- [x] **Step 3: Update notice**

Explain that a public handle already attached to a price, Visit Report, or Recommendation appears with all-time visible counts on the public contributor record. Explain anonymous prices stay anonymous and excluded, and hidden/taken-down contributions stop counting. Update retention language to distinguish attributed prices from anonymous rows.

- [x] **Step 4: Run test and confirm GREEN**

Run: `npm test -- __tests__/legalPages.test.ts`

Expected: PASS.

### Task 7: Browser, full verification, review, and commit

**Files:**
- Modify only files required by findings.

**Interfaces:**
- Consumes: complete feature.
- Produces: verified commit on `fm/public-leaderboards`.

- [x] **Step 1: Run focused suite**

Run: `npm test -- __tests__/contributorLeaderboard.test.ts __tests__/contributorLeaderboardStores.test.ts __tests__/contributorLeaderboardRoute.test.ts __tests__/contributorLeaderboardPage.test.ts __tests__/priceSubmitRoute.test.ts __tests__/weatherRecommendationStoreSupabase.test.ts __tests__/weatherRecommendationsRoute.test.ts __tests__/legalPages.test.ts`

Expected: PASS with no warnings.

- [x] **Step 2: Run full gate**

Run: `npm run verify`

Expected: PASS.

- [x] **Step 3: Run real browser at 390px**

Run app with `npm run dev`, then:

```bash
chrome-devtools-axi open http://localhost:3000/contributors
chrome-devtools-axi emulate --viewport "390x844x3,mobile,touch"
chrome-devtools-axi eval '()=>location.reload()'
chrome-devtools-axi screenshot .artifacts/contributors-390.png
```

Check no horizontal overflow, 44px tap targets, honest state copy, ties, all-time label, reduced-motion behaviour, and profile navigation.

- [x] **Step 4: Review diff and project docs**

Run code-review, review, verification-before-completion, requesting-code-review, and check-work playbooks. Run `/Users/karanmanoharan/karan-agent-workspace/bin/fm-ensure-agents-md.sh .`. Add durable AGENTS.md knowledge only if it helps almost every future session.

- [x] **Step 5: Commit**

```bash
git add app components lib supabase/migrations __tests__ docs/superpowers/plans
git commit -m "feat: rank public contributors"
```

Expected: clean committed branch.
