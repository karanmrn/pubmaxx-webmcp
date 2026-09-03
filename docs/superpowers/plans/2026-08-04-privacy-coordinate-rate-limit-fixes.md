# Privacy Coordinate and Rate-Limit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure viewer coordinates are coarsened to three decimals at every network boundary and durable rate-limit rows are deleted after their useful window.

**Architecture:** `lib/geo.ts` owns one point-level privacy seam used by browser request builders and server third-party forwarders. A forward migration adds an explicit expiry to `public.rate_limits`, prunes expired rows whenever either durable limiter write path runs, and refreshes expiry on every recorded hit.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, PostgreSQL/Supabase migrations.

## Global Constraints

- Bugs only. Do not add RLS policies.
- Coarsen viewer points to three decimal places before browser or server egress.
- Update only factual data-practice statements in `app/privacy/page.tsx`.
- Tests must fail on `origin/main` and pass after implementation.
- Do not merge, push to `main`, or deploy.

---

### Task 1: Shared coordinate egress seam

**Files:**
- Modify: `lib/geo.ts`
- Modify: `lib/venueJourney.ts`
- Modify: browser request callers under `app/` and `components/`
- Modify: `app/api/last-train/route.ts`
- Modify: `app/api/citymcp/journey/route.ts`
- Test: `__tests__/patchSeamAdoption.test.ts`
- Test: `__tests__/viewerCoordinateEgress.test.ts`
- Test: `__tests__/citymcpJourneyRoute.test.ts`

**Interfaces:**
- Produces: `coarsenViewerPoint(point: { lat: number; lng: number }): { lat: number; lng: number }`
- Consumes: finite latitude and longitude from browser geolocation, remembered public area centres, route bodies, and route query strings.

- [ ] **Step 1: Write failing egress tests**

Assert `loadWhatsOnTonight` changes `{ lat: 51.51361234, lng: -0.1365789 }` into `near=51.514,-0.137`. Assert the viewer-facing last-train URL builder applies the same reduction while public venue last-ride URLs keep their own accuracy. Assert POST journey forwarding and TfL StopPoint forwarding never receive more than three viewer-coordinate decimals.

- [ ] **Step 2: Run tests to verify expected failures**

Run: `npx vitest run __tests__/patchSeamAdoption.test.ts __tests__/viewerCoordinateEgress.test.ts __tests__/citymcpJourneyRoute.test.ts`

Expected: raw What's On, viewer last-train, and server-forwarded points violate the three-decimal assertions.

- [ ] **Step 3: Implement the single point seam**

Add a three-decimal point helper in `lib/geo.ts`. Remove caller-owned per-axis rounding and `privacyRoundedJourneyPoint`. Apply the shared helper inside viewer request builders, inside `loadWhatsOnTonight`, and immediately before server calls to TfL and CityMCP.

- [ ] **Step 4: Re-run focused tests**

Run: `npx vitest run __tests__/patchSeamAdoption.test.ts __tests__/viewerCoordinateEgress.test.ts __tests__/citymcpJourneyRoute.test.ts __tests__/venueJourney.test.ts __tests__/lastTrainDestination.test.ts`

Expected: all pass.

### Task 2: Durable rate-limit expiry

**Files:**
- Create: `supabase/migrations/20260804120000_0070_rate_limit_expiry.sql`
- Create: `__tests__/rateLimitExpiryMigration.test.ts`

**Interfaces:**
- Produces: `public.rate_limits.expires_at`, `public.prune_expired_rate_limits()`, refreshed `public.check_rate_limit`, and refreshed `public.charge_round_price_line`.
- Consumes: each call's `p_window_ms` as the row's useful lifetime.

- [ ] **Step 1: Write failing migration contract test**

Read the new migration and assert an indexed non-null expiry, an expiry delete using `expires_at <= now()`, cleanup from both durable writer functions, and expiry refresh using `p_window_ms`.

- [ ] **Step 2: Run test to verify expected failure**

Run: `npx vitest run __tests__/rateLimitExpiryMigration.test.ts`

Expected: fail because migration does not exist.

- [ ] **Step 3: Add forward migration**

Backfill existing rows with a bounded seven-day transition expiry, make the column non-null, add its index, define service-role-only cleanup, and redefine both writer functions so each call prunes all expired rows and extends only its own key by the exact limiter window.

- [ ] **Step 4: Re-run focused test**

Run: `npx vitest run __tests__/rateLimitExpiryMigration.test.ts __tests__/rateLimit.test.ts __tests__/roundPriceBudget.test.ts`

Expected: all pass.

### Task 3: Privacy notice and closeout

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `__tests__/legalPages.test.ts`

**Interfaces:**
- Consumes: implemented coordinate coarsening and durable limiter expiry.
- Produces: factual promises that viewer coordinates never leave at full precision and limiter rows are deleted after expiry.

- [ ] **Step 1: Tighten legal assertions and copy**

Replace the What's On full-precision disclosure with the shared three-decimal promise. Replace the retained-key disclosure with deletion after the configured limiter window.

- [ ] **Step 2: Run legal and focused privacy tests**

Run: `npx vitest run __tests__/legalPages.test.ts __tests__/viewerCoordinateEgress.test.ts __tests__/rateLimitExpiryMigration.test.ts`

Expected: all pass.

- [ ] **Step 3: Run required gates**

Run: `npx tsc --noEmit`, `npm run lint`, and `npm test`.

Expected: exit 0, lint has 0 errors, and suite reports at least 7,490 passing tests.

- [ ] **Step 4: Review and commit**

Inspect `git diff --check`, diff against `origin/main`, and changed-file scope. Commit with a bug-fix message. Do not push or create a PR.
