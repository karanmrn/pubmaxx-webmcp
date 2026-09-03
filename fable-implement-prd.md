# FABLE IMPLEMENT PRD — App Launch Foundations (2026-07-17)

Author: Fable 5 (architect/reviewer — no inline execution). For Sol's review. This file is the only direct-to-main commit from this session; all code went through PRs listed below, **none merged** — Sol reviews and merges.

## Decisions grilled with the owner (locked)

1. **Distribution**: Capacitor wrap of the existing PWA + native push + real in-app camera. No static export — remote-URL shell over pubmaxxing.com. Full native rebuild rejected.
2. **Sequencing**: foundation before wrap. Verified against GitHub remote (local clone was 25 commits stale — remote main is ground truth; squash merges make local ahead/behind counts lie).
3. **Launch headline**: London-only THE LOCAL loop. Wave 2 nine-city and Wave 4 Pub Pal voice deferred.
4. **Growth**: crew-invite universal links (eng priority) + Pint Index press launch + owner clears SEO blockers. Paid UA budget confirmed exists.
5. **Store accounts**: none existed; Apple enrollment deferred by owner ("mobile site version first"). Play's 14-day new-account closed-test rule likely pushes Android production past the month.
6. **Convex**: NOT migrating. Supabase is certified production (RLS, ledger, Wave 0 write-surface certification); `convex/` stays dormant. Post-launch decision.
7. **Process**: Fable plans/reviews only; implementation delegated to model-tiered subagents (haiku=mechanical, sonnet=standard, opus=hard). Fable never merges — Sol reviews + merges in the owner's Codex environment. Fable's work never overwrites owner/GPT plans (sol2.md, PRDs).

## Ground-truth audit (start of session)

Remote main `5e1252df` already contained Sol's overnight lanes: H1 rate-limit isolation, F1 night-profile (+ wired into You), locked public error contract, store dedup, weather + late food, endings persistence, Master PRD #280, Wave 0 mutating-API certification #292, consent analytics #294, migration ledger #289, sheets-above-nav #290. Live prod verified fresh (serves night-profile 401 with proper envelope; no stale deployment pin). H1 fix confirmed per-IP (`app/api/plans/generate/route.ts:179`).

## Shipped this session (open PRs — Sol's queue)

| PR | Title | Implementing model | Status at handoff |
|---|---|---|---|
| #276 | About/founder story + press kit — conflicts vs redesigned landing resolved; CodeRabbit MAJOR fixed (aboutStats counts only venues with accepted price observations); stylelint + test fixes | Fable 5 subagent (inherited, pre-tiering rule) | CI green + CLEAN |
| #295 | Capacitor iOS wrap foundation: remote-URL shell, `ios/` scaffold (SPM), native seams (`lib/nativePlatform/nativeCamera/nativePush.ts`), `POST /api/push-tokens` + `lib/pushTokenStore.ts` + migration `0039_push_tokens`, AASA universal links (`/plan/*`, `/rounds/*`, `/p/*`), breakpoint hoist `lib/breakpoints.ts`. Architect review forced 5 fixes (rate limit, error envelope, webDir stub, AASA comment, write-surface certification as route 61). Cursor security MEDIUM (forwarded-header rotation) fixed with global backstop bucket 300/h + regression test (301 requests / 250 rotating IPs) | Fable 5 subagent (inherited, pre-tiering rule) | CI green + CLEAN, security re-passed |
| #296 | First-run WELCOME tour gated to `/map` surfaces only (`shouldShowFirstRunTour` in `lib/firstRunTour.ts`, 21-assertion test). Once-per-device persistence already existed; surface gate was the real bug | **Sonnet 5** | CI green + CLEAN |
| #298 | e2e: `serviceWorkers: "block"` on chromium-gl — `public/sw.js` tile cache bypassed Playwright `page.route()`, silently defeating the delayed-tiles scenario (pre-existing main failure, now fixed; test-infra only) | **Sonnet 5** (claude-sonnet-5) | CI green + CLEAN |
| #299 | (stacked on #295) Contextual push permission prompt — sequence-gated after first plan action (join/start/confirm), "Later" re-offers only after next qualifying action; native first-run redirect landing→map, once ever, never over existing city preference. 11 new gate tests, full suite 3118 green | **Sonnet 5** (claude-sonnet-5) | CI green + CLEAN (CodeRabbit skips stacked base) |
| #300 | (stacked on #295) Push SENDING pipeline behind APNs-ready provider seam (noop until env keys), fan-out + invalid-token pruning, night-signal go-live broadcast with DURABLE at-most-once dedup (budget-of-1 isLimited claim keyed on snapshot generatedAt — Fable review caught the original per-instance Set flaw), plan-scoped sends dormant behind identity seam (privacy: pre-auth tokens have no identity) | **Opus 4.8** (claude-opus-4-8) | CI green + CLEAN |
| #297 | Map first-frame watchdog: WebGL context GRANTED but zero frames painted → `style.load` settled the scene into permanent blank white with no fallback. Watchdog on MapLibre `render` event, 10s visible-tab timeout → honest `no-frame` fallback with Retry + cheapest-pubs venue rows + `/pubs` link. e2e under SwiftShader with stubbed rAF | Fable 5 subagent (launched pre-tiering rule) | CI pending at handoff |

## Mobile audit findings (live 390×844 captures via Firecrawl)

- **Blank map** in no-frame environments — fixed by #297. Matters for Instagram/TikTok in-app webviews.
- **Welcome modal on every surface** — fixed by #296.
- **Pint Index page says "Public release pending"** — OWNER DECISION: copy/timing vs press launch.
- Feed/Tonight healthy; Tonight honestly thin until signals ingestion gets EXA_API_KEY.

## Suggested merge order

#295 → #299 → #300 (stack; retarget #299/#300 to main after #295 lands if preferred — CodeRabbit will then review them). #276, #296, #297, #298 independent, any order.

## For Sol — beyond the PR queue

- Pre-existing e2e failure on main (proved identical on main baseline): `map-gl.spec.ts` "bounded pin fallback when basemap tiles are delayed" — `public/sw.js` caches `tiles.openfreemap.org`; service-worker fetches bypass Playwright `page.route` delay. Separate fix.
- 38 remote branches map to already-merged PR head refs — prune list ready, owner confirmation pending.
- #295 leaves push SENDING unbuilt (needs APNs key after Apple enrollment); `registerNativePush()` deliberately unwired — prompt placement is a product decision (recommend: after first plan action).
- Drafts #263/#264 remain held; #229 MapLibre 6 stays HOLD.

