# London harvest

A Firecrawl-backed refresh that keeps London pub data fresh from **first-party
pages only**. Two halves that share one set of parsers:

| Half | Command | Writes |
|---|---|---|
| Durable pass | `npm run harvest:run` | the What's-On files, the pub-facts artifact, the run report |
| Scheduled pass | `GET /api/cron/harvest-refresh` (weekly, `vercel.json`) | nothing; it reports to the function log |

A Vercel function's file system is read only, so the scheduled pass cannot commit
a file. What it buys is **noticing**: it runs the same fetchers over the same
pages every week and reports what each one stated. `/api/cron/enrich-city-pubs`
already splits this way; the harvest follows it.

## The rules

- **First party is the default.** An operator's own page, or the venue's own
  site. Every ticketing aggregator in the source table is refused, each on its
  own recorded rule. A source that does not own what it publishes is read only
  as a named exception that states what it may take: `common-social-posts` is
  the one today (facts plus a link out, read by
  `scripts/whatson/commonRefresh.mjs`), and the fence refuses any allowed
  non-first-party source without a `nonFirstPartyException`.
- **A page that does not state a thing yields no row.** A deal with a weekday
  and no window is a recorded drop, not an invented 11:30 to 23:00. Greene King
  emitting zero rows is the pipeline working.
- **Provenance on every row**: `source: { label, url }` plus `observedAt`.
- **A skip is a finding.** Empty, skipped and failed are three outcomes with
  three names, so a quiet source is never mistaken for a quiet city.
- **Fail closed.** No `FIRECRAWL_API_KEY`, no requests and no files written.
- **A lane that harvested nothing never overwrites its file.** A good file beats
  a fresh empty one.

## Where each rule lives

| Question | File |
|---|---|
| May we read this source, and on whose say-so? | `lib/harvest/sourcePolicy.ts` |
| Key, retries, and the per-run request budget | `lib/harvest/firecrawl.ts` |
| What makes a chain offer a deal day | `lib/harvest/chainDeals.ts` |
| What makes a venue listing an event | `lib/harvest/venueEvents.ts` |
| Which stated facts a venue page yields | `lib/harvest/pubFacts.ts` |
| The shape of a run report | `lib/harvest/runReport.ts` |
| The bounded batch the cron runs | `lib/harvestRefresh.server.ts` |
| The durable pass | `scripts/harvest/run.mjs` |
| Context.dev web reads (events lane) | `lib/contextDev.ts` (app door: `lib/contextDev.server.ts`) |
| Context.dev registered events harvest | `lib/events/contextDevProvider.ts` |

## Context.dev (events lane)

The What's-On events refresh (`scripts/whatson/eventsRefresh.mjs`) may read
**registered venue-events pages** from `lib/harvest/sourcePolicy.ts` through
Context.dev when `CONTEXT_DEV_API_KEY` is set server-side. The wrapper is
`lib/contextDev.server.ts` (`scrapeMarkdown`, `extract`); the lane is
`lib/events/contextDevProvider.ts`.

Both are imported by a plain-`node` CLI, so two rules hold in that pair.
`lib/contextDev.ts` carries the implementation and NO `server-only` marker, for
the reason `lib/harvest/firecrawl.ts` carries none: the marker package throws on
import outside a React Server Component. `lib/contextDev.server.ts` re-exports
it behind that marker, and app code imports THAT. Every specifier inside the
lane is relative and carries its extension, because Node strips TypeScript types
but resolves no tsconfig `@/*` alias. A dynamic import of the lane hid both
faults inside its own catch and reported an upstream failure every run.

| Endpoint | Credits | Docs |
|---|---|---|
| `GET /web/scrape/markdown` | 1 | https://docs.context.dev/api-reference/web-scraping/markdown |
| `POST /web/extract` | 10 | https://docs.context.dev/api-reference/web-extraction/extract |

