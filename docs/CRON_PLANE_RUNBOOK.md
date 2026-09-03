# Production cron plane - owner runbook

Vercel Cron keeps live data fresh and drains the Social text moderation queues.
Freshness jobs cover weather, all bounded What's-On lanes, permissible-source
price retrieval, Night Signal candidates, and a rotating UK city pub-enrichment
sweep. No job fabricates data or reports false success.

Area news is a committed research snapshot, not a Vercel cron lane. Refresh it
from a local checkout with `npm run refresh:area-news`. The job searches and
fetches current London pub sources through Keenable, keeps only dated facts in
the 21-day serving window, and preserves the existing archive rows. A provider
error or a run with no valid facts fails loudly and does not replace the file.
Set `KEENABLE_API_KEY` for the keyed API. Without it, the job uses Keenable's
public endpoint. Run `node scripts/build_area_news_matches.mjs` after the
refresh only when venue-match badges need rebuilding.

### Area-news investigation handoff

The snapshot stopped at 18 July because the original Lane A implementation was
a one-time editorial extraction. `docs/research/sweep-central-west.md`,
`sweep-east.md`, `sweep-north.md`, and `sweep-south.md` were compiled on 18
July from Exa search plus Firecrawl REST extraction, with WebFetch used in the
north sweep. The app loaded their reviewed facts from `data/area_news.json`,
but no repeatable acquisition command or scheduled writer existed. The July
snapshot therefore aged in place while its reader continued to serve archive
rows.

`npm run refresh:area-news` is now the repeatable July-extraction replacement:
Keenable `search_web_pages` finds candidates, `fetch_page_content` reads each
page and extracts one dated fact, and the command keeps the prior artifact when
any search or page fetch fails. It does not publish partial success.

This differs from What's-On. What's-On's official event lane refreshes durable
Supabase rows from its authenticated Vercel cron and preserves each failed
provider lane. Its broader harvested lanes still use local files and review
PRs. Area news has no durable store or server-safe file writer, so it remains a
manually run, reviewed static artifact. Its 21-day read filter is the safety
net until a successful refresh is merged.

> **Vercel owns server-safe scheduled work.** File-producing acquisition runs through
> the Mac's local launchd scheduler and review PRs; see
> [`LOCAL_REFRESH_SCHEDULER.md`](./LOCAL_REFRESH_SCHEDULER.md). One exception is
> written down rather than assumed: `.github/workflows/events-refresh.yml` carries a
> daily 04:00 UTC schedule for the What's-On events refresh, which validates its own
> output and opens a review PR. GitHub Actions is disabled at the repo level today, so
> that schedule fires nothing until the captain switches Actions on. Do not add another
> `.github/workflows/*` schedule without that decision.

---

## What runs, when

Vercel Cron invokes each route with `Authorization: Bearer $CRON_SECRET`. Crons
run on **production deployments only**. Schedules are **UTC** (Vercel Cron has no
DST awareness); the London mapping is spelled out because `vercel.json` is strict
JSON and cannot carry inline comments.

| Route | Schedule (UTC) | London (BST / GMT) | Purpose | maxDuration |
|---|---|---|---|---|
| `GET /api/cron/refresh-weather` | `0 */6 * * *` | 01:00·07:00·13:00·19:00 / 00:00·06:00·12:00·18:00 | Fetch Open-Meteo for every night area → durable `weather_snapshots` store | 60s |
| `GET /api/cron/refresh-whats-on` | `30 5 * * *` | **06:30** / 05:30 | Refresh bounded quiz, deal, music, and sport lanes plus official Ticketmaster / Skiddle events into `whats_on_listings`; readers prefer non-expired durable rows and fall back to bundled files | 60s |
| `GET /api/cron/freshness-audit` | `30 6 * * *` | 07:30 / 06:30 | Read the freshness spine, report stale feeds and unresolvable feeds as two separate findings (console only) | 30s |
| `GET /api/cron/refresh-night-signals` | `15 5 * * *` | 06:15 / 05:15 | Exa sweep for PENDING Night Signal candidates + freshness stamp — never publishes; human review still gates the feed | 60s |
| `GET /api/cron/moderate-social-posts` | `* * * * *` | Every minute | Claim and moderate up to 20 queued Social posts; posts stay held until approval | 30s |
| `GET /api/cron/moderate-social-interactions` | `* * * * *` | Every minute | Claim and moderate up to 20 queued comments or quote posts; text stays held until approval | 30s |
| `GET /api/cron/enrich-city-pubs` | `15 3 * * *` | 04:15 / 03:15 | Rotating official-page discovery for the night's primary UK city (`lib/searchProvider.server.ts` selects Exa or Tavily; `lib/tavilyPubEnrichment.server.ts` owns rotation, caps, and Bristol spillover) - structured observations to logs only; a function cannot commit repository files | 120s |

