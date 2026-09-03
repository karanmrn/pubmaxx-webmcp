# UK-wide OSM Pub Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce resumable, committed UK OSM pub seed packs and a normalized dataset with curated overlap reporting, without runtime integration.

**Architecture:** Tile the UK bbox into stable 1 degree cells and clip every Overpass query to UK relation 62149. Store each raw response independently, rebuild one normalized OSM-id-unique pack from all raw chunks, then annotate overlap against curated London and existing city packs.

**Tech Stack:** Node.js ES modules, Overpass QL, Vitest, JSON seed packs.

## Global Constraints

- Keep `[timeout:90]`, two Overpass endpoints, five attempts, inter-chunk delay, and exponential backoff on 429/502/503/504.
- Retain `outdoor_seating` as `outdoorSeating` and every `smoking` or `smoking:*` tag verbatim.
- Do not touch `lib/cities.ts`, `venues_slim.json`, map components, UI, or enrichment crons.
- Stop for a decision if committed `data/osm/uk/` size exceeds 100 MiB.

---

### Task 1: Verify grid, query, and retry contract

**Files:**
- Modify: `__tests__/ukOsmSeedPacks.test.ts`
- Modify: `scripts/lib/ukOsmSeed.mjs`
- Modify: `scripts/fetch_uk_osm_pubs.mjs`

**Interfaces:**
- Consumes: `UK_BBOX`, UK relation 62149, 1 degree default steps.
- Produces: 132 stable chunks and Overpass queries using the required timeout.

- [x] **Step 1: Write the failing timeout regression**

```ts
const query = buildUkOverpassQuery([54, -8, 55, -7]);
expect(query).toContain("[timeout:90]");
```

- [x] **Step 2: Run the focused test and confirm expected failure**

```bash
npx vitest run __tests__/ukOsmSeedPacks.test.ts
```

Expected: query assertion fails because current default is 180 seconds.

- [x] **Step 3: Align query and fetch retry settings with existing city fetcher**

```js
const MAX_ATTEMPTS = 5;
const QUERY_TIMEOUT_S = 90;

export function buildUkOverpassQuery(bbox, { timeout = 90 } = {}) {
```

- [x] **Step 4: Run focused tests**

```bash
npx vitest run __tests__/ukOsmSeedPacks.test.ts
```

Expected: all UK OSM tests pass.

- [x] **Step 5: Pin resume compatibility and a stable rate-limited grid**

```ts
expect(runFetcherList("--skip-if-present").status).toBe(0);
expect(runFetcherList("--lat-step=0.5").status).toBe(1);
expect(runFetcherList("--delay-ms=0").status).toBe(1);
```

Expected: city-style resume syntax works, while raw-pack layout and rate-limit safety cannot be overridden.

### Task 2: Verify normalization and overlap behavior

**Files:**
- Create: `scripts/lib/osmPubNormalizer.mjs`
- Create: `scripts/lib/osmPubNormalizer.d.mts`
- Create: `scripts/fetch_city_osm_pubs.d.mts`
- Modify: `scripts/fetch_city_osm_pubs.mjs`
- Modify: `scripts/lib/ukOsmSeed.mjs`
- Modify: `scripts/lib/ukOsmSeed.d.mts`
- Modify: `__tests__/ukOsmSeedPacks.test.ts`

**Interfaces:**
- Consumes: raw Overpass nodes and ways plus curated London and city records.
- Produces: one shared normalized pub contract with raw smoking tags, used by city and UK fetchers, plus optional UK `curatedRef`.

- [x] **Step 1: Write failing shared-normalizer regression**

```ts
const normalized = normalizeOverpass({ elements: [pubElement({ tags: {
  amenity: "pub",
  name: "Shared Arms",
  smoking: "outside",
} })] }, city);
expect(normalized.pubs[0].smoking).toEqual({ smoking: "outside" });
```

- [x] **Step 2: Run focused test and confirm expected failure**

```bash
npx vitest run __tests__/ukOsmSeedPacks.test.ts
```

Expected: city normalizer returns no `smoking` field before consolidation.

- [x] **Step 3: Extract and adopt one OSM pub normalizer**

```js
const pub = normalizeOsmPubElement(element, { fallbackCity: city.displayName });
const ukPubs = normalizeElements(rawElements);
```

Both `scripts/fetch_city_osm_pubs.mjs` and `scripts/lib/ukOsmSeed.mjs` consume this owner directly.

- [x] **Step 4: Run normalization and dedupe unit coverage**

