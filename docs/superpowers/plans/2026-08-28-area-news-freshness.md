# Area News Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the sourced London area-news layer with current Keenable results and stop the "New round here" surface from serving facts older than 21 days.

**Architecture:** Keep `data/area_news.json` as the reviewed static artifact because the deployed server cannot write repository files. Add one repeatable Node refresh command that searches Keenable, fetches each candidate page, asks Keenable for one explicitly stated fact, validates every generated row, and refuses to replace the artifact when provider or validation failures leave no usable rows. Apply one shared request-time age filter to API and server-rendered readers, so an overdue artifact renders an honest empty state.

**Tech Stack:** Node 22, native `fetch`, Keenable Search/Fetch HTTP API, Next.js App Router, TypeScript, Vitest.

**Spec:** `docs/CYCLE15_PRD.md` Lane A and the task brief for the latest sourced area-news refresh.

## Global Constraints

- Every item must carry a real `https://` source URL and a valid publication date.
- Every item must belong to a known London area and use an allowed area-news kind.
- Search and fetch failures must be visible in command output and must not silently write an empty replacement.
- Runtime readers must omit items older than 21 days and sort newest first.
- Serverless cron remains out of scope for repository-file publication; document the manual command and limitation.

---

### Task 1: Add shared freshness policy

**Files:**
- Modify: `lib/areaNews.ts`
- Modify: `app/api/area-news/route.ts`
- Modify: `app/borough/[slug]/page.tsx`
- Test: `__tests__/areaNews.test.ts`

**Interfaces:**
- Produces `AREA_NEWS_MAX_AGE_DAYS` and `freshAreaNews(entries, { now, maxAgeDays })` for all readers.

- [x] **Step 1: Write the failing tests**

Add tests proving `freshAreaNews` drops future and over-21-day entries, keeps boundary-day entries, and returns newest-first order. Add an API assertion that a fixture older than the cutoff is not returned.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run __tests__/areaNews.test.ts`

Expected: FAIL because the freshness helper and API filtering do not exist.

- [x] **Step 3: Write minimal implementation**

Use one UTC millisecond cutoff in `freshAreaNews`, filter invalid dates and future dates, sort by `observedAt` descending with id tie-break, and call it before the existing area resolver and before the borough page slice.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run __tests__/areaNews.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/areaNews.ts app/api/area-news/route.ts 'app/borough/[slug]/page.tsx' __tests__/areaNews.test.ts
git commit -m "fix(area-news): hide stale facts at read time"
```

### Task 2: Build tested Keenable refresh extraction

**Files:**
- Create: `scripts/lib/keenableAreaNews.mjs`
- Test: `__tests__/keenableAreaNews.test.ts`

**Interfaces:**
- Produces `searchKeenable(query, options)`, `fetchKeenable(url, options)`, `parseExtractedFact(raw)`, and `buildAreaNewsEntry({ result, page, fact, now, knownAreas })`.

- [x] **Step 1: Write the failing tests**

Cover keyed and keyless endpoint selection, non-2xx errors, malformed JSON, invalid extracted facts, HTTP-only source rejection, future publication dates, and a valid result-to-entry conversion with a deterministic id and source host.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run __tests__/keenableAreaNews.test.ts`

Expected: FAIL because the Keenable client and parser do not exist.

- [x] **Step 3: Write minimal implementation**

Call `/v1/search` or `/v1/search/public` with the `X-API-Key` or `X-Keenable-Title` contract, call `/v1/fetch` or `/v1/fetch/public` with `url`, `max_chars`, and a bounded JSON extraction prompt, parse fenced or plain JSON, and reject rows that do not pass the area-news schema and date rules.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run __tests__/keenableAreaNews.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add scripts/lib/keenableAreaNews.mjs __tests__/keenableAreaNews.test.ts
git commit -m "feat(area-news): add Keenable extraction client"
```

### Task 3: Add manual refresh command and publish current artifact

**Files:**
- Create: `scripts/refresh_area_news.mjs`
- Modify: `package.json`
- Modify: `data/area_news.json`
- Modify: `scripts/build_area_news_matches.mjs` only if current rows need conservative pin matches
- Test: `__tests__/refreshAreaNews.test.ts`

**Interfaces:**
- Command: `npm run refresh:area-news`.
- Optional command flags: `--max-results N` and `--max-candidates N`.

- [x] **Step 1: Write the failing tests**

Test that query results are deduplicated, one fetch failure is reported, all-provider failure throws without writing, zero usable rows throws without writing, and a successful run writes a generated timestamp with rows sorted newest first.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run __tests__/refreshAreaNews.test.ts`

Expected: FAIL because the command does not exist.

- [x] **Step 3: Write minimal implementation**

Run bounded London opening, closure, refurbishment, award, price-sighting, and local-news searches for the last 21 days. Fetch each unique candidate page, extract one explicit fact, preserve previous data until the complete run has a usable result, write only validated `https` rows, and print every search/fetch/drop/failure count. Use the source publication timestamp for `observedAt`, not the refresh time.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run __tests__/refreshAreaNews.test.ts`

Expected: PASS.

- [x] **Step 5: Run the real refresh**

Run: `npm run refresh:area-news`

Expected: loud per-query and per-page outcomes, a non-empty validated dataset, and newest rows dated within the current 21-day window.

- [x] **Step 6: Commit**

```bash
git add scripts/refresh_area_news.mjs package.json data/area_news.json __tests__/refreshAreaNews.test.ts
git commit -m "feat(area-news): refresh London facts from Keenable"
```

### Task 4: Document operations and freshness registry

**Files:**
- Modify: `data/freshness_registry.json`
- Modify: `docs/CRON_PLANE_RUNBOOK.md`
- Modify: `data/area_news.json`

- [x] **Step 1: Update the registry**

Set area-news cadence and refresh workflow to the exact `npm run refresh:area-news` command and retain its static-artifact limitation.

- [x] **Step 2: Document rerun and failure behavior**

Add the command, required `KEENABLE_API_KEY` option, keyless fallback, 21-day publication rule, and the reason no Vercel cron publishes this file.

- [x] **Step 3: Validate docs and data**

Run: `npm run validate-data` and `npm run check:freshness`

Expected: PASS, with area-news freshness measured from the new `generatedAt`.

- [x] **Step 4: Commit**

```bash
git add data/freshness_registry.json docs/CRON_PLANE_RUNBOOK.md
git commit -m "docs(area-news): document repeatable freshness refresh"
```

### Task 5: Final verification

- [x] **Step 1: Run focused tests**

Run: `npm test -- --run __tests__/areaNews.test.ts __tests__/keenableAreaNews.test.ts __tests__/refreshAreaNews.test.ts`

- [x] **Step 2: Run quality gates**

Run: `npm run lint` and `npm run typecheck`.

- [x] **Step 3: Inspect the diff and current artifact**

Run: `git diff HEAD^ --check`, `git status --short`, and a JSON check that every entry is dated within 21 days, has an `https` source URL, and is sorted newest first.

- [x] **Step 4: Commit any remaining test-only or documentation corrections**

Use a focused commit with the affected files.

## Execution notes

Focused area-news tests, data validation, and lint passed. Typecheck currently
reports an unused `@ts-expect-error` at `__tests__/areaNews.test.ts:27` because
the new Keenable declaration file now types that import. The full Vitest run
exposed unrelated existing worker timeouts and certification-suite failures, so
it was stopped after the failures were identified. The live refresh completed
with seven current facts and zero fetch failures.