The What's-On slot is chosen to land **before London is awake**, and that is a
change: it used to run at `0 14 * * *` (15:00 BST), which is the middle of the
afternoon. The cron now writes each bounded lane to `whats_on_listings` before
morning. It does not stamp combined `feed_freshness`; the store rows carry
their own observation times and bundled files remain the fallback. `30 5 * * *`
is 06:30 in BST and 05:30 in GMT, so refreshed rows are available from first
light in both halves of the year, and the job still sits clear of the evening
read.

---

## One-time setup checklist

1. **Set `CRON_SECRET`** on the Vercel project (Production, and Preview if you
   want to test there):
   - Generate a strong random value, e.g. `openssl rand -hex 32`.
   - `vercel env add CRON_SECRET production` (or via the dashboard →
     Settings → Environment Variables).
   - Vercel automatically attaches it as the `Authorization: Bearer` header on
     cron invocations. Each route **also** re-checks it (defence in depth), so a
     direct hit to `/api/cron/*` without the secret gets `401`. **If
     `CRON_SECRET` is unset in production the routes refuse to run** (`401
     CRON_NOT_CONFIGURED`) rather than exposing an unprotected mutating endpoint.

2. **Apply migration `0047`** (`supabase/migrations/20260721130000_0047_cron_freshness_plane.sql`)
   and **migration `0119`** (`supabase/migrations/20260824120000_0119_whats_on_listings.sql`):
   - `0047` is **additive-only**: two new tables (`weather_snapshots`,
     `feed_freshness`), RLS on, service-role only, no change to any existing
     object, no functions (so no `search_path` to pin).
   - `0119` is the same shape for `whats_on_listings` (service-role only).
   - Apply loudly via the Supabase MCP or `supabase db push`, then run the
     **advisor pass** (security + performance lints).
   - **Until they land, local and Preview stores fail soft to process-memory;**
     deployed Production writes fail closed and the read side falls back to the
     committed `public/data/weather/latest.json` and `public/data/whats_on/*`
     files. Weather and all successful What's-On lanes become durable the moment
     the tables exist.

3. **Confirm the existing Supabase env** is present (already required by the app):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Local and Preview may run without
   them using process-memory only. Deployed Production requires them: otherwise
   the cron refuses the write and the read side serves the committed file.

---

## Which keys enable each job

| Job | Provider | Env key(s) | Behaviour without the key |
|---|---|---|---|
| **Weather** | Open-Meteo | **none** (keyless) | Always runs. No skip branch. |
| **Price updates** | First-party official pages / open data | **none** | Cron runs and logs an honest no-op. Freshness remains unchanged until a real source parser returns valid rows. |
| What's-On — bounded lanes | Question One plus existing first-party definitions and bundled venue inputs | **none** | Cron refreshes quiz, deal, music, and sport into `whats_on_listings`; a failed lane leaves its prior rows unchanged. Broader Exa / Firecrawl harvest remains a separate recovery path. |
| What's-On — events vertical | Ticketmaster / Skiddle | `TICKETMASTER_API_KEY`, `SKIDDLE_API_KEY` | Cron persists live rows to `whats_on_listings`. Without an official provider key, that event lane is skipped while bounded lanes can still refresh. Skiddle also needs **written commercial approval** (email dev@skiddle.com) and `SKIDDLE_BRAND_ASSET_PRESENT`. |
| **Night Signals — candidates** | Exa | `EXA_API_KEY` | Cron logs the absent key and no-op skips; candidates stay wherever the last sweep left them. |
| **Social text moderation** | OpenAI | `OPENAI_API_KEY` | Both crons answer `200 { skipped: "openai_not_configured" }` before they claim a job; queued posts, comments, and quotes stay pending. The posts cron still reads the backlog and logs its `[social-moderation][ALERT]` findings on that skip. |
| **UK city pub enrichment** | Exa through Vercel AI Gateway, with Tavily fallback (discovery only - never provenance; see `data/price_sources.json`) | `SEARCH_PROVIDER`, `AI_GATEWAY_API_KEY` or automatic Vercel OIDC, `SEARCH_GATEWAY_MAX_CALLS`, `TAVILY_API_KEY` | Defaults to Exa. Missing Gateway credentials or a failed Gateway request fall back loudly when Tavily is configured. Explicit Tavily selection requires `TAVILY_API_KEY` and does not use Exa. When the selection has no configured provider or fallback, the cron is an honest no-op. Set server-only values as Vercel secrets. |

