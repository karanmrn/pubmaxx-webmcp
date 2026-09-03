# Price Trust Reconciliation Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Recover first trust unlocks and missing credits after an accepted
community price outlives a failed trust-event write.

**Architecture:** A service-role-only queue is updated by a database trigger in
the price-write transaction. Direct submission and a bounded cron share one
idempotent pair reconciler. Revision-bound acknowledgement preserves a newer
concurrent write.

**Tech Stack:** Next.js App Router, TypeScript, Supabase PostgreSQL, Vitest,
Vercel Cron.

**Spec:** `docs/specs/2026-08-31-price-trust-reconciliation-queue.md`

## Current state

Tasks 1-3 are implemented in PR #1289. Review follow-up also keeps a failed
one-tap pairing from retaining trust and rotates unavailable queue pairs behind
newer work without dropping them. Focused tests, targeted ESLint, and diff
checks pass. Full suite, build, hosted CI, database application, merge, and
production proof remain separate release gates.

## Global Constraints

- Stable PUBMAXX User IDs own credits. Handles never do.
- Price trust uses the existing corroboration, age, agreement, and moderation
  policies.
- Browser roles cannot access queue, event, or credit tables.
- Price persistence stays successful when trust reconciliation is pending.
- Queue work is bounded and idempotent.

---

### Task 1: Durable reconciliation queue

**Files:**

- Create: `supabase/migrations/20260831120000_0126_price_trust_reconciliation_queue.sql`
- Create: `supabase/migrations/rollback/20260831120000_0126_price_trust_reconciliation_queue_rollback.sql`
- Create: `__tests__/priceTrustReconciliationMigration.test.ts`

**Interfaces:**

- Produces table `price_trust_reconciliation_queue(venue_id, category, version,
  enqueued_at)`.
- Produces service-role RPC `enqueue_price_trust_reconciliation(text, text)`.
- Produces trigger `community_prices_queue_price_trust`.

- [ ] **Step 1: Write failing migration shape tests**

Pin price-only trigger guards, version increment, service-role grants, browser
denial, and rollback removal.

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run __tests__/priceTrustReconciliationMigration.test.ts --maxWorkers=1
```

Expected: fail because migration files do not exist.

- [ ] **Step 3: Add queue migration and rollback**

Use one trigger function that queues attributed `NEW` work and any attributed
`OLD` pair removed by an authority-key update. Fire on insert and updates of
price-authority columns only. Use never-reused sequence revisions with:

```sql
on conflict on constraint price_trust_reconciliation_queue_pkey do update
set version = nextval('public.price_trust_reconciliation_version_seq'),
    enqueued_at = now()
```

- [ ] **Step 4: Run GREEN**

Run the focused migration test and `git diff --check`.

### Task 2: Idempotent queue store and pair reconciler

**Files:**

- Modify: `lib/priceTrustEventStore.ts`
- Modify: `lib/priceTrustImpact.server.ts`
- Modify: `__tests__/priceTrustEventStore.test.ts`
- Modify: `__tests__/priceTrustImpact.test.ts`

**Interfaces:**

- Produces `PriceTrustReconciliationTask`.
- Produces store methods `enqueueReconciliation`,
  `listPendingReconciliations`, `ackReconciliation`, and `ensureCredits`.
- Produces `reconcilePendingPriceTrust(task, now)`.
- Changes `syncTrustAfterPriceWrite` to return
  `Promise<PriceTrustReconciliation>`.

- [ ] **Step 1: Write failing recovery tests**

Pin failed first event, stored event with missing credits, repeated drain,
revision-bound acknowledgement, and failed work retention.

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run __tests__/priceTrustEventStore.test.ts __tests__/priceTrustImpact.test.ts --maxWorkers=1
```

Expected: fail because queue methods and reconciliation results do not exist.

- [ ] **Step 3: Implement minimal store and reconciler**

For a live event, resolve actors from the event's stored observation IDs and
call `ensureCredits`. For no live event, call the existing first-cluster writer.
Return unavailable for degraded reads, multiple live events, incomplete event
evidence, failed credit writes, or failed acknowledgement.

- [ ] **Step 4: Run GREEN**

Run both focused test files and strict targeted ESLint.

### Task 3: Accepted receipt and bounded cron

**Files:**

- Modify: `app/api/price-submit/route.ts`
- Create: `app/api/cron/reconcile-price-trust/route.ts`
- Modify: `vercel.json`
- Modify: `__tests__/priceSubmitRoute.test.ts`
- Create: `__tests__/cronReconcilePriceTrustRoute.test.ts`

**Interfaces:**

- Adds `trustReconciliation: "synced" | "pending"` to successful price POST
  responses.
- Adds cron GET `/api/cron/reconcile-price-trust` with a batch limit of 20.

- [ ] **Step 1: Write failing route tests**

Pin accepted price plus pending trust, cron authentication, successful
acknowledgement, failed-work retention, and concurrent revision safety.

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run __tests__/priceSubmitRoute.test.ts __tests__/cronReconcilePriceTrustRoute.test.ts --maxWorkers=1
```

Expected: fail because receipt field and cron route do not exist.

- [ ] **Step 3: Wire response and cron**

Map reconciliation result to receipt without changing the `201`. Authenticate
cron with `assertCronRequest`, process at most 20 tasks, acknowledge only synced
matching revisions, and return retryable `503` when work remains unavailable.

- [ ] **Step 4: Verify and ship**

Run focused tests, strict targeted ESLint, migration shape tests,
`git diff --check`, independent reviews, commit, push, and remote SHA
confirmation. Do not claim full typecheck if the 8 GB Mac cannot complete it.
