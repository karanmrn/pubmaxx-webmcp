# Weather Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Pubmaxxer write, own, and surface a short venue recommendation tied to a closed weather condition, using existing weather snapshots for honest matching.

**Architecture:** Add a browser-safe domain module for the closed condition vocabulary, validation, and pure weather matching. Persist attributed rows behind one dual-backend store with a visible-contributor count seam, expose one bounded venue API using existing Open-Meteo snapshots, and mount one focused client card in the venue overview beside the existing community contribution flow.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Supabase/PostgREST, existing Open-Meteo snapshot store, existing identity and rate-limit seams, plain CSS.

## Global Constraints

- No new weather provider, API key, or heavy dependency.
- A Recommendation is a Pubmaxxer's attributed opinion, never a review, verified venue fact, aggregate score, or venue ranking.
- Conditions are exactly `warm`, `clear`, `raining`, `cold`, and `windy`.
- `clear` is used instead of `sunny` because existing snapshots do not carry day/night state. A clear night must not be called sunny.
- Current weather comes only from `loadWeatherSnapshot` and `planningWeatherForArea`.
- Matching reads observed fields only: the reported condition, apparent temperature and wind. The snapshot's precipitation probability is a next-hour forecast and decides nothing, and snow is not rain.
- If current conditions cannot be checked, return and render `unavailable`, then show recommendations unconditionally with explicit copy.
- Venue reads return at most 20 recommendation rows and stay under 8 KiB for maximum-size valid rows.
- Contributor counts are derived by normalized handle through the store and are not shown as a venue score.
- Authoring remains usable at 390px with 44px touch targets, labelled controls, keyboard submission, visible focus, and reduced-motion handling.
- Keep review code untouched. Venue overview integration is one import and one mounted component.
- Do not manually edit generated files or CHANGELOG.md.

## Weather outside the five conditions

Matching on observed fields alone leaves a common state: weather we read fine that is none of the five conditions anyone can author for. In the shipped snapshot (`public/data/weather/latest.json`, generated 2026-07-18) 8 of the 20 night areas read `Cloudy` and the other 12 read `Clear`, with apparent temperature between 15.8C and 16.8C and wind between 11.5 kph and 13.7 kph. Cloudy at that temperature and wind matches nothing, and `Fog` behaves the same way, as do the untranslated `Weather code N` strings.

So the venue card treats it as its own fact and says only that we have no recommendations for today's conditions. It never reports it as an absence of contributors, and it never invites a recommendation the form cannot accept. Widening the vocabulary to cover cloud or fog is a separate product decision, deliberately not taken here.

---

### Task 1: Closed recommendation vocabulary and honest weather matching

**Files:**
- Create: `lib/weatherRecommendations.ts`
- Create: `__tests__/weatherRecommendations.test.ts`
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: `NightAreaWeatherObservation` from `lib/weatherSnapshots.ts`
- Produces: `WEATHER_RECOMMENDATION_CONDITIONS`, `WeatherRecommendationCondition`, `WeatherRecommendation`, `WeatherRecommendationInput`, `validateWeatherRecommendation`, `conditionsForWeather`, `matchingWeatherRecommendations`, and display labels

- [ ] **Step 1: Write failing domain tests**

```ts
import {
  conditionsForWeather,
  matchingWeatherRecommendations,
  validateWeatherRecommendation,
} from "@/lib/weatherRecommendations";

it("normalises one authored recommendation and rejects unknown conditions", () => {
  expect(validateWeatherRecommendation({
    venueId: "venue-1",
    condition: "WARM",
    reason: "The back garden catches the last of the light.",
    contributorHandle: "@night_owl",
  })).toEqual({
    ok: true,
    value: {
      venueId: "venue-1",
      condition: "warm",
      reason: "The back garden catches the last of the light.",
      contributorHandle: "night_owl",
    },
  });
  expect(validateWeatherRecommendation({
    venueId: "venue-1",
    condition: "snowy",
    reason: "Good in snow.",
    contributorHandle: "night_owl",
  })).toEqual({ ok: false, error: "Pick the weather this suits." });
});

it("derives overlapping conditions from supported snapshot fields", () => {
  expect(conditionsForWeather({
    condition: "Clear",
    feelsLikeC: 20,
    precipitationProbabilityPct: 5,
    windKph: 36,
  })).toEqual(["warm", "clear", "windy"]);
});

it("matches authored opinions without turning them into facts", () => {
  expect(matchingWeatherRecommendations([
    row("warm"),
    row("cold"),
  ], ["warm", "clear"]).map((item) => item.condition)).toEqual(["warm"]);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- __tests__/weatherRecommendations.test.ts`

