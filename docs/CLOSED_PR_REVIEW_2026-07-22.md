# Closed PR review and implementation record — 2026-07-22

Owner-facing audit trail for Fable. This file records the fixed review scope,
independent Standards and Spec results, inherited reviewer comments, browser QA,
changes made, and verification evidence.

## Corpus and fixed point

- GitHub inventory at review time: **394 closed PRs** — **358 merged**, **36 closed
  without merge**. The closed-without-merge set ends at #264; it is historical or
  superseded work and contributes no diff to current `main`.
- Prior corpus reviews remain in
  [`REVIEW_STANDARDS_AXIS_2026-07-18.md`](./REVIEW_STANDARDS_AXIS_2026-07-18.md),
  [`REVIEW_SPEC_AXIS_2026-07-18.md`](./REVIEW_SPEC_AXIS_2026-07-18.md), and the
  `DEEP_REVIEW_*` / `FINDINGS_CONFIDENCE_*` chain. This pass inventories the full
  closed set and deeply re-reviews the six PRs closed on 22 July: **#489–#494**.
- Fixed point: `a3e37b40163227abb8c90edbd3086ba5db05972d`.
- Diff: `git diff a3e37b40163227abb8c90edbd3086ba5db05972d...HEAD`.
- Spec sources: the complete bodies of #489–#494 and
  [`SOL_SYNC_2026-07-22.md`](./SOL_SYNC_2026-07-22.md). The repository does not
  contain `docs/agents/issue-tracker.md`, so GitHub PR bodies/comments were read
  directly with the authenticated GitHub CLI.

| PR | Standards | Spec | Action in this pass |
|---|---|---|---|
| #489 entry boot stamp | Pass | Pass | None |
| #490 sharp CVE unblock | Pass | Pass | None |
| #491 road-following routes | Pass | Fail: mixed route looked fully routed | Fixed + regression tests |
| #492 metadata sweep | Pass | Fail: retired handle kept obsolete canonical | Fixed + regression tests |
| #493 plan mini-map | Pass | Fail: clipped detours and stale state/names | Fixed + regression coverage |
| #494 walk-route hardening | Pass | Pass | Added concurrent deduplication and a global fan-out backstop |

## Standards

No hard violation of `AGENTS.md`, `README.md`, `CONTEXT.md`, `package.json`, or
`eslint.config.mjs` was found. Keyless operation and the standard command surface
remain intact.

The first pass confirmed one judgement-call smell: **Duplicated Code**.
`lib/walkRoute.ts` and `lib/routeMiniMap.ts` independently defined `LngLat` and
the stop-query encoder, while `PlanRouteMiniMap.tsx` repeated the route-source
union. The independent second pass found three remaining low-severity shapes:
the mini-map's `stopsParam` middle-man, a repeated plan-stop contract, and
duplicate unknown-JSON coordinate decoding in the ORS provider/cache store.
All are now resolved through canonical `encodeStops`, `PlanRouteStop`,
`parseLngLatArray`, `LngLat`, and `WalkRouteSource` exports.

Existing reviewer findings reproduced on pre-fix `HEAD`: five fully, one partly,
and one conditionally. The five full reproductions were the mixed-route styling,
obsolete alias canonical, clipped detour, stale prior route, and stale accessible
venue names. The unrestricted-fan-out report was partly addressed by #494's rate
limit but still lacked single-flight deduplication. This pass adds process-local
single-flight, a five-second durable same-leg lease across serverless instances,
and an IP-independent global request ceiling for forwarding-header rotation.

## Spec

Five findings. PRs **#489, #490, and #494 passed**; **#491, #492, and #493
failed** before this implementation pass.

1. #491 promised that straight fallback geometry stays dashed, but a mixed
   ORS/straight route was flattened to overall `ors` and drawn solid.
2. #492 promised one canonical public profile URL, but a retired handle was
   canonicalised before the client redirected it to the current handle.
3. #493 fit bounds around stops only, so legitimate road detours could leave the
   SVG viewBox.
4. #493 left the previous plan's mini-map visible while replacement stops loaded.
5. #493 keyed its effect only by venue IDs, so renamed venues left stale names in
   the SVG description.

No scope creep was found. The worst Spec issue was #491 presenting approximate
fallback geometry as a real walking route.

The independent second pass rechecked all five fixes. Route honesty, detour
bounds, and keyed stale-state/name handling passed. Two partials were hardened:
an alias-store outage now omits canonical/OG URLs and emits `noindex`, and
same-leg ORS misses now take a short durable lease before spending the shared
key. #492's original privacy wording is narrowed by necessity: metadata reads
only public handle-resolution fields, never profile content or social data.

