# Local data refresh scheduler

GitHub Actions cannot allocate a runner for this repository, and Vercel functions cannot persist committed files. A per-user launchd job therefore owns file-producing acquisition on the captain's Mac. Vercel keeps its separate server-safe freshness plane.

The scheduler lives in `scripts/local-refresh/scheduler.mjs`. It renders two agents:

- Monday at 07:30 local time: London pub prices, venue additions, and location fixes.
- Daily at 15:45 local time: London events. This mode runs two independent lanes, the official-provider refresh (`scripts/whatson/eventsRefresh.mjs`) and the keyless Common reader (`scripts/whatson/commonRefresh.mjs`).

launchd uses local calendar time. If the Mac sleeps through a calendar firing, launchd coalesces missed firings and starts the job after wake.

## Safety model

Every run checks one-minute load and macOS memory pressure before doing work. Default load ceiling is 75% of logical CPU capacity with a floor of `4.0`; free memory floor is `25%`. A shared lock prevents price and event jobs overlapping. Existing acquisition scripts run one at a time.

Secrets load at runtime from `~/karan-agent-workspace/data/keys.env`. Scheduler refuses any mode other than `0600`, never puts keys in a plist or command argument, and redacts loaded values from captured child-process output. Provider keys remain available to acquisition and validation commands, but are removed from every Git and `gh-axi` subprocess environment. Monday prices require `EXA_API_KEY`, `BROWSERBASE_API_KEY`, and `TAVILY_API_KEY`; a missing one refuses the whole mode.

Events readiness is per LANE, not per mode. The provider lane needs `TICKETMASTER_API_KEY`, a `SKIDDLE_API_KEY` whose commercial use has written approval, or `CONTEXT_DEV_API_KEY` for the registered-source lane ([`LONDON_HARVEST.md`](./LONDON_HARVEST.md)); without any of them, that lane alone is skipped and the log names it (`SKIPPED LANE`). The Common lane is keyless and still runs, so a machine holding no event-provider key still refreshes events. Each lane is independent: one lane failing is logged (`LANE FAILED`) and the other still runs, and the run fails only when every lane it started failed.

Price acquisition chooses provider by work type in `scripts/lib/localRefreshProviders.mjs`:

| Work | Provider | Failure rule |
|---|---|---|
| Discover new London pubs and useful official pages | Exa | Missing or refused Exa access aborts run and names Exa. |
| Render interactive chain menus and price boards | Browserbase | Missing or refused Browserbase access aborts run and names Browserbase. |
| Extract ordinary first-party pages | Tavily | Missing, refused, or failed extraction aborts run and names Tavily. |

Provider errors never become an empty result. Zero rows means provider completed acquisition and parser found no publishable observation. Legacy `firecrawl_*` script names and `.firecrawl` cache paths remain because downstream merge scripts consume those names and paths; scheduled path makes no Firecrawl API or CLI call.

Each scheduled run fetches `origin/main` and creates a disposable Git worktree from that ref. Scrapers may write served files only there. Scheduler validates data, stages only approved refresh outputs, then checks staged diff. No changed data means no branch, commit, push, or PR.

A changed run creates an `automation/local-refresh-*` branch, pushes that branch, and opens a review PR through `gh-axi`. PR body counts new pubs, new price rows, changed prices, new deals, and location fixes. Captain review remains publication gate. Job never pushes to `main` and never merges.

## Install

Install from stable repository checkout that should own future runs. Installer embeds that checkout and current Node executable as absolute paths, so reinstall after moving checkout or Node installation.

```sh
stat -f '%Sp %N' ~/karan-agent-workspace/data/keys.env
node scripts/local-refresh/scheduler.mjs install
```

First command must show `-rw-------`. Install writes only these files under `~/Library/LaunchAgents/` and loads them:

```text
com.pubmax.refresh-prices.plist
com.pubmax.refresh-events.plist
```

Plists contain executable paths, schedules, low-priority process settings, and log paths. They contain no provider key or key value.

## Operate

```sh
node scripts/local-refresh/scheduler.mjs status
node scripts/local-refresh/scheduler.mjs stop
node scripts/local-refresh/scheduler.mjs start
node scripts/local-refresh/scheduler.mjs uninstall
```

`stop` unloads both agents without deleting plists. `start` loads installed plists. `uninstall` unloads and removes only those two files.

Inspect newest run and launchd capture:

```sh
ls -lt ~/karan-agent-workspace/data/refresh-logs/
tail -n 200 ~/karan-agent-workspace/data/refresh-logs/launchd-prices.log
tail -n 200 ~/karan-agent-workspace/data/refresh-logs/launchd-events.log
```

Each invocation also writes a mode and timestamp named log in same directory. Resource refusal, missing key, scraper failure, validation failure, no-change exit, diff summary, and PR publication all appear there.

## Manual proof runs

Dry runs use a disposable worktree from committed `HEAD`, bounded network-heavy scraper limits, and real data contracts. Using `HEAD` lets a review branch prove its own scheduler before merge; installed scheduled runs remain fixed to freshly fetched `origin/main`. Dry runs print staged diff and semantic summary but do not create a branch, commit, push, or PR.

```sh
node scripts/local-refresh/scheduler.mjs run prices --dry-run
node scripts/local-refresh/scheduler.mjs run events --dry-run
```

Render plists for inspection without installing:

```sh
node scripts/local-refresh/scheduler.mjs render-launchd --output-dir .local-refresh-launchd
plutil -lint .local-refresh-launchd/*.plist
```

Target-account lint, load, list, unload, and cleanup output is recorded in [`docs/proof/local-refresh-scheduler/launchd-validation-2026-08-05.md`](./proof/local-refresh-scheduler/launchd-validation-2026-08-05.md).

Do not run `install` from a disposable task worktree. Its absolute path disappears when worktree is removed.
