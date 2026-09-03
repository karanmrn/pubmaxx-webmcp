# Performance budgets

Speed is the promise this product makes. A promise nobody counts is a wish, so
every budgeted route has a number, the number is tracked in the repository, and
CI refuses a change that goes past it.

- The ceilings: [`perf/route-budgets.json`](../perf/route-budgets.json)
- The rules and the failure table: [`lib/performanceBudgets.ts`](../lib/performanceBudgets.ts)
- The measuring: [`e2e/performance-budget.spec.ts`](../e2e/performance-budget.spec.ts)
- The method both perf specs share: [`e2e/helpers/perfMeasurement.ts`](../e2e/helpers/perfMeasurement.ts)
- The UX lane report: [`e2e/ux-lane-perf-verification.spec.ts`](../e2e/ux-lane-perf-verification.spec.ts). Four arrival routes (`/`, `/near`, `/map/london`, `/out`) with LCP and CLS beside decoded JS, written as a markdown table for the PR body. It REPORTS: a route over a ceiling here is a warning, and the only failure is a route it could not measure at all
- The gate: the `performance-budget` job in `.github/workflows/ci.yml`; the UX lane report is its own `ux-lane-performance` job, because one 15-minute wall cannot hold two full sweeps
- The API gate: the `api-latency-budget` job in `.github/workflows/api-performance.yml` probes a successful main deployment

## What each metric means

| Metric | What it is | Why this one |
| --- | --- | --- |
| `serverRenderMs` | `responseStart - requestStart` on the document's own navigation entry | Over loopback there is no network in that figure, so it is the part of a production TTFB the code owns. |
| `jsDecodedKB` | Decoded bytes of every same-origin script the route asked for before it was interactive | Decoded, not transferred, because parse time is what a phone feels. |
| `requests` | Same-origin requests to the same point, the document included | A route can hold its bytes and still lose the night to a waterfall. |
| `lcpMs` | The largest contentful paint the SAME run observed, from a buffered `PerformanceObserver` | The three above are levers; this is the one a drinker feels, and a route can hold every lever and still paint late. |

## Where the LCP ceilings came from

Seeded on 2026-09-01 from three production runs per route over the real network
rather than loopback. Those seed runs used 390x844 at DPR 3. The enforced sweep
uses Desktop Chrome at device pixel ratio 1 with the same CSS viewport, 4x CPU
throttle, and cross-origin requests refused, so seed figures are indicative of
their origin rather than reproductions of CI's method. Medians:

| route | measured LCP | seeded ceiling |
| --- | --- | --- |
| `/` | 296 ms | 1500 ms |
| `/pal` | 792 ms | 1500 ms |
| `/map` | 1196 ms | 2500 ms |
| `/today` | 720 ms | 2500 ms |
| `/tonight` | 784 ms | 2500 ms |
| `/out` | 900 ms | 2500 ms |
| `/about` | 320 ms | 2500 ms |
| `/pubs` | 372 ms | 2500 ms |

The ceilings are deliberately looser than the measurements. A seed taken on one
box against production is not the sweep, and a first ceiling that fails CI on
the day it lands teaches nothing. `/` and `/pal` take the speed programme's own
1500 ms target because they are the front door and its one primary action;
every other route takes 2500 ms, the Core Web Vitals good boundary, so no route
may be worse than good. Ratcheting them to CI's measured numbers is the same
down-only move every other ceiling here makes.

`/pal` joins the file with them. It was the heaviest unbudgeted route in the
seed sweep at 1745 KB decoded, and an unbudgeted route is one nothing can
regress.

Production RUM corroborates the lab figure independently: `onLCP` already
reports through `lib/webVitals.ts` and the consent-gated `web_vital` event
(`components/PerformanceVitals.tsx`), rounded and route-patterned, carrying no
identifier.

## What each route actually parses