**Axis summary:** Standards — 0 hard violations, 3 low-severity smell shapes,
all resolved. Spec — 5 initial findings plus 2 second-pass edge cases, all
resolved under the production durable-store contract; worst was mixed-route
honesty.

## Reviewer-comment ledger

| Origin | Finding | Pre-fix state | Resolution |
|---|---|---|---|
| #491 | Public ORS fan-out | Partial: rate limit landed, no single-flight | Same-process misses share one promise; durable deployments take a per-leg lease across instances |
| #491 | Mixed route loses fallback status | Reproduced | Overall source is `ors` only when every leg routed |
| #492 | Alias keeps obsolete canonical | Reproduced | Server metadata resolves the public handle alias |
| #493 | Routed detour leaves viewBox | Reproduced | Bounds include stops and every routed vertex |
| #493 | Previous route survives stop change | Reproduced | Render state is keyed; mismatched prior state renders nothing |
| #493 | Venue rename keeps stale label | Reproduced | Effect key includes ID, name, and position |
| #494 | Forwarded header rotates rate budget | Reproduced outside a trusted edge | Added an IP-independent global route bucket and rotation regression test |

## Implementation ledger

- `lib/walkRoute.ts`: all-legs honesty for the stitched route source.
- `app/api/walk-route/route.ts`: process-local single-flight map for concurrent
  cache misses; entries are deleted in `finally`. A durable global request
  bucket now caps total ORS fan-out even when caller IP keys rotate, and a short
  per-leg lease suppresses cross-instance duplicate misses.
- `lib/routeMiniMap.ts`: canonical walk-route encoder/types plus a pure
  `fitRouteDiagram` helper that includes routed vertices in bounds.
- `components/plan/PlanRouteMiniMap.tsx`: keyed render state, name-aware effect
  identity, and complete-geometry fitting.
- `app/u/[handle]/page.tsx`: public alias resolution before title/canonical/OG
  metadata is emitted; storage outages fail closed for indexing while useful
  title/description metadata still renders.
- Shared route encoding, coordinate validation, route source, and plan-stop
  contracts were consolidated to remove the second-pass duplication findings.
- Six focused test files now cover mixed routes, process/durable deduplication,
  global limiter rotation, alias canonicals, storage failure, shared coordinate
  decoding, and routed-detour fitting.

## Desktop and mobile QA record

Both requested UI-control paths were used.

- In-app Browser, live deployment `https://pubmaxxing.com/`: desktop
  **1440×900** and mobile **390×844**. Primary CTAs, responsive six-item bottom
  navigation, semantic headings, theme control, and core links were present.
- Computer Use, Google Chrome, `https://pubmaxxing.com/map/london`: existing
  mobile-width map and maximised desktop map. The mobile map exposed Near me,
  Tonight, Filters, route planning, map controls, and the bottom navigation; the
  desktop map exposed search, drink/zone filters, Plan tonight, status layers,
  map controls, and list view.
- Deployment mismatch to track separately: the live wordmark still renders
  **PUBMAXXING** while current `main` and `CONTEXT.md` use **PUBMAXX**. This is a
  deployment/version observation, not a defect introduced by #489–#494.
- Local `next dev` became ready but its first `/` compilation did not finish
  within the browser navigation window in this large shared worktree, so visual
  evidence was taken from the live deployment. Code-level fixes were verified
  locally below.

## Verification

- Focused Vitest after the second implementation pass: **65 tests passed**
  across profile metadata, route mini-map, walk-route core/API/provider/store;
  the subsequent full gate also covers the added shared-decoder regression.
- `npm run verify`: **passed end to end** — all 14 bundled datasets valid,
  repo-wide ESLint 0 errors (37 pre-existing warnings), TypeScript clean,
  **495 test files / 4,732 tests passed** with coverage, and `npm audit` found
  **0 vulnerabilities**.
- Coverage: statements 78.49%, branches 69.83%, functions 83.90%, lines 82.47%.
- Advisory data freshness remains over budget for price updates, night signals,
  weather, and What's On; validation explicitly treats these as non-failing.
- `git diff --check`: passed.

## Remaining follow-up

- Run a key-backed preview with a real ORS mixed route to capture the dashed
  honesty state and an extreme detour in screenshots; keyless mode cannot create
  that visual condition.
- If PUBMAXX is deployed outside Vercel, the edge should still overwrite
  `x-forwarded-for` / `x-real-ip`; the new global bucket limits aggregate abuse
  but cannot restore fair per-client accounting behind an untrusted proxy.
- Confirm the production deployment contains the current PUBMAXX wordmark and
  the #489–#494 merge set before Fable's final visual sign-off.
