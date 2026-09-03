# Data-freshness burndown — root cause and owner actions (2026-07-24)

> **Update 2026-08-20 (does not rewrite the report below).** `price_updates` is
> now registered **episodic** with **no machine staleness budget**, like reviewed
> `night_signals`. The served `latest.json` envelope stays empty while parsers
> are stubbed, and its `generatedAt` names the bundled pint collection day
> (2026-07-03) so public surfaces and the audit stay honest. The freshness audit
> no longer treats that empty baseline as a 336 h breach. Current policy lives in
> [`data/freshness_registry.json`](../data/freshness_registry.json) and
> [`docs/WAYFINDER_LIVE_DATA.md`](./WAYFINDER_LIVE_DATA.md).
>
> **Update 2026-07-27 (does not rewrite the report below).** The two GitHub
> Actions named in this report — "Price refresh" (Mon 07:00) and "Night Signal
> refresh" (daily 08:15) — have been **deleted**. Price retrieval moved onto the
> Vercel cron plane as `GET /api/cron/refresh-prices` (Mon 07:00 UTC), which
> stamps the new artifact-less `price_update_retrieval` feed only after valid
> rows are retrieved; the served `price_updates` file still advances only on a
> reviewed publish (see the 2026-08-20 update above for current audit class).
> `night_signals` is now registered as **episodic with no staleness budget**
> (was 48h): it is human-gated, so a machine budget was claiming a cadence that
> never existed. Its separate candidate ingestion stays scheduled on Vercel
> (`/api/cron/refresh-night-signals`). Read the mechanism column below as
> historical. See `docs/CRON_PLANE_RUNBOOK.md` for the live plane.

Four datasets exceed their staleness budgets. This documents the root cause per
dataset, what is fixed in-repo, and what the **owner must do** (external blockers
this repo cannot fix).

Staleness is measured by `scripts/check_freshness.mjs` against each artifact's
committed on-disk stamp (`data/freshness_registry.json`). Confirmed today:

| Dataset | Committed stamp | Age | Budget | Refresh mechanism |
|---|---|---:|---:|---|
| `price_updates` | 2026-07-06 | ~441h | 336h | GitHub Action "Price refresh" (Mon 07:00) |
| `whats_on` | 2026-07-11 | ~321h | 48h | Vercel cron `/api/cron/refresh-whats-on` (daily) |
| `night_signals` | 2026-07-16 | ~201h | 48h | GitHub Action "Night Signal refresh" (daily 08:15) |
| `weather` | 2026-07-18 | ~131h | 48h | Vercel cron `/api/cron/refresh-weather` (every 6h) |

The two file-measured feeds with no working scheduler, `price_updates` and
`night_signals`, are still open as **issue #635**; their ages have grown since
the table above, and the owner actions below are unchanged.

## Root cause per dataset

- **`price_updates` — pipeline is a deliberate no-op.** `fetchFromSource` is
  STUBBED (returns `[]`); every "Price refresh" run writes zero rows, so the
  committed file never advances. This is documented in the registry `gate`. It is
  not a broken schedule — it is an unbuilt per-source parser. **Owner action:**
  build real first-party price parsers (product work), or accept the episodic
  manual cadence and raise the budget.

- **`whats_on` — store-backed refresh + retired GitHub job + read-only FS.** The
  Vercel cron revalidates the servable tonight window into the durable
  `feed_freshness` store; it CANNOT rewrite the committed `latest.json` (serverless
  FS is read-only). Full ingest (`scripts/refresh_whats_on.mjs`) is a local/manual
  job needing pre-scraped inputs. `events-refresh.yml`'s `schedule:` is commented
  out and marked retired. So the committed-file age is stale *by design*; true
  freshness is store-backed. **Owner action:** confirm the Vercel whats-on cron is
  firing and DB migration 0047 (`feed_freshness`) is applied so the store overlay
  reports fresh; run the manual full-ingest to re-commit the baseline when needed.
  Optionally set `TICKETMASTER_API_KEY` / `SKIDDLE_API_KEY` for events breadth.

- **`night_signals` — GitHub runner allocation + missing key.** The daily "Night
  Signal refresh" Action cannot run: GitHub-hosted Actions fail at
  `startup_failure` (zero jobs) on this private repo — the same account-level
  runner-allocation failure that keeps `ci.yml` on `workflow_dispatch` only.
  Candidate ingestion also needs `EXA_API_KEY` (without it the reviewed snapshot
  publishes empty). No Vercel cron backs this feed. **Owner action:** fix the
  GitHub Actions runner allocation (account/billing), then set `EXA_API_KEY`.

- **`weather` — store-backed refresh; committed file is the degraded fallback.**
  The every-6h Vercel cron writes to the durable `weather_snapshots` store, not the
  committed file (read-only FS). Open-Meteo is keyless — the feed code works. The
  retired GitHub `weather-refresh.yml` cannot run (runner allocation). So the
  committed-file age is stale *by design*; live freshness is store-backed.
  **Owner action:** confirm the Vercel weather cron is firing and migration 0047 is
  applied so the store overlay serves fresh; the committed file is only the
  pre-migration fallback.

### Dominant causes (cross-cutting)

1. **GitHub Actions runner allocation is broken (external).** Every workflow fails
   before job allocation on this private repo (`ci.yml` header documents run
   28893076008). All GitHub-Action-driven refreshes (prices, night-signals, the
   retired weather/events jobs) cannot run until the owner fixes account/billing.
   Because of this, a new GitHub "freshness gate" workflow would only add
   `startup_failure` noise — the loud path is deliberately the Vercel audit cron
   (below), which runs.
2. **Store-backed feeds vs file-based measurement.** `weather` and `whats_on`
   refresh to a durable store the serverless cron can persist; the committed files
   they are measured against are only the fallback. Their file-age "staleness" is
   expected while the store is the live source.
3. **Missing provider keys (external):** `EXA_API_KEY` (night_signals) and,
   optionally, ticket/event keys (whats_on breadth).
4. **Stubbed price parsers (product):** price feeds emit zero rows by design.

## In-repo fixes (this branch)

- **Loud alerting, not an advisory warn.** `lib/freshnessNotify.ts` now logs a
  budget breach at **error** level with a distinct `[freshness-audit][ALERT]`
  marker (was `console.warn`). The daily Vercel cron `/api/cron/freshness-audit`
  is store-aware and runner-independent, so this is the reliable loud signal that
  trips log-based alerting. Covered by `__tests__/cronFreshnessAuditRoute.test.ts`.
- **Discoverable owner gate.** `npm run check:freshness` runs
  `scripts/check_freshness.mjs`, which prints the table and exits non-zero on any
  breach — the ad-hoc/CI-when-runners-return gate. (Not wired into the merge build:
  a late daily cron must never block a code merge, and the file-based check would
  false-fail the store-backed feeds.)

## End-to-end pipeline proof

`node scripts/refresh_weather_snapshots.mjs` was run locally (keyless Open-Meteo):
weather flipped **134.6h → 0h fresh** (20 observations written), proving the
pipeline code is fully functional. The data file was reverted afterward (this
branch is code-only). The gap is **scheduled execution/persistence**, not code.