```bash
npx vitest run __tests__/ukOsmSeedPacks.test.ts
```

Expected: coverage confirms both consumers share smoking retention, plus way centers, unnamed-record rejection, OSM-id dedupe, name-distance matching, and overlap totals.

- [x] **Step 5: Inspect committed report totals**

```bash
node -e 'const r=require("./data/osm/uk/dedupe_report.json"); console.log(r)'
```

Expected: `matchedTotal + uniqueToUk === ukPubs` and each existing source has an entry.

### Task 3: Rebuild from committed raw packs

**Files:**
- Regenerate: `data/osm/uk/chunks.json`
- Regenerate: `data/osm/uk/uk_osm_pubs.json`
- Regenerate: `data/osm/uk/dedupe_report.json`

**Interfaces:**
- Consumes: all files under `data/osm/uk/raw/`.
- Produces: complete manifest, normalized pack, and overlap report without network access.

- [x] **Step 1: Exercise resumable offline rebuild**

```bash
npm run fetch:uk-pubs -- --from-raw
```

Expected: 132 chunks read, zero missing chunks, 38,215 named pubs written, and pack size below 100 MiB.

- [x] **Step 2: Confirm generated structure and size**

```bash
du -sk data/osm/uk
node -e 'const m=require("./data/osm/uk/chunks.json"); if (m.missingChunks.length) process.exit(1)'
```

Expected: size below 102,400 KiB and no missing chunks.

### Task 4: Verify documentation and restricted scope

**Files:**
- Review: `data/osm/uk/README.md`
- Modify: `README.md`
- Review: `package.json`

**Interfaces:**
- Consumes: generated pack contract.
- Produces: one refresh command and queued-runtime consumption instructions.

- [x] **Step 1: Check changed paths**

```bash
git diff --name-only origin/main...HEAD
```

Expected: data pipeline, tests, documentation, and package script only. No runtime or UI path appears.

- [x] **Step 2: Check documentation against measured artifacts**

```bash
node -e 'const p=require("./data/osm/uk/uk_osm_pubs.json"); const m=require("./data/osm/uk/chunks.json"); console.log(p.count,m.chunks,m.elements)'
```

Expected: generated pack and manifest agree, and root README links to the UK data handoff.

### Task 5: Run project gates and commit

**Files:**
- Modify only files required by verified findings.

**Interfaces:**
- Consumes: complete branch diff.
- Produces: committed branch ready for firstmate validation.

- [x] **Step 1: Run focused and full verification**

```bash
npx vitest run __tests__/ukOsmSeedPacks.test.ts
npm run verify
```

Result: focused tests, data validation, lint, typecheck, and 5,770-test coverage
pass. Final audit reports nine pre-existing dev-only ESLint dependency highs.
Firstmate decision `[key=audit-dev-cve]` keeps audit policy and tooling unchanged
in this data PR; separate dependency cleanup is queued.

- [x] **Step 2: Run project memory maintenance**

```bash
/Users/karanmanoharan/karan-agent-workspace/bin/fm-ensure-agents-md.sh .
```

Expected: existing `AGENTS.md` remains concise unless durable global knowledge is missing.

- [x] **Step 3: Commit remaining work**

```bash
git add -A
git commit -m "fix(data): align UK OSM fetch limits with city pipeline"
```

- [x] **Step 4: Confirm clean committed state**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: clean `fm/uk-osm-fetch` branch with all task work committed.

### Task 6: Harden resumability after independent review

**Files:**
- Modify: `scripts/fetch_uk_osm_pubs.mjs`
- Create: `scripts/fetch_uk_osm_pubs.d.mts`
- Modify: `__tests__/ukOsmSeedPacks.test.ts`
- Refresh: stale files under `data/osm/uk/raw/`
- Regenerate: `data/osm/uk/chunks.json`, `uk_osm_pubs.json`, `dedupe_report.json`

- [x] Write raw and generated JSON through atomic same-directory renames.
- [x] Reject malformed, truncated, remarked, missing-timestamp, future, and
  older-than-48-hour Overpass responses.
- [x] Make normal resume refetch unusable or stale cache entries while
  preserving `--from-raw` offline rebuild behavior.
- [x] Refresh 36 stale chunks and regenerate all derived artifacts.
- [x] Verify 132 current packs, zero count mismatches, 38,215 pubs, 3,039
  overlaps, 25.9 MiB total, and 24 focused tests.
- [x] Obtain independent re-review approval with no remaining blockers.
