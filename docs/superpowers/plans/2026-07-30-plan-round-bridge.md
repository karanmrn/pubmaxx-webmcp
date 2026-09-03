# Active Plan to Round Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member viewing an active Plan start a Round with its ordered stops already queued.

**Architecture:** Reuse `RoundStarter` and `startRoundWithStops`, the bridge already used by the map route drawer. Mount it beside the member-only canonical Plan route, so venue names and ids cross only after the existing Plan capability gate. Round remains responsible for spend, membership, identity, and contribution policy.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright, Vitest.

## Global Constraints

- Do not change Plan generation, Round spend logic, pricing, identity, or contribution gates.
- Do not restyle Plan or Round.
- Do not refactor `components/PubMap.tsx` or `components/plan/PlanComposer.tsx`.
- Carry ordered venue ids and names plus Plan title. Do not carry Plan constraints because Round has no matching fields and adding them would require a new relationship.

---

### Task 1: Lock the active Plan journey

**Files:**
- Create: `e2e/plan-round-bridge.flag-on.spec.ts`

**Interfaces:**
- Consumes: existing Plan UI, `POST /api/plans`, `RoundStarter`, and Round routes.
- Produces: browser regression proving Plan stops retain order after Round start.

- [ ] **Step 1: Write the failing Playwright test**

Create a near-start Plan with three listed venues, open its full member view, discard a generated route draft, start a Round, and assert the Round route contains the same three canonical venue names in the same order.

- [ ] **Step 2: Run test to verify it fails**

Run: `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2=1 PW_PORT=3317 npx playwright test e2e/plan-round-bridge.flag-on.spec.ts --project=chromium-flag-on --workers=1`

Expected: FAIL because active Plan exposes no `Start Round` control.

### Task 2: Reuse the existing ordered-stop bridge

**Files:**
- Modify: `components/plan/PlanSummary.tsx`
- Test: `e2e/plan-round-bridge.flag-on.spec.ts`

**Interfaces:**
- Consumes: member-only `PlanState`, confirmed canonical stops, and `RoundStarter`.
- Produces: Plan detail control that creates a Round, adds stops sequentially, and navigates to `/rounds/{code}`.

- [ ] **Step 1: Add minimal implementation**

Keep confirmed canonical stops separate from editable draft state. Render `RoundStarter` after the canonical `PlanRoute`, passing `state.plan.title` and confirmed stops mapped to `{ id, name }`. Update confirmed stops only after a successful route save, and keep default navigation behavior.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- __tests__/startRoundWithStops.test.ts
PUBMAX_FRIEND_MEMBER_REHYDRATION_V2=1 PW_PORT=3317 npx playwright test e2e/plan-round-bridge.flag-on.spec.ts --project=chromium-flag-on --workers=1
```

Expected: both PASS.

- [ ] **Step 3: Verify quality and scope**

Run:

```bash
npm run lint
npm run typecheck
git diff --check
```

Check `components/PubMap.tsx` and `components/plan/PlanComposer.tsx` have zero changed lines. Record complexity delta for changed production code.

- [ ] **Step 4: Commit**

Commit message must state ordered venue ids, names, and Plan title carry into Round; Plan constraints do not because Round has no matching fields and the task does not add a new data relationship.