Expected: FAIL because `@/lib/weatherRecommendations` does not exist.

- [ ] **Step 3: Implement minimal pure domain**

```ts
export const WEATHER_RECOMMENDATION_CONDITIONS = [
  "warm",
  "clear",
  "raining",
  "cold",
  "windy",
] as const;

export function conditionsForWeather(weather: RecommendationWeather): WeatherRecommendationCondition[] {
  const out: WeatherRecommendationCondition[] = [];
  if (weather.feelsLikeC >= 18) out.push("warm");
  if (/\b(clear|sun|sunny)\b/i.test(weather.condition)) out.push("clear");
  if (/rain|drizzle|storm|shower/i.test(weather.condition)) out.push("raining");
  if (weather.feelsLikeC < 8) out.push("cold");
  if (weather.windKph !== null && weather.windKph >= 30) out.push("windy");
  return out;
}
```

Validation must strip control characters and angle brackets, collapse whitespace, cap venue IDs at 64 characters, normalize handles with `normalizeHandle`, require reason length 8 to 160, and run `presentableDescription` so scraped marketing prose does not become attributed community copy.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npm test -- __tests__/weatherRecommendations.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 5: Record domain language**

Replace the old computed `Trusted Recommendation` glossary term with:

```md
**Recommendation**:
A short, attributed opinion from a Pubmaxxer that a venue suits one condition from the product's weather vocabulary. It is neither a review nor a verified fact about the venue.
_Avoid_: Computed suggestion, review, venue fact, score

**Suggested Venue**:
A venue surfaced by product logic from current conditions, preferences, or other known signals. It has no human author and is never presented as a Recommendation.
_Avoid_: Recommendation, user tip
```

- [ ] **Step 6: Commit slice**

```bash
git add CONTEXT.md lib/weatherRecommendations.ts __tests__/weatherRecommendations.test.ts
git commit -m "feat(recommendations): define weather recommendation vocabulary"
```

### Task 2: Dual-backend store, durable attribution, and contributor count seam

**Files:**
- Create: `lib/weatherRecommendationStore.ts`
- Create: `__tests__/weatherRecommendationStore.test.ts`
- Create: `__tests__/weatherRecommendationStoreSupabase.test.ts`
- Create: `supabase/migrations/20260728121000_0058_weather_recommendations.sql`

**Interfaces:**
- Consumes: validated `WeatherRecommendationInput`
- Produces: `WeatherRecommendationStore.create`, `.listForVenue`, `.countForContributor`, `weatherRecommendationStore`, `submitWeatherRecommendation`, `readWeatherRecommendations`, `readWeatherRecommendationContributorCount`, `__resetWeatherRecommendations`

- [ ] **Step 1: Write failing store tests**

```ts
it("upserts one recommendation per venue, condition, and contributor", async () => {
  await store.create(input({ reason: "First reason here." }), "actor-a", 1_000);
  const updated = await store.create(input({ reason: "Better reason here." }), "actor-b", 2_000);
  expect((await store.listForVenue("venue-1"))).toEqual([updated]);
  expect(updated.actorHash).toBeUndefined();
});

it("counts rows by contributor without producing a venue score", async () => {
  await store.create(input({ venueId: "venue-1" }), "actor-a", 1_000);
  await store.create(input({ venueId: "venue-2", condition: "cold" }), "actor-a", 2_000);
  expect(await store.countForContributor("night_owl")).toBe(2);
  expect(await store.countForContributor("someone_else")).toBe(0);
});

it("bounds venue reads to newest 20 rows", async () => {
  for (let i = 0; i < 25; i += 1) {
    await store.create(input({ contributorHandle: `person_${i}` }), `actor-${i}`, i);
  }
  expect(await store.listForVenue("venue-1")).toHaveLength(20);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- __tests__/weatherRecommendationStore.test.ts`

Expected: FAIL because store module does not exist.

- [ ] **Step 3: Implement store and migration**

Memory storage uses `Map<string, StoredWeatherRecommendation>` keyed by row ID plus a natural key index of `venueId::condition::contributorHandle`. Public projection removes `actorHash`. Supabase uses `createFailSoftGuard`, `onMissingDurableWrite`, and `selectStore`; writes throw on hard durable failure, reads fail soft with an explicit degraded status.

Migration shape:

