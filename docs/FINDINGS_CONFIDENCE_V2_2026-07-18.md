# Findings Confidence Ledger V2 — 2026-07-18

> **Superseded by [`FINDINGS_CONFIDENCE_V3_2026-07-19.md`](FINDINGS_CONFIDENCE_V3_2026-07-19.md)**,
> which re-verifies every non-final verdict against post-launch `main` HEAD. This document is
> historical evidence of the pre-merge state.

The **final** adversarial pass. V1 (`docs/FINDINGS_CONFIDENCE_2026-07-18.md`, 47 verdicts)
covered the review corpus up to the data/recap/C8 stack. This V2 **appends the design +
live-data + resilience programme (#345–#354)** so that *every PR in the programme carries a
mechanical verdict in one place*.

**Reviewer branch:** `review/final-pass` (from `origin/main` after a fresh `git fetch`, in an
isolated worktree; the shared checkout's HEAD was never touched). Doc committed, not pushed.

**Method (unchanged discipline):** each PR head fetched to a local `pr-<n>` ref;
`merge-tree --write-tree` for conflict truth; `git grep`/`diff`/row-count for claim truth;
the 13 load-bearing suites run on a **fully-merged tree** (all ten PRs sequenced onto
`origin/main`) inside this worktree via an APFS-cloned `node_modules`. Nothing is trusted from
a PR body.

**Verdict legend:** `CONFIRMED` (claim holds, evidence quoted) · `REFUTED` (claim is wrong) ·
`STALE` (was true, since fixed) · `OWNER-DECISION` (needs a human call). `OK`/`PASS` sub-tag =
the PR asserted correctness and it holds.

---

## Headline

**The programme is merge-ready.** All ten PRs (#345–#354) merge into `origin/main` with
`merge-tree` **rc=0**, and — the load-bearing result — they also merge **sequentially into one
combined tree with zero conflicts**, which then **typechecks clean (`tsc --noEmit` rc=0)** and
passes **all 13 load-bearing suites (110 tests)**, including the mutating-surface certification.

Three things a from-`main` diff would miss:

1. **The one genuine shared-file overlap composes.** #346 (a11y List view) and #353 (chrome
   tiers) both edit `components/PubMap.tsx`, but in **disjoint regions** — #346 adds
   imports/state/the `<MapVenueList>` mount + a focus-trap; #353 renames one `MobileMapShell`
   prop call (`filtersActive` → `drinkFiltersActive` + `priceCapActive`) whose matching
   signature change lives in the *same* PR (#353's `MobileMapShell.tsx`). Combined tree
   typechecks. No hand-merge needed.

2. **#350's regex broadening is load-bearing, not cosmetic.** #350 rewraps `citymcp/journey`'s
   `POST` as `export const POST = withRouteTiming(...)`. Under `main`'s **narrow** cert regex
   (`export async function POST`) that rewrap would silently drop journey out of the inventory
   (60 → 59) and **fail CI**. #350 broadens the regex to `export (?:async function|const)` in
   the *same* PR, holding the count at 60. The certification stays honest *because* of the
   regex change.

3. **The "cert count was 62" premise is REFUTED.** The committed assertion is `toHaveLength(60)`
   on `main`, on #350, on #354, and on the full ten-PR merge. #345–#354 add **zero** new
   mutating routes (journey's POST and price-confirm's POST both pre-exist on `main`; #349's
   `/api/freshness` is GET-only). See the cert reconciliation section.

No blocker-severity findings. The only debt is documentation/token hygiene (rows 52, 53), both
inherited rather than introduced by this programme.

---

## The ledger (continues V1 at row 48)

| # | PR | Claim under test | Verdict | Evidence |
|---|----|------------------|---------|----------|
| 48 | #345 | design-direction study — docs only, no code risk | **CONFIRMED · OK** | Single file `docs/DESIGN_DIRECTION_2026-07-18.md` (+298). `merge-tree` vs main rc=0. |
| 49 | #346 | keyboard venue list + desktop focus-trap parity; composes with the map | **CONFIRMED · OK** | Adds `MapVenueList` + `buildMapVenueListModel` + `useFocusTrap` reuse of the mobile-sheet trap. Shares `PubMap.tsx` with #353 but **disjoint hunks**; combined tree `tsc` rc=0; `mapVenueList.test.ts` green. |
| 50 | #347 | logo system — new brand namespace, no collision with token retunes | **CONFIRMED · OK** | 16 files; brand tokens live in `components/brand/pubmaxxMark.css`/`pubmaxxWordmark.css` (own namespace), not the `--radius`/`--panel-*` scale #348 retunes. `package.json` change is **one npm script** (`gen:brand-assets`), no deps. `pubmaxxMark.test.ts` green. |
| 51 | #348 | D3/D4/D6 token quick-wins; the 22-consumer radius migration is complete | **CONFIRMED** | Retunes `--radius` 10→8, `--radius-sm` 7→6, `--panel-raised`→#fffdf9; adds `--shadow-btn`/`--shadow-btn-hover` (**append-only**, per-theme, announced to #328). Migration count: **21× `10px`→`var(--radius)` + 1× `7px`→`var(--radius-sm)` = 22**; `git grep 'border-radius:\s*(10px\|7px)'` on the merged tree = **0** left behind. Shadow tint uses `var(--brass)` which is **live on `main`** (`--brass: #ff5a5f`, globals.css:31). |
| 52 | #354 | pre-existing `/api/price-confirm` lacks a certification row | **CONFIRMED · doc gap** | `price-confirm` appears **nowhere** in `docs/WRITE_SURFACE_CERTIFICATION.md` (grep = 0), though its POST is one of the 60 and IS boundary-covered in code (`isLimited`, route.ts:60). Fix = paste the row below; no code change. |
| 53 | #354 | "community-verified prices" — zero new mutating surface | **CONFIRMED** | `route.ts` diff is **additive only**: adds `recentConfirms: 0` to the two GET fail-soft fallbacks (2 ins/2 del). The mutating `POST` **pre-exists on `main`**. No new `route.ts`; `VenuePriceStory.tsx`/`.css` already on `main`. The 7 `var(--brass)` in `venuePriceStory.css` are **pre-existing** (diff adds 0; #328 unmerged so `--brass` is still the live token). `priceConfirm`/`priceConfidence` suites green. |
| 54 | #353 | three-tier chrome is "capability-preserving" | **CONFIRMED** | Every removed chip's handler is still reachable: Drinks + price chips **both** called `set("filters")` on `main` (opened the same sheet) → merged into one Filters chip, same handler + `filtersContent`; TfL → Tier-3 corner `IconButton` `onClick={() => set("tfl")}`; Near me → Tier-1; Tonight → Tier-2. `filtersContent`/`tflContent` panels unchanged. `mapChromeTiers.test.ts` green. |
| 55 | #350 | per-route timing is a pass-through seam; cert regex broadened to keep coverage | **CONFIRMED** | `withRouteTiming` returns the handler's `Response` untouched and re-raises throws (`routeObservability.ts`). Rewrapping `citymcp/journey` POST as `export const POST` would de-certify it under the narrow regex; #350's broadened regex holds the inventory at **60**. `routeObservability`/`rateLimitFailOpen`/`citymcp*` suites green. |
| 56 | #349 | freshness is WARN-in-build, hard-gate only in the dedicated CLI | **CONFIRMED** | `validate-data.mjs` exit code stays driven solely by schema `failed` count; the freshness block only `console.log("WARN …")` and is wrapped in `try/catch` → `SKIPPED` on any registry problem. The non-zero gate lives in `check_freshness.mjs` (`process.exit(1)` at :148). `/api/freshness` is **GET-only** (no mutating surface, no withRouteTiming collision with #350). `freshness`/`freshnessRoute` suites green. |
| 57 | #352 | demo kill switch gates both surfaces; default truly unchanged | **CONFIRMED** | `demoContentEnabled() = process.env.NEXT_PUBLIC_DEMO_CONTENT !== "off"` → **default ON** (any non-`"off"` value, incl. unset). Surface 1 (pint drops): `demoPintDropsForCity`/`demoDropsFor` return `[]` when off. Surface 2 (ambient presence): `ambientPresenceCurve` returns `0` when off, and `ambientPresenceRows` skips every persona via `if (slot >= count) continue` → empty roster. `findPintDropsByIds` still raw-includes seeds **by design** (id-resolution for the visibility gate, not a display path). `demoContent.test.ts` green. |
| 58 | #351 | voice & wording spec — docs only | **CONFIRMED · OK** | Single file `docs/VOICE_AND_WORDING_SPEC_2026-07-18.md` (+225). rc=0. |
| 59 | #352 | Fable deep-review doc + the kill-switch it prescribes | **CONFIRMED · OK** | `docs/FABLE_DEEP_REVIEW_2026-07-18.md` is the review artifact; the code half is row 57. |

### Cross-PR interaction verdicts

| # | Interaction | Verdict | Evidence |
|---|-------------|---------|----------|
| 60 | #346 × #353 — same file `PubMap.tsx` | **CONFIRMED · composes** | `merge-tree` rc=0; disjoint hunks (list-mount/focus-trap vs one prop-call rename); combined-tree `tsc` rc=0. #346's List view is **not yet** mounted inside #353's Tier-3 corner — both authors annotate this as a post-merge adoption, not a conflict (cosmetic follow-up). |
| 61 | #348 × #328 × #347 × #353 — token retunes | **CONFIRMED · no drift** | #348 radius/shadow retunes touch the shared scale; #347 mark tokens are namespaced; #353's corner uses `border-radius: 999px` (a pill, not a `--radius` consumer → immune to the retune). `--shadow-btn` is append-only new tokens. `merge-tree` 348×353 rc=0. |
| 62 | #349 × #350 — route conventions | **CONFIRMED · aligned** | Different route files; #349 GET-only freshness, #350 `withRouteTiming` on `citymcp/*`. `merge-tree` rc=0. Both additive to the API tree. |
| 63 | #354 × #328 × #348 — plaque social proof | **CONFIRMED** | `merge-tree` 348×354 rc=0. #354 introduces **no** new raw `--brass`; the plaque tokens (`--price-plaque-*`) #328 would add aren't on `main` yet, so no token is referenced-before-defined. |

---

## Mutating-surface certification reconciliation

**Final count: 60.** Not 62. The committed assertion `expect(mutationRoutes).toHaveLength(60)`
holds on `main`, on each of #350/#354, and on the full ten-PR merge (verified: `grep -rlE
'export (async function|const) (POST|PUT|PATCH|DELETE)' app/api --include=route.ts` = **60**).

- **#345–#354 add zero new mutating routes.** journey's POST and price-confirm's POST both
  pre-exist on `main`; `/api/freshness` (#349) is GET-only.
- **#350 broadened the regex** (`export async function` → `export (?:async function|const)`) to
  keep journey certified after its `withRouteTiming` rewrap. Net count unchanged.
- **Bump schedule:** the number moves only when a genuinely *new* `route.ts` exports a
  `POST/PUT/PATCH/DELETE`. None of this programme does. The next bump belongs to the still-in-flight
  identity/push/#329 lanes from V1 (rows 18–22, 32–35) *if and when* they add a route — this
  programme does not touch that count. When such a route lands: add its file, give it a boundary
  (`isLimited` / `callerUserId` / `planMemberCapability` / moderator / confirmation), and raise
  the assertion by exactly that many in the same commit.

### Cert row for `/api/price-confirm` (paste into `docs/WRITE_SURFACE_CERTIFICATION.md`)

The doc uses boundary-class rows, not per-route rows; `price-confirm` is a **Durable rate limit**
surface (keyless, server-derived actor, one confirm per device·venue·price). Paste option A adds
it to the representative surfaces; option B adds an explicit note under "Failure posture".

**A — extend the Durable rate limit row (line 13):**

    | Durable rate limit | Public/keyless abuse and provider-cost control | Events, discovery proxies, Pint Drops, price confirmations, crawl contributions, Plan creation |

**B — add under "Failure posture":**

    - The price-confirm micro-contribution (`/api/price-confirm` POST) is keyless and durable-rate-
      limited on a server-derived actor (`hashActor(hashIp(clientIp))`) keyed per (actor, venue); a
      durable write failure answers 503 rather than a fake success, and reads degrade to a zero tally.
      It records confirmations of an already-displayed price, never a new price.

---

## Per-PR verdict summary

| PR | What it ships | Verdict |
|----|---------------|---------|
| #345 | Design-direction study (doc) | **CONFIRMED · OK** — merge-ready |
| #346 | Keyboard venue List + desktop focus-trap | **CONFIRMED** — composes with #353, tests green |
| #347 | PUBMAXX logo system | **CONFIRMED · OK** — namespaced, no token drift |
| #348 | Radius/shadow/warm-white token quick-wins | **CONFIRMED** — 22/22 consumers migrated, append-only shadows |
| #349 | Freshness registry + `/api/freshness` | **CONFIRMED** — WARN-in-build, hard-gate in CLI |
| #350 | withRouteTiming + stale-serve observability | **CONFIRMED** — pass-through seam, regex keeps cert at 60 |
| #351 | Voice & wording spec (doc) | **CONFIRMED · OK** — merge-ready |
| #352 | Demo kill switch + Fable deep-review (doc) | **CONFIRMED** — both surfaces gated, default ON |
| #353 | Three-tier mobile chrome | **CONFIRMED** — capability-preserving |
| #354 | Community-verified price confirmations | **CONFIRMED** — additive route, zero new mutating surface; add cert doc row |

---

## Is the programme merge-ready?

**Yes.** All ten PRs merge into `origin/main` cleanly (`merge-tree` rc=0) *and* stack into a single
combined tree with zero conflicts that typechecks (`tsc --noEmit` rc=0) and passes all 13
load-bearing suites (110 tests), including the mutating-surface certification at its unchanged
count of 60. The one real shared-file overlap (#346 × #353 on `PubMap.tsx`) composes without a
hand-merge; every claim the programme makes — #353 capability-preservation, #354 zero-new-mutating-
surface, #349 freshness-WARN, #350 regex-keeps-cert-honest, #348 22-consumer migration, #352
default-unchanged kill switch — is CONFIRMED against the code. There are **no blocker findings**.
The only residuals are a one-line documentation paste (the `price-confirm` cert row, row 52) and a
pre-existing token-hygiene note (7 inherited `--brass` refs in `venuePriceStory.css`, to migrate
when #328 lands, row 53) — neither blocks merge. Recommended order is incidental (all independent),
but landing #348 before #354/#328 keeps the token story tidy, and #346's List view can adopt #353's
Tier-3 corner mount as a trivial post-merge follow-up.

_Compiled by Fable 5 (Opus 4.8) on `review/final-pass`. Every load-bearing claim re-run in this
worktree (fetch / `merge-tree --write-tree` / `git grep` / row-count / `tsc` / `vitest` on the
combined ten-PR tree), not trusted from any PR body or lane report._