Base URL: `https://api.context.dev/v1`. Auth: `Authorization: Bearer
$CONTEXT_DEV_API_KEY` (never in a client bundle). On 429 honour `Retry-After`,
but only up to `CONTEXT_DEV_MAX_RETRY_AFTER_MS` (30 s): the wait sits between
requests, so no request timeout bounds it, and a provider asking for an hour
would park a scheduled run rather than let the next one act on the rate limit.
Past that ceiling the call stops and its message says so. Retry 408/5xx with
bounded backoff; never retry validation errors; pass `maxAgeMs` when freshness
matters. Without a key every call answers `not-configured` and sends nothing.

The lane spends ONE `createContextDevBudget()` for the whole run, shared by
every source and counting retries, so a retry storm spends the run rather than
the account. `CONTEXT_DEV_RUN_REQUEST_BUDGET` is 12 requests, which at the table
above is at most 120 credits. A request reserved past the cap sends nothing, and
it answers one of TWO ways. A ceiling reached before this call sent anything is
the whole finding, so it answers `BUDGET_EXHAUSTED`. A ceiling reached between
retries is not: the upstream failure that caused the retry is the actionable
one, so the answer keeps that failure's own code and status (a 503 stays
`PROVIDER_UNAVAILABLE`) and the spent budget rides in the message as the reason
no further attempt was made.

Which sources the lane may read is `contextDevEventSources()`, and the bar is
FIRST PARTY: an extract call hands a whole page to a model, so it cannot honour
the narrow `nonFirstPartyException` an allowed listings source carries.

Proof (captain): with the key in `.env.local`:

```bash
set -a && source .env.local && set +a
npx vitest run __tests__/contextDevLiveProof.test.ts --disableConsoleIntercept
```

The test skips when `CONTEXT_DEV_API_KEY` is unset. It prints a trimmed JSON
preview to the console for PR bodies, and `--disableConsoleIntercept` is what
hands that preview through unreformatted.

## The budget

`HARVEST_CRON_REQUEST_BUDGET` (12) and `HARVEST_CLI_REQUEST_BUDGET` (120) in
`lib/harvest/firecrawl.ts` cap how many requests one run may send. The budget
counts **every request, retries included**, so a retry storm spends the run's
budget rather than the account. Past the cap a scrape resolves
`budget-exhausted` without sending, which the report records as a skip: the run
covered less, it did not break.

## Running it

```bash
npm run harvest:run                    # deals only, the cheap high-yield lane
npm run harvest:run -- --all           # deals, events and pub facts
npm run harvest:run -- --all --dry-run # print what would be written
npm run harvest:run -- --events --venue-limit 40 --budget 120
```

`--fresh` bypasses Firecrawl's index copy. The run report always lands at
`data/harvest/last_run.json`; `--dry-run` prints instead of writing.

`FIRECRAWL_API_KEY` comes from `.env.local` (Vercel production already has it).

## What a source that reads whole documents is for

Two lanes deliberately scrape with `onlyMainContent: false`:

- a venue **home page**, because its what's-on link lives in the nav;
- an **operator page**, because opening hours live in the footer.

The listings page itself is read main-content only, where the listings are.

## Adding a source

Add it to `HARVEST_SOURCES` with its access decision, the rule behind that
decision, and the day the rule was checked. Nothing else takes a URL from a
caller, so a source absent from that table is not harvested at all. A source
that publishes what somebody else owns also needs `nonFirstPartyException`,
naming what the reader may take and what it may not.

Check `robots.txt` before adding one, and treat an unreadable `robots.txt` as a
refusal: several Mitchells & Butlers brands answer theirs with a challenge page,
so no permission can be read, and a page we cannot ask about is a page we do not
take. Watch for `User-agent: CloudflareBrowserRenderingCrawler`, which is the
headless-renderer class this harvest belongs to - a site may admit ordinary
crawlers and still refuse it.

## Pins

`__tests__/harvestFirecrawlClient.test.ts` (fail closed, budget, retries),
`__tests__/contextDev.server.test.ts` and `__tests__/contextDevProvider.test.ts`
(Context.dev wrapper and events lane),
`__tests__/harvestRows.test.ts` (what earns a row, provenance),
`__tests__/harvestSourcePolicy.test.ts` (the source table and the report),
`__tests__/cronHarvestRefreshRoute.test.ts` (auth, keyless run, budget ceiling).
