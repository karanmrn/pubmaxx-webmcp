# Exa Gateway Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-only search-provider seam that can use Vercel AI Gateway Exa search during its free window, fall back to Tavily, and migrate the rotating city-enrichment cron without changing price acceptance rules.

**Architecture:** `lib/searchProvider.server.ts` owns the provider contract, environment selection, Exa adapter, Tavily adapter, fallback policy, and per-run gateway spend guard. The existing pure enrichment core receives an injected search object from the server cron, while the local CLI keeps its current Tavily path until a later migration. Exa returns official-page leads only; existing official-domain filtering, extraction, provenance, and downstream gates remain authoritative.

**Tech Stack:** Next.js 16 Node route handlers, Vercel AI SDK Gateway, Node.js ESM enrichment core, Vitest, Vercel Cron.

## Global Constraints

- Search providers are server-side only and must not enter client bundles.
- `SEARCH_PROVIDER=exa|tavily` selects the active provider; Exa is the default and Tavily remains a zero-code kill switch.
- Missing AI Gateway credentials or failed Exa calls fall back loudly to Tavily when Tavily credentials exist.
- Gateway calls have a hard per-run cap and cumulative call/token logs; the guard stops before another call when the cap is reached.
- Search results are leads. Existing official-domain, extraction, provenance, corroboration, and acceptance logic remains unchanged.
- Use British English and no em dashes.

---

### Task 1: Provider Contract and Spend Guard

**Files:**
- Create: `lib/searchProvider.server.ts`
- Test: `__tests__/searchProvider.test.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces `SearchProvider.search(request)` returning normalised result pages and run statistics.
- Produces `createSearchProvider(options)` with config-driven selection and Tavily fallback.
- Produces a per-run guard that rejects calls after `SEARCH_GATEWAY_MAX_CALLS` and logs calls, model, and estimated tokens.

- [ ] **Step 1: Write failing tests** for provider selection, missing Exa credential fallback, provider failure fallback, and guard exhaustion.
- [ ] **Step 2: Run `npx vitest run __tests__/searchProvider.test.ts` and confirm expected missing-module failures.**
- [ ] **Step 3: Add the smallest provider contract, guard, and dependency needed for the tests.** Keep imports server-only and avoid importing the provider from client modules.
- [ ] **Step 4: Run the targeted test and confirm it passes.**
- [ ] **Step 5: Commit `feat: add search provider seam and gateway guard`.**

### Task 2: Exa Gateway and Tavily Adapters

**Files:**
- Modify: `lib/searchProvider.server.ts`
- Test: `__tests__/searchProvider.test.ts`

**Interfaces:**
- Exa uses `generateText` and `gateway.tools.exaSearch()` with `openai/gpt-5-nano`, fast search, official-domain filters, date filters, and highlights capped for token efficiency.
- Tavily preserves the existing POST request shape and normalises `raw_content` or `content` into the shared result shape.
- Exa tool results are read from AI SDK step tool results. A missing or malformed tool result is a provider failure and can fall back.

- [ ] **Step 1: Add failing adapter tests** for Exa request options, normalised tool results, domain/date filters, and Tavily request compatibility.
- [ ] **Step 2: Run only those tests and confirm they fail for the missing adapter behaviour.**
- [ ] **Step 3: Implement both adapters with dependency injection for `generateText`, gateway, and fetch in tests.** Do not expose raw provider payloads beyond the server seam.
- [ ] **Step 4: Run provider tests and confirm all pass.**
- [ ] **Step 5: Commit `feat: add Exa Gateway and Tavily search adapters`.**

### Task 3: Migrate City Enrichment and Document Operations

**Files:**
- Modify: `scripts/lib/tavilyPubEnrichment.mjs`
- Modify: `lib/tavilyPubEnrichment.server.ts`
- Modify: `app/api/cron/enrich-city-pubs/route.ts`
- Test: `__tests__/cronEnrichCityPubsRoute.test.ts`, `__tests__/tavilyPubEnrichment.test.ts`
- Modify: `.env.example`, `docs/CRON_PLANE_RUNBOOK.md`, `docs/DEPLOYMENT.md`

**Interfaces:**
- The enrichment core accepts an optional injected search object; its default path remains the existing Tavily implementation for CLI compatibility.
- The cron constructs the selected provider, returns the current result contract, and logs provider and gateway budget statistics.
- Official-page checks, `extractPintPrices`, source URL/licence fields, and all price acceptance logic stay unchanged.

- [ ] **Step 1: Add failing migration tests** proving the cron can run through the shared provider and that its returned city, cursor, match, and price fields remain unchanged.
- [ ] **Step 2: Run focused cron/core tests and confirm the new contract fails.**
- [ ] **Step 3: Inject the provider into the core and wire the cron.** Missing credentials must be a loud safe no-op only when neither provider is configured; Exa failure must try Tavily before returning provider-unavailable.
- [ ] **Step 4: Update server-only environment and runbook pointers.** State that `SEARCH_PROVIDER` defaults to Exa, `TAVILY_API_KEY` is the rollback path, and gateway budget logs are authoritative for spend.
- [ ] **Step 5: Run focused provider, cron, and enrichment tests.**
- [ ] **Step 6: Commit `feat: migrate city enrichment to provider seam`.**

### Task 4: Closeout Validation

- [ ] Run `memory_pressure -Q` before any full suite.
- [ ] Run lint, typecheck, and the focused tests. Run at most one full suite if memory allows.
- [ ] Inspect diff and confirm no client import path, price-policy edit, or acceptance-gate edit.
- [ ] Fetch and rebase `origin/main` immediately before PR preparation.
- [ ] Commit any final coherent documentation or validation change.