Swept on 2026-09-01 against production at 390x844, by fetching every same-origin
script the route loaded and reading the four heavy libraries out of the text.
Decoded KB, so parse cost rather than transfer:

| route | total | MapLibre | Convex | ElevenLabs | Supabase |
| --- | --- | --- | --- | --- | --- |
| `/` | 1143 | 0 | 0 | 0 | ~341 |
| `/pal` | 1745 | 0 | 0 | 603 | ~341 |
| `/map` | 2599 | 1024 | 0 | 0 | ~341 |
| `/today` | 1180 | 0 | 0 | 0 | ~341 |
| `/tonight` | 1175 | 0 | 0 | 0 | ~341 |
| `/out` | 1129 | 0 | 0 | 0 | ~341 |
| `/about` | 1081 | 0 | 0 | 0 | ~341 |
| `/pubs` | 1092 | 0 | 0 | 0 | ~341 |

Three things this settles.

MapLibre is on `/map` and nowhere else, and Supabase is on every route as the
same ~341 KB lazily fetched after paint by `ensureSupabaseBrowser`. Entry-point
isolation is already correct for both.

`/about` and `/pubs` were carrying 1900 and 1950 KB ceilings against 1081 and
1092 KB measured. There was no accidental import to split: no MapLibre, no
Convex, no voice SDK, no image cropper in any of their 24 and 25 chunks. They
were 800 KB of unbanked slack, which is the shape #1296 named, so both ceilings
ratchet to 1200.

Their REQUEST ceilings are left alone. A seed run counts requests against its
own interactive moment on a different box and network: this sweep counted 62 on
`/` where CI is green at 50, so a request figure measured here is not
comparable. Decoded bytes are, which is why only those ratcheted.

## Which API reads may sit at the edge

A shared cache holds ONE answer for everybody, so only a route whose answer is
the same for everybody may ask for one. The bar is narrower than "is it
public": the body has to be a pure function of the request URL and the
deployment. A session, a caller's identity, a store read that can change
between two requests, or a URL that can carry the viewer's own coordinates all
disqualify it.

| class | contract | verdict |
| --- | --- | --- |
| Night Areas (list and slug) | Bundled config; changes only on deploy | Cached (`jsonCached`) |
| Tonight conditions | Public and read-only, but its URL carries `lat`/`lng` | No-store, deliberately |
| What's-On | Bundled rows plus a live layer, and it accepts `near=lat,lng` | No-store, escalated |
| Everything actor-gated | Answer differs per caller | No-store, by law |

`__tests__/sharedCacheHonesty.test.ts` is the fence. It sweeps every route file
and fails when a shared-cache header sits beside a per-caller read or a viewer
point.

It first flagged two routes that ship one from a file mentioning
`coarsenViewerPoint`. The captain's ruling of 2026-09-01 set the invariant: no
UN-COARSENED viewer point may ever appear in a URL or a shared cache key, and a
bucket many people share by construction may. Traced against it, both are on the
right side.

`/api/tfl-disruption` is case one. Both callers, `DisruptionLine` and
`TodayTubeCard`, run `coarsenViewerPoint` BEFORE they build the URL, so the key
holds only bucket values and the route's own call is a defensive second pass for
a direct caller. The bucket is three decimal places, roughly a 70 to 110 metre
cell: in the London this strip serves that is a city block holding many people,
and the answer is a whole transport patch, coarser again than the cell that
selected it. The cache stays.

`/api/citymcp/journey` was never a viewer-point cache. Its cacheable GET carries
venue-to-venue coordinates, which are public map data; a journey that starts
where the reader stands goes by POST with `cache: no-store`, which
`useVenueJourney` says in its own comment.

Both stay named in the fence with the reason that ruled them, and the list may
only shrink. The fence now checks the invariant rather than trusting it: every
caller must coarsen above the line that builds the URL, and the viewer-origin
journey must stay on POST.

## The API latency budgets

