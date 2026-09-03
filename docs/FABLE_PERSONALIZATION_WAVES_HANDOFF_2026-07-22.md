# Fable handoff ledger: personalization Waves A and B

Status: **merged as PR #557 / `5c69d630`; automated release gates and exact deployed browser verification complete; Fable human review queued**

Original lane baseline: `origin/main@a3fde784` on 2026-07-22

Refreshed integration baseline: `origin/main@07b645ea` after Fable's #549 to #556 close-out

Post-merge evidence baseline: `origin/main@a10cc675` after Fable merged guarded web push #457 and grounded Plan generation #462

Release roles: Karan owns product rulings; Fable owns architecture review, green-gate review, merge order, and rollout verdict.

## Owner supersession record

- Karan's 2026-07-22 direction asked Codex to build the user-personalised PUBMAXX product, then explicitly directed the 5.6-high agent fleet to execute the resulting tasks and waves. That authorises this narrow read-only Today slice and supersedes the original Lane A "Cut: personalization" line in `docs/UNIVERSAL_DAY0_PRD.md`; it does not authorise account writes, automatic memory, or new tracking.
- The current `FABLE_HANDOFF.md` records the later owner decision `persona shape = pub-tied lens only`. That supersedes the older `OWNER DECISION PENDING` language in `docs/PERSONA_DRINKS_AND_DESKTOP_PRD.md`. Wave B implements only that pub-tied pure contract and still defers UI wiring.

## Scope and ownership

Wave A makes the existing `/today` brief respond deterministically to already-available preference context. It may personalize existing composition, ordering, or presentation through a new pure resolver. It does not add a preference-capture flow, a data source, an account write, or an ungrounded recommendation. Wave B adds only a pure Surprise Drink resolver and its focused tests; UI wiring is explicitly deferred.

| Lane | Exact ownership | Branch / worktree |
| --- | --- | --- |
| Wave A: Personalized Today | `lib/todayPersonalization.ts`, `__tests__/todayPersonalization.test.ts`, minimum wiring in `app/today/page.tsx`, `app/today/TodayClient.tsx`, the area-specific weather option in `lib/todayBrief.ts`, and its existing focused test | `codex/wave-personalized-today-20260722` / `.codex-worktrees/wave-personalized-today` |
| Wave B: Surprise Drink | `lib/surpriseDrink.ts` and `__tests__/surpriseDrink.test.ts` only. No UI wiring. | `codex/wave-surprise-drink-20260722` / `.codex-worktrees/wave-surprise-drink` |
| Integration / handoff | This ledger and later conflict review only after both lane SHAs and touched-file manifests exist. This ledger commit contains no product code. | `codex/wave-personalization-integration-20260722` / `.codex-worktrees/wave-personalization-integration` |

Both feature branches started at the same original baseline and tracked `origin/main`; no lane-specific remote ref or PR number was locally available when this ledger was opened. A separate security lane proved the Next.js fix, but Fable independently merged the same exact 16.2.11 patch as #550. The integration rebase therefore dropped our duplicate dependency commit and inherits #550 without touching either manifest.

## Overlap exclusions

Personalized Today must not edit any existing file outside its declared manifest. Explicit exclusions are:

- `app/today/today.css` and all other existing `/today` cards/helpers;
- PlanComposer, auth, generation, account-hub, or preference-capture surfaces;
- PubMap, `usePersonaTonight`, mobile nav, shared nav, or other active map files;
- Tonight, check-ins, plan-page, and Cursor-owned files, including `app/tonight/TonightClient.tsx`;
- Fable-owned landing, metadata, and walk-route lanes;
- Wave B files `lib/surpriseDrink.ts` and `__tests__/surpriseDrink.test.ts`; Wave A has no ownership there.

If either lane needs an excluded file, stop and return the proposed file plus reason to Fable. Do not broaden ownership implicitly during rebase or conflict resolution.

## Acceptance criteria

