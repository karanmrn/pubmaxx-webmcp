# Nearby Bus Departures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show fresh TfL bus departures from walkable stops near a London pub inside the venue sheet's existing getting-home journey.

**Architecture:** Extract the existing guarded TfL request helper from the last-train route so both transport routes share one client. Add one bounded, no-store bus route that finds stops within 500 metres, fetches each capped stop's arrivals concurrently inside a single deadline, rejects stale predictions, and returns destinations plus straight-line stop distances. Render it as a lazy, collapsed disclosure beneath Last Pint, so it appears only after explicit getting-home intent and adds one compact row to the closed 390px sheet.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, existing TfL Unified API access, existing venue-sheet CSS tokens.

## Global Constraints

- No new API key, transport provider, heavy dependency, or second TfL client.
- Departures must name their destination and stop direction where TfL supplies it.
- Distances are TfL's straight-line metres from the pub, never invented walking times.
- Predictions older than two minutes, missing a prediction timestamp, already due, or over an hour away never render.
- TfL failure or stale/empty predictions read as "couldn't check", never "no buses".
- London bus route payload is capped at four stops and three departures per stop.
- Bus UI is London-only, collapsed by default, and fetched only after the existing getting-home tab and disclosure are opened.
- No animation is added, so reduced-motion users receive the same stable layout.
- Product copy follows `docs/VOICE.md`, including British spelling and no em dash or exclamation mark.

## Latency budget

Measured behaviour, so nobody re-guesses it later:

- TfL's `StopPoint` geo query measures around 3 seconds and runs slower again from a serverless region. `app/api/last-train/route.ts` has given that same endpoint a 9 second deadline since before this feature existed, and that number is the reason: a slow-but-real response aborted early is reported to the reader as a failed check, which is a lie about TfL.
- `Arrivals` answers for one stop point at a time (a comma-joined id list is a 404, not a batch), so the capped four stops are asked concurrently and the whole fan-out is capped at 5 seconds. Each call is the cheaper of the two.

The route therefore declares a 15 second budget (`BUS_ROUTE_BUDGET_MS`, which is also its `maxDuration`) and reserves 1 second of it for its own work. Every upstream deadline is `busUpstreamTimeoutMs`: whatever is left of the budget, capped by that call's own ceiling. So the stop lookup keeps its full 9 seconds, a retry only happens with time still on the clock, and the arrivals call takes what remains. The route always reaches its own `unavailable` body and `no-store` header rather than being killed mid-call and handing the browser a platform 504. 30 seconds was rejected: a night bus card that hangs for half a minute has already failed the reader.

Two consequences of spending that much time upstream, both load-bearing:

- The clock that judges prediction freshness is read after the arrivals response, not at the top of the request. A lookup may legitimately burn six of those seconds, and TfL stamps its predictions from the later moment; measuring them against a pre-call timestamp reads our own latency as a source clock running ahead and discards working data.
- The stop lookup retries only a failure that could answer differently. `tflFetch` reports whether a failure was transient, so a 4xx costs one request rather than two.

The card does not wait that long before speaking. After `BUS_DEPARTURES_SLOW_WAIT_MS` (6 seconds) it replaces the spinner with could-not-check copy and a "Check again" control, while the request underneath keeps running: if the slow answer arrives, the card fills in. Loads never overlap, so neither the retry control nor a reopened disclosure can duplicate a request in flight.

---

### Task 1: Shared TfL request client

**Files:**
- Create: `lib/tflClient.server.ts`
- Modify: `app/api/last-train/route.ts`
- Test: `__tests__/lastTrainRoute.test.ts`

**Interfaces:**
- Produces: `tflFetch<T>(path, options?: { retries?: number; timeoutMs?: number }): Promise<TflOutcome<T>>`, which reports whether a failure was retryable, plus `tflGet<T>(...): Promise<T | null>` for callers that only need the answer.
- Preserves: HTTPS-only `api.tfl.gov.uk` allow-list, optional `TFL_APP_KEY`, timeout, retry, and User-Agent behaviour.

- [ ] **Step 1: Keep the existing off-host and failure tests as the red/green safety net**

Run:

```bash
npm test -- __tests__/lastTrainRoute.test.ts
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract the existing helper without changing behaviour**

Move `withKey`, `resolveTflUrl`, and `tflGet` from the route into `lib/tflClient.server.ts`. Replace `tflGet(path, 1)` with:

```ts
tflGet<ResponseShape>(path, { retries: 1 })
```

- [ ] **Step 3: Re-run the route contract**

Run:

```bash
npm test -- __tests__/lastTrainRoute.test.ts
```

Expected: PASS, including rejection of off-host disambiguation URLs.

### Task 2: Bounded fresh bus-departures route

**Files:**
- Create: `lib/nearbyBusDepartures.ts`
- Create: `app/api/nearby-bus-departures/route.ts`
- Create: `__tests__/nearbyBusDepartures.test.ts`

**Interfaces:**
- Produces: `NearbyBusDeparturesResult`, `NearbyBusStop`, and `NearbyBusDeparture`.
- Produces: `freshBusPredictions(predictions, now): FreshBusPrediction[]`.
- Route: `GET /api/nearby-bus-departures?lat=<number>&lng=<number>`.

- [ ] **Step 1: Write failing freshness tests**

Use literal fixtures to prove that a fresh prediction survives, a prediction over two minutes old is removed, a row without a timestamp is removed, and results sort by expected arrival.

- [ ] **Step 2: Run the pure tests and verify RED**

Run:

```bash
npm test -- __tests__/nearbyBusDepartures.test.ts
```

Expected: FAIL because `lib/nearbyBusDepartures.ts` does not exist.

- [ ] **Step 3: Implement minimal freshness and response types**

Define:

```ts
export const BUS_PREDICTION_MAX_AGE_MS = 2 * 60_000;
export const BUS_DEPARTURE_HORIZON_MS = 60 * 60_000;
```

Return only rows with valid `timestamp`, valid future `expectedArrival`, non-empty line and destination, and age inside the freshness window.

- [ ] **Step 4: Run pure tests and verify GREEN**

Run:

```bash
npm test -- __tests__/nearbyBusDepartures.test.ts
```

Expected: freshness tests PASS.

- [ ] **Step 5: Add failing route tests**

Mock one nearby-stop response and a per-stop arrivals response. Assert:

```ts
expect(body.status).toBe("ready");
expect(body.stops[0]).toMatchObject({
  distanceM: 140,
  indicator: "Stop B",
});
expect(body.stops[0].departures[0]).toMatchObject({
  lineName: "63",
  destinationName: "King's Cross",
  direction: "outbound",
});
```

Also assert `no-store`, London bounds, stale-only `unavailable`, upstream failure `unavailable`, four-stop cap, three-departure cap, and one Arrivals request per capped stop id.

- [ ] **Step 6: Run route tests and verify RED**

Run:

```bash
npm test -- __tests__/nearbyBusDepartures.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 7: Implement minimal route**

