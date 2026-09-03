# Tavily City Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add resumable, budget-capped Tavily discovery of official pub pages and provenance-stamped pint prices for Manchester, Birmingham, Edinburgh, Glasgow, Leeds, and Bristol, with rotating Vercel cron coverage and one committed real harvest.

**Architecture:** One pure JavaScript module owns city bounds, official-domain policy, chain delegation, price extraction, Tavily request budgeting, and deterministic enrichment results. A CLI adds per-city disk checkpoints and canonical dated output. A thin server module and authenticated route reuse the same core in bounded cron batches, rotating city and cursor deterministically because Vercel functions cannot commit repository files.

**Tech Stack:** Node.js 22 ESM, Tavily HTTP Search API, Next.js 16 route handlers, Vitest, Vercel Cron.

## Global Constraints

- Tavily calls hard-cap at `--max-queries`, default `200`, with calls and provider credits logged.
- Only official pub or chain pages may provide facts. Competitor aggregators and review sites remain forbidden.
- Wetherspoons, Greene King, and Mitchells & Butlers pubs consume zero Tavily calls and are delegated to existing chain harvesters.
- Every emitted price has `source.label`, official `source.url`, `source.licence`, and ISO `observedAt`.
- Local checkpoints live under ignored `.tavily/enrichment/`; committed evidence contains no raw page copy or secret.
- `TAVILY_API_KEY` is documented as optional server-only configuration and never committed.
- Cron uses `CRON_SECRET`, rotates six cities, and has its own conservative call cap.

---

### Task 1: Tested Tavily Enrichment Core and CLI

**Files:**
- Create: `scripts/lib/tavilyPubEnrichment.mjs`
- Create: `scripts/lib/tavilyPubEnrichment.d.mts`
- Create: `scripts/enrich_city_pubs_tavily.mjs`
- Create: `__tests__/tavilyPubEnrichment.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: normalized OSM rows selected by city bbox from `data/osm/uk/uk_osm_pubs.json`.
- Produces: `runCityEnrichment({ city, pubs, maxQueries, startIndex, apiKey, fetchImpl, observedAt })`, canonical drink-price rows, per-pub official-page evidence, budget stats, and next cursor.

- [ ] **Step 1: Write failing pure behavior tests**

Add literal fixtures proving: unsupported cities fail; known chain sites are delegated without provider calls; non-official result domains are rejected; same-domain OSM sites are accepted; only lines identifying a pint/568ml draught serving produce plausible GBP price rows; query count never exceeds cap; credits sum from Tavily `usage.credits`.

- [ ] **Step 2: Run test to verify RED**

Run: `npx vitest run __tests__/tavilyPubEnrichment.test.ts`

Expected: FAIL because `scripts/lib/tavilyPubEnrichment.mjs` does not exist.

- [ ] **Step 3: Implement minimal pure core**

Use `https://api.tavily.com/search` with `search_depth: "advanced"`, `max_results: 10`, `include_answer: false`, `include_images: false`, and `include_raw_content: "markdown"`. Advanced search is required for priced PDF menu extraction. Send key in bearer auth. Enforce result-domain policy before extracting or emitting any fact. Stamp first-party read-only licence and exact result URL.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npx vitest run __tests__/tavilyPubEnrichment.test.ts`

Expected: PASS.

- [ ] **Step 5: Add CLI checkpoint and output boundary**

Parse `--city`, `--max-queries`, `--reset`, and `--dry-run`. Save checkpoint atomically after each processed pub. After each successful bounded run, write a dated canonical `{ version, generatedAt, updates }` file plus a compact run report whose `complete` field reports whether city cursor reached end. Print `pubs matched / prices extracted / queries spent / credits`.

- [ ] **Step 6: Add command and ignore state**

Add `enrich:city` script and ignore `.tavily/`.

### Task 2: Tested Rotating Vercel Cron

