# Growth Activation Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three non-duplicate V1 growth gaps: honest free-text constraints, morning crew reuse, and a five-borough evidence pilot.

**Architecture:** Extend existing owners at their current seams. Grounded Plan selection converts reconciled Night Context into hard access constraints, Morning Re-entry composes the existing usual-lot store, and Borough Coverage adds one campaign row. No parallel models or compatibility layers.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, existing Supabase-backed stores.

## Global Constraints

- Use British spelling and no em dash.
- Start each behavior change with a failing test and observe the failure.
- Do not publish Pint Index claims while eligible observations remain zero.
- Do not add alcohol-volume rewards, public location, or public-by-default memories.
- Do not install dependencies or run full builds while disk space is constrained.
- Reuse root `node_modules`; run targeted Vitest, focused ESLint, typecheck when space permits, and `git diff --check`.

---

### Task 1: Enforce access constraints on free-text decisions

**Files:**
- Modify: `lib/planGenerationSelection.server.ts`
- Modify: `lib/tonightAgent.ts`
- Modify: `components/plan/TonightAgentPanel.tsx`
- Test: `__tests__/planRouteConstraints.test.ts`
- Test: `__tests__/planGenerateRoute.test.ts`
- Test: `__tests__/tonightAgent.test.ts`

**Interfaces:**
- Consumes: reconciled `NightContext`, `ParsedPlanGenerationIntake`, and existing `selectGroundedPlanRoute`.
- Produces: `buildTonightAgentGenerateBody(query: string)` and context-derived `PlanAccessibilityNeed[]` when intake did not answer access.

- [ ] **Step 1: Write failing selection and request-body tests**

```ts
expect(buildTonightAgentGenerateBody("  Step-free in Camden  ")).toMatchObject({
  query: "Step-free in Camden",
  intake: { version: 1, accessibilityNeeds: [], skipped: expect.arrayContaining(["accessibility"]) },
});
```

Add a selection fixture whose Night Context has `accessibility: ["step-free"]`,
whose skipped intake has no explicit access answer, and whose candidates have
unknown access. Expect grounded selection failure with accessibility rejects.

- [ ] **Step 2: Run tests and confirm red**

Run: `npx vitest run __tests__/tonightAgent.test.ts __tests__/planRouteConstraints.test.ts`

Expected: request builder missing and context access is not enforced.

- [ ] **Step 3: Implement minimum owner changes**

Use existing `PLAN_ACCESSIBILITY_NEEDS` as the closed vocabulary. Authoritative
answered intake wins. Skipped or absent intake falls back to supported values in
`context.accessibility`. Build Tonight Agent body with
`planIntakeHandoff(skipRemainingPlanIntake(createPlanIntakeDraft()))`.

- [ ] **Step 4: Run targeted route tests**

Run: `npx vitest run __tests__/tonightAgent.test.ts __tests__/planRouteConstraints.test.ts __tests__/planGenerateRoute.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/planGenerationSelection.server.ts lib/tonightAgent.ts components/plan/TonightAgentPanel.tsx __tests__/tonightAgent.test.ts __tests__/planRouteConstraints.test.ts __tests__/planGenerateRoute.test.ts
git commit -m "fix(plan): enforce free-text access needs"
```

### Task 2: Offer usual-lot planning from morning recap

**Files:**
- Modify: `components/night/MorningReentryCard.tsx`
- Modify: `components/night/morningReentry.css`
- Test: `__tests__/morningReentryCard.test.ts`

**Interfaces:**
- Consumes: `subscribeLastCrew`, `readLastCrew`, and `nextNightCommittedProps` from `lib/lastCrew.ts`.
- Produces: conditional `/plan` link and existing `next_night_committed` event.

- [ ] **Step 1: Write failing source-contract test**

```ts
expect(source).toContain('trackEvent("next_night_committed"');
expect(source).toContain('href="/plan"');
expect(source).toContain('crew.names.length < 2');
```

- [ ] **Step 2: Run test and confirm red**

Run: `npx vitest run __tests__/morningReentryCard.test.ts`

Expected: event and Plan action absent.

- [ ] **Step 3: Implement conditional action**

Read crew with `useSyncExternalStore`. Render one secondary link only for two
or more saved names. Keep names on-device and out of href and event props.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run __tests__/morningReentryCard.test.ts __tests__/morningReentry.test.ts __tests__/lastCrew.test.ts __tests__/analyticsEvents.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add components/night/MorningReentryCard.tsx components/night/morningReentry.css __tests__/morningReentryCard.test.ts
git commit -m "feat(recap): plan again with usual lot"
```

### Task 3: Expand seed campaign to Islington

**Files:**
- Modify: `lib/boroughCoverageStatus.ts`
- Modify: `__tests__/boroughCoverageStatus.test.ts`
- Modify: `docs/growth/SEED_BOROUGH_PLAYBOOK.md`

**Interfaces:**
- Consumes: existing `SEED_BOROUGH_CAMPAIGN` renderer and loader.
- Produces: fifth campaign row with slug and map query `islington` / `Islington`.

- [ ] **Step 1: Change test to require five unique rows and Islington**

```ts
expect(SEED_BOROUGH_CAMPAIGN).toHaveLength(5);
expect(SEED_BOROUGH_CAMPAIGN).toContainEqual({
  slug: "islington", name: "Islington", mapQuery: "Islington",
});
```

- [ ] **Step 2: Run test and confirm red**

Run: `npx vitest run __tests__/boroughCoverageStatus.test.ts`

Expected: length is four and Islington is absent.

- [ ] **Step 3: Add Islington and operator rationale**

Append the campaign row. Add playbook table row that states exact Plan support
and current curated density. Do not claim community corroboration exists.

- [ ] **Step 4: Run targeted tests**

Run: `npx vitest run __tests__/boroughCoverageStatus.test.ts __tests__/boroughs.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/boroughCoverageStatus.ts __tests__/boroughCoverageStatus.test.ts docs/growth/SEED_BOROUGH_PLAYBOOK.md
git commit -m "feat(growth): add fifth seed borough"
```

### Task 4: Integrate and verify

**Files:**
- Modify: `specs/growth-activation-wave/README.md`

**Interfaces:**
- Consumes: three task commits.
- Produces: one clean integration branch ready for review.

- [ ] **Step 1: Cherry-pick Task 2 and Task 3 into Task 1 branch**

Use explicit commit hashes. Resolve no unrelated files.

- [ ] **Step 2: Run combined targeted verification**

Run: `npx vitest run __tests__/tonightAgent.test.ts __tests__/planRouteConstraints.test.ts __tests__/planGenerateRoute.test.ts __tests__/morningReentryCard.test.ts __tests__/morningReentry.test.ts __tests__/lastCrew.test.ts __tests__/boroughCoverageStatus.test.ts __tests__/boroughs.test.ts __tests__/analyticsEvents.test.ts`

- [ ] **Step 3: Run focused lint and typecheck**

Run focused ESLint over changed TypeScript files. Run `npm run typecheck` only
if it does not require a new install or large generated output.

- [ ] **Step 4: Check patch integrity**

Run: `git diff --check origin/main...HEAD`

Expected: no output.

- [ ] **Step 5: Update spec and commit integration state**

Mark all shipped slices complete and record any skipped gate with the exact
resource reason.
