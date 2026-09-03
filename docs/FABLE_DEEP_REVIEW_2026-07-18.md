# Fable Deep Review — the systemic layer (2026-07-18)

Reviewer: Fable 5 fork with full session context (every cycle, every review doc, the confidence ledger). Scope: the questions no per-corpus lane could ask. Baseline: origin/main `ed5db4be`; ~50 open PRs (#276, #295–#350).

## 1. Integration risk — safe intermediate states

Main will pass through ~50 intermediate states. Most are safe; four clusters are NOT — inside them, a partially-merged main is a broken or lying product:

| Cluster | PRs (order) | Why partial = broken | Rule for Sol |
|---|---|---|---|
| **Prompt cluster** | #323 → #301 → #312 → #313 (→ #343) | #312 live without #323's budget adoption = identity+push stacking live (the confirmed P1). #343 stacks on #312. | Land #323 FIRST, then the cluster in one sitting, applying E5's adoption diffs at each rebase. Acceptance gate: `grep -rl claimPromptBudget components/ | wc -l` ≥ 4 before the sitting ends. |
| **Data chain** | #308 → #315 → #320 → #319 → #317 → #329 | Already a verified linear stack (re-confirmed today: #317 merges rc=0; #329 rebased on top). Partial landing is SAFE data-wise, but #329 before #317 is impossible (stacked) and any hand-merge of the single-line JSONs remains forbidden — script re-runs only. | Land the whole chain top-down in one sitting; run `build:slim` + `validate-data` after the last. |
| **Token cluster** | #328 → #348 → (#329's alias block, #326, #335 adopt) | #348 retunes the SAME token lines #328 defines (D4/D6 are in-place by nature). #329/#335 carry byte-identical alias blocks with dedupe-on-merge notes. Partial = duplicate/conflicting token definitions and a visually half-migrated product (coral in some surfaces, roles in others) — the exact "inconsistent = slop" failure the work exists to kill. | #328 then #348 back-to-back; delete the dedupe blocks in #329/#335/#326 as each lands. One sitting. |
| **Certification counter** | #295(→61), #343(→62), + #303/#330/#342/#350 (touch file/regex, count-neutral) | `writeSurfaceCertification.test.ts:47` pins an ABSOLUTE literal. Verified across branches today: #295=61, #343=61 (assumes only its own +1), all others=60. Every count-changing merge invalidates the literal in EVERY unmerged branch touching that file — serial CI breakage by design ("deliberate conflict point"), but nobody computed the schedule. | Final count = **62** (main 60 + push-tokens + email-subscribers). At each cluster merge, bump the literal in the remaining branches (or accept the 1-line fix at rebase). #350's regex broadening must be preserved when reconciling (it recognizes the wrapped `export const POST` form). |

Everything outside these four clusters can land independently in #316 v2's order without a broken intermediate.

**Order-doc staleness (again):** #316 v2 predates #339–#350 — twelve PRs are unslotted. Proposed slots (extending v2's logic): docs/reviews (#341, #345, #339, this doc) anytime-early; #340/#344 with the feature bulk (map/feed fixes, low risk); #346 after the map cluster (touches PubMap); #348 immediately after #328 (token cluster above); #342/#349/#350 anytime after the data chain (#349's registry references data artifacts); #343 at the end of the prompt cluster; #347 anytime (assets staged, inert until activation). The serial lesson: the order doc goes stale within hours in a fleet this fast — Sol should treat the CLUSTER RULES above as the invariant and slot stragglers by cluster membership, not chase a total order that's stale on arrival.

## 2. Test-suite drift

Branches were tested against different mains (suite grew 3086 → 3146 across lanes). Verified findings:

- **The certification literal** (above) is the one systematic drift bomb — the only pinned absolute that multiple branches edit.
- **Analytics registry**: #301's additions merge union-clean against every consumer branch (re-verified via merge-tree in #321); POST-#301 markers mean no branch depends on unmerged registry state. Safe. The `platform` prop registration remains a #301-merge-time edit (E3).
- **Playwright config**: #298's `serviceWorkers: "block"` (chromium-gl) interacts with #306's decoded-bytes budget and #344's scroll spec — checked: #306 measures network-layer sizes (SW-independent), #344 disables scroll anchoring itself and runs in the default project. No cross-dependency.
- **No branch pins the total test count** — suite-size drift is cosmetic.
- Residual risk class: branches whose green predates the data chain's regenerated artifacts (any test reading `venues_slim.json` fixtures). The chain's own branches re-ran these; independent branches (e.g. #309's near-me tests) use synthetic fixtures — sampled, safe.

## 3. UX coherence at full merge — the map-chrome verdict

At full merge the 390px map carries: top bar (wordmark, city, search, Pal avatar, ⋯) + a chip row of **Near me, Tonight(badge), Drinks, ≤£8, TfL(badge), Zone (#329), List (#346)** = 7 peer chips, plus the tonight lane, the 3-stop-plan pill, and the tab bar. Verdict: **over the line.** The persona's first glance now reads as instrument-panel, not answer. Nothing individually is wrong; collectively the chips flatten hierarchy — Near me (THE answer) has the same visual weight as TfL (a utility).

**Recommended consolidation (one lane, post-merge, before launch):** three tiers — (1) **Near me** keeps primary position/weight; (2) **Filters** chip opens the existing filter sheet absorbing Drinks + price + Zone (the zone picker already renders inside the mobile filter sheet — promote that as its only home on mobile); (3) TfL and List move to the map's utility corner (icon buttons, not chips). Net: 7 chips → 3 + 2 icons. This preserves every capability, restores the answer-first hierarchy, and is a CSS/placement lane, not a rebuild.

Prompt-surface coherence: sound IF AND ONLY IF the E5 acceptance gate holds (one interruptive surface per session, identity > push > A2HS). The recap/share chain is coherent. The first-run tour + native first-run redirect + iOS A2HS suppression compose correctly (verified in #313's F1 fix).

## 4. What the programme forgot / what we shouldn't ship

**Forgot — second-observer confirmation for drops.** The harvest proved crowdsourced drops are the only price channel; #303/#326 built submission. But a price a single anonymous stranger typed is weak evidence, and the Pint Index's public credibility rests on it. Missing: consensus mechanics — "confirm this price" one-tap on an existing drop (cheaper than a new drop, gives lurkers a contribution), observation counts on the plaque ("£5.20 · 3 confirmations · this week"), and staleness decay. This is the single highest-leverage unbuilt feature: it turns the moat from "user-generated" into "community-verified", which no competitor can scrape OR fake. Build next.

**Shouldn't ship as-is — seeded liveness.** The feed ships demo drops (DEMO-badged) and the "Live tonight — N spilling right now" strip runs on a deterministic FAKE curve (`ambientPresenceCurve`, seeded personas). Badged demo *stories* are defensible bootstrap; a fake *presence count* on a product whose brand is data honesty is a landmine — one screenshot of "2 spilling right now" at a closed pub undoes every provenance rule we enforce. Fixed on this branch: `NEXT_PUBLIC_DEMO_CONTENT=off` now kills ALL seeded content (drops + presence) in one env flip, default unchanged. **Owner decision: flip timing** (recommend: the day real drops exist; presence strip should arguably flip earlier).

## 5. Changes made on this branch

- `lib/demoContent.ts` (new) + gates in `lib/pintDropSeeds.ts` / `lib/ambientPresence.ts` + `__tests__/demoContent.test.ts` — the demo kill switch (4 tests, tsc + eslint clean, seed/ambient suites green).
- This document.

## Bottom line

The programme's construction quality is high and the review machinery worked — but the queue's remaining risk is **choreography, not code**: four clusters that must land as sittings, one counter that needs a schedule, one chrome surface that needs a hierarchy pass, and one fake-liveness flag that needs an owner's flip. Plus one genuinely missing feature (drop confirmations) that the harvest evidence says is the moat's keystone.