```sql
create table if not exists public.weather_recommendations (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null,
  condition text not null check (condition in ('warm', 'clear', 'raining', 'cold', 'windy')),
  reason text not null check (char_length(reason) between 8 and 160),
  contributor_handle text not null,
  actor_hash text not null,
  submitted_at timestamptz not null default now(),
  unique (venue_id, condition, contributor_handle)
);
create index if not exists weather_recommendations_venue_recent_idx
  on public.weather_recommendations (venue_id, submitted_at desc);
create index if not exists weather_recommendations_contributor_idx
  on public.weather_recommendations (contributor_handle);
alter table public.weather_recommendations enable row level security;
revoke all on public.weather_recommendations from anon, authenticated;
grant all on public.weather_recommendations to service_role;
```

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npm test -- __tests__/weatherRecommendationStore.test.ts`

Expected: PASS with actor hashes absent from public DTOs and counts derived by handle.

- [ ] **Step 5: Commit slice**

```bash
git add lib/weatherRecommendationStore.ts __tests__/weatherRecommendationStore.test.ts supabase/migrations/20260728121000_0058_weather_recommendations.sql
git commit -m "feat(recommendations): store attributed weather recommendations"
```

### Task 3: Bounded API with existing weather and honest availability

**Files:**
- Create: `app/api/weather-recommendations/route.ts`
- Create: `__tests__/weatherRecommendationsRoute.test.ts`
- Modify: `__tests__/writeSurfaceCertification.test.ts`
- Modify: `docs/WRITE_SURFACE_CERTIFICATION.md`

**Interfaces:**
- Consumes: `lookupCanonicalVenue`, `loadWeatherSnapshot`, `nearestNightAreaForViewport`, `planningWeatherForArea`, `resolveMessageHandle`, `gateHandleAction`, `deriveCommunityPriceActor`, `isLimited`
- Produces:
  - `POST { venueId, condition, reason, contributorHandle } -> 201 { recommendation }`
  - `GET ?venueId=<id> -> 200 { weatherStatus, matchingConditions, recommendations, degraded, truncated }`

- [ ] **Step 1: Write failing route tests**

```ts
it("stores a validated attributed recommendation with server-derived identity", async () => {
  const response = await POST(request({
    venueId: "venue-1",
    condition: "warm",
    reason: "The back garden stays bright late.",
    contributorHandle: "night_owl",
    actorHash: "client-lie",
  }));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    recommendation: {
      venueId: "venue-1",
      condition: "warm",
      contributorHandle: "night_owl",
    },
  });
  expect(JSON.stringify(await response.clone().json())).not.toContain("actorHash");
});

it("matches from the existing venue-area weather snapshot", async () => {
  const response = await GET(new Request("https://pubmax.test/api/weather-recommendations?venueId=venue-1"));
  expect(await response.json()).toMatchObject({
    weatherStatus: "available",
    matchingConditions: ["warm", "clear"],
  });
});

it("distinguishes weather unavailable from no matching rows", async () => {
  const response = await GET(new Request("https://pubmax.test/api/weather-recommendations?venueId=venue-1"));
  expect(await response.json()).toMatchObject({
    weatherStatus: "unavailable",
    recommendations: expect.any(Array),
  });
});