`perf/api-budgets.json` is the same discipline one layer down: what the public
GETs the map, Today and Out spend on arrival may make a reader wait for. A page
can hold every byte budget it has and still lose the night because the read
behind it took a second.

Six reads are budgeted on p50 and p95, measured as time to the first byte of
the body. `lib/apiBudgets.mjs` owns the runtime rules and
`lib/apiBudgets.ts` supplies the application types; `scripts/probe-api-budgets.mjs`
only measures, so the verdict is unit-tested without a network:

```
node scripts/probe-api-budgets.mjs --base-url https://<deployment>.vercel.app
```

Seeded on 2026-09-01 from eight production samples per route, timed as curl's
`time_starttransfer`, which includes this machine's round trip and a cold
invocation in the first sample. The ceilings are looser again than the seed for
that reason, and the same down-only rule applies to them as to the page
budgets. A route the probe could not measure fails: a budget nothing checked is
not a budget, and an error page is not a fast read.

## Banking the slack

Slack does not stay slack. #1296 is the record of what happens otherwise: a
ceiling set generously, a route that quietly grows back into it, and nobody
able to say when.

So the sweep prints a second table. Any route that beats a ceiling by more than
15% is named as a ratchet candidate, with what it measured and how far under it
sat. A sweep where every ceiling is snug prints nothing, so a quiet run stays
quiet.

It is a WARNING and only a warning. It edits no file and fails no build:
`lib/performanceBudgets.ts` touches the filesystem at all only to read the
ceilings, and `__tests__/lcpBudget.test.ts` holds it to that. A ceiling comes
down because a person decided it should, with the measurement in front of them,
which is the same rule the budget file's own note states.

An unmeasured route is never a candidate. That route is a BREACH, and the
breach table already says so.

## How a run is taken

Against the production build in Desktop Chrome at device pixel ratio 1, with a
CSS viewport of 390x844, a 4x CPU throttle, and every cross-origin request
refused, so a run measures what we ship and never a tile server's morning. Each
route gets a warm-up load whose request lifecycle must fully drain before
measurement, then the median of three measured runs. A network that does not
drain within 20 seconds fails the run.

Counting stops at an APP-DEFINED moment, not a wall clock: the route's own
readiness gate, no earlier than the window load event. A resource counts if it
started before that moment; the run then waits for the network to go quiet so
every counted entry carries its final size.

That distinction is the difference between a gate and a coin toss. `networkidle`
catches or misses the post-paint background warmup
(`lib/backgroundWarmup.ts`, which loads the OTHER tab destinations on purpose)
depending on how fast the box is: the first CI run of this spec measured
`/today` at 2726 KB and the retry at 1186 KB, on one build. Under the current
anchor three consecutive local runs agree byte for byte, and CI agrees with
them to within about 4 KB.

Run it locally the same way CI does:

```
PUBMAX_PERF_BUDGET=1 npx playwright test e2e/performance-budget.spec.ts --project=chromium --workers=1
```

A failing run prints one row per breach: route, metric, measured, budget, and
how far past the ceiling it went.

## Changing a number

A budget is a ratchet. Take one DOWN whenever the measured figure has been
comfortably below it for a while: that is the point of the exercise.

Take one UP only deliberately, in the same commit as the change that needs it,
with the reason in the commit message and the new figure measured rather than
guessed. A budget raised to make a red build green is not a budget.

Adding a route is cheap: one entry with a `readySelector` the route really
renders and one sentence of `why`. Removing one needs a reason, because an
unmeasured route reads as a pass and never fails again.

## The pin-ready record on /map

`/map` carries one extra tracked block, `pinReady`. It is NOT one of the four
budgeted metrics: `lib/performanceBudgets.ts` never reads it, so nothing here
fails a build. It is the RECORD of the map's own arrival promise - a cold phone
visit must reach tappable pins - kept beside the route it describes so the
figure and the ceiling live in one place.

