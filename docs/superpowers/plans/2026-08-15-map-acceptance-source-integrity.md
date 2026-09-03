# Map Acceptance Source Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove accepted-arrival provenance survives stale UI state, then move PubMap PlanningIntent reads into React's external-store contract.

**Architecture:** Use a deterministic unit case to check whether `acceptMapVenue` already protects a trusted arrival from stale UI state. Resolve Map receipt state with `useSyncExternalStore`, where the snapshot validates URL and session storage together and the server snapshot remains null.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/plans/2026-08-14-permanent-venue-acceptance.md`

> **Superseded within the same branch.** Task 2 below created
> `__tests__/pubMapAcceptancePurity.test.ts`, a source-regex test that asserted
> call shapes rather than behaviour. Branch review called it vacuous and the
> later memoised reader broke it, so it was deleted and replaced by real
> memoisation cases in `__tests__/mapAcceptance.test.ts`. The external-store
> snapshot contract this plan describes still holds; only the named test file is
> gone, so every command below that names it will not run as written.

## Global Constraints

- A URL source is trusted only when `accept=1`, `src`, selected Venue, city, and live PlanningIntent all match.
- Browsing a Venue never creates PlanningIntent.
- Only a confirmed storage write emits acceptance telemetry or opens Plan.
- Near and Tonight provenance must survive acceptance.
- React browser-state reads must use a supported external-store snapshot. Render never writes browser storage.
- Use PUBMAXX domain language and no em dash.

---

### Task 1: Event-time provenance authority

**Files:**
- Modify: `__tests__/mapAcceptance.test.ts`

**Interfaces:**
- Consumes: `acceptMapVenue(input, options): MapAcceptanceResult`
- Produces: proof that trusted accepted-arrival source overrides stale `input.source`

- [x] **Step 1: Write stale-source regression test**

Seed a valid Near PlanningIntent with area and dated price evidence. Call `acceptMapVenue` with `source: "map-search"` and a matching `?sel=...&accept=1&src=near` URL. Assert returned telemetry and stored intent still use `near`, with area and evidence unchanged.

- [x] **Step 2: Run diagnosis test**

Run:

```bash
npx vitest run __tests__/mapAcceptance.test.ts
```

Expected hypothesis: FAIL if current source equality downgrades the valid arrival. Actual result: PASS. The later rich-intent branch already restores the trusted Near envelope, so the reported provenance race does not reproduce.

- [x] **Step 3: Keep authority code unchanged**

Keep `acceptedArrivalIntent` and `acceptMapVenue` unchanged. Retain the new test as a guard for the stale UI source case.

- [x] **Step 4: Confirm focused test**

Run the same Vitest command. Expected: PASS.

### Task 2: PubMap render purity

**Files:**
- Create: `__tests__/pubMapAcceptancePurity.test.ts`
- Modify: `components/PubMap.tsx`

**Interfaces:**
- Consumes: `verifiedAcceptedArrivalSource(input, { cleanupInvalid: false })`
- Produces: `acceptedArrivalSource` external-store snapshot resolved after hydration and URL changes

- [x] **Step 1: Write failing source-contract test**

Read `components/PubMap.tsx`. Assert:

```ts
expect(source).not.toContain("function subscribeHydration");
expect(source).toMatch(/acceptedArrivalSnapshot[\s\S]*verifiedAcceptedArrivalSource/);
expect(source).toMatch(/acceptedArrivalSource = useSyncExternalStore/);
```

Also assert `verifiedAcceptedArrivalSource` is not assigned from a render-time ternary.

- [x] **Step 2: Run RED test**

Run:

```bash
npx vitest run __tests__/pubMapAcceptancePurity.test.ts
```

Expected: FAIL because PubMap currently reads PlanningIntent during render.

- [x] **Step 3: Move verification into an external-store snapshot**

Remove the fake hydration subscriber. Build a memoised snapshot from current search, selected URL Venue, and city with cleanup disabled. Subscribe to storage and popstate changes. Use null as the server snapshot. Keep receipt rendering driven by the verified snapshot.

- [x] **Step 4: Run GREEN tests**

Run:

```bash
npx vitest run __tests__/pubMapAcceptancePurity.test.ts __tests__/mapAcceptance.test.ts
```

Expected: PASS.

### Task 3: Browser provenance regression

**Files:**
- Modify: `e2e/venue-acceptance.spec.ts`

**Interfaces:**
- Consumes: valid Near PlanningIntent and accepted-arrival URL
- Produces: Plan receives original Near provenance after immediate Stop 1 action

- [x] **Step 1: Add browser provenance assertion**

Seed a valid Near PlanningIntent, open matching accepted Map URL, click `Make Arnos Arms Stop 1`, and assert stored source remains `near` and Plan shows its accepted handoff. This protects the complete browser path in addition to the deterministic unit regression.

- [x] **Step 2: Check reported comment violations**

Inspect the cited Near and Tonight acceptance comments. Both already use plain punctuation, so no source change is needed.

- [x] **Step 3: Run focused browser gate**

Run:

```bash
PW_SKIP_WEBSERVER=1 PW_PORT=3127 npx playwright test e2e/venue-acceptance.spec.ts --project=chromium --workers=1
```

Expected: PASS.

### Task 4: Verification and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-map-acceptance-source-integrity.md`

- [x] **Step 1: Run focused lint and typecheck**

```bash
npx eslint components/PubMap.tsx __tests__/mapAcceptance.test.ts __tests__/pubMapAcceptancePurity.test.ts e2e/venue-acceptance.spec.ts
npm run typecheck
```

- [x] **Step 2: Run full verification**

```bash
npm run verify
```

- [x] **Step 3: Review and commit**

```bash
git diff --check
git commit -m "fix: subscribe to accepted Venue state"
```