Provider-key failures follow the table above. A missing key never produces fake
success.

---

## Human review boundaries

Vercel owns machine scheduling, not publication. Price publication stays a
manual reviewed path because a read-only serverless filesystem cannot rewrite
`public/data/price_updates/latest.json`. Vercel `refresh-prices` scheduling was
retired because its in-function parsers returned no rows. While those Vercel
parsers stay stubbed, its served envelope stays empty and its `generatedAt`
names the bundled pint collection day (2026-07-03), not a fresher-looking date
with no rows behind it. The served file is registered **episodic** with no
machine staleness budget, like reviewed `night_signals`, so the freshness audit
reads `untracked` rather than `stale` until a human publishes through
`scripts/refresh_prices.mjs`.

Night Signal candidate ingestion is separately machine-scheduled. It never
publishes reviewed `night_signals`; approved human publication remains the only
way that snapshot advances. For that reason the reviewed feed is registered as
episodic and has no machine staleness budget.

---

## Why full harvest is still out of the function

The **full** generic What's-On ingest still cannot run inside a serverless cron:

- **Broader harvest** (sport / quiz / deals / music) is aggregated by
  `scripts/refresh_whats_on.mjs` **from pre-scraped agent outputs on disk**.
  There is no general scraper agent inside a Vercel function, and the output is
  a committed file the **read-only serverless filesystem cannot write**.
- The cron does run bounded replacements for those lanes: Question One pages
  for quiz, and existing first-party definitions plus bundled venue inputs for
  deal, music, and sport. These rows are written to `whats_on_listings`.
- The GitHub events-refresh workflow writes the same committed file. Keep it
  in the tree so it can resume when Actions billing returns. It is not the
  live path; Vercel Cron is the reliable refresh path.

The events vertical **does** run in this function: Ticketmaster and Skiddle
already have an in-function provider (`lib/events/liveProvider.ts`). The cron
writes those rows to `whats_on_listings` (migration `0119`). Readers prefer
that store and fall back to bundled `public/data/whats_on` files. The cron does
not stamp combined `feed_freshness`; each durable row carries its own observed
time.

Broader harvested inputs still need disk agents. Local launchd acquisition is
documented in [`LOCAL_REFRESH_SCHEDULER.md`](./LOCAL_REFRESH_SCHEDULER.md).

---

## TfL disruption needs NO cron

`lib/tflDisruption.ts` (route `/api/tfl-disruption`) is **live-per-request with a
5-minute server-side revalidate** (Next data cache). It fetches TfL Line Status,
filters to material disruptions overlapping tonight, and renders nothing when
clear. There is **no disk artifact to age** and nothing to schedule — a cron
would only duplicate the live path. Same for `/api/last-train` and friends
(keyless, live). Do not add a cron for these.

---

## Verifying a cron ran

- **Vercel dashboard → Project → Cron Jobs**: each job lists its last run,
  status, and duration. A `200` with `{ ok: true, ... }` body is success.
- **Logs**: filter Runtime Logs for the tags
  `[cron:refresh-weather]`, `[cron:refresh-whats-on]`,
  `[cron:refresh-prices]`, `[cron:freshness-audit]`,
  `[cron:refresh-night-signals]`, `[cron:enrich-city-pubs]`.
  - Weather success: `wrote N observations at <iso> (skipped M)`.
  - What's-On success: `persisted N rows at <iso>` with per-kind counts in
    the response.
  - Price no-op: `fetched no rows; freshness unchanged`.
  - Price success: `retrieved N valid row(s), observed at <iso>`.
  - Audit: `all tracked feeds within budget.`, or one or both of two DIFFERENT
    alerts. `N feed(s) breaching freshness budget` means the data is old and a
    refresh job owes us a run. `N feed(s) whose age could not be determined`
    means the audit could not read the artifact at all and says nothing about
    whether the data is good; each line names the artifact and how it failed.
    A run of unresolvable feeds usually means the function shipped without its
    data files, so check `outputFileTracingIncludes` in `next.config.mjs` before
    suspecting the feeds.
  - Night Signals success: `swept N pending candidate(s) at <iso>`.
  - Social moderation success: each moderation route reports `processed`,
    `approved`, `needsReview`, `retried`, and `terminalErrors` counts.
  - City enrichment success: a `[city-enrichment]` JSON line with
    `primaryCity`, per-city `cityRuns`, cursor, selected provider,
    queries/credits spent, Gateway calls, Gateway model, estimated tokens,
    matched pubs, and extracted prices. The HTTP body mirrors `primaryCity` and
    `cityRuns`. On Bristol rotation nights the route may answer `200 { ok: true
    }` even when Bristol's own run failed, as long as spillover cities
    enriched. The Gateway fields are the per-run spend record. Exa search calls
    through AI Gateway are free through 31 August 2026, but `openai/gpt-5-nano`
    model tokens are still billed. The call guard stops before a run exceeds
    `SEARCH_GATEWAY_MAX_CALLS`.