## Tooling/ops done this session (not code PRs)

- Local main fast-forwarded 25 commits; CLI already latest (2.1.212).
- Firecrawl API key installed + validated; mcporter installed + configured (Chrome attach still failing — extension reconnect pending); browser-use skill's wrong-user path fixed.
- Auto-compact at 70% (~140k) set globally; statusline now shows model/dir/branch (verified: `Fable 5 / pubmax [main]`).

## CYCLE 2 — Mobile-web love (grilled + locked 2026-07-17, evening)

Owner directive: mobile WEB only. App/store/Apple work is owner-scheduled, later — users must love the site and beg for the app first. Decisions locked in grilling:

- **Metrics**: funnel of four, all first-class — nights planned/week, invites per planner, return rate (measured daily, not weekend-bound — people drink every day), A2HS installs. No single tiebreaker.
- **Daily hook**: utility first (Tonight + live pint prices earn the random-Tuesday open), companion layered on top; feed waits for density.
- **Identity**: push harder — account prompt after first plan or first moment, early email capture. Browsing/map/prices never gated (SEO + first touch).
- **USP bets — all four**: (1) last-train/last-orders guardian (TfL, issue #45), (2) gamified pint-price drops (one-tap submission, proof, streaks, borough leaderboards — deepens the data moat daily), (3) live buzz layer (BLOCKED on EXA_API_KEY), (4) group ledger polish.
- **Beg-for-app mechanics**: A2HS prompt after second visit or first completed night (installed iOS PWAs gain web push — reachability without an app); email digest + WhatsApp-native share artifacts (recap, invite, price drop).

### Waves (mobile web)

- **Wave A — measure + speed (first)**: metrics funnel instrumentation (consent-gated, PostHog server lib exists); perf budget pass on the map loop (LCP < 2.5s mid-tier 4G, instant back-nav, no sheet jank). Nothing ships without moving/measuring the funnel.
- **Wave B — USP**: B1 guardian; B2 price drops (new mutating surface — full write-surface certification, anti-abuse, provenance gates per Pint Index rules); B3 ledger polish; B4 buzz when EXA lands.
- **Wave C — reach**: identity nudges; weekly email digest; WhatsApp-native share artifacts on every night object; A2HS flow (iOS share-sheet instruction sheet + Android beforeinstallprompt).

Planned lanes (worktrees; Fable reviews, Sol merges): guardian + price drops = Opus 4.8; funnel, A2HS/share, ledger, digest = Sonnet 5; mechanical chores = Haiku 4.5.

## STANDING LOOP — iterate until excellent (owner directive, 2026-07-17 night)

Owner mandate: keep iterating on the mobile web product in a continuous loop until it stops reading as AI slop and the journey is excellent. Rules: Fable audits (screenshots of live + Vercel PR previews), writes each cycle's PRD here so Sol reviews with full intent, delegates to **Opus 4.8 agents** in isolated worktrees, separate branch + separate PR per lane, Fable reviews, **Sol merges — never Fable**. London only; every borough matters.

**The judging persona (every cycle, every surface):** a 9-to-5 worker leaving the office, any night of the week, wants a cheap good pint near where they are. If they can't get from open → answer in seconds, the cycle failed.

### Cycle 3 PRD (this cycle)

Audit basis: live 390×844 captures + Cycle-2 PR previews. Two failures against the persona:

1. **No instant answer.** Opening the site, the persona meets: landing marketing OR a map needing pan/tap/filter work. Nowhere is there a one-tap "cheapest pints near me right now" answer. The map is a tool; the persona wants an ANSWER first, tool second. → Lane `feat/instant-answer` (Opus 4.8): a "Near me now" instant surface — geolocate, show the 3–5 cheapest quality pubs within walking distance as immediate cards (price, walk minutes, open-late flag), one tap from everywhere (map, landing, tab bar treatment TBD by lane research), full map one tap deeper. Reuse slim index + existing geolocation + venue sheet; no new backend if possible.
2. **Borough coverage is hollow.** "Every single area in London" — /pubs gallery holds ~119 scraped pubs; the persona in Croydon or Barnet may find nothing near them. → Lane `data/borough-coverage` (Opus 4.8): coverage report per borough (pubs with usable price data ÷ borough), then expand via the EXISTING scrape/canonicalize scripts (`fetch:city-pubs`, `canonicalize:venues`, `refresh:prices` — read them first); provenance rules absolute (no invented prices); output = data PR + honest coverage table in the PRD for the next cycle's audit.

Carried follow-ups for later cycles (from PR #306 audit): first-map-paint ~4.2s (maplibre-bound, post-#297), Supabase eager on /map, sheet-drag/back-nav trace pass, header consistency, feed card slimming (in flight).

### Loop mechanics

Each cycle: capture screenshots (live + preview URLs of open PRs) → judge as persona → append Cycle N PRD here → launch Opus lanes → Fable reviews diffs → separate PRs → next cycle. Loop sustains across sessions via this file + memory.

## NIGHT LOG — 2026-07-17 overnight (running record for morning review)

Owner asleep from ~23:00. Every overnight action appended here with the why. State at handoff:

- **13 open PRs** (#276, #295–#307) — all Fable-reviewed, CI-green, awaiting Sol. Stack: #295→#299/#300.
- **Running**: GNHF Companion run (Codex, worktree, 15-iteration cap) deep-reviewing all open PRs + executing the e2e specs worktree lanes couldn't run; verdict doc lands on `review/sol-queue-20260717`. Two Opus 4.8 Cycle-3 lanes: `feat/instant-answer` (near-me cheapest-pint instant surface), `data/borough-coverage` (33-borough coverage report + honest expansion).
- Loop heartbeat armed; each completed lane gets Fable review → separate PR → logged here.

### Overnight events
<!-- appended as they happen -->

- **~23:15 — GNHF review run FAILED**: codex backend exited code 1 ("Reading additional input from stdin") on all 3 iterations, zero output. Codex CLI not headless-ready on this machine. Why not retried: broken backend, not a flaky run. Note: several PRs show Greptile "trial credit limit" review spam — ignore, not real reviews.
- **~23:20 — Replacement**: spawned `e2e-verifier` (Opus 4.8, worktree) to do the highest-value slice GNHF was meant to cover — actually EXECUTE the e2e specs flagged as authored-but-unrun in #297/#302/#304/#305/#307 (APFS-clone node_modules trick from perf-lane), verdict table to `docs/E2E_VERIFICATION_2026-07-18.md` on branch `verify/e2e-overnight`. No source changes, no pushes.
- **#307 (feed card slim) CI: green + CLEAN.** All 13 open PRs now CI-green.
- **PR #308 opened** (borough coverage, Opus 4.8): 78% of 1246 venues priced; outer ring hollow (Barking&Dagenham 1 priced pub, Kingston 4, Hounslow 5). ZERO rows added — honest: seeds exhausted, price fetch is a stub, Firecrawl harvesters off-metric, OSM scoped non-London. Next-cycle levers logged in PR: sourced outer-borough seeds, per-row observedAt, seed-dedup coordinate-drift bug, core geo≠stored borough mismatch (Camden 89).
- Still running: instant-answer lane (Opus), e2e-verifier (Opus).

### Night log (contd.)

- **PR #309 opened + CI green** — "Near me now" instant answer (Opus 4.8): geolocate → 3–5 cheapest priced pubs in a 12-min walk; landing hero "Find my pint"; map Near-me chip opens answer sheet; borough-picker fallback. THE persona fix.
- **PR #310 opened — e2e truth table** (Opus 4.8 verifier): #305 verified clean (25/25); **#304 fails its own disclosure spec; #302 4/9 mocked cases never render the card; #307 regressed tap targets (36px) + removed pub-name links.** Fixes dispatched back to the three owning lanes; Sol must read #310 before merging those. GNHF-claude lane launched for WhatsApp share artifacts. Cycle-4 lanes (osm/identity/a2hs/header) running.

- **PR #311** header consistency (Opus 4.8): killed mobile pill-box + landing badge outliers; one wordmark/bar idiom. CI green.
- **PR #312** identity nudges (Opus 4.8): sign-in offers after first plan action / first moment draft, 7-day cooldown, never gates browsing; ordered ahead of native push prompt. CI green.

- **PR #313** A2HS install flow (Opus 4.8): proven-value gate (2nd day / first completed night), Android beforeinstallprompt + iOS instruction sheet, NEW lib/promptBudget.ts (one prompt per session, adoptable by tour/identity). CI green.
- **PR #314** WhatsApp share artifacts (GNHF Claude run, 5/5 iterations): pure builders for 8 night objects, 9 call sites unified behind native-sheet-first/wa.me flow, Bar Tab OG card added. CI green. Merge after #307.
- **#302 e2e fixed** (Opus 4.8): 4/9 failures were webServer cold-start vs default 30s timeout, not code — 90s timeout per suite convention, proof 18/18 repeat-each=2. Pushed e5dbd244 + PR comment.

- **#304 fixed — REAL production bug found** (Sonnet 5 fix loop): MapLibre constructor inserts canvas DOM before GL validation; on throw, orphaned canvases sit over the fallback and swallow all clicks (real users too). Fix: replaceChildren() in constructor catch + React-controlled disclosure. map-fallback 5/5. Merge-order note posted: #297 first, then #304.

- **OSM lane done → PR opening**: +657 outer-London pubs (worst-10 boroughs 112→769), multi-mirror Overpass, zero invented prices, dedupe-drift fix with false-merge guard. FLAG for Sol: slim payload budget 600→900KB — borough-sharding follow-up for next cycle PRD.

## CYCLE 4 PRD (overnight, owner directive: maximize parallel Opus 4.8 lanes)

Backlog drawn from logged findings; four non-colliding lanes, all Opus 4.8, worktrees, separate PRs:

1. **`data/outer-london-osm`** — the one real coverage lever coverage-lane identified: extend the keyless OSM/Overpass ingestion (currently scoped to non-London Wave-2 cities) to London venue PRESENCE for the worst-10 outer boroughs (Barking&Dagenham 1 priced pub today). Unpriced pins acceptable per Cycle-3 PRD; provenance-stamped seeds; also fix the seed-dedupe coordinate-drift bug found by coverage-lane (4-dp key rounding doubles pins).
2. **`feat/identity-nudges`** — Cycle-2 locked decision not yet implemented: push identity harder. Account prompt after first plan action and after first moment capture (pattern: the sequence-gated prompt from #299), email capture on account create surfaces, "own your streak" nudge exists in #303 — this lane adds the two missing prompts. Browsing never gated.
3. **`feat/a2hs-flow`** — Wave C: install-prompt UX. Android: custom install sheet on `beforeinstallprompt` after second visit or first completed night (day-bucket persistence idiom); iOS: share-sheet instruction sheet (no API exists). Events already defined in #301 — reuse those names, no registry edits.
4. **`taste/header-consistency`** — last open taste finding: three different header treatments (landing pill vs map chrome vs tonight). Unify to one header idiom without breaking map's special chrome.

Deferred (conflict-avoidance): Supabase-eager-on-/map (touches PubMap.tsx, would collide with #309), email digest (needs provider decision + inbox confirmation from owner).

- **#307 closed out**: 44px fix pushed (c37157ff); pub-link/Cheers failures proven contention artifacts (19/0 at workers=1). All Cycle-3/4 lanes complete.

## CYCLE 5 PRD (early morning)

Audit: live captures confirm every remaining defect is already fixed in an open PR — the bottleneck is now the 20-PR merge queue, not missing work. PubMap.tsx is touched by #297/#304/#306/#309; ShareBar by #307/#314. Launching more feature lanes would compound conflicts. Two lanes instead:

1. **`docs/merge-order-matrix`** (Opus 4.8): pairwise conflict analysis across all open PRs (git merge-tree, no checkouts), optimal total merge order, per-PR one-line rebase notes where conflicts exist. Deliverable Sol can execute top-to-bottom. This is the highest-leverage artifact for getting live unblocked.
2. **`perf/slim-borough-shards`** (Opus 4.8, atop #315): #315 raised the slim first-paint budget 600→900KB to fit +657 venues. Shard the slim index (core boroughs eager, outer boroughs lazy by viewport/near-me need) to reclaim <600KB first paint without losing coverage.

Deferred until merges land: post-#301 analytics wiring (#309/#312/#313 call sites), buzz layer (EXA key), email digest (provider decision).

- **Merge-order matrix done → PR**: 22 PRs, only 4 conflict pairs (#299 hub, #307↔#314); recommended order collapses to 2 rebases / 4 files; steps 1–18 simulate clean. Sol has an executable checklist.

- **Slim sharding done → PR (stacked on #315)**: eager 805→515KB (manifest+core), 10 lazy outer shards via objective ≥20-venues/<40%-priced rule, loader seam with viewport/near-me/failure-retry, budgets CI-enforced. Full suite 3117 green.

## CYCLE 6 PRD (morning, loop continues per Karan)

Non-merge-gated work only. Three Opus 4.8 lanes + Fable preview audit:

1. **`data/outer-price-harvest`** — the outer boroughs are now venue-covered (#315) but 4–17% priced. FIRECRAWL_API_KEY is valid: harvest honest prices for the new OSM pubs from pub-OWNED published sources (own site/menu pages) under the Pint Index evidence rules (explicit source, licence, observed-at; no aggregator scraping in violation of ToS; no invented prices). Feeds cheapestPrice via the existing price pipeline.
2. **`feat/ledger-polish`** — Cycle-2 USP bet 4, never executed: rounds/bar-tab splitting hardening + mobile UX pass (the sticky-per-group loop).
3. **`data/borough-label-repair`** — #308's data-quality signal: geo≠stored borough mismatch is high in the core (Camden 89, City of London 77) — pins carry wrong borough labels from the source site. Repair stored labels to point-in-polygon truth via the canonical pipeline, with a diff report.
4. **Fable**: visual audit of Vercel preview URLs for #309 (/near), #311 (headers), #307 (feed), #304 (tonight) — pre-merge taste verdicts.

- **Round-loop polish → PR**: PREMISE CORRECTION — bill-splitting never existed (Cycle-2 "ledger polish" bet mislabeled; ledger=heritage log, bar-tab=photo grid). Lane refused scope creep, polished the real Round loop (two-tap close, honest search states, visibility-gated polling, 44px/press, keyboard hygiene). OWNER DECISION queued: build bill-splitting as its own feature, or drop the idea.

- **Borough label repair → PR**: scraped labels were systematically wrong; geometry now source of truth. 610 rows/262 venues corrected (Camden 185→96 pubs, Islington 40→87 — corrections, not regressions). Public Pint Index snapshot unaffected (status:empty).

- **Price harvest → PR (stacked #315)**: 2 verified first-party prices; STRATEGIC FINDING — pubs don't publish pint prices on the web (chains app-only), so crowdsourced drops (#303) is the only real price-moat lever. Firecrawl credits exhausted (105 independents queued — owner: top up if wanted). Cycle 6 complete: 4 PRs (#318, #319, harvest, + #316/#317 from C5).

## CYCLE 7 PRD (post-retrospective — deep-review remediation + next bets)

Deep reviews (#321 app, #322 data) found: P1 prompt stacking (identity+push on one tap; promptBudget unadopted, ordering dead code), HIGH data-chain merge hazard (#319 naive merge silently deletes #315/#320 data), #316's order doc stale vs the data chain, P2 analytics prop drift (pwa_* missing "platform").

**Remediation lanes (Opus 4.8, launch now):**
1. `fix/prompt-orchestration` — adopt promptBudget in tour/#296-pattern, identity (#312), push (#299) surfaces; make identity-before-push real (wire isIdentityNudgePending at the PlanCrew anchor exactly as #321's fix specifies). Built on main as a standalone PR that supersedes the #299×#312 conflict resolution.
2. `data/319-rebase` — rebase #319 onto #315+#320 merged base, re-run repair + build:slim, force-push its branch (branch update, not a merge).
3. `docs/316-amendments` — fold both reviews' merge-order amendments into docs/MERGE_ORDER (data chain: #308→#315→#320→#319→#317 last; app: prompt-fix supersedes #299×#312 resolution; ShareBar rebase-by-intent note; pwa_* platform prop note).

**Next-bet queue (post-merge / owner-gated, unchanged):** drops-first growth loop (harvest log as target list), analytics wiring, preview verification, buzz (EXA), bill-splitting decision, Firecrawl credits, Apple/press timing.

### Cycle 7 execution log
- **#316 → v2** (30-step order, 3 manual stops, script-rerun legend). **#319 rebased + force-pushed** onto the data chain (evidence: 0/660 OSM relabeled, prices survive, idempotent, 3097 green); base retargeted. **#317 shard regen dispatched** (last data step). **Prompt orchestration → PR** (promptBudget on main byte-identical, tour adopts, contract doc; P1 closed at the design level — branches adopt on rebase). New Firecrawl key live; harvest round 2 sweeping 105 venues. iOS App PRD lane drafting (build-today path, paid account deferred). Owner action: install full Xcode (~12GB) for today's simulator build.

- **PR #324 — iPhone App PRD** (Opus 4.8): build-today path (free Apple ID + full Xcode = simulator/device build, no paid account), paid-account activation checklist, acceptance criteria. Grounding found 3 build blockers, fixes dispatched: F1 A2HS shows inside the native shell (→#313 lane), F2 AppDelegate missing APNs forwarding + F3 missing camera permission strings (→#295 lane). OWNER: install full Xcode (~12GB) — the only human step before today's first build.
- **Owner directive: ALL-LONDON price harvest** — expanded from outer-10 to every unpriced venue with a website, borough-batched, checkpoint-committed, credit-burn guard (pause + report if hit rate <5%). Evidence so far says chains are app-only; the sweep settles it.

- **Owner directive: TfL zone price lens** — zone-lane launched (Opus 4.8, feat/zone-price-lens): nearest-station zone assignment (honest, provenance-labeled), zone picker chip on map + /pubs, playful "Zone 1 tax" median strip on pint-index (real numbers only, <10-venue zones say "not enough pints logged — fix that"). Boroughs already on the map (33 polygons); zones are the new lens.
- **#295 updated**: F2 (APNs forwarding) + F3 (camera permission strings) fixed, plutil-validated.

## CYCLE 8 PRD (don't-wait directive)

Three lanes (Opus 4.8, worktrees, separate branches, Sol decides):
1. **`feat/apns-transport`** (stacked on #300): implement the spec'd-but-stubbed APNs HTTP/2 + ES256 JWT transport in `apnsPushProvider` — fully unit-tested against mocks, activates the moment the paid-account env keys land. Closes the last engineering gap in the push story.
2. **`feat/email-digest`**: weekly "your London week in pints" digest behind a provider seam (noop until email-provider keys — same pattern as push): digest content generator from real data (new cheapest near your area, drops logged, tonight highlights), send pipeline seam, owner decision on provider (Resend/Postmark) documented as config drop-in.
3. **`feat/first-drop-nudge`**: drops-first growth — on unpriced venues' sheets, an honest nudge "No pint price logged here yet — be the first" wiring into the existing drop composer; targets the 658 unpriced outer pubs list. Careful: #303 touches the composer — build on main, additive, note rebase-by-intent if they collide.

- **Real-user slop feedback → both-theme audit + token-lane** (Opus 4.8, design/token-system-v2): diagnosis is SYSTEMIC — coral does everything, dark mode is flat inverted-light with a muddy brown wash, no elevation system, weak type hierarchy outside prices. Lane scope: token-level only (accent roles, dark elevation steps, wash removal, 3-level type scale, 1-2 signature moves like brass price-plaques) — no layout rewrites (those live in #305/#307/#311). Screenshots: scratchpad t-{light,dark}-{home,map,tonight,feed}.png.

- **Owner directives: production fundamentals + study guide** — prod-lane (Opus 4.8, infra/production-readiness): honest audit of caching/CDN/DB-index/resilience/observability gaps vs what exists, then top-5 quick wins as commits. teach-lane (Opus 4.8, docs/how-pubmaxx-is-built): self-contained HTML curriculum, 10 chapters first-principles→staff-level, every concept anchored to real repo code + this project's war stories.

- **PRs #327 (email digest), #328 (token system v2), #329 (zone lens — the £1.60 Zone 1 tax, real data)** opened. **Harvest CONCLUDED + paused by guard**: 239 evaluated, 4 verified, 1.7% — inner London 0%, hypothesis refuted structurally (prices live on bar boards + Order&Pay apps, not the web). Drops (#303/#326) confirmed as THE price channel. OWNER DECISION: hand-curated harvest shortlist, or hold and bet fully on drops (Fable recommends: hold, bet on drops).

### Cycle 8 complete — full delivery log
- **PR #325** APNs transport (real HTTP/2+ES256, no deps, 25 tests) · **#326** first-drop nudge · **#327** email digest seam (opt-in-first) · **#328** token system v2 (brass price plaques, wash killed) · **#329** zone lens (the £1.60 Zone 1 tax, 649 stations, 0 unknowns) · **#330** production hardening (OG caching, API cache headers, 0041 author index — third ledger collision caught in review, OAuth timeouts; audit doc gives fair credit to what's already mature) · **#331** the How-PUBMAXX-Is-Built study guide (15k words, fact-checked the project's own folklore against code).
- **Harvest verdict** stands: drops are the price channel. **review-c8 lane** running: adversarial cross-PR pass over #323–#329 (zone×data-chain merge position, token drift, APNs crypto verification, digest PII, #323 adoption checklist + merge-order additions).
- Open PR count: **~30 active** (#276, #295–#331 minus held/superseded). Sol's path: #316 v2 order + #321/#322 reviews + review-c8's amendment when it lands.

- **PR #332 — deep review of Cycle 8**: all six approved. Routed fixes running: zone-lane rebasing #329 onto the data chain + migrating 32 raw --brass refs to #328's role tokens; digest-lane guarding the unsubscribe placeholder. #326's one-token nit → Sol's rebase note. Merge-order E5/F amendments drafted (acceptance gate: 4 components call claimPromptBudget). #329 slots as step 31 (after #317).

- **All #332 remediations closed**: #327 unsubscribe guard fail-safe (0550649b); #329 rebased into the data chain as step 31 (4a66e0e0 — 1919 venues intact, zone in every shard, 519KB eager, 0 raw brass). **Every open PR is now reviewed, cross-reviewed, and remediation-clean.** Data chain final shape: #315→#320→#319→#317→#329.

## CYCLE 9 PRD (grilled + locked: depth before validation, owner's call)

Owner chose depth-first over ship-and-measure (PMF conviction; validation follows the depth wave). Locked: **the recap artifact + night arc** — polish plan→live night→ending→recap into one seamless arc that reliably produces a beautiful, sendable night memory. Form: **private approval-gated recap PAGE + generated OG image card** (the WhatsApp preview is the hook, the page is the memory). Privacy: nothing shareable without the existing Story-approval consent flow.

Lanes (Opus 4.8, worktrees, Sol decides):
1. **`feat/night-arc-seams`** — audit the arc end-to-end in code (plan → activation → guardian/get-in/votes → ending selection → recap), fix the seams: dead ends, state loss between stages, missing transitions, mobile one-hand continuity. Polish lane discipline (no new features).
2. **`feat/recap-page`** — the crafted private recap page: route walked, pints + prices logged, approved photos, chosen ending, guardian save, dry-London copy; approval-gated sharing via existing consents; #328 token system (plaques, elevation); 390-first both themes.
3. **`feat/recap-card`** — generated OG image card for shared recaps (ogBrand kit + OG_CACHE_HEADERS from #330's pattern): night title, route line, headline stats. The preview that makes people tap.

- **PR #333 recap OG card** (privacy-gated, 60s revocation TTL, lanes coordinated URL agent-to-agent) · **PR #334 night-arc seams** — HIGH find: the recap was STRANDED after the 8h window (the arc's payoff dead-ended); fixed with 24h grace + completed-state plan page. recap-page lane still building the durable memory surface. Pointer appended to sol2.md (untracked, additive only).

- **PR #335 recap page — CYCLE 9 COMPLETE.** The recap set: #334 (arc seams + 24h grace) → #335 (private crew page + approval-gated public recap, single privacy choke point) → #333 (OG card). Lanes locked URL + stats contracts agent-to-agent, zero file overlap. The USP loop now runs end-to-end in the queue: find the pint → guard the night → log the drop → keep the memory → send the card.

- **PR #336 — recap-set adversarial review**: all three APPROVED. R1: lanes' "zero overlap" claim FALSE — #334×#335 NightModeCard conflict proven, exact hand-merge documented + verified (Sol: steps 31–33 = #334 → #335 hand-merge → #333). R2 (MEDIUM, fix routed): withdrawn-consent photos fetchable ~1h via signed URLs — public recap TTL dropping to 180s. Everything else fail-closed.

- **R2 closed** (1be94e3b): public recap photo TTL 3600→180s, scoped to the public path, tested. **The full queue — 36 PRs — is now reviewed, adversarially attacked, and remediation-clean.** Sol's complete path: #316 v2 order + review docs #321/#322/#332/#336 (steps 31–33 = recap set with the one documented hand-merge).

- **PRs #337/#338 — two-axis corpus review (Standards / Spec)**: Standards CLEAN (0 hard violations; DeliveryStatus + DAY_MS cleanups; seam repetition sanctioned). Spec: 3 fidelity gaps — early email capture NOT built (locked decision, needs a lane or a de-scope), #313 gates on 2nd calendar day vs locked "second visit" (owner confirm), USP bet 4 unresolved (bill-split decision). Issue map: #45 closable on #302 merge; #286 satisfied; #283 needs accessibility-matrix proof; #287/#282 correctly deferred.

## CYCLE 10 — confidence hardening (owner directive)

Raise every open finding from reviewer-prose to evidence-backed verdict, and close the confirmed gaps. Three Opus 4.8 lanes: (1) `review/findings-confidence` — every unfixed finding across all six review docs re-attacked mechanically → CONFIRMED/REFUTED/STALE/OWNER-DECISION table with quoted evidence; (2) `feat/email-capture` — builds the locked-but-missing Cycle-2 email capture (digest-purpose-limited inline capture on the identity nudge, double-opt-in, unconfirmed excluded from sends, migration 0042, full house pattern, cert 61→62); (3) `docs/a11y-matrix` — produces #283's missing accessibility-matrix proof (reduced-motion, focus, 44px, computed token contrast, aria) and fixes small failures inline.

### Owner iPhone bug reports (live prod, screenshots) — 3 lanes launched
- **fix/route-stop-labels**: route line + numbered stops render but carry no pub names (live main behavior, not merge-gated) → brass-chip labels on stops.
- **feat/event-sources**: Tonight thin → research-first event ingestion via OFFICIAL APIs only (Ticketmaster Discovery free tier, Skiddle; Eventbrite search API deprecated — verifying). No aggregator scraping (ToS). Provider-keyed, noop until owner signs up (free keys).
- **fix/feed-scroll-stability**: feed scroll bounces on iPhone Safari → CLS hunt (unreserved media heights, poll-reorders mid-scroll, iOS 100vh) + Playwright scroll-stability test.

### Cycle 10 complete + owner bug sweep
- **#339** a11y matrix (#283 proven, 1 fix, 3 filed) · **#340** route-stop names (owner report — symbol layer, brass halo text) · **#341** findings confidence ledger (47 verdicts: 10 stale, ~13 merge-time, 11 owner) · **#342** event sources (Ticketmaster free/instant + Skiddle gated; Eventbrite dead; seam key-activated) · **#343** early email capture (last missing locked decision, stacked on #312, double-opt-in) · **#344** feed scroll stability (owner report — iOS anchoring; regression test proven-failing pre-fix) · #329 token migration completed.
- Owner activation shortlist: TICKETMASTER_API_KEY (2 min, fills Tonight), Skiddle approval, Firecrawl top-up (credits exhausted again). All three owner-side.

## CYCLE 11 PRD (new Firecrawl credits; owner: scrape all viable data + execute mentioned next steps)

1. **`data/harvest-continuation`** (Opus 4.8): with fresh credits — (a) the remaining unevaluated independents from the London sweep (resume script exists, --resume/--scope flags); (b) the venue drink-menu ENRICHMENT harvesters (previously off-metric for cheapestPrice but real value for venue detail pages — run for matched chains per existing scripts); (c) keep the <5% pause guard for the price sweep but enrichment is exempt (different metric). Checkpoint commits.
2. **`fix/a11y-findings`** (Opus 4.8): the two real filed a11y gaps from #339 — a keyboard-operable venue path (DOM list fallback reachable by keyboard for arbitrary pin selection, WCAG 2.1.1) + desktop venue drawer focus trap (mobile parity).
3. **`infra/resilience-p2`** (Opus 4.8): #330's deferred P2s — CityMCP serve-last-known-on-error + single retry; per-route latency/error-budget log drain + alert on rate-limiter fail-open events (per the PNC observability runbook's patterns).

Wayfinder next-wave note: with these, every filed finding in the programme is either fixed, PR'd, or an owner decision. The wave after this is merge-activation (Sol) + PMF measurement — no construction left that isn't gated.

- **Design wave added to Cycle 11** (owner directive): `docs/design-direction` — Firecrawl study of Citymapper/DICE/Airbnb/Linear/Family + Apple HIG physics → design thesis + top-8 implementable deltas as the next wave's PRD; `design/logo-system` — 3 crafted SVG mark concepts (no beer-mug kitsch; ××-as-rendezvous / geometric pint / X-marks-the-pub directions), full icon system, owner picks before any live swap.

- **Live-data wayfinder lane** (owner: "always get live data"): `infra/live-data-wayfinder` — cadence audit per data class, activation matrix (which owner key arms which cron), and the missing spine: machine-readable freshness registry + check_freshness script + /api/freshness route feeding the existing staleness labels uniformly. Key truth: TfL is already live; most other classes are built-but-key-gated; drops' refresh mechanism IS the growth loop.

### Cycle 11 + design wave complete — PRs #345–#350
- **#345** design direction (the bar-mat thesis, top-8 deltas, collision map) · **#346** a11y features (List view + shared focus trap) · **#347** the logo system (Concept A "The Crossing" recommended — owner picks, one-commit activation) · **#348** design quick wins (D3/D4/D6, 22 radii migrated, AA holds) · **#349** live-data wayfinder (cadence audit, activation matrix, freshness spine — caught 3 stale crons on main; correction: digest/APNs are branch work, not dormant keys) · **#350** CityMCP stale-serve + observability drain · #320 harvest closed (enrichment +87 rows).
- **Programme state: ~50 open PRs, zero merged, everything reviewed.** Construction backlog is EMPTY except owner-gated items. Next wave = activation: Sol merges (#316 v2 + #341 ledger), owner keys (Ticketmaster 2-min, EXA, Skiddle approval, Firecrawl fine, logo pick, #313 wording, bill-split), then real users on the funnel.

### FABLE DEEP REVIEW (#352) + voice spec (#351) — the closing layer
- **#351 voice spec**: the great voice exists, buried under plumbing-leak + SaaS registers; full rewrite table + 8 attachment moments, sequenced into owning PRs.
- **#352 Fable fork systemic review**: 4 merge clusters must land as single sittings (partial prompt-cluster merge = P1 live in prod); cert-count bomb mapped (true final = 62, bump schedule for Sol); map chrome ruled OVER THE LINE post-merge (consolidation design ready as a next lane); **forgot: drop confirmations** (community-verified moat — recommended next build); **shouldn't ship: fake presence counts** — demo kill switch committed (NEXT_PUBLIC_DEMO_CONTENT=off), OWNER DECISION: flip before launch.

## CYCLE 12 — the taste wave (owner: GO; two Fable forks, high context)

Remote truth re-verified pre-launch (origin/main ccceede7, no new Sol merges, codex branches unchanged). Two Fable-fork lanes (full session context each, fresh-fetch mandated):
1. **`feat/map-chrome-tiers`** — the #352 consolidation: Near me as the single Tier-1 answer, one Filters chip absorbing Drinks/price/Zone as sheet sections, TfL+List as corner icons; capability-preserving placement-only; adoption notes so #309/#329/#346 rebase mechanically.
2. **`feat/drop-confirmations`** — the moat completion: one-tap "Still £5.20?" confirms, trust math (fresh-confirmed/aging/stale states) rendered subtly on the brass plaque, "It's changed" routes into the composer, day-bucket dedupe + dual limits, migration 0043, cert count → 63 with reconciliation note, decay for unconfirmed prices.

## PROGRAMME CLOSED TO CONSTRUCTION — MERGE-READY (final pass #355)

**#353** chrome tiers (7→3+2, adoption notes) · **#354** drop confirmations (Sol's plumbing discovered + honest delta only: social proof, trust math, decay) · **#355** final pass: ALL of #345–#354 verified as one conflict-free stacking tree, 13/13 suites, cert truth = 60 (fork's 62 claim refuted — self-correcting reviews), ZERO blockers. Every PR #276–#355 now carries an evidence-backed verdict (ledgers V1+V2).

**The programme: ~55 PRs, 12 cycles, 3 ledgers, merge-ready. Next: the launch/activation plan (grilling with owner), then Sol's merge day per the choreography (#352 clusters + #316 v2 + #341/#355 ledgers).**

### Issue backlog triaged (evidence-verified)
- **CLOSED**: #45 (Last Pint — #302 merged), #286 (Wave 0 — cert/hardening/observability mapped), #283 (Wave 1 — a11y matrix closed the gap; List view carried by #346).
- **Downgraded honestly**: #279 stays open — #349's registry is a third mirror of the hand-authored PINT_DATASET_OBSERVED_AT, not the single source the issue asks for; exact wiring commented (small post-cluster lane).
- **Status-commented, kept open**: #281 umbrella (wave table), #284/#285 (pending the integrator's cluster restack), #287/#282 (deferred per locked London-only decision), #252 (companion depth = owner's depth-order), #168 (real debt, factory case stronger).
- Open issues now: 8, each with a current, honest status. OWNER decisions still pending: #313 gate wording, bill-split.

## LAUNCH DAY COMPLETE — THE PROGRAMME IS MERGED (2026-07-18)

Owner granted merge authority; the full choreography executed: docs tier → data chain (script-rerun restacks, true merges) → feature bulk → prompt cluster (one sitting, P1 impossible in prod) → share + recap clusters (documented hand-merges) → native stack (double-restacked, cert count final at 62). **Every programme PR #276–#356 is on main** except the three documented holds (#229/#263/#264). Final composition verified: 3605 tests green.

Launch-day incidents, all root-caused + fixed: crosswalk governance ×2 (unindexed PRD docs), reactions-test timeout flake, CSS comment self-termination (real prod-risk bug), Tonight-sheet layout break (from the chrome-tier move — #356), disk exhaustion (worktree prune). In flight at close: deploy-sheriff (until live green + signatures verified), mobile gutters, em-dash sweep.

Owner queue: Ticketmaster/EXA/Resend/APNs keys now light up MERGED code; logo pick; demo-content flip; #313 wording; bill-split; Xcode for the first iOS build.

### Post-launch polish + debt closure (evening)
- **#356** tonight-sheet fix · **#357** global gutters (found the profile zero-padding bug) · **#358** em-dash sweep (504+ rewrites incl. fresh merge copy) · **#359** provenance single-source (closes #279 for real — drift test) · **#360** store factory (#168's honest remainder, 4 stores converted). All merged.
- **Tracker at zero-debt**: 4 open issues (all deliberate: deferred waves #287/#282, companion depth #252, #168's follow-up adopters), 2 open PRs (#229 GA-hold confirmed vs maplibre 5.24, none other). #263/#264 closed superseded with evidence.
- Outstanding: deploy-sheriff loop until production Ready + live signatures verified (multiple CI-only failures fixed in sequence; live site still serving pre-wave build until one deploy lands green).

## CYCLE 13 — PRODUCTION GREEN + THE LIVE-DATA WAVE (2026-07-18 evening)

**PRODUCTION IS LIVE.** The withRouteTiming generic fix (fcf60731) was the last blocker; pubmaxxing.com now serves the full launch build (near 200, freshness 200, about clean). Owner reviews the flow tonight.

Owner supplied keys in-session (verified live before wiring): EVENTBRITE_API_TOKEN + EXA_API_KEY → Vercel production+preview env, .env.local, and EXA_API_KEY as a GitHub Actions secret. TfL confirmed working keyless. Meetup parked (OAuth2 + likely Pro subscription, weak fit).

Six parallel lanes from the Londonmaxxing resources audit + key drop. Models: FHRS/police/heritage/Eventbrite/Exa = Opus 4.8 (claude-opus-4-8, standard integrations); TfL + perf = Fable forks (claude-fable-5, high effort). Fable reviewed every PR; merge-on-green per owner's standing instruction:

- **#361 FHRS hygiene badge** (MERGED): FSA rating chip on the venue sheet; postcode + Sørensen-Dice fuzzy match, pub-over-cafe tie-break, fail-soft, 22 tests.
- **#362 night calm context** (MERGED): data.police.uk aggregated to coarse Night Areas; relative night-relevant share → three reassuring bands; silent under 20-crime samples; tone-tested (no alarm words possible).
- **#363 TfL get-home strip** (MERGED): Tonight page line pair from the EXISTING /api/last-train surface (lane correctly extended instead of duplicating lib/tfl.ts). Privacy copy made honest (coords rounded to ~110m, sent once, never saved); location block un-gated on thin nights.
- **#364 Eventbrite provider seam** (CI rerunning after a fetch-mock type fix): capability probe proved a private token gets ZERO public discovery (search API removed 2019, account owns no orgs) — honest zero-row provider that lights up if the account ever owns events. **Ticketmaster key is now the only real path to filling Tonight.**
- **#365 heritage pub facts** (CI running): 237 London pubs matched to NHLE listed buildings (1 Grade I, 12 Grade II*), conservative two-tier matcher with denylist guards, OGL attribution, build-time snapshot, brass-plaque styling + JSON-LD.
- **#366 Exa buzz ingestion** (CI running): wired the existing Night Signals seam's missing producer — daily 07:45 UTC workflow stages PENDING candidates (publisher headlines verbatim, tracking-stripped URLs, human approval gates publication).

Also this cycle: owner reported site slowness → measured (homepage TTFB ~1s no-store SSR MISS; ~1.1MB first-load JS) → **perf lane running as a Fable fork** (rendering-mode fixes toward edge-cached static/ISR + MapLibre code-split). Standing rule recorded: any Exa/Firecrawl credit exhaustion or scrape failure is reported to Karan immediately.

## CYCLE 14 — OWNER SCREENSHOTS + FULL JOURNEY AUDIT WAVE (2026-07-18 night)

Owner iPhone screenshots drove three Fable-fork fixes, then a desktop browser audit (13 ranked findings) drove three more lanes. All merged same-night, every one CI-green through CodeRabbit + Cursor security:

- **#367 map UX** (Fable fork): duplicate List-view pill was a CSS rule-ordering bug; rotation was never disabled — fitBounds calls flattened bearing/pitch and the flat camera persisted via saved session; fits now preserve bearing, dead-flat saved viewports upgrade to the designed attitude, new brass compass with tap-to-north. NOTE for owner: the ambient idle ORBIT was removed deliberately (abeb471e, tile-churn flicker) and stays removed pending owner call.
- **#368 venue sheet** (Fable fork): legacy drawer sticky-bar offsets leaked onto the portal sheet + iOS vh/dvh mismatch floated the command bar mid-content; dvh migration, offsets scoped :not(.mobileSharedSheet), Train duplicate removed (tab row owns navigation).
- **#369 perf split** (Fable fork; owner REJECTED the CSP downgrade after AskUserQuestion): shipped only the safe wins — 3MB price-JSON out of the map chunk (7.9→5.2MB client JS), five render-nothing shell extras deferred post-hydration. Static rendering + edge cache PARKED behind hash-CSP.
- **#370 brand** (Opus 4.8): The Crossing (Concept A) activated — favicon, icons, maskable, manifest, OG cards via new CrossingMark in ogBrand. theme_color left #16122a (doc says confirm, not invent).
- **#371 search/routing** (Opus 4.8): search now flies to a unique match / fits multi-matches through the existing camera path; /stories 308→/feed; branded not-found; disruption banner severity-gated + role-tokened.
- **#372 drawer polish** (Fable fork): mobile-only peek strip rendered unstyled on desktop (media-query leak) — the "collapsed text run" bug; martini-pin precedence fixed (categories outrank cocktails amenity); amenity chips humanized; light basemap Liberty→Positron (brand-tinted custom style JSON = follow-up).
- **#373 copy/data** (Opus 4.8): em dashes killed at the event-title seam with regression test; Pint Index leads with real data not "Public release pending"; citation brackets → superscript links.

Desktop audit remainder: map-boot blank canvas (rides on hash-CSP lane, running), demo-content flip (owner env), desktop feed layout (parked, design pass).

Also this cycle: global `ideate` skill created (~/.claude/skills/ideate + rule in ~/.claude/CLAUDE.md): every new owner idea triggers grilling + top-tier agent panel + gated implement/verify/review/close pipeline, across all repos. 13 official Anthropic skills installed (webapp-testing, mcp-builder, skill-creator, pdf, theme-factory...). Standing rule: Exa/Firecrawl credit failures get reported to owner immediately.

IN FLIGHT: hash-CSP lane (Fable fork) — strict CSP without nonce so public routes go static + edge-cached (the ~1s TTFB fix) with NO unsafe-inline (owner's constraint).

## Owner queue

TICKETMASTER_API_KEY (the sole events-discovery path) · demo-content flip (NEXT_PUBLIC_DEMO_CONTENT=off) · orbit decision (auto-rotate stays removed unless owner overrides) · Apple Developer enrollment · Search Console + Bing + sitemap · `hello@pubmaxxing.com` · #313 wording · bill-split decision · RESEND_API_KEY + EMAIL_FROM.

## Cycle 15-16 close + Cycle 17 (launch week, 2026-07-19/20)

Cycles 15-16 (overnight research + clarity loops) closed into the launch: regional sweeps, slop filter (#376), native readiness (#377), Tonight Conditions (#378), Social Loop v1 (#379), wayfinder clarity #393-#397 closed with judge evidence. Full detail in FABLE_HANDOFF.md history and docs/UNIVERSAL_DAY0_PRD.md.

Cycle 17 (docs/UNIVERSAL_DAY0_PRD.md = canonical): 26 PRs merged in one owner-steered day+night, #409-#416 + #418-#434. Three arcs:

1. **Data + platform truth** (#409 tonight interval overlap root cause, #410 map boot two-clock, #415 API envelope + limiter symmetry, #416 sport reseed + past-dated guard, #420 point-row kind-aware grace, #419 store-factory batch 1, #418 confidence V3 ledger).
2. **Owner-driven mobile taste** (#414 /today + six tabs, #422 six-tab equal rhythm, #421 rotation + restored idle auto-orbit (owner call, supersedes abeb471e) + #423 6s first-impression, #427 borough wall replaced by pints-first curated patches, #429 one remembered patch across map/Tonight/Today, #426/#432 friction-state voice sweeps with CI fences, #428 judge w1 (+ prod-deploy unbreaker), #431 feed density + pal glance, #430 token tail, #434 polish w3, #433 judge w2 CLEAN PASS verdict).
3. **Vibe layer** (docs/VIBE_LAYER_SPEC_2026-07-19.md, owner-grilled + two-fork panel: #424 seven chips on Tonight + pal in British sesh register, "On a bender" kept by owner override; #425 Bungee --font-party + validated OG vibe stamp + fixed plan share cards silently 500ing since #413).

Ops: GNHF CLI run produced 0 tokens (backend never engaged) — native Fable lane loop did the work. 226 stale local branches pruned under proof contract (83 kept with reasons). Old gnhf shareSheet/bar-tab work confirmed already on main under rebased hashes.

## Owner queue (current)

GitHub Actions billing (revives all crons — highest leverage) · VAPID keypair + APNS_PRIVATE_KEY after store enrollment #390 · TICKETMASTER_API_KEY #385 · Exa/Firecrawl credit top-ups · OpenRouter funding (concierge narration flip) · Sol start on PRD Lanes B (web push, rescoped) + E (category ingest) · pid 33497 forgotten claude session holding worktree locks · two dirty worktrees salvage call (routeObservability edits; CSP double-build) · 50 unmerged-content branches archaeology (email digest, price drops v2 may hold value).