| Field | What it is |
| --- | --- |
| `path` | The document measured. `/map/london` is the per-request city route, not the CDN-cached `/map`. |
| `targetMs` | The CEILING. A cold visit must reach painted, tappable pins inside it. |
| `measuredMs` | The last RECORDED figure, not a second ceiling. It is a note of where we stood. |
| `signal` | What was waited for: painted pins the collision index kept, off `components/map/canvas/paintedPinProbe.ts`. |
| `viewport` | The phone the promise is made to. |
| `note` | How the figure was taken, in one sentence. |

The pin-ready test in `e2e/mobile-map-chrome-fit.spec.ts` opens the route cold,
waits up to sixty seconds on the painted-pin probe, and always records
`pinReadyMs` as a Playwright annotation. That proves pins paint on every run.

The `targetMs` ceiling is enforced only when `PUBMAX_PIN_SLA_ENFORCE=1` is set
(GPU or real-device runs). That one variable does BOTH halves: it arms the
ceiling AND drops the spec's `--use-angle=swiftshader` launch override, so the
enforced run measures the machine's own renderer. Stock CI keeps SwiftShader
software rendering, which routinely exceeds five seconds even when pins do
paint; failing that build on the ceiling would be noise, not a product
regression. Set the variable only on a box with a real GPU - a software
fallback under an armed ceiling fails for the reason the gate exists to
excuse.

Nothing enforces `measuredMs`: re-measure it by running that spec against a
production build and reading the `pinReadyMs` annotation, then update it in the
same commit as the change that moved it. Take `targetMs` DOWN under the ratchet
rule above; raising it is raising the promise, which is a captain decision
rather than a number to edit.

## The second navigation

The budgeted numbers above are about ARRIVING. They say nothing about the
navigation a drinker does far more often: tapping between tabs inside a session
that is already open. That one has its own shape, and it had its own defect.

Method, and it is deliberately not the budget spec's: one phone profile
(390x844, 4x CPU throttle, 10 Mbps at 40 ms RTT, cross-origin refused), a lap
around the bottom nav, and the clock started on the tap itself with `pointerdown`
fired immediately before the click, so intent-warm gets no head start a fast
thumb would not give it. A switch has ARRIVED when the destination route's own
root element is in the DOM and the browser has painted twice. For `/map` that
root is the map screen, not the pins: the WebGL init that follows is the map's
own cold-start lane. COLD is the first landing on a route in the session; WARM is
every later one. Both arms of a comparison run alternating in one process so
machine drift lands on both, and the first two laps are dropped as the server's
own warm-up - the same rule `warmupRuns` states above.

Measured on 2026-08-09, before and after the client-cache work:

| Tab switch | p50 before | p50 after | p95 before | p95 after |
| --- | --- | --- | --- | --- |
| Today, warm | 314 ms | 46 ms | 328 ms | 60 ms |
| Tonight, warm | 317 ms | 35 ms | 319 ms | 39 ms |
| You, warm | 314 ms | 30 ms | 316 ms | 44 ms |
| Map, warm | 31 ms | 32 ms | 49 ms | 66 ms |
| Tonight, cold | 327 ms | 329 ms | 334 ms | 334 ms |
| Social, cold | 328 ms | 329 ms | 330 ms | 331 ms |
| You, cold | 330 ms | 326 ms | 332 ms | 348 ms |
| Map, cold | 401 ms | 395 ms | 409 ms | 414 ms |

Read it as one finding: a warm switch was a flat ~314 ms because it was a full
RSC round trip and a fresh server render for a document the browser was still
holding, and it is now the remount alone. A COLD switch is unchanged, which is
the right answer - there was nothing held to reuse. The map was already instant
in both arms because its document is one of the two the CDN holds.

The seams:

