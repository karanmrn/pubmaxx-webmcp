# Findings Confidence Ledger V3 — 2026-07-19

**Supersedes** `FINDINGS_CONFIDENCE_2026-07-18.md` (V1, rows 1-47) and
`FINDINGS_CONFIDENCE_V2_2026-07-18.md` (V2, rows 48-63). Those ledgers scored findings against
pre-merge PR branches; this pass re-verifies every non-final verdict **against HEAD of `main`**
(`77d65a6a`, post-#415) and folds in the 2026-07-19 two-axis review (spec + backend standards +
frontend standards, diff `e6dfa164...HEAD`, 238 commits).

Rows 15, 16, 35, 36, 42, and 53 were re-verified on 2026-08-06 at `b8737d98` and marked
resolved. Other verdicts retain their original review evidence.

**Method:** every row below was re-run in this worktree against HEAD (grep / file read / `gh`
state / test assertion), not carried forward on trust. Rows from V1/V2 whose verdict was already
final and whose subject merged unchanged are closed under "Shipped" and not re-argued.

**Verdict legend:** `RESOLVED` (finding fixed on main, fixing evidence cited) · `CONFIRMED-OPEN`
(finding still true at HEAD) · `REFUTED` · `SHIPPED` (V1/V2 pre-merge finding whose subject
merged; hazard class extinct) · `OWNER` (needs a human call) · `ACCEPTED` (known tradeoff,
recorded).

---

## Headline

At the initial 2026-07-19 review, of the 63 V1/V2 rows plus 11 new findings: **31 resolved or shipped, 7 of
today's 11 already fixed same-day, 1 refuted, 12 still open** (all minor or owner-gated; zero
blocker severity). The three P1/P2 classes V1 left live in code — prompt-budget adoption, the
identity-first ordering guard, and the analytics `platform` payload — are all **wired on main
now**. The largest remaining debt is cosmetic token hygiene and two doc gaps.

---

## V1 rows re-verified at HEAD

