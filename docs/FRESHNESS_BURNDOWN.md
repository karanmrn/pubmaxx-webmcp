# Freshness burndown - per-feed verdicts and fix classes (2026-08-07)

> **Update 2026-08-20 (does not rewrite the inventory below).** `price_updates`
> is now **UNTRACKED** in the spine: episodic, no machine budget, empty served
> envelope with an honest 2026-07-03 collection-day stamp while parsers are
> stubbed. See [`data/freshness_registry.json`](../data/freshness_registry.json)
> and [`docs/WAYFINDER_LIVE_DATA.md`](./WAYFINDER_LIVE_DATA.md).

> **Update 2026-08-24 (does not rewrite the inventory below).** The What's-On
> inventory below predates migration `0119` and the all-lane Vercel refresh.
> `GET /api/cron/refresh-whats-on` now refreshes bounded quiz, deal, music, and
> sport lanes plus configured official event lanes into durable
> `whats_on_listings`; readers prefer non-expired durable rows and use bundled
> files as fallback. Full harvested breadth remains a separate recovery path.
> The current contract is owned by [`docs/CRON_PLANE_RUNBOOK.md`](./CRON_PLANE_RUNBOOK.md),
> [`data/freshness_registry.json`](../data/freshness_registry.json), and
> [`docs/WAYFINDER_LIVE_DATA.md`](./WAYFINDER_LIVE_DATA.md).

> **Update 2026-08-28 (does not rewrite the inventory below).** Area news now
> has a repeatable manual Keenable refresh and a 504-hour registry budget. The
> current command, 21-day serving rule, and serverless publication limit are
> owned by [`docs/CRON_PLANE_RUNBOOK.md`](./CRON_PLANE_RUNBOOK.md),
> [`data/freshness_registry.json`](../data/freshness_registry.json), and
> [`docs/WAYFINDER_LIVE_DATA.md`](./WAYFINDER_LIVE_DATA.md). The area-news row
> below remains the 2026-08-07 historical inventory.

This is a scoping pass. It lists every feed in the freshness spine, its
2026-08-07 verdict, and its fix class. It proposes no code change. Class (c)
rows carry a follow-up diff sketch only. A later task must decide and apply
the real change.

A prior report, `docs/FRESHNESS_BURNDOWN_2026-07-24.md`, covered four stale
feeds as of 2026-07-24. This report is a full re-run against today's state.
It covers all 27 feeds, not only the stale ones, and sorts each into a fix
class. Read the old report for historical root cause on GitHub Actions
runner failure, which no longer applies (Actions is retired for this repo;
see `docs/CRON_PLANE_RUNBOOK.md`).

## How this report was built

The inventory step ran `node scripts/check_freshness.mjs` against
`data/freshness_registry.json` and read `lib/freshness.ts` for the exact
verdict rules. It also read `docs/CRON_PLANE_RUNBOOK.md` and
`docs/LOCAL_REFRESH_SCHEDULER.md` for the refresh mechanism behind each
stale or untracked feed, and ran one read-only check,
`node scripts/local-refresh/scheduler.mjs status`, to confirm whether the
local price and event jobs are installed. No file was changed.

## Headline counts

Of 27 datasets:

- 7 are FRESH. No action needed.
- 7 are LIVE (no disk artifact; fetched per request). No action needed.
- 3 are STALE (over their staleness budget).
- 10 are UNTRACKED (no staleness budget applies, by design or by gap).
- 0 are UNKNOWN. The spine calls this status "cannot measure the age at
  all," separate from "the data is old." No feed is in that state today.
  Project rule: never merge "stale" and "cannot tell" into one number. This
  report keeps them apart. The 0-UNKNOWN count is a distinct fact from the
  10 UNTRACKED feeds below, several of which age with no budget to alarm on.

Fix class breakdown for the 13 feeds that need a decision (3 STALE + 10
UNTRACKED):

