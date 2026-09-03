---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
title: Whole-site speed programme
date: 2026-09-01
---

# Whole-site speed programme

Speed is the product differentiator. This plan makes every surface feel
instantly fast and makes the feeling measurable and enforced, building on the
existing discipline: `perf/route-budgets.json` (method: 4x CPU throttle,
390x844, median of 3), `docs/PERFORMANCE_BUDGETS.md`, `lib/webVitals.ts`
(privacy-safe, consent-gated), immutable hashed-static caching, region `lhr1`.

Targets: LCP <= 1.5s on `/` and `/pal` under the budget-file method; no route
ships more decoded JS than its ceiling; ceilings only ratchet DOWN (#1296 law).

Out of scope (in flight on other branches, do not touch): map viewport-first
loading, map camera fixes, UK pin contrast, the six UI polish findings, the
auth session seam.

## Settled decisions (KTDs)

- KTD-1 (user-directed): viewport-first progressive loading is the house
  pattern for heavy surfaces. Rejected: eager full-data loading.
- KTD-2 (user-approved): `perf/route-budgets.json` ceilings only come down.
  Rejected: per-PR raises. #1296 records lowering /map's 160 after lane
  consolidation.
- KTD-3 (user-directed): heavy verification runs on remote CI, never local
  full builds (8GB host). Rejected: local sweeps.

## Units

### U1. LCP ceilings enter the budget file
Add `lcpMs` per route to `perf/route-budgets.json` (same method block), with
the CI perf sweep measuring and enforcing it alongside requests/jsDecodedKB.
Seed ceilings from three measured runs on current production; `/` and `/pal`
get 1500. Wire `onLCP` through the existing `lib/webVitals.ts` mapping if not
already reported, so production RUM corroborates lab numbers.
Acceptance: CI fails when a route's median LCP exceeds its ceiling; budget
file documents the seed measurements.

### U2. Landing and /pal JS diet
`/` ships 1250KB decoded JS. Inventory what the landing actually parses before
first paint (analytics, posthog-js, @elevenlabs/react, ai SDK, providers) and
move everything not needed for first paint to idle-time or first-interaction
dynamic import. The consent banner must not pull the full analytics bundle
before consent. The landing measured 1143KB, but that cost is shared baseline
rather than landing-only code, so its 1250KB ceiling stays for the CI sweep to
ratchet. The /pal voice split is recorded in `docs/PERFORMANCE_BUDGETS.md`.
Acceptance: new lower ceilings committed and green in CI; no behaviour
fences broken; consent semantics unchanged.

### U3. Heavy-outlier routes /about and /pubs
The initial 1900KB and 1950KB ceilings were stale for these mostly-static
content pages. The production inventory found no accidental MapLibre, photo
editor, Convex or voice import to split, so this unit banks the slack instead.
The measured inventory and the 1200KB ceilings live in
`docs/PERFORMANCE_BUDGETS.md`.
Acceptance: both routes measurably below 1300KB or a documented reason why
not, ceilings ratcheted, no route regressed.

### U4. Dual backend-client audit
Both `convex` and `@supabase/supabase-js` ship as dependencies. Establish per
route which client is actually exercised; ensure neither is parsed on routes
that do not use it (entry-point isolation, not removal). If convex is
vestigial (no live route uses it), record that finding for the captain rather
than removing it in this lane.
Acceptance: written inventory in the PR body; any isolation shipped is fenced
by the budget ratchets from U2/U3.

### U5. Font weight subsetting
Three `next/font` families load (Space Grotesk, Inter, JetBrains Mono).
Inventory used weights/styles per family; drop unused ones from the loader
config. Keep metric-matched fallbacks (adjustFontFallback stays on).
Acceptance: fewer font files on first load, zero visual diff on the audited
surfaces at 390x844.

### U6. Cacheable API GET headers
Classify dynamic `/api/*` GET routes by
freshness contract (weather: 6h cron; whats-on: daily; manifest/slim-index
reads: per deploy) and add `s-maxage` + `stale-while-revalidate` where the
data's own refresh cadence makes it honest. Never cache personalised or
session-varying responses. Document each choice next to the route.
Night Area list and slug reads now use `jsonCached` because they contain bundled
deployment data; coordinate-bearing, live and personalised reads stay
uncached. The current classification lives in `docs/PERFORMANCE_BUDGETS.md`.
Acceptance: header tests per route class; no personalised route carries a
shared-cache header; measured repeat-visit latency improvement recorded.

### U7. API latency budgets
Create `perf/api-budgets.json` mirroring the route-budgets discipline:
per-route p50/p95 time-to-first-byte ceilings for the hot read APIs the map,
today, and out surfaces call. Trusted remote CI probes a successful main
deployment and fails on ceiling breach; pull-request previews stay outside the
credentialed probe because the probe executes deployed source. Down-only
ratchet from seed measurements. The probe uses curl-compatible response timing,
not a `Server-Timing` header.
Acceptance: file + CI job green with seeded ceilings; breach fails.

### U8. Ratchet automation
Small CI check: when a measured route beats its ceiling by >15% for the whole
sweep, print a warning table listing the ratchet candidates, so slack gets
banked as lower ceilings instead of quietly regrowing (#1296 pattern).
Acceptance: warning appears in CI output when slack exists; no auto-edit.

## Order and sizing

U1 first (instrumentation before diet, so every later unit proves itself),
then U2, U3 in either order, U5 and U6 cheap and parallel-safe, U4 as
investigation riding U2/U3's chunk work, U7 after U6, U8 last. One branch,
one commit per unit, no-mistakes validation per house law. Anything needing a
product call (removing a dependency, changing consent flow, caching a route
with ambiguous freshness) stops and escalates rather than deciding locally.

## Verification

The CI perf sweep (remote, per KTD-3) is the oracle for every unit. Before/
after numbers for each unit recorded in the PR body. Zero raised ceilings
anywhere (KTD-2). Existing fences stay green.

## Risks

- Chunk-splitting can move cost rather than remove it: the budget file's
  whole-sweep numbers are the guard.
- Cache headers on APIs risk stale reads: the freshness classification in U6
  is the contract; when in doubt a route stays uncached.
- Landing diet touching the consent banner risks consent semantics: fences
  first, then change.