- The resolver is pure and deterministic: explicit inputs in, decision out; no React, fetch, storage, ambient clock, randomness, or mutation.
- Resolver inputs, precedence, tie-breaking, and output effect are named in code and pinned by tests. Unsupported, absent, or corrupt preference context produces the current baseline `/today` behaviour exactly.
- Personalization uses only existing grounded content. It preserves source labels, freshness/staleness language, honest empty states, the current pick cap, and existing remembered-area continuity.
- Today enforces only exclusions its event DTO can prove: muted areas and topics. Zero-proof, accessibility, and budget remain planning context with provenance; this slice does not pretend event rows prove those constraints.
- No new API route, migration, secret, analytics identifier, auth dependency, or durable write is introduced. Any such need is a scope change requiring a new ruling.
- Existing Today contracts remain green, including `todayBrief`, patch continuity, Today area/pints, quiet-pint, deals-digest, and weather read-through coverage.
- Keyboard and screen-reader semantics remain intact; both themes are visually checked at 390x844 and desktop width with reduced motion enabled once.
- `npm run verify` and the Vercel gate pass on the integrated SHA. Fable's human diff and rollout verdict remains explicitly queued even though the automated gates passed and PR #557 was merged externally.
- Wave B changes exactly `lib/surpriseDrink.ts` and `__tests__/surpriseDrink.test.ts`; it has no component, page, style, route, or other UI integration.

## Test and review evidence

Fill every field before merge; `TBD` is not release evidence.

| Lane | Commit / PR | Touched-file manifest | Focused tests | `npm run verify` | Visual / live evidence | Fable verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Wave A: Personalized Today | lane `155a2769`; integrated through `9bd58f94`; PR #557 merged as `5c69d630` | `lib/todayPersonalization.ts`; `__tests__/todayPersonalization.test.ts`; `app/today/page.tsx`; `app/today/TodayClient.tsx`; `lib/todayBrief.ts`; `__tests__/todayBrief.test.ts` | Included in final 134/134 focused set; typecheck and touched-file lint pass | Both Vercel projects passed on PR #557 and on subsequent current-main deployments | Production desktop light and 390x844 light/dark baseline passed. Exact preference-path check proved progressive Camden intake wins over remembered Clapham for weather, storage is read-only, and a fresh tab reports zero errors and zero warnings. | Automated clean; Fable human review queued per owner request |
| Wave B: Surprise Drink | lane `7ca77b74`; integrated through `9bd58f94`; PR #557 merged as `5c69d630` | `lib/surpriseDrink.ts`; `__tests__/surpriseDrink.test.ts` | Included in final 134/134 focused set; typecheck and touched-file lint pass; final Surprise-only set 21/21 | Both Vercel projects passed on PR #557 and on subsequent current-main deployments | Not applicable until a separately approved UI wave | Automated clean; Fable human review queued per owner request |
| Inherited security baseline | Fable #550 / `b5f9b7b9` | No dependency file belongs to this branch after rebase | Installed Next.js 16.2.11; typecheck passed | Registry-backed `npm audit --audit-level=high`: 0 vulnerabilities | Canonical builds passed through PR #557 and later `main` deployments | Already merged by Fable; duplicate Codex dependency commit correctly dropped |
| Integrated waves | product fixed point `9bd58f94`; PR head `f1957ea8`; merge `5c69d630` | 9-file feature manifest including this ledger; feature manifests remain disjoint | 134/134 focused tests; typecheck; touched-file lint; diff-check all pass | Latest full data/lint/typecheck/coverage before the four final timestamp controls: 516 files and 5,021/5,021 tests passed. The four later controls passed targeted validation. Registry-backed audit found 0 vulnerabilities. PR #557 Vercel chengdu/pubmax and CodeRabbit passed. | Production desktop light, mobile light/dark, and an exact deployed personalized-state path passed. The protected preview redirected to Vercel login, recorded as access protection rather than a product failure. | Automated fixed point clean; Fable human review queued per owner request |

## Deployed browser evidence

All checks below ran against `https://pubmaxxing.com/today` after PR #557 merged. Temporary browser state was limited to the two existing keys `pubmax:plan-intake:v1` and `pubmax:nightPatch:v1`; both were removed after the check.