Use shared `tflFetch`, `pointInCityBounds`, and `isLastRideLimited`. Query `NaptanPublicBusCoachTram` stops within 500 metres with `modes=bus`, cap nearest stops at four, fetch each capped stop ID through its own concurrent Arrivals call, group fresh predictions by `naptanId`, and return `unavailable` when live predictions cannot be checked.

- [ ] **Step 8: Run route tests and verify GREEN**

Run:

```bash
npm test -- __tests__/nearbyBusDepartures.test.ts
```

Expected: all bus route and freshness tests PASS.

### Task 3: Subordinate venue-sheet disclosure

**Files:**
- Create: `components/map/NearbyBusDepartures.tsx`
- Create: `components/map/nearbyBusDepartures.css`
- Modify: `components/map/inspector/VenueGettingHomeTab.tsx`
- Create: `__tests__/nearbyBusDeparturesComponent.test.ts`

**Interfaces:**
- Consumes: `NearbyBusDeparturesResult`.
- Produces: `<NearbyBusDepartures lat={number} lng={number} />`.
- Placement: after `LastTrainCard`, London only, inside the already intent-gated `getting-home` tab.

- [ ] **Step 1: Write failing static-render tests**

Assert the closed component renders one 44px summary labelled "Buses nearby", no departures before opening, destination wording as `to King's Cross`, straight-line metres, and unavailable copy containing "Couldn't check".

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
npm test -- __tests__/nearbyBusDeparturesComponent.test.ts
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement lazy disclosure and presentational view**

Use native `<details>` without `open`. On first `toggle` to open, fetch the route once with an `AbortController`. Render stop name, stop letter/towards text, straight-line metres, route number, destination, and due minutes. Never render a walking-time estimate.

- [ ] **Step 4: Add compact token-based CSS**

Give summary a 44px touch floor, reuse `--line`, `--panel-raised`, `--ink`, `--muted`, and `--brass`, avoid box shadow and animation, wrap destination text, and keep every flex/grid child at `min-width: 0`.

- [ ] **Step 5: Mount only in London's getting-home tab**

Render:

```tsx
{cityId === "london" ? (
  <NearbyBusDepartures lat={venue.latitude} lng={venue.longitude} />
) : null}
```

This makes explicit getting-home intent the relevance gate and keeps daytime Overview unchanged.

- [ ] **Step 6: Run component and route tests**

Run:

```bash
npm test -- __tests__/nearbyBusDeparturesComponent.test.ts __tests__/nearbyBusDepartures.test.ts
```

Expected: PASS.

### Task 4: Closeout and mobile evidence

**Files:**
- Verify only: affected source and tests
- Do not commit: `.scratch/nearby-bus-departures/*.png`

**Interfaces:**
- Produces: committed feature branch with green repository gate.

- [ ] **Step 1: Run targeted lint and typecheck**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: PASS with no warnings.

- [ ] **Step 2: Run full project verification**

Run:

```bash
npm run verify
```

Expected: validate-data, lint, typecheck, coverage, and resilient audit PASS.

- [ ] **Step 3: Capture 390px after evidence when browser tooling works**

Open the same Black Friar venue and Last train tab at `390x844x3,mobile,touch`. Capture closed and opened bus states to absolute paths under `.scratch/nearby-bus-departures/`, then `ls` the exact paths printed by `chrome-devtools-axi`. If screenshot output remains unavailable, continue because no-mistakes gathers its own browser evidence.

- [ ] **Step 4: Run project memory guard**

Run:

```bash
/Users/karanmanoharan/karan-agent-workspace/bin/fm-ensure-agents-md.sh .
```

Expected: existing `AGENTS.md` remains valid; no new project-wide knowledge needs adding.

- [ ] **Step 5: Review diff and remove local tooling churn**

Run:

```bash
git diff --check
git status --short
```

Restore `next-env.d.ts` if Next dev rewrote it. Keep `.scratch` uncommitted.

- [ ] **Step 6: Commit**

```bash
git add app/api/nearby-bus-departures components/map/NearbyBusDepartures.tsx components/map/nearbyBusDepartures.css components/map/inspector/VenueGettingHomeTab.tsx lib/tflClient.server.ts lib/nearbyBusDepartures.ts app/api/last-train/route.ts __tests__/nearbyBusDepartures.test.ts __tests__/nearbyBusDeparturesComponent.test.ts docs/superpowers/plans/2026-07-28-nearby-bus-departures.md
git commit -m "feat: add nearby bus departures"
```

Expected: clean committed branch, ready for firstmate's no-mistakes validation and PR step.