it("keeps a maximum valid response below 8 KiB", async () => {
  const response = await GET(new Request("https://pubmax.test/api/weather-recommendations?venueId=venue-1"));
  expect(Buffer.byteLength(await response.text(), "utf8")).toBeLessThanOrEqual(8 * 1024);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- __tests__/weatherRecommendationsRoute.test.ts __tests__/writeSurfaceCertification.test.ts`

Expected: route tests fail for missing route; write-surface inventory fails at 72 after route exists and before certification update.

- [ ] **Step 3: Implement POST**

Validate body with shared pure validator. Resolve canonical pub, prefer JWT-linked handle over asserted handle, enforce `gateHandleAction`, derive actor from request, then apply:

```ts
const actorKey = actor ?? "anon";
if (await isLimited(`weather-recommendation-actor:${actorKey}`, `weather-recommendation-actor:${actorKey}`, 30, 3_600_000)) {
  return publicApiError("Too many recommendations, slow down.", "RATE_LIMITED", 429, { retryable: true });
}
if (await isLimited(
  `weather-recommendation:${actorKey}:${canonicalId}`,
  `weather-recommendation:${actorKey}:${canonicalId}`,
  5,
  3_600_000,
)) {
  return publicApiError("Too many recommendations for this pub, slow down.", "RATE_LIMITED", 429, { retryable: true });
}
```

Persist the canonical ID, resolved handle, actor hash, and server clock only. Return 503 on hard write failure.

- [ ] **Step 4: Implement GET**

Resolve venue coordinates from the canonical venue index. Read at most 20 rows. Load existing snapshot store-first, find nearest night area, and pass the observation through `planningWeatherForArea`. Return:

```ts
{
  recommendations: weather
    ? matchingWeatherRecommendations(recommendations, matchingConditions)
    : recommendations,
  matchingConditions,
  weatherStatus: weather ? "available" : "unavailable",
  degraded: storeRead.status === "degraded",
  truncated,
}
```

When weather is unavailable, all authored rows surface unconditionally. Never turn this into an empty array described as no recommendations.

- [ ] **Step 5: Certify write surface**

Raise inventory from 71 to 72 and document validation, dual identity, two rate limits, server-stamped provenance, bounded reads, count seam, weather availability, and rollback.

- [ ] **Step 6: Run tests and confirm GREEN**

Run: `npm test -- __tests__/weatherRecommendationsRoute.test.ts __tests__/writeSurfaceCertification.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit slice**

```bash
git add app/api/weather-recommendations/route.ts __tests__/weatherRecommendationsRoute.test.ts __tests__/writeSurfaceCertification.test.ts docs/WRITE_SURFACE_CERTIFICATION.md
git commit -m "feat(recommendations): add weather-matched venue API"
```

### Task 4: One-handed venue authoring and opinion surfacing

**Files:**
- Create: `components/map/VenueWeatherRecommendations.tsx`
- Create: `components/map/venueWeatherRecommendations.css`
- Create: `__tests__/venueWeatherRecommendations.test.ts`
- Modify: `components/map/inspector/VenueOverviewTab.tsx`

**Interfaces:**
- Consumes: venue ID and name, `/api/weather-recommendations`, `authedFetch`, `pubmax_handle`
- Produces: matching opinion cards, unavailable-weather note, closed condition picker, handle and short-reason form, optimistic receipt

- [ ] **Step 1: Write failing presentation tests**

```ts
it("renders every recommendation as attributed opinion", () => {
  const html = renderToStaticMarkup(createElement(WeatherRecommendationList, {
    venueName: "The Crown",
    recommendations: [recommendation()],
    weatherStatus: "available",
  }));
  expect(html).toContain("@night_owl");
  expect(html).toContain("recommends this when it’s warm");
  expect(html).not.toContain("verified");
  expect(html).not.toContain("score");
});

it("states weather read failure and still renders authored rows", () => {
  const html = renderToStaticMarkup(createElement(WeatherRecommendationList, {
    venueName: "The Crown",
    recommendations: [recommendation()],
    weatherStatus: "unavailable",
  }));
  expect(html).toContain("We couldn’t check the weather here just now");
  expect(html).toContain("The back garden catches the light");
});

it("renders five labelled condition controls and a short reason field", () => {
  const html = renderToStaticMarkup(createElement(VenueWeatherRecommendations, {
    venueId: "venue-1",
    venueName: "The Crown",
  }));
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain("Clear skies");
  expect(html).toContain('maxlength="160"');
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- __tests__/venueWeatherRecommendations.test.ts`

Expected: FAIL because component module does not exist.

- [ ] **Step 3: Implement client card**

Initial mount reads `pubmax_handle` safely, fetches venue rows once, and separates:

- `matched`: heading “Fits tonight” and only matching recommendations.
- `unavailable`: note “We couldn’t check the weather here just now. These are Pubmaxxers’ tips, shown without a weather match.” and all rows.
- `matched` with no rows: no empty recommendation claim, only authoring card.
- degraded store read: “We couldn’t read every recommendation just now.” without claiming venue has none.

Each row says `@handle recommends this when it’s {condition label}` followed by the quoted reason. No count, score, stars, rank, or “best” copy.

Authoring mirrors price submission:

```tsx
<div role="radiogroup" aria-label={`When does ${venueName} suit?`}>
  {WEATHER_RECOMMENDATION_CONDITIONS.map((option) => (
    <button type="button" role="radio" aria-checked={condition === option}>
      {weatherRecommendationConditionLabel(option)}
    </button>
  ))}
</div>
<input aria-label="Your Pubmaxx handle" />
<textarea maxLength={160} aria-label={`Why ${venueName} suits this weather`} />
<button type="submit">Recommend it</button>
```

Use `authedFetch`, save normalized handle to local storage on successful validation, adopt server response, and announce success through `role="status"`.

- [ ] **Step 4: Add focused CSS**

Use existing venue-sheet tokens. Condition controls and submit button have `min-height: 44px`; grid uses `repeat(2, minmax(0, 1fr))` at phone width; text wraps; no horizontal overflow. Transitions are colour and border only, with:

```css
@media (prefers-reduced-motion: reduce) {
  .venueWeatherRecommendations *,
  .venueWeatherRecommendations *::before,
  .venueWeatherRecommendations *::after {
    transition-duration: 0.01ms;
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }
}
```

- [ ] **Step 5: Mount in venue overview**

Import the component and place it immediately after `VenuePriceSubmit`, passing only `venue.id` and `venue.name`. Do not modify review components or props.

- [ ] **Step 6: Run tests and confirm GREEN**

Run: `npm test -- __tests__/venueWeatherRecommendations.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit slice**

```bash
git add components/map/VenueWeatherRecommendations.tsx components/map/venueWeatherRecommendations.css components/map/inspector/VenueOverviewTab.tsx __tests__/venueWeatherRecommendations.test.ts
git commit -m "feat(recommendations): add venue weather authoring card"
```

### Task 5: Integration, browser evidence, and completion checks

**Files:**
- Modify only files required by observed failures

**Interfaces:**
- Consumes: completed API and venue component
- Produces: verified 390px dark-mode flow, PR-body browser evidence, clean project gate, committed branch

- [ ] **Step 1: Run focused integration suite**

Run:

```bash
npm test -- \
  __tests__/weatherRecommendations.test.ts \
  __tests__/weatherRecommendationStore.test.ts \
  __tests__/weatherRecommendationStoreSupabase.test.ts \
  __tests__/weatherRecommendationsRoute.test.ts \
  __tests__/venueWeatherRecommendations.test.ts \
  __tests__/writeSurfaceCertification.test.ts
```

Expected: all pass with clean output.

- [ ] **Step 2: Run static gates**

Run: `npm run lint && npm run typecheck`

Expected: both exit 0 with no warnings.

- [ ] **Step 3: Start isolated dev server**

Run: `NEXT_DIST_DIR=.next-weather-recommendations npm run dev`

Expected: server ready on `http://localhost:3000`.

- [ ] **Step 4: Verify real browser at 390px at night**

Using `chrome-devtools-axi`:

1. Open `http://localhost:3000/map?sel=<known-pub-id>`.
2. Emulate `390x844x3,mobile,touch`, then reload in place.
3. Set dark colour scheme through supported browser emulation.
4. Confirm five condition buttons, handle field, reason field, and submit button fit without horizontal overflow.
5. Submit a recommendation.
6. Confirm POST returns 201, receipt announces success, and row reads as `@handle recommends`.
7. Reload venue sheet and confirm persisted memory-store row returns.
8. Inspect console and network. Require zero errors and no warnings attributable to this feature.
9. Inspect accessibility tree and keyboard focus order.
10. Emulate reduced motion and confirm no meaningful transition or animation remains.
11. Capture screenshots for the PR body through the no-mistakes browser-evidence step. The supervisor waived a repository screenshot artifact after `chrome-devtools-axi screenshot` twice reported a path without writing a file.

- [ ] **Step 5: Run full project gate**

Run: `npm run verify`

Expected: validate-data, lint, typecheck, coverage, and resilient audit all exit 0.

- [ ] **Step 6: Restore local tooling churn**

Run:

```bash
git checkout -- next-env.d.ts package.json
git status --short
```

Expected: only task files remain.

- [ ] **Step 7: Review diff and commit**

Run:

```bash
git diff --check
git diff --stat
git add CONTEXT.md docs/superpowers/plans/2026-07-28-weather-recommendations.md \
  lib/weatherRecommendations.ts lib/weatherRecommendationStore.ts \
  app/api/weather-recommendations/route.ts \
  components/map/VenueWeatherRecommendations.tsx \
  components/map/venueWeatherRecommendations.css \
  components/map/inspector/VenueOverviewTab.tsx \
  __tests__/weatherRecommendations.test.ts \
  __tests__/weatherRecommendationStore.test.ts \
  __tests__/weatherRecommendationStoreSupabase.test.ts \
  __tests__/weatherRecommendationsRoute.test.ts \
  __tests__/venueWeatherRecommendations.test.ts \
  __tests__/writeSurfaceCertification.test.ts \
  docs/WRITE_SURFACE_CERTIFICATION.md \
  supabase/migrations/20260728121000_0058_weather_recommendations.sql
git commit -m "feat: add authored weather recommendations"
```

- [ ] **Step 8: Report ready for firstmate gate**

Append:

```bash
echo "done: authored weather recommendations committed and npm run verify green; no-mistakes browser evidence pending" >> '/Users/karanmanoharan/karan-agent-workspace/state/weather-recommendations.status'
```