- Desktop baseline, light: [full-page capture](evidence/pr-557/pubmax-today-desktop-baseline.png)
- Desktop baseline, dark: [full-page capture](evidence/pr-557/pubmax-today-desktop-dark-baseline.png)
- Desktop dark with reduced motion requested: [full-page capture](evidence/pr-557/pubmax-today-desktop-dark-reduced-motion.png)
- Mobile baseline at 390x844, light: [full-page capture](evidence/pr-557/pubmax-today-mobile-baseline.png)
- Mobile baseline at 390x844, dark: [full-page capture](evidence/pr-557/pubmax-today-mobile-dark-baseline.png)
- Mobile deployed preference path at 390x844: [full-page capture](evidence/pr-557/pubmax-today-mobile-personalized-pr557.png)
- The [machine-readable live-state trace](evidence/pr-557/pr557-live-state-evidence.json) records the exact production URL, 1440x1000 dark viewport, reduced-motion media query, zero running document animations, headings, navigation, storage comparisons, and weather evidence URL.
- The preference-path control stored a valid progressive intake with `area: "camden"` and a lower-priority remembered patch `clapham`. The trace records weather coordinates `latitude=51.539&longitude=-0.143`, the repository's Camden coordinates, plus byte-identical progressive-intake and remembered-patch strings after hydration.
- The [fresh-tab console artifact](evidence/pr-557/pr557-live-console.txt) records `0` errors and `0` warnings. Temporary browser keys were removed after capture.
- [PR #557 checks](https://github.com/karanmrn/pubmax/pull/557/checks) record both Vercel projects and CodeRabbit passing. The corresponding checks also passed on later main merges [#457](https://github.com/karanmrn/pubmax/pull/457/checks) and [#462](https://github.com/karanmrn/pubmax/pull/462/checks), so the feature remained deployed after Fable's subsequent voice, web-push, and grounded-generation work.

## Proposed next non-overlapping product queue

Status: **planning only**. `sol_execution.md` pauses the next implementation wave until Fable reviews the open Sol work. None of the slices below has started, and each requires a fresh ownership check immediately before branching.

Current collision fence: do not touch the newly merged #462 Plan-generation contract or remaining PlanComposer drafts (#495 to #497, #510), analytics (#456), auth or push identity (#459), Tonight (#495, #504), map chrome/search (#501, #502, #509), invitations (#503, #508, #516), `/near` (#517), or Fable's owner-blocked migrations and configuration sequence.

The broader `/choose` concept is **not implementation-ready**: its pub discovery, distance, and comparison journey would collide at product scope with `/near` #517 and map-search work #501/#502/#509 even if it used new filenames. Fable must first rule whether a separate chooser should exist or whether those capabilities belong inside the existing map and near journeys.

The safe queue below stays inside the already-merged Today/Surprise Drink domain. No open PR in the 2026-07-23 GitHub inventory claimed `lib/surpriseDrink.ts` or the `/today` feature files, but Fable must repeat that ownership check before each branch starts.

Exact-drink availability is the entry gate, not an assumption. The existing authoritative input is `DrinkPriceUpdate` from `public/data/drink_price_updates/latest.json`, validated by `lib/drinkPriceUpdates.ts`. The browser-only `lib/priceUpdatesLoader.ts` is not a server adapter because it deliberately yields no data when `window` is absent. The new server-only seam must instead mirror `app/feed/feedSightings.server.ts`: read the public JSON with `fs`, parse it with `parseDrinkPriceUpdates`, and resolve canonical `venueKey` values to venue IDs/names. No adapter currently converts those rows into `SurpriseDrinkAvailability`, and Today's event picks alone do not prove that a venue serves a persona's exact order. All UI slices below remain blocked until Fable assigns that bounded adapter and its coverage audit finds enough exact matches to justify a card.

| Priority | Slice | User outcome | Bounded implementation surface | Acceptance gate and non-overlap proof |
| --- | --- | --- | --- | --- |
| P0 | **Exact-drink availability adapter and coverage audit** | The product learns whether it can truthfully offer persona drinks at Today's pubs before any card promises them | New server-only `lib/surpriseDrinkAvailability.ts`, focused tests, and a read-only audit script; direct server read and validation mirroring `app/feed/feedSightings.server.ts`; bounded `lib/surpriseDrink.ts` contract extension plus tests to replace the flat `source` string with the complete structured source `{ label, url, licence }` | Exact canonical venue and normalized exact drink-name matches only; preserve price, linked source label/URL, licence, and observed time in `SurpriseDrinkAvailability`; fail closed to zero rows; publish match-rate evidence; no browser loader, scrape, migration, client fetch, or inferred menu claim |
| P0, blocked on adapter | **Surprise Drink card** for an existing Today pick | A person gets one concrete drink, at one already-recommended pub, with exact price and evidence instead of a generic beverage category | New Today card/component consuming the approved adapter and `lib/surpriseDrink.ts`, plus minimum `/today` wiring ruled by Fable | Render only when the adapter proves an exact match at a pub already present in Today's three-pick result; honest absent state or no card at zero coverage; no venue discovery, Plan, Map, Tonight, account, storage, analytics, or migration edits |
| P1, blocked on card | **Why this drink?** evidence trace | Weather, daypart, personality lens, price, source, and freshness are understandable without presenting taste as fact | New pure presentation DTO beside `lib/surpriseDrink.ts` and card copy only | Every displayed reason maps to an enforced resolver field and approved availability row; missing evidence is visibly unknown; no additional recommendation or ranking engine |
| P1, blocked on card | **Drink mood lens** for this view | The user can explicitly ask for classic, adventurous, refreshing, warming, or alcohol-free without building an account profile | Session-only state in the Surprise Drink card; lens values remain drink-scoped and do not copy Plan's area, group-size, budget, accessibility, or navigation schemas | Refresh returns to baseline; no localStorage; explicit current lens outranks inferred lens; strict zero-proof cannot relax; no active Plan-intake ownership crossed |
| P2, blocked on coverage | **Same-pub alternative and deterministic cycling** | A user can ask again without reopening the location decision | Extend the pure output and card to cycle only among availability rows for the same canonical venue | Every alternative has its own exact price/source/freshness evidence; stable order independent of input order; no randomness, tracking, persistence, cross-pub comparison, `/near`, map-search, route, or Plan behavior |

Suggested wave order after Fable clears the hold: availability adapter and measured coverage first. Only if that gate passes should the card, evidence trace, drink mood lens, and same-pub cycling proceed. Keep each slice in its own worktree and PR, and re-run the open-PR collision check before assigning files.

## Open security, reliability, and owner gates

- No new high-severity dependency issue was found: Next.js 16.2.11 is inherited from Fable #550 and the registry-backed high-severity audit returned zero vulnerabilities.
- Production migrations remain an owner-authorized operation. The live handoff records migrations through 0050 plus later Sol mappings as unapplied or sequence-sensitive; do not apply, renumber, or route around them from a product lane.
- Web push #457 is merged, but production targeting remains bounded by the still-open identity join #459 and by VAPID/provider configuration. Do not duplicate that work in chooser or personalization code.
- GitHub scheduled-job billing/capacity and remaining external credentials are infrastructure blockers documented in `sol_execution.md`; product UI must fail soft and must not claim background freshness it cannot prove.
- Mobile owner-device verification debt remains for the sheet/map fixes listed in `FABLE_HANDOFF.md`. The captures in this ledger verify `/today`; they do not close unrelated map, planner, or native-shell rendering claims.
- Worktree and disk hygiene is release reliability, not housekeeping: remove only a lane proven merged or otherwise preserved, and stop orphaned Next servers before production builds. No Fable worktree was removed in this wave.

## Review ledger

- Fixed point `16568bfb`: two independent 5.6-high reviews found auth scope creep, unenforced constraint labels, duplicate-order dependence, missing price/freshness guarantees, remembered-area masking, owner-decision documentation gaps, and voice-copy issues. Closed by `6adac551`.
- Fixed point `6adac551`: two fresh isolated reviews found substring topic matching, overstated current-menu copy, modelled Night Areas without weather effects, a duplicated area mapping, and stale ledger evidence. Closed by `6f607f71`.
- Fixed point `6f607f71`: two fresh isolated reviews found a mutating intake read, dishonest preference-filtered empty state, UTC/local-day conflation, and tied price-conflict selection. Closed by `285b092d`.
- Fixed point `527854dc`: two fresh isolated 5.6-high reviews found missing exact-drink identity, equivalent-timestamp price conflicts, filter-after-cap behaviour, an unenforced London day key, an overstated confirmation claim, UTC evidence-date display, and locale-dependent evidence order. All seven were closed in rebased fixed point `42b2b04e`, with focused tests increasing from 118 to 123.
- Fixed point `467c349d`: two more isolated 5.6-high reviews found that uncapped distance ordering could break source diversity and remembered-area membership, zone-less instants remained host-dependent, a final hash-collision tie-break still used locale collation, wholly corrupt higher-priority arrays could clear lower preferences, and an explicit null patch masked the same layer's valid Night Area. All five were closed in `7cd1ea4b`, with focused tests increasing from 123 to 128.
- Fixed point `1c82e44c`: product/spec review returned clean; standards review found wholly corrupt non-empty planning-context arrays still clearing lower fields and an outdated date-only evidence comment. Both were closed in `74eaaec3`, with an intentional-empty-array control test and focused total increasing from 128 to 129.
- Fixed point `cd74933a`: standards review returned clean; product/spec review found that `Date.parse` normalized impossible zoned calendar dates. Strict calendar and wall-clock component validation in `e131e751` now rejects impossible `asOfIso` and `observedAt` values, with focused total increasing from 129 to 130.
- Fixed point `6a1a7fb7`: two isolated reviews found valid microsecond ISO instants were rejected and impossible civil offsets above `±14:00` were accepted. Rebased commits `6103cb01` and `4c4a0678` close both boundaries; the focused total increased from 130 to 132.
- Fixed point `afffc8e7`: standards review returned clean on the declared boundaries; product/spec review found that millisecond canonicalization lost accepted sub-millisecond ordering. Rebased product commit `9bd58f94` now preserves every significant fractional digit in canonical UTC and compares exact seconds plus arbitrary decimal precision for freshness, latest-price choice, and same-instant conflicts. Focused total increased from 132 to 134. Two fresh isolated reviews at the resulting fixed point returned no actionable P0-P3 findings.
- The security gate found the newly disclosed high-severity Next.js advisory and proved the exact 16.2.11 patch in isolated lane `9b83c046`. Fable independently merged the same patch as #550 before our final fetch. Rebase dropped the duplicate commit cleanly; this branch now changes no dependency file and the networked audit remains clean.

## Build note

The first isolated production-build attempt correctly failed because Turbopack will not compile against dependencies outside its worktree. After a copy-on-write local dependency tree was provided, Next.js 16.2.11 started the canonical Turbopack build but slept at 0% CPU for more than 23 minutes. Only that generated build process was stopped, and its incomplete `.next-security` output was removed. Fable's #550 now supplies the same dependency baseline; Vercel remains the canonical production build gate.

## Rollout

1. Freeze each wave at a reviewed SHA and attach `git diff --name-only <baseline>...<sha>` to this ledger or the PR.
2. Fable compares both manifests before choosing merge order. A shared product file is a coordination event, not an automatic conflict resolution.
3. Rebase each lane on the then-current `origin/main`, rerun focused tests and `npm run verify`, then run the integrated gate. Use `NEXT_DIST_DIR=.next-prod` for production QA if a dev server is active elsewhere.
4. Ship without new environment or data activation. Check the baseline/no-preference path first, then one supported preference path, browser-console hydration errors, provenance, empty states, and both themes.
5. Record the deployed SHA and live-check result in the evidence table. Do not call the wave complete while any field remains `TBD`.

## Rollback

- PR #557 merged Waves A and B in one squash commit, `5c69d630`. To remove both, create a rollback branch at current `main`, run `git revert 5c69d630`, execute the full gate, and ship the resulting revert through the normal PR and Vercel process.
- To remove only Wave A, create a forward rollback commit that restores `app/today/TodayClient.tsx`, `app/today/page.tsx`, `lib/todayBrief.ts`, and `__tests__/todayBrief.test.ts` from `5c69d630^`, and removes `lib/todayPersonalization.ts` plus `__tests__/todayPersonalization.test.ts` by restoring those paths from the same parent. Leave the two Surprise Drink paths untouched. Run Today-focused tests, `npm run verify`, and both Vercel gates; the no-preference path must match the pre-wave ordering and content.
- To remove only Wave B, restore `lib/surpriseDrink.ts` and `__tests__/surpriseDrink.test.ts` from `5c69d630^` in a forward rollback commit, leaving all six Wave A paths untouched. Run the focused Today suite, `npm run verify`, and both Vercel gates. Wave B has no UI or persisted-state cleanup.
- Update this ledger in any selective rollback so Fable can distinguish code removal from a failed deployment or disabled UI.
- No database or account cleanup should be needed. If implementation creates persisted state, migrations, or new external dependencies, stop rollout because the accepted scope has changed.

## Evidence inspected

- `AGENTS.md` and the current `FABLE_HANDOFF.md`, including Fable's reviewer/merger protocol, current Cursor ownership exclusions, and the 2026-07-22 close-out through #556.
- `docs/SOL_SYNC_2026-07-22.md`, including active file-collision rules and the recorded Cursor/Fable lane boundaries.
- Local refs, worktree registry, branch tracking, and history for the integration branch plus Waves A and B at `a3fde784`, then conflict-reviewed rebases through `07b645ea`; no lane-specific remote PR evidence existed at ledger creation.
- Existing Today lineage: #414 morning brief, #429 remembered-area ordering, #527 deal diversity, #528 Tube/pints modules, #533 quiet-pint module, and #540 weather read-through.
