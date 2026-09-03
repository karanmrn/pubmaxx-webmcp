# Local Refresh Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Monday London price acquisition and daily London event acquisition on the captain's Mac, with every meaningful data change delivered as a review pull request.

**Architecture:** A launchd installer renders two per-user agents that call one Node.js orchestrator. Each invocation checks machine pressure, acquires a shared lock, loads the protected key file, creates a disposable worktree from `origin/main`, runs existing acquisition scripts sequentially, validates allowlisted data outputs, and either prints a dry-run diff or commits a uniquely named automation branch and opens a PR through `gh-axi`. One acquisition seam assigns Exa to discovery, Browserbase to rendered pages, and Tavily to plain extraction while preserving every scraper's output contract. No scraper receives `--open-pr`, so only the orchestrator owns Git and GitHub publication.

**Tech Stack:** Node.js ESM, macOS launchd plists, Git worktrees, `gh-axi`, Vitest, existing refresh scripts.

## Global Constraints

- Base scheduled acquisition worktrees on freshly fetched `origin/main`; use committed `HEAD` only for non-publishing dry-run proof. Never push to `main` and never merge.
- Run price acquisition each Monday and event acquisition daily through macOS launchd.
- Run one scraper at a time and refuse work when one-minute load or system-free memory breaches the documented threshold.
- Load secrets only from `~/karan-agent-workspace/data/keys.env`, require mode `0600`, redact loaded values from logs, and never place keys in Git, arguments, or plists.
- Write readable logs under `~/karan-agent-workspace/data/refresh-logs/`.
- Run only existing scrapers. Do not create a new scraper or change page copy.
- Keep provider policy in one seam: Exa discovers new pubs and useful pages, Browserbase renders interactive menus and price boards, and Tavily extracts ordinary pages.
- Treat missing credentials and provider refusal as explicit failures naming the provider and reason. A provider failure may never be translated into zero rows.
- A no-change run creates no branch, commit, push, or PR.
- Every PR body reports new pubs, new price rows, changed prices, new deals, and location fixes.
- Event acquisition needs `TICKETMASTER_API_KEY` or an approved `SKIDDLE_API_KEY`; current key inventory has neither, so the job must report the missing provider key without guessing or overwriting event data.
- Scheduled jobs may write served data only inside their disposable review worktree. Production data changes only after captain-reviewed merge.

---

### Task 1: Lock scheduler behavior with failing tests

**Files:**
- Create: `__tests__/localRefreshScheduler.test.ts`
- Create: `scripts/local-refresh/scheduler.mjs`

**Interfaces:**
- Consumes: synthetic memory-pressure output, synthetic before/after data snapshots, repository paths, and launchd render options.
- Produces: `resourceRefusal`, `summariseRefresh`, `renderLaunchAgents`, `publishPreparedChanges`, and CLI commands `run`, `render-launchd`, `install`, `start`, `stop`, and `status`.

- [x] **Step 1: Write failing resource-gate and summary tests**

Create tests proving high one-minute load refuses, free-memory percentage below 25 refuses, healthy readings pass, and hand-derived before/after fixtures report exactly one new pub, one new price row, one changed price, one new deal, and one location fix.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- __tests__/localRefreshScheduler.test.ts`

Expected: FAIL because `scripts/local-refresh/scheduler.mjs` does not exist.

- [x] **Step 3: Implement minimal pure resource and summary functions**

Implement parsing around macOS `memory_pressure -Q`, one-minute load thresholds, venue identity, price observation identity, deal identity, and coordinate comparison. Keep thresholds explicit and overrideable only by non-secret scheduler environment settings.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- __tests__/localRefreshScheduler.test.ts`

Expected: resource and summary cases PASS.

### Task 2: Implement isolated sequential acquisition and no-empty-PR publication

**Files:**
- Modify: `scripts/local-refresh/scheduler.mjs`
- Modify: `__tests__/localRefreshScheduler.test.ts`

**Interfaces:**
- Consumes: `origin/main`, the protected key file, existing price and event scripts, and `gh-axi`.
- Produces: a disposable review worktree, redacted per-run log, allowlisted staged diff, optional automation branch, and review PR.

- [x] **Step 1: Write failing no-change integration test**

Create a temporary Git repository, call `publishPreparedChanges` in dry-run mode with no tracked or allowlisted untracked changes, and assert the result is `no-change`, with no branch and no publication command.

- [x] **Step 2: Run focused test and verify RED**

Run: `npm test -- __tests__/localRefreshScheduler.test.ts`

Expected: FAIL because publication behavior is absent.

- [x] **Step 3: Implement orchestration and publication**

Implement shared atomic locking, mode-0600 key loading, secret redaction, `origin/main` fetch, disposable worktree creation and cleanup, sequential child processes, source validation, allowlisted path staging, staged-diff emptiness check, dry-run diff output, automation branch creation, commit, push, and `gh-axi pr create`. Price mode runs the seven specified scripts without `--open-pr`; dry-run mode applies bounded limits inside the disposable worktree. Event mode runs `scripts/whatson/eventsRefresh.mjs` and reports absent provider keys before any fetch.

- [x] **Step 4: Verify no-change GREEN and mutation resistance**

Run: `npm test -- __tests__/localRefreshScheduler.test.ts`

Expected: PASS; changing the staged-diff check to always publish makes the no-change test fail.

### Task 3: Render and control launchd agents

**Files:**
- Modify: `scripts/local-refresh/scheduler.mjs`
- Modify: `__tests__/localRefreshScheduler.test.ts`