- **Manual trigger** (with the secret):
  ```bash
  curl -sS -H "Authorization: Bearer $CRON_SECRET" \
    https://<prod-domain>/api/cron/refresh-weather | jq
  ```
  Without the header (or with a wrong secret) you get `401` — that is the gate
  working.
- **End-to-end**: after a weather run, `GET /api/freshness` should show the
  `weather` dataset's `observedAt` advance to the store stamp (not the committed
  file's), and `/api/tonight-conditions` serves the fresher reading store-first.

---

## Failure posture (never fake success)

- Weather provider total outage → **`502`**, nothing written.
- Weather payload fails the contract per area → that area is **skipped** and
  reported in `skipped[]`; the surviving areas are still written.
- Durable weather write hard-fails → **`503 STORE_UNAVAILABLE`**, nothing faked.
- Price retrieval returns no valid rows → **`200`**, explicit no-op log, prior
  freshness stamp untouched.
- Price provider failure → **`502 PROVIDER_UNAVAILABLE`**, prior freshness
  stamp untouched.
- What's-On official-provider refresh fails → **`200`** with `ok:false`,
  `providers`, `stamped:false`, and `observedAt:null`; that provider's prior
  rows remain unchanged, while successful bounded lanes may advance. If a later
  durable write fails after an earlier kind was replaced, `written` reports the
  rows already committed and `observedAt` reports that partial run; the route
  still keeps `stamped:false` because the whole refresh did not succeed.
- No official provider is configured → the event lane is skipped; bounded
  lanes may still produce an overall successful refresh.
- A bounded lane fails → its prior rows remain unchanged; other lanes may
  advance, and the combined response reports `ok:false`.
- Freshness audit → **never 500s**; a broken artifact surfaces as that dataset's
  own `unknown` status. Alerting is **console-only** today
  (`lib/freshnessNotify.ts` is the seam a later push/alert integration hangs
  off; push delivery is a separate lane and this plane sends none).
- Social moderation provider failures keep posts, comments, and quotes held.
  Retryable failures use bounded backoff; terminal failures require an
  authenticated requeue action.
- Missing `OPENAI_API_KEY` returns **`200 { skipped: "openai_not_configured" }`**
  before any queued job is claimed. An absent key is a configuration fact, not a
  failed drain. The posts cron still inspects the backlog and emits its findings
  on that path, so a growing pending queue is never silent. A store failure is
  the separate **503 `UNAVAILABLE`** answer, with the cause logged.
- A drain that claimed nothing names why, and the two crons word it apart
  because only one of them can tell. The posts cron answers **`200 { skipped:
  "queue_empty" }`** and only when the backlog read agrees `pending` is 0. The
  interactions cron has no backlog inspector, so it answers **`200 { skipped:
  "no_jobs_claimed" }`**: nothing was leased, which covers an empty queue and
  jobs held in backoff or out of retries alike. Neither word may be read as
  "there is nothing to review".
- City enrichment provider failure on a **non-Bristol primary night** →
  **`502 PROVIDER_UNAVAILABLE`** with a `[city-enrichment][ALERT]` log; any
  partial batch already processed is logged as a `[partial]` line (progress
  observations stream per pub, so a mid-batch failure never loses what was
  found).
- City enrichment on a **Bristol primary night** splits the nightly
  `SEARCH_CRON_QUERY_CAP` (25): Bristol runs under `BRISTOL_CRON_QUERY_CAP`
  (8) and `BRISTOL_CRON_WALL_MS` (45s), then spillover cities share the
  remaining budget. A Bristol timeout or upstream 504 is isolated to that
  city's `cityRuns` entry; spillover cities still enrich and the route stays
  **`200 { ok: true }`** without an `[ALERT]`. One city failure stays one city.