**Files:**
- Create: `lib/tavilyPubEnrichment.server.ts`
- Create: `app/api/cron/enrich-city-pubs/route.ts`
- Create: `__tests__/cronEnrichCityPubsRoute.test.ts`
- Modify: `vercel.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: same `runCityEnrichment` function and OSM pack loader as CLI.
- Produces: authenticated JSON containing selected city, cursor, matches, price count, query count, credits, and safe skip response when key is absent.

- [ ] **Step 1: Write failing route tests**

Test real route behavior with only Tavily fetch mocked: wrong cron secret returns 401; missing key is safe no-op and performs no fetch; keyed run respects cron query cap and returns exact spend; provider failure returns 502 with `[city-enrichment][ALERT]`.

- [ ] **Step 2: Run test to verify RED**

Run: `npx vitest run __tests__/cronEnrichCityPubsRoute.test.ts`

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement server and route**

Derive city as epoch-day modulo six and batch cursor as completed six-day rotations times cron cap. Set Node runtime, dynamic response, and bounded `maxDuration`. Never claim durable repository writes from serverless execution.

- [ ] **Step 4: Wire cadence and secret documentation**

Add daily Vercel cron after freshness audit. Add `TAVILY_API_KEY=` to `.env.example` with server-only, optional, safe-no-op wording.

- [ ] **Step 5: Run route and core tests**

Run: `npx vitest run __tests__/tavilyPubEnrichment.test.ts __tests__/cronEnrichCityPubsRoute.test.ts`

Expected: PASS.

### Task 3: Real Leeds Evidence and Closeout

**Files:**
- Create: `public/data/drink_price_updates/prices_20260726.json`
- Modify: `public/data/drink_price_updates/latest.json` only when real rows exist
- Create: `data/enrichment/tavily/leeds/run_20260726.json`
- Modify: `data/price_sources.json`

**Interfaces:**
- Consumes: local `TAVILY_API_KEY` from `/Users/karanmanoharan/karan-agent-workspace/data/keys.env`, never copied into the repository.
- Produces: canonical real price observations and compact reproducibility/hit-rate evidence.

- [ ] **Step 1: Run bounded live harvest**

Run: `set -a; source /Users/karanmanoharan/karan-agent-workspace/data/keys.env; set +a; npm run enrich:city -- --city=leeds --max-queries=10 --reset`

Expected: bounded resumable run with no more than 10 Tavily calls and explicit matched, extracted, call, and credit counts.

- [ ] **Step 2: Audit every emitted source**

Confirm each emitted URL is on accepted official domain, each pub identity matches name plus locality, every extracted row explicitly identifies pint/568ml/draught context, and no aggregator domain appears.

- [ ] **Step 3: Record discovery-provider governance**

Document Tavily as discovery/extraction infrastructure only, never price provenance. Keep official publisher URL as row source and existing first-party licence wording.

- [ ] **Step 4: Run validators and focused tests**

Run: `npm run validate-data`

Run: `npx vitest run __tests__/tavilyPubEnrichment.test.ts __tests__/cronEnrichCityPubsRoute.test.ts __tests__/validateDrinkPriceUpdatesScript.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full verification**

Follow `verification-before-completion`, `review`, and `check-work` playbooks. Run `npm run verify`; repair every lint, typecheck, test, coverage, or data failure.

- [ ] **Step 6: Preserve local tooling files and commit**

Restore only known `next-env.d.ts` and `package.json` tooling churn if generated, run project memory check, inspect final diff, and commit normal code/doc wording without agent co-author.

## Self-Review

- Spec coverage: city command, official-only governance, chain reuse/delegation, query cap, spend log, resume, cron rotation, secret reference, one live dataset, stats, and validators each map to a task.
- Placeholder scan: no TBD/TODO/implement-later steps.
- Type consistency: CLI and route both call `runCityEnrichment`; result fields remain `matchedPubs`, `prices`, `queriesSpent`, `creditsSpent`, and `nextIndex`.