**Interfaces:**
- Consumes: repository root, current Node executable, user home, and log directory.
- Produces: `com.pubmax.refresh-prices.plist` and `com.pubmax.refresh-events.plist` under the chosen output directory, defaulting to `~/Library/LaunchAgents/` for installation.

- [x] **Step 1: Write failing plist behavior test**

Assert Monday uses `Weekday=1`, daily events omit `Weekday`, both use `StartCalendarInterval`, low-priority background settings, the exact scheduler entry point, and log paths. Assert no loaded key name or value appears in either plist.

- [x] **Step 2: Run focused test and verify RED**

Run: `npm test -- __tests__/localRefreshScheduler.test.ts`

Expected: FAIL because launchd rendering is absent.

- [x] **Step 3: Implement render, install, start, stop, and status commands**

Render valid XML with escaped absolute paths. Installation writes only the two named files and loads them. Start uses `launchctl load`, stop uses `launchctl unload`, and status uses `launchctl list` filtered to both labels. Keep secrets and secret names out of plists.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- __tests__/localRefreshScheduler.test.ts`

Expected: all scheduler tests PASS.

### Task 4: Replace Firecrawl acquisition behind one provider seam

**Files:**
- Create: `scripts/lib/localRefreshProviders.mjs`
- Create: `scripts/lib/localRefreshProviders.d.mts`
- Create: `__tests__/localRefreshProviders.test.ts`
- Modify: `scripts/firecrawl_greene_king_prices.mjs`
- Modify: `scripts/firecrawl_mbplc_prices.mjs`
- Modify: `scripts/harvest_outer_london_prices.mjs`
- Modify: `scripts/local-refresh/scheduler.mjs`

**Interfaces:**
- Consumes: provider job kind, URL or discovery query, and runtime keys from the protected environment.
- Produces: the markdown, links, and discovery records expected by existing parsers and merge scripts.

- [x] **Step 1: Write failing provider policy and refusal tests**

Pin the job-to-provider mapping, exact missing-key errors, non-success HTTP refusal errors, and preserved markdown/links response shape. Prove provider errors escape scraper loops instead of reading as an honest zero-row result.

- [x] **Step 2: Implement the provider seam**

Use Exa search for discovery, Browserbase CDP sessions for rendered menu or price-board content, and Tavily Extract for plain pages. Keep provider policy and credential names in one exported table. Never log request headers or key values.

- [x] **Step 3: Swap acquisition calls without changing output files**

Route Greene King and Mitchells & Butlers rendered pages through Browserbase. Route independent plain pages through Tavily and use Exa to discover missing or newly relevant official pub pages. Preserve `.firecrawl` cache filenames and JSON output schemas because downstream merge scripts own those contracts.

- [x] **Step 4: Verify focused tests**

Run: `npm test -- __tests__/localRefreshProviders.test.ts __tests__/localRefreshScheduler.test.ts`

Expected: provider mapping and loud-failure tests PASS; scheduler requires Exa, Browserbase, and Tavily rather than Firecrawl.

### Task 5: Document operator workflow

**Files:**
- Create: `docs/LOCAL_REFRESH_SCHEDULER.md`
- Modify: `README.md`
- Modify: `docs/CRON_PLANE_RUNBOOK.md`

**Interfaces:**
- Consumes: scheduler CLI and existing freshness-plane explanation.
- Produces: one canonical operator guide linked from the root README and cron runbook.

- [x] **Step 1: Write the operator guide**

Explain why launchd owns committed-file acquisition while Vercel owns only server-safe freshness work. Document prerequisites, key-file permission check, install, start, stop, status, manual dry runs, log inspection, PR behavior, resource refusal, missing event provider key, and uninstall.

- [x] **Step 2: Link the guide without duplicating commands**

Add short pointers from `README.md` and `docs/CRON_PLANE_RUNBOOK.md`. Keep exact command inventory in the canonical guide only.

- [x] **Step 3: Validate documentation links**

Run: `rg -n "LOCAL_REFRESH_SCHEDULER" README.md docs/CRON_PLANE_RUNBOOK.md`

Expected: both parent docs point to the guide.

### Task 6: Produce operational proof and full verification

**Files:**
- Review: all changed files.

**Interfaces:**
- Consumes: dry-run mode, launchd render mode, launchctl, and repository quality gates.
- Produces: captured terminal evidence and a committed implementation branch.

- [x] **Step 1: Run bounded price dry run**

Run: `node scripts/local-refresh/scheduler.mjs run prices --dry-run`

Expected: existing price scripts run sequentially in a disposable worktree, output is redacted, and a real scraped-row diff plus semantic summary prints without commit, push, PR, or production-data modification.

- [x] **Step 2: Prove missing event key behavior**

Run: `node scripts/local-refresh/scheduler.mjs run events --dry-run`

Expected: explicit `TICKETMASTER_API_KEY` report, no guessed value, no event-file overwrite, and no PR.

- [x] **Step 3: Prove launchd load and discovery**

Render plists into a worktree-local proof directory, run `launchctl load` on both, confirm both labels with `launchctl list`, then unload both proof agents.

- [x] **Step 4: Run requested quality gates**

Run:

```bash
npx tsc --noEmit
npm run lint
npm test
```

Expected: typecheck exit 0, lint 0 errors, unit suite at 7,490 or more tests with zero failures.

- [x] **Step 5: Review, verify, and commit**

Run `git diff --check`, the project review playbook, and fresh full verification. Confirm no secrets, served-data changes, page copy, workflow deletions, direct-main push, or generated files entered the diff. Commit all implementation, tests, plan, and docs on `fm/local-refresh-scheduler`.