| Fix class | Meaning | Feed count |
|---|---|---|
| (a) Operational | A real refresh mechanism exists. The data is old because the mechanism did not run, or ran but its output was not reviewed and merged. | 4 |
| (b) / registry-model gap | The feed has no committed file the check script can read. Its real age lives only in a durable store. The check script needs new read logic, not a new parser. | 2 |
| (c) Deliberately episodic | The feed correctly has no fixed budget. It needs an explicit outer-bound budget so true neglect still alarms. | 5 |
| Out of scope | Static reference data with no timestamp by design. Working as intended. | 2 |

whats_on (class a) also carries a separate, larger structural gap: the full
content ingest cannot run inside a serverless function at all. See its row
below.

## Full inventory

| Feed | Status | Age / Budget | Fix class | Effort | Owner |
|---|---|---|---|---|---|
| pint_prices | FRESH | 840h / 2160h | n/a | none | n/a |
| price_updates | STALE | 780h / 336h | (a) operational | low | operator |
| drink_price_updates | FRESH | 292.8h / 336h | n/a | none | n/a |
| food_price_updates | FRESH | 647.7h / 1440h | n/a | none | n/a |
| night_signals | UNTRACKED | 540h / no budget | (c) episodic, budget already correct | low | code |
| night_signal_candidates | UNTRACKED | no age / no budget | (b) registry-model gap | low | code |
| weather | STALE | 469.6h / 48h | (a) operational | low | operator |
| whats_on | STALE | 660h / 48h | (a) operational, plus a separate architecture gap | medium-high | operator, then code |
| whats_on_sport_fixtures | UNTRACKED | 469.1h / no budget | (a) operational (issue #408) | low-medium | code |
| events_live_eventbrite | LIVE | n/a | n/a | none | n/a |
| pint_index_snapshot | UNTRACKED | 540h / no budget | (c) episodic, light-touch ceiling | low | code |
| late_food_evidence | UNTRACKED | 264h / no budget | (c) episodic, needs ceiling | low | code |
| pubmaxxing_seed | UNTRACKED | 756h / no budget | (c) episodic, needs ceiling | low | code |
| wetherspoons_directory | UNTRACKED | 648.1h / no budget | (c) episodic, needs ceiling | low | code |
| tfl_last_train | LIVE | n/a | n/a | none | n/a |
| tfl_nearby_buses | LIVE | n/a | n/a | none | n/a |
| tfl_disruption | LIVE | n/a | n/a | none | n/a |
| food_hygiene | LIVE | n/a | n/a | none | n/a |
| citymcp | LIVE | n/a | n/a | none | n/a |
| police_night_context | LIVE | n/a | n/a | none | n/a |
| tfl_lines | UNTRACKED | no age / no budget | out of scope, static by design | none | n/a |
| london_pois | UNTRACKED | no age / no budget | out of scope, static by design | none | n/a |
| heritage_listings | FRESH | 492h / 8760h | n/a | none | n/a |
| area_news | FRESH | 480h / 1080h | n/a | none | n/a |
| persona_drinks | FRESH | 480h / 2160h | n/a | none | n/a |

## Per-feed notes

### Class (a): operational

**price_updates.** Two separate acquisition paths feed this dataset, and
they must not be confused.

A real acquisition path exists: `scripts/local-refresh/scheduler.mjs`, run by a
Mac launchd job, scrapes London pub prices through Exa, Browserbase, and
Tavily on a Monday schedule, then opens a review pull request. This is a
working parser, not a stub. The status check run for this report confirms
both launchd jobs are installed and their last run exited clean. But no
`automation/local-refresh-*` pull request has ever been opened. The gap is
operational: confirm the required keys (`EXA_API_KEY`,
`BROWSERBASE_API_KEY`, `TAVILY_API_KEY`) are present, run
`node scripts/local-refresh/scheduler.mjs run prices --dry-run` to see if it
finds a real diff, and check `~/karan-agent-workspace/data/refresh-logs/` for
the last run's outcome. Once a pull request lands, a human still must
publish it through `scripts/refresh_prices.mjs` before the served file
advances; the loop never auto-publishes by design.

**weather.** The Vercel cron is keyless and runs every 6 hours. Its writes
land in the durable `weather_snapshots` store only once migration `0047`
(`supabase/migrations/20260721130000_0047_cron_freshness_plane.sql`) is
applied. Until then, the read side falls back to the committed file, which
never updates itself. Confirm the migration is applied in production and
confirm `CRON_SECRET` is set, since a missing secret makes the cron route
refuse to run.

**whats_on.** The SLIM cron shares the same migration-0047 and
`CRON_SECRET` dependency as weather, so the operator action above applies
here too. But this feed carries a second, larger gap the operator action
cannot close: full content ingest (the baseline verticals and the events
vertical) cannot run inside a serverless function at all, because a
function cannot write a committed file and there is no scraper agent inside
it. `docs/CRON_PLANE_RUNBOOK.md` names three real alternatives: local
launchd acquisition (the same mechanism `LOCAL_REFRESH_SCHEDULER.md`
already runs for prices and events), a separate worker writing to a durable
table, or a Ticketmaster-only in-function ingest once
`TICKETMASTER_API_KEY` is set. This is an architecture decision, not a
one-line fix, and belongs in its own follow-up task.

**whats_on_sport_fixtures.** The registry marks this feed's cron dead and
names the tracking issue, `#408`. Its budget is correctly null, since a
dead cron should not alarm on a schedule it cannot meet. The fix is to
restore the cron per `#408`; until then, this stays a manual, hand-curated
feed.

### Class (b): registry-model gap

**night_signal_candidates.** This scheduled Vercel cron writes to a durable
store, not to a committed file. Candidate freshness must be read from that
store. The retired `price_update_retrieval` cron is not a feed: every parser was
a no-op, so keeping its schedule created only unresolved noise.

### Class (c): deliberately episodic, needs an explicit budget

Five feeds have a computable age but no budget, because they run on a human
or event cadence rather than a fixed schedule. A null budget is correct for
normal cadence gaps. But a null budget also means the feed can age forever
with no alarm if genuinely abandoned. The fix is an explicit outer-bound
budget: generous enough to never fire on normal use, tight enough to catch
real neglect.

- **night_signals** (540h, human-gated publish, no machine schedule): the
  budget is already correctly null and documented as episodic. No change is
  required. An optional neglect ceiling is included below for completeness.
- **pint_index_snapshot** (540h, event-sourced from confirmed observations):
  correctly user-cadence. An optional light-touch ceiling is included below.
- **late_food_evidence** (264h, hand-curated per Night Area): needs a
  neglect ceiling.
- **pubmaxxing_seed** (756h, one-time-ish import from the sibling repo):
  needs a long neglect ceiling, since this data rarely changes by design.
- **wetherspoons_directory** (648.1h, OSM/directory harvest): needs a
  neglect ceiling, since directory accuracy still benefits from a periodic
  refresh even though there is no fixed schedule.

#### Proposed diff sketch (not applied)

Add a `stalenessBudgetHours` value to each entry in
`data/freshness_registry.json`. Example for two of the five:

```diff
   {
     "id": "late_food_evidence",
     "label": "Late-night food evidence",
     "class": "episodic",
-    "stalenessBudgetHours": null,
+    "stalenessBudgetHours": 2160,
     "gate": "episodic - evidenced by hand per Night Area"
   },
   {
     "id": "wetherspoons_directory",
     "label": "Wetherspoons directory",
     "class": "episodic",
-    "stalenessBudgetHours": null,
+    "stalenessBudgetHours": 4320,
     "gate": "episodic - OSM / directory harvest"
   }
```

Proposed ceilings for all five: night_signals 4320h (180 days),
pint_index_snapshot 2160h (90 days), late_food_evidence 2160h (90 days),
pubmaxxing_seed 8760h (365 days), wetherspoons_directory 4320h (180 days).
A follow-up task should confirm these numbers with the feed's actual
owner before applying them.

### Out of scope: static by design

**tfl_lines** and **london_pois** carry no stamp at all. Both are static
reference data that change rarely and are not meant to be dated. This is
correct as shipped. No fix class applies.

## What this pass did not do

This pass changed no code and no registry entry. It read the current
freshness spine, the cron runbook, the local refresh scheduler docs, and
the prior burndown report, then ran one read-only status check. A follow-up
task should pick one fix class at a time: start with the class (a)
operational checks, since they are the lowest effort and the highest
confidence, then the class (b) registry-model change, then the class (c)
budget additions.