- **`experimental.staleTimes` in `next.config.mjs`** is the window. It is safe
  only because no page server-renders per-account content and nothing calls
  `router.refresh()`; `__tests__/clientRouterCache.test.ts` fences both.
  `/admin` is the one argued exception to the first invariant, named in that
  fence as `PER_SESSION_SERVER_PAGES`: it server-renders the console or a 401
  token form off the caller's own credential, nothing links to it, and every
  `/api/admin` read re-gates. A second exception re-derives the whole window
  rather than adding a list entry.
- **`lib/surfaceDataCache.ts`** is the data half: one browser-only
  stale-while-revalidate store, so a return paints its last answer and refreshes
  behind it. It refuses auth and identity keys outright and empties at an
  account boundary. On the same lap set, Tonight's LISTINGS - not just its shell
  - reached the screen on a return in 197 ms p50 / 344 ms p95, from 417 / 660.
- **`components/nav/IntentLink.tsx`** warms a dynamic destination on intent
  instead of prefetching it on sight. A Tonight arrival used to fire about twenty
  `/plan?occasion=…` and `/pal/chat?ask=…` server renders in front of the
  listings it was still fetching.

Keeping tabs MOUNTED instead - parallel-route slots rather than navigations -
was considered and rejected on the same numbers. The remount is what is left of
a warm switch, and it now measures 30-46 ms; against that, every other page
would carry the map's tree, its effects and a live WebGL context all session.
The JS heap over one lap reads 8.8 MB on arrival at `/today` and 15.8 MB after
visiting every tab, of which the map step alone is +3.3 MB. Route JS is retained
once loaded either way, so persistence would buy back tens of milliseconds and
charge the heaviest route to every surface.

## What holds the numbers up

These are the seams a regression usually comes through. Each carries the reason
in its own file:

- **Two documents are prerendered; every other route is dynamic.** The
  per-request CSP nonce (`proxy.ts`) rules out static generation, ISR and PPR,
  so a nonce'd page view is a function invocation with no CDN copy to serve
  instead. That was the single largest cost in the production figures, and it
  is a policy decision rather than an implementation detail: on 2026-08-09 the
  captain took the exception named in `CDN_CACHED_DOCUMENT_PATHS`, so `/` and
  `/map` drop the nonce, prerender, and are held by the CDN. Both are public
  and anonymous, and their documents are asserted to name nobody. Every other
  route - identity, social, profile, admin, every API - keeps the nonce and
  keeps paying the invocation.
- **A prerendered document reads nothing per request.** `force-static` on those
  two pages turns a per-request read into a build error rather than a silent
  fall back to dynamic rendering, and it is also what stops the root layout's
  nonce read (`headers()`) from pulling them back. A `/map` request whose
  document really does differ - a town arrival, national browse, a curated
  share card - is rewritten to `app/map/arrival` and rendered per request with
  the nonce intact; `lib/mapDocumentTwin.ts` owns that split, and widening its
  key list takes those requests off the CDN.
- **Bundled data is read once per instance, never once per request.**
  `lib/aboutStats.ts` and `lib/venuePriceIndex.ts` memoize; the price dataset is
  6.7 MB of JSON and parsing it per request is the difference between a fast
  landing and a slow one.
- **No third party is on a render path without a deadline.**
  `WEATHER_TOP_UP_RENDER_DEADLINE_MS` in `lib/weatherFreshness.server.ts` bounds
  the live weather top-up; past it the reader gets the cached reading with its
  honest staleness line and the top-up finishes in the background.
- **No share card lives at the root segment.** Next folds a segment's
  `opengraph-image` into a metadata module that every descendant page's server
  function carries, and at the root that is every page on the site. A
  `import()` inside the handler does not help, because the tracer follows it.
  The homepage card is therefore a route (`app/api/home-card/route.tsx`) named
  by the homepage's own metadata. A card that only some subtree pays for may
  stay a file convention.
- **The map's eager JS has its own older fence**,
  `e2e/map-perf-budget.spec.ts`, kept because it states the map-specific
  regression cliff the audit measured.