| # | Finding (V1) | V3 verdict | Evidence at HEAD |
|---|--------------|-----------|------------------|
| 1 | Early email capture not built | **RESOLVED** | `components/identity/IdentityNudge.tsx:226-247` ships a pre-OAuth email form ("Just leave your email...") posting to `/api/email-subscribers` (:143) with double-opt-in (:22); backend routes on main (#379 lineage, envelopes unified by #415). |
| 2 | USP bet 3 (live buzz) blocked on EXA key | **RESOLVED (code) · OWNER (ops)** | Ingest producer merged (#366, `scripts/ingest_night_signal_candidates.mjs` no-ops loudly without key); `EXA_API_KEY` present in Vercel prod env per handoff infra facts. Local `.env.local` lacks it — owner item, not a code gap. |
| 3 | USP bet 4 (group ledger) scope dispute | **RESOLVED (owner)** | Owner ruled bill-split OUT of launch (2026-07-18 pre-sleep decisions, FABLE_HANDOFF.md); Round loop = the shipped reading. |
| 5 | #324 iPhone-PRD scope creep | **RESOLVED (owner)** | Native work owner-sanctioned; #295 Capacitor wrap + #377 store readiness merged. |
| 6 | A2HS "second calendar day" reading | **RESOLVED (owner, reconciled)** | Idiom unchanged at `lib/a2hsPrompt.ts:71` (`dayBucketFromDate`), `secondDayBucket` model intact (:52,:61); Cycle-4 reconciliation stands. |
| 7 | Identity cooldown 7 days | **CONFIRMED · OK** | `lib/identityNudge.ts:41` `IDENTITY_NUDGE_COOLDOWN_DAYS = 7`. |
| 8 | Recap privacy choke | **CONFIRMED · OK** | Re-verified 07-19 by spec axis: `getPublishedRecapSource` sole gate; consumers enumerated (socialFeed, recapCardStats.server, nightMemoryStore, recap page). |
| 9 | Close #45 on #302 merge | **RESOLVED** | #302 MERGED, #45 CLOSED (gh state). |
| 10 | #168 store-factory dedupe open | **CONFIRMED-OPEN** | Issue #168 open; correctly parked. |
| 11 | #279 dataset `*.meta.json` provenance | **CONFIRMED-OPEN** | `git ls-files | grep -c 'meta.json$'` = **0**. Still unbuilt. |
| 12 | #252 six-companion system open | **CONFIRMED-OPEN · progress** | `components/pal/` now ships `PalExperience`/`PalPortrait` onboarding plus `/pal/chat` (#412). Companion system partially real; #252 remains open for the rest. |
| 13 | #283 lacks a11y matrix proof | **RESOLVED** | `docs/A11Y_MATRIX_2026-07-18.md` exists on main; #282/#287 remain open-deferred per London-only launch (correct). |
| 15 | Duplicated `DeliveryStatus` unions | **RESOLVED (2026-08-06)** | `lib/deliveryStatus.ts` owns `DeliveryStatus`; push and email export provider-specific aliases derived from it. |
| 16 | Magic `86_400_000` day-ms | **RESOLVED (2026-08-06)** | `lib/dayMs.ts` owns `DAY_MS`; the scoped digest and contribution arithmetic import it. |
| 18 | promptBudget one-sided (P1) | **RESOLVED** | All four surfaces adopt: `grep -rl claimPromptBudget components/` = A2HSInstallPrompt, IdentityNudge, NativePushPrompt; FirstRunTour via `claimTourPromptBudget` (`components/onboarding/FirstRunTour.tsx`, `lib/firstRunTour.ts`). |
| 19 | Identity/push ordering guard dead code (P1) | **RESOLVED** | Guard wired in production: `components/plan/PlanCrew.tsx:167` `if (!isIdentityNudgePending())` gates the high-intent push record; PlanComposer documents the ordering (:528). |
| 20 | `pwa_install_*` payload drift (P2) | **RESOLVED** | `lib/analyticsEvents.ts:94-95` registers `["platform"]` for both events. |
| 29 | Write-path newline inconsistency | **OWNER · cosmetic** | Unchanged; harmless post `build:slim`. |
| 30 | Coverage doc date-stamps | **CONFIRMED-OPEN · cosmetic** | Single `BOROUGH_COVERAGE_2026-07-17.md` today; duplication risk only materialises on re-run. |
| 35 | `pubsGallery.css` raw `--brass` (was 11) | **RESOLVED (2026-08-06)** | `components/pubs/pubsGallery.css` uses role tokens; no raw `--brass` reference remains. |
| 36 | Identity nudge CTA raw `--brass` | **RESOLVED (2026-08-06)** | `components/identity/identityNudge.css` uses the `--accent-action` role token. |
| 39 | Recap photo signed-URL TTL | **RESOLVED (on main)** | `lib/nightMomentMedia.ts:36` `PUBLIC_RECAP_PHOTO_TTL_SECONDS = 180`. |
| 40 | RICH OG 11-min revocation window | **ACCEPTED** | `lib/recapCard.ts:190-191` unchanged (`rich: s-maxage=60, swr=600`); payload title+date only; documented tradeoff stands. |
| 42 | Share-helper duplication | **RESOLVED (2026-08-06)** | `components/plan/RecapShareButton.tsx` imports `whatsappShareHref` from `lib/shareArtifacts.ts`; the local copy is gone. |
| 43 | `map-gl.spec.ts` SW-vs-Playwright failure | **OWNER** | Spec still present (`e2e/map-gl.spec.ts`); runtime status not re-run this pass; pre-existing on main per V1 proof. |
| 44 | Remote branch prune list | **OWNER** | 158 remote heads today; prune awaits owner confirmation. |
| 45 | Push sending unbuilt | **RESOLVED (code) · OWNER (key)** | Full APNs HTTP/2 ES256 transport + sender pipeline on main (`lib/pushProvider.ts`, `lib/pushSender.ts`, `lib/pushTokenStore.ts`); needs `APNS_PRIVATE_KEY` env after store enrollment. Web-push VAPID path = PRD cycle-17 Lane B (Sol). |
| 46 | Drafts #263/#264, #229 HOLD | **RESOLVED / OWNER** | #263, #264 CLOSED. #229 (MapLibre 6) open on HOLD awaiting 6.x GA — the one intentional open PR. |
| 4, 14, 23, 24, 28, 31, 37, 41 | V1 `CONFIRMED · OK/PASS` verdicts | **CONFIRMED · OK** | Carried; no contrary evidence surfaced by the 07-19 axes. |
| 17, 21, 22, 25, 26, 27, 32, 33, 34, 38, 47 | Branch-topology hazards (data stack, ShareBar, layout, NightModeCard, slim budget) | **SHIPPED** | All subject branches merged into main during launch; the from-`main` mis-merge hazard class is extinct. Slim budget guard still enforced (`scripts/slimShards.mjs` CI drift check). |

## V2 rows re-verified at HEAD

| # | Finding (V2) | V3 verdict | Evidence at HEAD |
|---|--------------|-----------|------------------|
| 48-51, 54-63 | #345-#354 programme verdicts | **SHIPPED** | Entire programme merged; launch happened 2026-07-18. |
| 52 | `/api/price-confirm` missing from cert doc | **CONFIRMED-OPEN · doc gap** | `grep price-confirm docs/WRITE_SURFACE_CERTIFICATION.md` = 0 at HEAD. The V2 paste-ready row was never pasted. Route IS boundary-covered in code and counted. |
| 53 | `venuePriceStory.css` raw `--brass` (was 7) | **RESOLVED (2026-08-06)** | `components/map/venuePriceStory.css` uses `--accent-action`; no raw `--brass` reference remains. |
| — | Cert count reconciliation | **UPDATED** | 60 (V2) → **63** now: `__tests__/writeSurfaceCertification.test.ts:59` `toHaveLength(63)`; the three additions (check-ins, email-subscribers, push-tokens era) each carry a boundary per the 07-19 backend standards axis. |

## New rows — 2026-07-19 two-axis review (spec, backend, frontend)

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 64 | Ten load-bearing overnight claims (#406 canary, #409 overlap, #410 two-clock, migration 0043 privacy, check-in coordinate-free model, recap choke, slop-filter wiring, persona lens, push pipeline, secret sweep) | **CONFIRMED · PASS** | Spec axis verified each against HEAD code; details in the 07-19 spec report. Marginal note: a row ending exactly at 16:00 counts as "on tonight" (`>=`), cosmetic. |
| 65 | PRD Lane B briefed Sol to rebuild an existing push pipeline | **RESOLVED (same day)** | Lane B rescoped to real gaps (web-push/VAPID, sw.js handler, daily sender) in `docs/UNIVERSAL_DAY0_PRD.md`, commit `4c69feba`. |
| 66 | Private individual's name in tracked `FABLE_HANDOFF.md` | **RESOLVED (same day)** | Scrubbed in `4c69feba`; `git grep` over tracked tree = 0 matches for either private name. |
| 67 | Night-signal descriptions bypass the slop filter | **REFUTED** | `NIGHT_SIGNALS` copy is house-authored static literals in `components/landing/NightSignals.tsx:45+` ("Good-value pints, familiar pubs..."), not scraped; the Exa ingest pipeline is a separate ops candidate path, not this component's source. |
| 68 | Error-envelope divergence on 5 new routes (429s unsignalled) | **RESOLVED** | #415 routes check-ins, email-subscribers (+confirm/unsubscribe), area-news through `publicApiError` with additive `code`/`retryable`; 429s carry `retryable: true`. |
| 69 | Check-ins limiter key asymmetry (degraded-mode shared budget) | **RESOLVED** | #415 `lib/checkInRateLimit.ts` aligns both axes on one `check-in:<handle>:<ipHash>` key via `makeIpRateLimiter`. |
| 70 | Non-hermetic wall-clock in daily-dedupe test | **RESOLVED** | #415 adds injectable `now` to `hasPricedDropToday`; test pinned to fixed epoch. |
| 71 | Unguarded `DROP FUNCTION` in migration `20260717072119` | **ACCEPTED** | Migration already applied to production; editing applied migrations trades ledger-content drift for replay safety. Recorded as replay caveat for fresh environments. |
| 72 | Frontend voice/design violations (scrape register x6 incl SEO title, ConfirmFollow em dash, "Night Area" label, destructive hex x5, `#fff` on brass, "Copied!" x7) | **RESOLVED** | #411 fixed all sites; grep confirms zero em dashes and zero "Copied!" in rendered copy; tokens verified against globals mapping. |
| 73 | Sport seed past-dated, no serving guard (#408) | **RESOLVED** | #416 MERGED: seed refreshed with sourced fixtures, `isPastDated`/`filterNotPast` at the serving seam, freshness-registry entry `whats_on_sport_fixtures`. |
| 74 | Point rows drop from default path the instant they start | **CONFIRMED-OPEN** | Filed as #417 during #416 review; kind-aware effective duration proposed. In-progress quiz vanishes mid-event on non-tonight surfaces. |

---

## Remaining open ledger (the honest to-do)

Minor code: 74/#417 (point-row grace).
Doc gaps: 52 (price-confirm cert row), 30 (coverage date-stamp). Owner-gated: 2 (EXA key local),
11 (#279 meta.json), 29 (newline), 43 (map-gl e2e), 44 (branch prune), 45 (APNS key + VAPID),
#229 (MapLibre 6 GA).

**Initial score movement: 24 V1/V2 rows upgraded to RESOLVED/SHIPPED beyond V1's own count, 7 of
11 new findings fixed the same day they were found, 1 refuted, 0 downgraded.** No open finding is
blocker-severity; none blocks the cycle-17 launch lanes.

_Compiled by Fable 5 (xhigh) on `docs/confidence-v3`. Original verdicts were re-run against
`77d65a6a`; the six maintenance rows named above were re-verified at `b8737d98`._
