# Merge Order Matrix — 2026-07-18

Executable merge plan for the open PR queue. Generated for Sol to run top-to-bottom.

- **Base:** `origin/main` @ `eee4f5f1` ("docs: Cycle 5 PRD").
- **PRs analyzed:** original 22 (`#276`, `#295`–`#315`) **plus** `#316`–`#322` (docs, data-chain follow-ups, and the two deep reviews) **plus** the in-flight `fix/prompt-orchestration` (no PR # yet). Held/excluded from the order: `#263`, `#264` (drafts), `#229` (MapLibre 6 HOLD). `#263` also has a red check.
- **Method (mechanically honest, no checkouts):** each PR was first proven to merge cleanly onto `main` in isolation (`git merge-tree --write-tree origin/main <branch>`). Pairwise conflicts were then found by **sequential simulation**: build the in-memory merge commit of A onto main (`git commit-tree` over the merge-tree), then `git merge-tree --write-tree --name-only <mergeCommit(A)> <branch B>`. rc≠0 with a `CONFLICT (content)` line = a real overlapping-hunk conflict. "Same file, different hunk" merges clean and is flagged below only as a co-touch review note, not a conflict.
- **Amended 2026-07-18** from two adversarial deep reviews (both machine-re-run, not trusted): `docs/DEEP_REVIEW_APP_2026-07-18.md` (`#321`, `review/deep-app`) and `docs/DEEP_REVIEW_DATA_2026-07-18.md` (`#322`, `review/deep-data`). The amendments add the data-chain sub-order (#317/#319/#320 did not exist when this doc was first cut), the prompt-collision fix ordering, and the analytics `platform`-prop wiring note.
- **Stack note:** `#299`/`#300` branch off `feat/capacitor-ios-wrap` (`#295`), so their branches already contain `#295`. `#295` in isolation is clean against every other PR — the `#299` conflicts below are `#299`'s *own* edits, not `#295`'s. Likewise `#317`/`#320` branch off `#315`; `#319` branched from **`main`** (this is the root of the data-chain conflict, see below).

---

## (a) Conflict matrix — only pairs that actually conflict

| Pair | Conflicting files | Nature |
|------|-------------------|--------|
| **#315 ↔ #319** | `public/data/pint_prices_app_dataset.json`, `public/data/venues_slim.json` | Single-line JSON; #319 branched from `main` and rewrites the whole line, colliding with #315's +660 OSM rows. **Naive resolution deletes data — see (e).** |
| **#319 ↔ #320** | `public/data/pint_prices_app_dataset.json`, `public/data/venues_slim.json` | Same single-line-JSON collision; #320's 2 harvested prices are on the same rewritten line. |
| **#299 ↔ #301** | `components/plan/PlanCollaborationPanel.tsx`, `lib/analyticsEvents.ts` | Both add analytics event wiring to the same regions. |
| **#299 ↔ #312** | `components/plan/PlanCrew.tsx` | Both arm a prompt on the same plan-join tap (identity nudge vs. native push). **Resolution now owned by `fix/prompt-orchestration` — see (e).** |
| **#299 ↔ #313** | `app/layout.tsx` | Both inject into the root layout (A2HS mount vs. native routing). |
| **#307 ↔ #314** | `components/feed/FeedCard.tsx`, `components/share/ShareBar.tsx` | Feed-card slim vs. WhatsApp share artifacts, same rows. |

**Textual conflict stops in the recommended order: 3** — `#319` (data chain, resolved by script re-run), `#314` (share), `#299` (native hub). `#299` is still the app hub (3 of its edges), but its `PlanCrew.tsx` edge is now resolved by the prompt-orchestration ordering guard rather than "both hooks coexist."

### Derived-artifact staleness (NOT a textual conflict, still a stop)

| PR | Symptom | Why merge-tree looks clean |
|----|---------|----------------------------|
| **#317** slim-borough-shards | `venues_slim.core.json` + 10 borough shards were built from **#315-only** labels/prices. After #319/#320 land, `validate-data` (recomputes the shard plan from the monolith and compares `borough` + `cheapestPrice` field-by-field) **FAILS loudly** on the committed shards. | Shards are new files, so `merge-tree` reports no conflict — but the *content* is stale. Self-heals only because `prevalidate-data`/`prebuild` run `build:slim` first; the **committed** shard files in the PR are wrong. #317 must land **last among data PRs** and regenerate shards from the final dataset. |

### Co-touch, but merges clean (ordering/review notes only — NOT conflicts)

| Pair | Shared file(s) | Why it still matters |
|------|----------------|----------------------|
| #297 ↔ #304 | `components/PubMapCanvas.tsx`, `app/globals.css`, `e2e/map-fallback.spec.ts` | Same MapLibre constructor path. Different hunks → clean, but land **#297 first** so #304's disclosure sits on the watchdog fix. (Deep-app §2 confirms the merged fallback shows both #304's disclosure and #297's venue list; the two error paths don't fight over the DOM.) |
| #306 ↔ #309 | `components/PubMap.tsx` | Both touch the map component in separable hunks; identical `import dynamic from "next/dynamic"` is git-deduped. Land adjacent (#306 then #309); clean either way. (Deep-app §2: NearMeNow's inputs live in PubMap's own scope, not in any lazied panel — no breakage.) |

> Every PR also touches `fable-implement-prd.md` (running log). merge-tree auto-resolves these across the whole queue — no prd.md conflict appears in the simulation — so it is not a blocker, just a known soft hotspot.

---

## (b) Recommended total order (one pass, minimizes manual resolution)

Rationale: land the docs/deep-reviews and the **strict scripted data chain** first, then the non-conflicting feature/fix bulk, then the three conflict clusters (prompt/analytics, share, native) last so each collapses into one rebase. `fix/prompt-orchestration` lands **before** `#301`/`#312`/`#313`/`#299` so the prompt-collision fix is in place when the identity + push surfaces arrive. Net manual work: **1 scripted data re-run (#319), 2 code rebases (#314, #299), + the prompt-orchestration reconcile.**

| # | PR | Branch | Tier / why here |
|---|----|--------|-----------------|
| 1 | #316 | docs/merge-order-matrix | This doc. Docs-only, land early/anytime. |
| 2 | #321 | review/deep-app | Deep review (docs). Anytime, early. |
| 3 | #322 | review/deep-data | Deep review (docs). Anytime, early. |
| 4 | #310 | verify/e2e-overnight | Docs (e2e truth table). Zero risk. |
| 5 | #308 | data/borough-coverage | **Data chain — anytime.** Read-only report, idempotent. |
| 6 | #315 | data/outer-london-osm | **Data chain — base.** +657/+660 OSM rows. Land first among data mutators. |
| 7 | #320 | data/outer-price-harvest | **Data chain — after #315.** Stacked on #315 (clean merge-tree). Rebase on merged base → re-run `apply_outer_london_prices.mjs` → +2 prices. |
| 8 | #319 | data/borough-label-repair | **Data chain — after #315+#320. ⚠️ REBASED from `main`.** Rebase onto post-#315(+#320) → re-run `repair_borough_labels.mjs` + `build:slim` → relabel 610. **Naive merge deletes 660 venues — see (e).** |
| 9 | #317 | perf/slim-borough-shards | **Data chain — LAST data PR.** Rebase on top → re-run `build:slim` → regenerate monolith + core + 10 shards from final labels+prices. Expect ~509 KB eager. |
| 10 | #276 | feat/about-story | Standalone page. |
| 11 | #296 | fix/welcome-modal-once | Onboarding fix, isolated (first-run tour → map surfaces only). |
| 12 | #298 | fix/e2e-sw-tile-delay | Test-only. |
| 13 | #297 | fix/map-webgl-fallback | Map fix. **Before #304** (shared constructor path). |
| 14 | #304 | taste/error-empty-states | Map disclosure. After #297. |
| 15 | #306 | perf/mobile-map-budget | Map perf. Adjacent to #309 (both PubMap.tsx). |
| 16 | #309 | feat/instant-answer | Near-me answer, PubMap.tsx. After #306. |
| 17 | #305 | taste/list-discipline | Taste, independent. |
| 18 | #311 | taste/header-consistency | Taste, independent. |
| 19 | #302 | feat/last-pint-guardian | Feature, independent. |
| 20 | #303 | feat/price-drops-v2 | Feature, independent. |
| 21 | #318 | feat/ledger-polish | Rounds polish. Independent — no `app/api/**`, no new mutation surface (deep-app §5). |
| 22 | — | fix/prompt-orchestration | ⚠️ **In flight (no PR # yet).** **Before #301/#312/#313/#299.** Makes `promptBudget` real across all four interruptive surfaces + wires the identity-first / push-defers ordering guard. **Supersedes the old #299×#312 "both hooks coexist" resolution.** See (e). |
| 23 | #301 | feat/metrics-funnel | Analytics foundation. **Before #299** (owns analyticsEvents). **Must register `platform` on the `pwa_*` events — see (e).** |
| 24 | #312 | feat/identity-nudges | **Before #299** (shares PlanCrew). Slots into the prompt-orchestration guard. |
| 25 | #313 | feat/a2hs-flow | **Before #299** (shares layout). Ships `lib/promptBudget.ts` that #22 makes universal. |
| 26 | #307 | taste/feed-card-slim | **Before #314** (shares ShareBar/FeedCard). |
| 27 | #314 | feat/whatsapp-share-artifacts | ⚠️ Rebase — conflict vs #307. Rebase-by-intent (see (e)). |
| 28 | #295 | feat/capacitor-ios-wrap | Native stack base. Clean vs all; retarget #299/#300 to main after this lands. |
| 29 | #299 | feat/native-first-run | ⚠️ Rebase — conflict vs #301/#312/#313 (one pass). `PlanCrew.tsx` resolved by the #22 ordering guard. |
| 30 | #300 | feat/push-senders | Stack top. Clean once #295/#299 in. |

**Sanity check (sequential merge-tree in this exact order, existing branches only):** steps 1–7 clean; **first conflict at step 8 (#319)** — `pint_prices_app_dataset.json` + `venues_slim.json` (resolved by script re-run, not hand-merge); step 9 (#317) merge-tree-clean but shards must be regenerated (derived-artifact staleness, above); steps 10–26 clean; **second conflict at step 27 (#314)** — `ShareBar.tsx` + `FeedCard.tsx`; **third conflict at step 29 (#299)** — `app/layout.tsx`, `PlanCollaborationPanel.tsx`, `PlanCrew.tsx`, `analyticsEvents.ts`; step 30 (#300) clean. No other conflicts surface. `fix/prompt-orchestration` (step 22) has no branch yet and could not be machine-simulated — treat its reconcile as a fourth, hand-verified stop.

**Remaining manual stops: 3 machine-verified (#319 scripted, #314 hand-merge, #299 hand-merge) + 1 unsimulated (prompt-orchestration) + 1 derived-artifact regen (#317).**

---

## (c) Per-conflicting-PR rebase notes

- **#314** — after **#307** lands, re-merge main; expect conflict in `components/share/ShareBar.tsx` and `components/feed/FeedCard.tsx`. **Rebase-by-intent (keep both diffs' intents):** take **#307's** `compact`/`showChannels` fold as the wrapper, re-apply **#314's** reordered channel list (native-share leads, WhatsApp promoted ahead of X) + `whatsappShareHref` routing *inside* that fold. #307 owns *whether* the strip is folded; #314 owns *what's in it and the order*. Do not let either side's revert of the fold or the channel order slip through — reapply by intent, never by textual `theirs`.
- **#299** — after **#301, #312, #313** (and **#22 fix/prompt-orchestration**) land, re-merge main (retarget to `main`). Expect conflicts in 4 files:
  - `lib/analyticsEvents.ts` + `components/plan/PlanCollaborationPanel.tsx` — take **#301's** event definitions/funnel wiring, add #299's native-prompt events alongside.
  - `components/plan/PlanCrew.tsx` — **resolved by the #22 ordering guard, not "both coexist":** keep the identity-first / push-defers block (`recordPlanNudgeTrigger()` first, then `recordPlanHighIntentAction()` only `if (!isIdentityNudgePending())`). #299 supplies the push call; it must sit *inside* the guard.
  - `app/layout.tsx` — keep **#313's** A2HS mount, add #299's native first-run routing (both mount).
- **#295, #300** — no manual resolution expected (clean in the simulated order). #300 only needs the standard stack rebase after #295/#299 land.

---

## (d) Sol's execution checklist (top to bottom)

Merge each via the queue; for the ⚠️ PRs, do the rebase/re-run note first, push, let CI go green, then merge.

- [ ] 1. Merge **#316** (docs/merge-order-matrix)
- [ ] 2. Merge **#321** (review/deep-app)
- [ ] 3. Merge **#322** (review/deep-data)
- [ ] 4. Merge **#310** (verify/e2e-overnight)
- [ ] 5. Merge **#308** (data/borough-coverage)
- [ ] 6. Merge **#315** (data/outer-london-osm) — data-chain base
- [ ] 7. ⚙️ **#320** (data/outer-price-harvest) — rebase on merged base → `node scripts/apply_outer_london_prices.mjs` → commit regenerated dataset → merge
- [ ] 8. ⚠️⚙️ **#319** (data/borough-label-repair) — rebase onto post-#315(+#320) → `node scripts/repair_borough_labels.mjs` **then** `npm run build:slim` → commit regenerated artifacts → merge. **DO NOT take #319's side of the JSON conflict — that deletes #315's 660 OSM rows + #320's 2 prices.**
- [ ] 9. ⚙️ **#317** (perf/slim-borough-shards) — rebase last → `npm run build:slim` → regenerate `venues_slim.json` + `.core.json` + 10 shards from the final dataset → `npm run validate-data` must pass (expect ~509 KB eager) → merge
- [ ] 10. Merge **#276** (feat/about-story)
- [ ] 11. Merge **#296** (fix/welcome-modal-once)
- [ ] 12. Merge **#298** (fix/e2e-sw-tile-delay)
- [ ] 13. Merge **#297** (fix/map-webgl-fallback)
- [ ] 14. Merge **#304** (taste/error-empty-states)
- [ ] 15. Merge **#306** (perf/mobile-map-budget)
- [ ] 16. Merge **#309** (feat/instant-answer)
- [ ] 17. Merge **#305** (taste/list-discipline)
- [ ] 18. Merge **#311** (taste/header-consistency)
- [ ] 19. Merge **#302** (feat/last-pint-guardian)
- [ ] 20. Merge **#303** (feat/price-drops-v2)
- [ ] 21. Merge **#318** (feat/ledger-polish)
- [ ] 22. ⚠️ Land **fix/prompt-orchestration** (in flight) **before** the next three — makes `promptBudget` universal + wires the identity-first/push-defers guard → push → CI green → merge
- [ ] 23. Merge **#301** (feat/metrics-funnel) — **at wiring time, register `platform` on `pwa_install_prompt_available` and `pwa_install_completed`** (add to the allow-list + `CUSTOM_PROP_VALIDATORS`), else #313's `{ platform }` emissions are stripped
- [ ] 24. Merge **#312** (feat/identity-nudges)
- [ ] 25. Merge **#313** (feat/a2hs-flow)
- [ ] 26. Merge **#307** (taste/feed-card-slim)
- [ ] 27. ⚠️ Rebase **#314** on main → resolve `ShareBar.tsx` + `FeedCard.tsx` **by intent** (#307's fold wrapping #314's reordered channels + `whatsappShareHref`) → push → merge
- [ ] 28. Merge **#295** (feat/capacitor-ios-wrap); retarget #299/#300 base to `main`
- [ ] 29. ⚠️ Rebase **#299** on main → resolve `analyticsEvents.ts`, `PlanCollaborationPanel.tsx`, `layout.tsx` (keep #301/#312/#313, add native intents); **`PlanCrew.tsx` → push call goes inside the #22 ordering guard, not alongside** → push → merge
- [ ] 30. Merge **#300** (feat/push-senders)

**Legend:** ⚠️ = manual conflict / ordering-critical · ⚙️ = re-run a data script and commit the regenerated artifact (not a hand-merge).

**Held (do not merge this round):** #263, #264 (drafts; #263 has a red check), #229 (MapLibre 6 HOLD).

---

## (e) Deep-review amendments (2026-07-18) — call-outs Sol must not miss

### E1 — Data chain is strict + scripted (from `#322` / DEEP_REVIEW_DATA)

**`pint_prices_app_dataset.json` and `venues_slim.json` are single-line JSON (0 newlines).** #315 (+660 OSM rows), #320 (+2 prices), and #319 (relabel 610 rows) each rewrite the **whole line**, so any two collide in a 3-way merge. **`#319` branched from `main`, so its committed artifacts do NOT contain #315's OSM rows or #320's prices — a "take #319's side" resolution silently deletes all of #315 and #320 (660 venues + 2 prices).**

The chain is therefore strict and **resolved by re-running scripts on the merged base, never by textual merge**:

```
#308  (independent — docs/report, land anytime)
  ↓
#315  (base: +660 OSM rows)
  ↓
#320  (rebase on #315 → re-run apply_outer_london_prices.mjs → +2 prices)
  ↓
#319  (REBASED from main onto #315+#320 → re-run repair_borough_labels.mjs + build:slim → relabel 610)
  ↓
#317  (LAST among data PRs → re-run build:slim → regenerate monolith + core + 10 shards; expect ~509 KB eager)
```

Proven by the deep review: the fully-stacked `#315+#320+#319+#317` state builds to **509.3 KB eager / 807.8 KB total** and passes `validate-data` **13/13**. OSM borough labels are geometry-correct and need **no** repair (repair is a no-op on the 660 OSM rows; it only touches 610 pre-existing core rows). #317's shard files are pure derived artifacts — **stale the moment #319/#320 touch the dataset**, so they must be regenerated from the final dataset (validate-data compares `borough` + `cheapestPrice` field-by-field and fails loudly otherwise).

### E2 — Prompt collision is the one ship-blocker (from `#321` / DEEP_REVIEW_APP)

Four interruptive surfaces exist (first-run tour #296, identity nudge #312, native push #299, A2HS #313). `#313` built `lib/promptBudget.ts` as the "one prompt per session" guard but **only A2HS adopts it** — so it guards A2HS against nobody, and identity/push/tour can stack. Worse, on a signed-out native first plan-join, **`recordPlanNudgeTrigger()` (#312) and `recordPlanHighIntentAction()` (#299) both fire on the same tap → identity nudge + push prompt render stacked.** The documented identity-first ordering (`lib/identityNudge.ts` — record identity first, record push only `if (!isIdentityNudgePending())`) exists **only in comments**; `isIdentityNudgePending()` has zero production callers.

**`fix/prompt-orchestration` (step 22) owns this fix** and lands before #299/#312/#313:
1. **Wires the ordering guard** at the `PlanCrew.tsx` join anchor — `recordPlanNudgeTrigger()` first, then `recordPlanHighIntentAction()` only `if (!isIdentityNudgePending())`. **This supersedes this doc's earlier "#299×#312 → both hooks coexist" resolution.** When #299 rebases (step 29), its push call goes *inside* this guard.
2. **Makes `promptBudget` real** — `FirstRunTour`, `IdentityNudge`, and `NativePushPrompt` each adopt it as A2HS already does (`if (!hasPromptBudgetFor(surface)) return;` before show, `claimPromptBudget(surface)` at show), so "at most one interruptive prompt per session" becomes a guarantee instead of an aspiration.

### E3 — Analytics `platform`-prop drift (from `#321` / DEEP_REVIEW_APP §3)

`#301` registers `pwa_install_prompt_available: []` and `pwa_install_completed: []` (empty prop allow-lists; the validator **strips** props not on the list). But `#313`'s A2HS emits these **with a `{ platform }` payload** (`A2HSInstallPrompt.tsx:135,168,195`). **At #301 wiring time (step 23), register `pwa_install_prompt_available: ["platform"]` and `pwa_install_completed: ["platform"]`** (add `platform` to the allow-list + likely `CUSTOM_PROP_VALIDATORS`), or the platform split the A2HS analytics promise is dead on arrival.

### E4 — ShareBar (#307 × #314) is rebase-by-intent (from `#321` / DEEP_REVIEW_APP §4)

Not logically incompatible: #307 changes *whether* the share strip is folded (`compact`/`showChannels`); #314 changes *what's in it and the order* (native-share leads, WhatsApp promoted, `whatsappShareHref`). Both rewrote the same lines → hand-merge keeping **both intents** (#307's fold wrapping #314's reordered list). Re-apply by intent, never by textual `theirs`.

**Follow-up unblocked by this queue:** post-#301 analytics wiring for #309/#312/#313 call sites is unblocked once #301 lands (step 23). `pwa_standalone_launch` still has no emitter in this corpus — expected layout-level follow-up (P3).
