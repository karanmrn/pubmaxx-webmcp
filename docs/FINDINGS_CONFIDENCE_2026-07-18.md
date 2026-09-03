# Findings Confidence Ledger — 2026-07-18

> **Superseded by [`FINDINGS_CONFIDENCE_V3_2026-07-19.md`](FINDINGS_CONFIDENCE_V3_2026-07-19.md)**,
> which re-verifies every non-final verdict against post-launch `main` HEAD. This document is
> historical evidence of the pre-merge state.

Every OPEN finding across the programme's review corpus, raised from reviewer-prose to a
**confidence verdict** backed by mechanical evidence, so Sol merges on facts.

**Reviewer branch:** `review/findings-confidence` (from `main@a7beb42c`, in an isolated worktree —
the shared checkout's HEAD was never touched).

**Sources** (each fetched from its `review/*` branch at FETCH_HEAD):
`DEEP_REVIEW_APP_2026-07-18.md` (#321), `DEEP_REVIEW_DATA_2026-07-18.md` (#322),
`DEEP_REVIEW_C8_2026-07-18.md` (#332), `DEEP_REVIEW_RECAP_2026-07-18.md` (#336),
`REVIEW_STANDARDS_AXIS_2026-07-18.md` (#337), `REVIEW_SPEC_AXIS_2026-07-18.md` (#338),
and the "For Sol" flags in `fable-implement-prd.md`.

**Verdict legend:** `CONFIRMED` (finding stands, evidence quoted) · `REFUTED` (review was wrong) ·
`STALE` (since fixed — fixing branch/commit cited) · `OWNER-DECISION` (not mechanically verifiable,
needs a human call). `PASS`/`OK` sub-tag = the review asserted correctness and it holds.

---

## Headline

Two things every reviewer missed because they diffed *against `main`* while the lanes moved:

1. **The whole data chain has been rebased into a clean linear stack** since the DATA/C8 reviews.
   `#315 -> #320(base) -> #319 -> #317 -> #329` are now ancestor-linked; merging the stack tip
   `#317` into `main` is `merge-tree` rc=0 (clean). This makes the two **HIGH** data findings and
   both #329 **P2** hazards **STALE** — the "naive merge deletes 660 venues" trap no longer has a
   from-`main` `#319`/`#329` to naively merge. Proof: `#319`'s tip is literally
   `7fc92830 fix(data): repair borough labels on post-#315/#320 base (rebase of #319)`;
   `#329`'s `venues_slim.json` is now **1919 rows** (was 1271 at review time) and carries the
   core + 10 borough shards.
2. **Four other P2/MED fixes were applied on their own branches** (Cycle-8/9 remediation, none yet
   in `main` — `main` has only doc commits since the review points): C8 P2-c (unsubscribe guard),
   C8 P2-b (#329 build-script hand-merge), RECAP R2 (signed-URL TTL -> 180 s), C8 P3-a (#329 token
   migration, partial).

Everything the **APP** review flagged is still live (its fix PR `#323` exists but only ships the
mechanism + first-run-tour adoption; identity/push adoption and the ordering guard are still
un-wired). The **spec-axis** fidelity gaps are all genuine and mostly OWNER calls.

---

## The ledger

| # | Finding | Source | Verdict | Evidence | Action if any |
|---|---------|--------|---------|----------|---------------|
| 1 | Early email capture NOT built | spec-axis (a) | **CONFIRMED** | `git grep -iE 'emailCapture\|type="email"\|collectEmail'` over `app/`,`lib/`,`components/` on `feat/identity-nudges`,`feat/email-digest`,`main` = **0 hits**. `IdentityNudge.tsx` exposes only `signInWithGoogle`/`signInWithMicrosoft`; comment `:84` "hand off to the existing OAuth flow (email is captured there)". No surface takes the address *before* OAuth. | **OWNER-DECISION**: build a standalone email field pre-OAuth, or ratify OAuth-only as satisfying the "early email capture" lock. |
| 2 | USP bet 3 (live buzz) not built | spec-axis (a) | **OWNER-DECISION** | Owner-gated on `EXA_API_KEY` (Cycle-2 lock marks it BLOCKED); correctly deferred. | Ship when key lands; don't count in "all four bets built". |
| 3 | USP bet 4 (group ledger) redefined, not delivered as specced | spec-axis (a) | **OWNER-DECISION** | #318 polished the Round loop; bill-split "never existed" (Cycle-6 premise correction). Whether the bet is met depends on whether bill-splitting was ever in scope. | Owner rules on whether "ledger polish" = Round loop or the unbuilt bill-split. |
| 4 | Funnel four metrics — all four computable | spec-axis (a) | **CONFIRMED · PASS** | `lib/analyticsEvents.ts` on `#301` registers `invite_created`/`invite_redeemed` (:78-79), `activity_pulse:["dayBucket"]` (:83), `pwa_install_*` (:87-88); plan-created + A2HS present. | None — matches lock. |
| 5 | #324 iPhone-PRD scope-creep vs "mobile web only" | spec-axis (b) | **OWNER-DECISION** | Docs-only PR, no code risk; later owner-sanctioned (Cycle-7 Xcode directive). | Owner confirms the app-work reschedule; borderline, not a violation. |
| 6 | #313 A2HS gate is "second calendar day", not "second visit" | spec-axis (c) | **CONFIRMED** | `lib/a2hsPrompt.ts`: `dayBucketFromDate = floor(getTime()/MS_PER_DAY)` (:71-73); `recordVisitDay` stamps `secondDayBucket` only when `todayBucket !== state.firstDayBucket` (:197-198); `hasProvenValue = secondDayBucket !== null \|\| planCompleted` (:204-205). Test "same-day reloads are a no-op" (`a2hsPrompt.test.ts:180`). Two visits one evening never qualify. | **OWNER-DECISION**: confirm the day-bucket idiom is the intended reading of "second visit" (Cycle-4 already reconciled it). |
| 7 | #312 identity cooldown = 7 days | spec-axis (c) | **CONFIRMED · OK** | `IDENTITY_NUDGE_COOLDOWN_DAYS = 7`; only fires post-dismissal, never gates browsing. | None. |
| 8 | Recap set matches Cycle-9 lock | spec-axis (c) | **CONFIRMED · PASS** | Single public choke point `getPublishedRecapSource`; double-consent gate (see RECAP privacy results). R2 TTL fix now in-branch (row 39). | None. |
| 9 | #45 (Last Pint) close on merge of #302 | spec-axis (d) | **CONFIRMED** | #302 ships `buildLastPintShareText` + send-to-crew + calm phrasing; the one remaining #45 item is done. | **OWNER-DECISION**: close #45 when #302 merges. |
| 10 | #168 store-factory dedupe correctly still open | spec-axis (d) | **CONFIRMED** | Untouched by corpus; precondition "F2 merged first" unmet. | None — leave open. |
| 11 | #279 dataset provenance `*.meta.json` not built | spec-axis (d) | **CONFIRMED** | `git ls-tree -r … \| grep 'meta.json$'` on `data/outer-london-osm`,`data/borough-label-repair`,`main` = **0**. | Open; schedule the single-source meta.json. |
| 12 | #252 THE LOCAL six-companion system substantially open | spec-axis (d) | **CONFIRMED** | Corpus builds loop pieces (instant answer/guardian/drops/recap) but not the Fox/Black Cat/Greyhound/Pigeon/Badger/Corgi system. | Open — large owner-scoped scope. |
| 13 | Waves #283/#285 partial; #282/#287 correctly deferred | spec-axis (d) | **OWNER-DECISION** | #283 Wave-1 lacks the light/dark/reduced-accessibility matrix proof; #285 A2HS-only. #282/#287 deferred per London-only launch. | Owner: don't close deferred waves; supply the a11y-matrix proof for #283. |
| 14 | Zero documented-standard violations (naming, `any`, ts-ignore) | standards (a) | **CONFIRMED** | Banned spellings (`PubMax`/`Pub Max`/`Pubmaxing`) in **new** `lib`/`components`/`app` = none (`PubMaxingShell` is **pre-existing on `main`**, blob `069e663`, not new-code). No new `@ts-ignore`/`as any`. | None. |
| 15 | Duplicated delivery result types (`DeliveryStatus`) | standards (b)1 | **CONFIRMED · shapes congruent** | `PushDeliveryStatus` (`pushProvider.ts:28`, also `apns:34`) and `EmailDeliveryStatus` (`emailProvider.ts:43`) are **verbatim** `"sent"\|"skipped"\|"invalid"\|"error"`. `PerTokenResult{token,status,reason}` vs `PerMessageResult{to,status,reason,id}` — differ only by the `token`/`to` key + `id`. | Extract shared 4-member `DeliveryStatus` union; keep per-provider records. Low urgency. |
| 16 | Magic number `86_400_000` / `3_600_000` (DAY_MS/HOUR_MS) | standards (b)2 | **CONFIRMED** | `weeklyDigest.ts` `86_400_000` at :161,:180,:364 + `3_600_000` at :223; `pintContributions.ts:42` `86_400_000`. `git grep 'export const (DAY_MS\|HOUR_MS)'` = none. | Introduce shared `DAY_MS`/`HOUR_MS`. Minor. |
| 17 | Slim-shard pipeline byte-identical across lanes -> merge-order flag | standards (b)4 | **STALE** | Now moot: the data lanes are a linear stack (`#317 subset #329`), not independent byte-identical copies — the shared pipeline lands once via the stack. | None — superseded by the rebase. |
| 18 | `promptBudget` is a one-sided guard — only A2HS adopts it (P1) | deep-app §1a | **CONFIRMED · partially fixed by #323** | On `feat/a2hs-flow` only `A2HSInstallPrompt.tsx` calls `claimPromptBudget`. `#323` (`fix/prompt-orchestration`) adds first-run-tour adoption (`lib/firstRunTour.ts` `tourHasPromptBudget`/`claimTourPromptBudget`, used in `FirstRunTour.tsx:122,127`). `feat/identity-nudges` + `feat/native-first-run` still call it **nowhere**. | Apply the `#323` E5 adoption diffs to `IdentityNudge.tsx` (surface `identity-nudge`) and `NativePushPrompt.tsx` (`native-push`) **at rebase**. Grep-proof target: `grep -rl claimPromptBudget components/` = 4. |
| 19 | Identity+push both arm on one plan-join tap; ordering guard is dead code (P1) | deep-app §1b | **CONFIRMED** | `isIdentityNudgePending()` has **zero production callers** on `#312` (only `lib/identityNudge.ts:164` def, a comment at `PlanComposer.tsx:528`, and tests). `merge-tree #299×#312` = **CONFLICT in `components/plan/PlanCrew.tsx`** (rc=1). Both arm at the same anchor with no guard. | Resolve the PlanCrew conflict *as* the fix: `recordPlanNudgeTrigger()` then `recordPlanHighIntentAction()` only `if (!isIdentityNudgePending())` (#323 E5 step 29). |
| 20 | Analytics payload drift — `pwa_install_*` registered empty, A2HS emits `{platform}` (P2) | deep-app §3 | **CONFIRMED · still open** | `#301` `analyticsEvents.ts:87-88`: `pwa_install_prompt_available: []`, `pwa_install_completed: []` (allow-list strips extras). `#313` A2HS marks POST-#301 emits with `{platform}` — **comments only** (`A2HSInstallPrompt.tsx:139,172,199`), not yet a live `trackEvent`, so drift is latent until wiring. | When the A2HS emits are wired, register `pwa_install_prompt_available:["platform"]` + `pwa_install_completed:["platform"]` (+ validator) in `#301`. |
| 21 | ShareBar #307×#314 hard conflict (P2) | deep-app §4 | **CONFIRMED** | `merge-tree #307×#314` = **CONFLICT in `components/share/ShareBar.tsx` + `components/feed/FeedCard.tsx`** (rc=1). Not logically incompatible (fold vs channel-order). | Land one, rebase the other, re-apply by intent (keep #307's `compact`/`showChannels` gate wrapping #314's reordered channels + `whatsappShareHref`). |
| 22 | #299×#313 `app/layout.tsx` conflict (merge table) | deep-app §merge | **CONFIRMED** | `merge-tree #299×#313` = **CONFLICT in `app/layout.tsx`** (rc=1). | Keep both mounts (`<NativePushPrompt/>` + `<A2HSInstallPrompt/>`). |
| 23 | Map cluster (#306×#309, #297×#304) composes clean | deep-app §2 | **CONFIRMED · OK** (trusted) | Reviewer's pairwise `merge-tree`=0; orthogonal edits. Not re-run here (low risk, no shared mutation). | None. |
| 24 | Security spot-checks (push-token limiter, identity, A2HS, rounds) | deep-app §5 | **CONFIRMED · OK** (spot) | Push-token dual limiter hashes IP before keying; identity nudge has no auth surface; A2HS storage bounded; #318 touches no `app/api/**`. | Note the shared-fate global push cap (P3) if push becomes load-bearing. |
| 25 | HIGH-1 #319 hard-conflicts with #315/#320; naive merge deletes 660 venues | deep-data HIGH-1 | **STALE** | Chain rebased into a linear stack. `#319` now contains `#315` (ancestor check YES; `venues_slim.json` = **1919 rows**); tip `7fc92830 …rebase of #319`. Merging stack tip `#317` into `main` = `merge-tree` **rc=0 clean**. No from-`main` `#319` remains to mis-merge. | Merge as a stack (`#315->#320->#319->#317`), not as independent PRs; verify the standalone `#320` tip's extra probe commit is intended (row 30). |
| 26 | HIGH-2 merge-order doc (#316) has no data-chain guidance | deep-data HIGH-2 | **STALE** | `docs/MERGE_ORDER_2026-07-18.md` on `#316` "**Amended 2026-07-18**" now carries the strict data sub-order (steps 6-9: #315->#320->#319->#317, re-run notes) + the prompt-collision ordering + the `platform`-prop note. | The doc's premise "#319 branched from main" is itself now outdated vs the rebased branches — a cosmetic refresh, not a merge risk. |
| 27 | MED-3 #317 shard files stale after #319/#320 | deep-data MED-3 | **STALE** | `#317` now sits on the rebased chain: `venues_slim.json` = 1919 rows and it carries `venues_slim.core.json` + borough shards built from the final labels/prices. | Still run `validate-data` post-merge as the belt-and-suspenders check the doc specifies. |
| 28 | MED-4 #319×#317 shard-membership shift benign; budget holds | deep-data MED-4 | **CONFIRMED · benign** (now moot) | Reviewer reproduced 509.3 KB eager < 600 KB with 90 KB headroom; post-rebase this is the shipped state. | None. |
| 29 | LOW-5 write-path serialization inconsistency (trailing newline) | deep-data LOW-5 | **OWNER-DECISION · minor** | `apply_outer_london_prices.mjs` writes `…\n`; `repair_borough_labels.mjs` no newline. Harmless once `build:slim` regenerates. | Standardize one serialization; cosmetic. |
| 30 | LOW-6 #308 coverage doc date-stamps to "today" | deep-data LOW-6 | **CONFIRMED · cosmetic** | `report_borough_coverage.mjs` writes `docs/BOROUGH_COVERAGE_<today>.md`; a re-run emits a new date, leaving duplicates. | Cosmetic; pin or dedupe the date. |
| 31 | LOW-7 #319 blast-radius table ±1 | deep-data LOW-7 | **CONFIRMED · honesty intact** | Reviewer rebuild: `City of London 145->79` vs actual `144->78` (one venue, rounding); venue count conserved. | None. |
| 32 | P2-a #329 `venues_slim.json` delete-on-naive-merge (1271 rows) | deep-c8 P2-a | **STALE** | `#329` rebased onto `#317`: `venues_slim.json` now **1919 rows** (was 1271), carries `venues_slim.core.json` + shards + `zone`. The from-`main` copy the hazard needed is gone. | Merge after the data chain (already its position); no textual `venues_slim` merge. |
| 33 | P2-b #329×#317 `build_slim_index.mjs` conflict | deep-c8 P2-b | **STALE** | Hand-merge already on-branch: `scripts/build_slim_index.mjs` on `#329` imports **both** `classifySlimShards` (:27, #317's shard stage) and `loadStationZones`/`nearestStationZone` (:30, #329's zone stamp); both bodies present (:533,:601). | None — verify `build:slim` + `validate-data` green at merge. |
| 34 | P2-c #327 `{{unsubscribe_url}}` has no substitution and no guard | deep-c8 P2-c | **STALE** | Fix on-branch: `toEmailMessage(digest, {unsubscribeUrl})` is now **required** (throws if not http(s), `weeklyDigest.ts:564-567`), substitutes via `split(UNSUBSCRIBE_PLACEHOLDER).join(...)`, and `assertNoResidualPlaceholders` **throws** on any residual `{{…}}` (:540-548). | None — a wired transport physically cannot emit an unresolved placeholder. |
| 35 | P3-a #329 reintroduces the anti-patterns #328 deprecated (raw `--brass`) | deep-c8 P3-a | **STALE (partial)** | `components/zones/zonePintIndex.css` now uses role tokens (`--price-plaque-*`, `--accent-price-ink`, `--state-active-*`, `--badge-surface`; header comment documents the migration). **Residue:** `components/pubs/pubsGallery.css` still has **11** raw `--brass` refs. | Migrate `pubsGallery.css` zone pills -> `--badge-*` on rebase. #329 doesn't yet contain #328, so land #328 first (tokens undefined otherwise). |
| 36 | P3-b #326 nudge CTA uses raw `--brass` (intent consistent) | deep-c8 P3-b | **CONFIRMED · minor** | It's a genuine CTA, so the loud accent is licensed under #328; only nit is hard-coded `--brass` vs `--accent-action`. | One-line token swap on rebase after #328. |
| 37 | P3-c #325 "zero new dependencies" true for transport, not the PR | deep-c8 P3-c | **CONFIRMED · informational** | Transport signs ES256 via `node:crypto` + HTTP/2 via `node:http2` (`pushProvider.ts:7-10`) — no dep. The 5 Capacitor deps are inherited from the #295->#300 stack. | None — accurate about the transport. |
| 38 | R1 #334×#335 both edit `NightModeCard.tsx` — "zero file overlap" is false | deep-recap R1 | **CONFIRMED** | `merge-tree #334×#335` = **CONFLICT in `components/night/NightModeCard.tsx`** (rc=1). `Link`/`BookOpen` already imported -> structural conflict only. | #335 lands after #334; hand-merge per R1 (keep #334 `recapInvite` wrapper + #335 `<Link href={/plan/${id}/recap}>` inside nested actions). |
| 39 | R2 approved-photo signed URL outlives consent withdrawal ~1 h | deep-recap R2 | **STALE** | Fix on-branch: `lib/nightMomentMedia.ts:36` `PUBLIC_RECAP_PHOTO_TTL_SECONDS = 180`; `app/recap/[storyId]/page.tsx:8,97` signs with it (was `60*60`). Leak window 3600 s -> 180 s (~20×). Matches spec-axis note "#336's R2 fix dropped public-recap photo TTL to 180 s". | None — track before real public traffic is now satisfied. |
| 40 | R3 RICH OG card can serve a revoked recap's title+date ~11 min | deep-recap R3 | **CONFIRMED · accepted** | `lib/recapCard.ts` RICH `s-maxage=60, stale-while-revalidate=600`. Payload is only title+date; TTL split is correctly oriented (RICH short, FALLBACK long -> no cache-poison promotion of hidden data). | Documented tradeoff; accept as-is. |
| 41 | R4 "private" `/plan/[id]/recap` has no actor/auth check | deep-recap R4 | **CONFIRMED · OK** | Matches existing `/plan/[id]` URL-as-capability model; plan ids are v4 UUIDs (`isPlanId`), not enumerable; write actions stay memberToken-gated. No **new** leak class. | Informational — "private" = shared-link-private, same as the plan page. |
| 42 | R5 local copies of #314's share helpers (dedupe debt) | deep-recap R5 | **CONFIRMED · INFO** | `RecapShareButton.tsx` `whatsappHref` + `recapView.ts buildRecapShareText` duplicate `lib/shareArtifacts.ts`; authors annotated REBASE-BY-INTENT; no textual conflict. | Fold together whenever #314 + recap set both land. |
| 43 | Pre-existing e2e failure `map-gl.spec.ts` (SW caches tiles, bypasses `page.route`) | For-Sol PRD | **OWNER-DECISION** | Author proved identical on `main` baseline — not introduced by the corpus. | Separate SW-vs-Playwright fix; don't block merges on it. |
| 44 | 38 remote branches map to already-merged PR heads (prune list) | For-Sol PRD | **OWNER-DECISION** | Prune list ready; owner confirmation pending. | Owner confirms before pruning. |
| 45 | #295 leaves push SENDING unbuilt (needs APNs key) | For-Sol PRD | **STALE / ADDRESSED** | `#325` `feat/apns-transport` now ships the real sender (`createApnsPushProvider`, ES256/HTTP2, `pushProvider.ts:7-10`); C8 review ran 54/54 push tests in an APFS-cloned worktree. Still needs the Apple key at runtime. | Provide `APNS_PRIVATE_KEY`/topic env after enrollment; code path exists. |
| 46 | Drafts #263/#264 held; #229 MapLibre 6 HOLD | For-Sol PRD | **OWNER-DECISION** | Held by owner directive (#263 also has a red check). | Owner ships or drops; excluded from the order. |
| 47 | Slim payload budget flag 600->900 KB (needs sharding) | For-Sol PRD | **STALE / ADDRESSED** | `#317` `perf/slim-borough-shards` restores the eager budget: core+manifest ship eagerly, boroughs lazy; DATA review reproduced **509.3 KB eager < 600 KB**. CI fails on drift (`slimShards.mjs:22-23`). | None — budget is back under 600 KB, no 900 KB raise needed. |

---

## What changed under the reviewers (the load-bearing correction)

The DATA (#322) and C8 (#332) reviews were mechanically correct **at their fixed points** but their
two HIGH and two #329 P2 findings are now **STALE**: the lanes were rebased into a linear data stack
(`#315 -> #320 -> #319 -> #317 -> #329`), which is exactly the remediation those reviews prescribed.
Verified: `#317` (stack interior) and the stack generally merge into `main` with `merge-tree` rc=0;
`venues_slim.json` is 1919 rows across `#319`/`#317`/`#329`; `#329` carries the shards + `zone`.

The APP (#321) findings are the **only ones still fully live in code** — `#323` shipped the
`promptBudget` mechanism and first-run-tour adoption, but the identity/push adoptions and the
identity-first ordering guard (the actual P1) are still un-wired and land only when
`#312`/`#299` are rebased. Rows 18-22 are the real pre-merge work.

The spec-axis fidelity gaps (rows 1, 6, 11, 12) are genuine and are **OWNER-DECISION** calls about
intent, not code defects.

_Compiled by Fable 5 (Opus 4.8) on `review/findings-confidence`. Every load-bearing claim above was
re-run in this worktree (grep / `merge-tree --write-tree` / row-count / ancestry), not trusted from
the source review._
