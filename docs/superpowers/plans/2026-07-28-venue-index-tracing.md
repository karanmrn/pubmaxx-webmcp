# Venue Index Runtime Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every App Router runtime entry that reaches `lib/venueIndex.ts` explicitly ships every enabled city venue pack.

**Architecture:** Add a build-time source scanner that follows local static imports from App Router entries to `lib/venueIndex.ts`, then derives exact escaped route globs from those entries. `next.config.mjs` turns those discovered globs into `outputFileTracingIncludes` entries using the existing city-pack registry, while preserving `/feed`'s separate drink-price overlay include.

**Tech Stack:** Next.js 16 App Router, Node.js ESM, TypeScript, Vitest

## Global Constraints

- Do not change runtime reader behaviour.
- Derive route includes from runtime readers and venue-pack files from `lib/cityVenuePacks.mjs`.
- Build with `NEXT_DIST_DIR=.next-prod`.
- Never manually modify generated files.

---

### Task 1: Derived reader discovery

**Files:**
- Create: `lib/venueIndexTracing.mjs`
- Create: `lib/venueIndexTracing.d.mts`
- Test: `__tests__/venueIndexTracing.test.ts`

**Interfaces:**
- Consumes: project root containing `app`, `components`, `lib`, and `lib/venueIndex.ts`
- Produces: `discoverVenueIndexRouteGlobs(projectRoot): string[]`

- [ ] **Step 1: Write failing discovery tests**

Create a synthetic source tree with a page importing a helper that imports `@/lib/venueIndex`, a dynamic Open Graph reader, a direct route reader, and an unrelated page. Assert:

```ts
expect(discoverVenueIndexRouteGlobs(root)).toEqual([
  "/api/direct",
  "/bar/\\[id\\]/opengraph-image",
  "/cyclic",
  "/nested",
]);
```

Also load real project discovery and assert each discovered route has every value returned by `enabledVenuePackIncludes()` in evaluated Next config.

- [ ] **Step 2: Verify test fails**

Run:

```bash
npx vitest run __tests__/venueIndexTracing.test.ts
```

Expected: failure because `lib/venueIndexTracing.mjs` does not exist.

- [ ] **Step 3: Implement source graph and route conversion**

Recursively read runtime source files under `app`, `components`, and `lib`. Resolve literal `@/` and relative static imports, follow their dependency graph, select App Router `page`, `route`, and `opengraph-image` entries that reach `lib/venueIndex.ts`, remove route-group and parallel-slot segments, escape dynamic-segment brackets for picomatch, sort, and deduplicate.

- [ ] **Step 4: Verify discovery test reaches config failure**

Run:

```bash
npx vitest run __tests__/venueIndexTracing.test.ts
```

Expected: synthetic discovery passes, real config coverage fails because reader routes are not yet declared.

### Task 2: Next tracing declaration

**Files:**
- Modify: `next.config.mjs`
- Test: `__tests__/venueIndexTracing.test.ts`

**Interfaces:**
- Consumes: `discoverVenueIndexRouteGlobs(projectRoot)` and `enabledVenuePackIncludes()`
- Produces: one `outputFileTracingIncludes` entry per discovered reader route

- [ ] **Step 1: Derive venue-index route includes**

Evaluate discovery once while loading config:

```js
const venueIndexFiles = enabledVenuePackIncludes();
const venueIndexRouteIncludes = Object.fromEntries(
  discoverVenueIndexRouteGlobs(projectRoot).map((route) => [route, venueIndexFiles]),
);
```

Spread those entries into `outputFileTracingIncludes`. Merge `/feed` with its drink-price overlay so collision with its derived venue-pack entry loses neither include.

- [ ] **Step 2: Verify focused tests pass**

Run:

```bash
npx vitest run __tests__/venueIndexTracing.test.ts __tests__/feedTracing.test.ts __tests__/freshnessTracing.test.ts
```

Expected: all tests pass.

### Task 3: Production trace and full verification

**Files:**
- Verify: `.next-prod/server/app/**/{page,route}.js.nft.json`

**Interfaces:**
- Consumes: production build output and discovered reader entries
- Produces: build evidence that each reader function ships every enabled venue pack

- [ ] **Step 1: Build isolated production output**

Run:

```bash
NEXT_DIST_DIR=.next-prod npm run build
```

Expected: exit 0.

- [ ] **Step 2: Inspect exact NFT files**

Read `.next-prod/server/app-paths-manifest.json`, map every discovered route entry to its `.js.nft.json`, and assert each trace contains every enabled venue pack.

- [ ] **Step 3: Run project gate**

Run:

```bash
npm run verify
```

Expected: exit 0.

- [ ] **Step 4: Review, restore generated churn, and commit**

Run closeout review skills, restore `next-env.d.ts` if build changed it, confirm only scoped files remain, then commit:

```bash
git add next.config.mjs lib/venueIndexTracing.mjs lib/venueIndexTracing.d.mts __tests__/venueIndexTracing.test.ts docs/superpowers/plans/2026-07-28-venue-index-tracing.md
git commit -m "fix: trace venue index readers"
```
