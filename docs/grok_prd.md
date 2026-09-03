# PUBMAXX Backlog Waves PRD (`grok_prd`)

**Status:** Execution rationale, corrected 2026-07-29
**Author lane:** Grok research pass (PRs, live site, MASTER/Wayfinder/Design Direction, PostHog)
**Baseline:** `main` @ `ba4b4e71` (planning, map and Stories usability #667)
**Site audited:** https://pubmaxxing.com (desktop ~1440 and mobile 390×844)

**Queue authority:** The durable work queue lives in the Firstmate backlog. This document records the reasoning behind those items; it is not a second queue.

This document is the corrected rationale behind the **2026-07-28 execution proposal**. It does not replace the programme authorities below. When this PRD and an authority disagree on sequencing, **Wayfinder + MASTER win**; when they disagree on craft, **Design Direction + PRODUCT/DESIGN win**; when they disagree on copy, **VOICE wins**.

---

## 1. Authorities (read these, do not rebuild them)

| Doc | Role |
|---|---|
| [`docs/MASTER_PRD.md`](./MASTER_PRD.md) | Canonical product programme |
| [`docs/WAYFINDER_PRODUCT_MAP_2026-07-20.md`](./WAYFINDER_PRODUCT_MAP_2026-07-20.md) | Ticketed execution map (six-tab nav locked) |
| [`PRODUCT.md`](../PRODUCT.md) / [`DESIGN.md`](../DESIGN.md) | Brand, vocabulary, colour lock |
| [`docs/VOICE.md`](./VOICE.md) | Copy law (no em dashes, British spelling, joke placement) |
| [`docs/DESIGN_DIRECTION_2026-07-18.md`](./DESIGN_DIRECTION_2026-07-18.md) | Craft Top-8 (D1–D8) |
| [`docs/STORE_READINESS.md`](./STORE_READINESS.md) | Store pack + owner enrolment gate |
| [`docs/FRESHNESS_BURNDOWN_2026-07-24.md`](./FRESHNESS_BURNDOWN_2026-07-24.md) | Stale feeds vs unmeasurable feeds |
| [`docs/A11Y_MATRIX_2026-07-18.md`](./A11Y_MATRIX_2026-07-18.md) | Accessibility contract and remaining accent findings |
| [`docs/UNKNOWNS_MAP_2026-07-21.md`](./UNKNOWNS_MAP_2026-07-21.md) | Living risks (OSA, mid-crawl UX, image rights, push) |
| [`AGENTS.md`](../AGENTS.md) | Engineering contracts (price trust, map density, phone chrome) |

Superseded as implementation authority (evidence only): `PRD_UI_NEXT.md`, mobile-first next-wave, Fable broad-appeal Phase 1 bug lists, archive under `docs/archive/`.

---

## 2. Snapshot (corrected 2026-07-29)

### 2.1 Tracked pull requests

| PR | Title | State | Disposition |
|---|---|---|---|
| [#656](https://github.com/karanmrn/pubmax/pull/656) | Community-observed pub signals on the venue sheet | **MERGED 2026-07-28** | **Wave 0 complete:** migration `0060`, targeted tests, 390px evidence and Vercel checks landed with the feature |
| [#229](https://github.com/karanmrn/pubmax/pull/229) | MapLibre GL 6 + fill-extrusion vertical gradient | **OPEN; unblocked** | **Wave 3:** npm published stable `maplibre-gl@6.0.0` on 2026-07-22, while `package.json` still pins `^5.24.0`. Rebase, pin stable 6.x, re-run map E2E, merge |

### 2.2 Recently shipped (do not rebuild)

Plans under `docs/superpowers/plans/` from 2026-07-26 onward map to merged PRs. Treat as **verify / smoke**, not greenfield:

| Theme | PR |
|---|---|
| Progressive Plan intake, responsive map controls, cached last-train data, venue-sheet hierarchy and Stories defaults | #667 |
| Consent-gated standard analytics: persistent device identity, browser, OS, device type, screen and viewport size, referrer, unique users and retention | #666 |
| Production honesty: removed invented event start times, live figures inside dated Pint Index editions, ungrounded locality/currentness claims and the unscoped Nearby feed | #665 |
| Production sign-in dead-end prevention | #664 |
| Private referral signup attribution | #663 |
| Consent prompt + reliable live pageviews | #662 |
| Landmark visibility + first-run map framing | #661 |
| Canonical deployed sign-in domain | #660 |
| Basemap recovery under storage pressure | #659 |
| Public contribution rankings | #658 |
| Community-observed pub signals | #656 |
| Visit Reports review lane | #655 |
| Nearby bus departures (getting home) | #654 |
| Weather-matched venue recommendations | #653 |
| PostHog EU ADR | #652 |
| Venue-pack runtime tracing | #651 |
| Drink-priced map lens | #650 |
| Provisional marks on UK base pubs | #649 |
| UK town search from city chooser | #648 |
| Round cost + buying rotation (spend, never debt) | #647 |
| Inbox failure ≠ empty | #646 |
| No-alcohol + food map views | #645 |
| Feed hierarchy / out-of-city leak | #644 |
| Voice jokes on low-stakes surfaces | #643 |
| National pint benchmarks + dearest league | #641 |
| Historical pint prices (then-and-now) | #640 |
| Dark-mode two-tone pin edges | #639 |
| Stale feeds → Vercel scheduler | #638 |
| Restaurant venues / fork pins | #637 |
| Freshness: ship registry + split stale/unmeasurable | #636 |
| Pint Index monthly editions + map arrival | #634 |
| Mobile 390/430 + voice pass | #633 |
| Price on pins | #632 |
| Provisional pin badge | #631 |
| Price dating honesty, OSM credit, community moderation | #630 |
| Community price corroboration gate | #621 |
| UK base OSM layer | #625 |
| PostHog analytics rail | #623 |
| Privacy + terms pages | #627 |

Also locked already: **six-tab nav** + `/tonight` cold start (Wayfinder); Color V2 Waves A/B/C; pin collision / clustering contracts in `buildScene.ts`.

### 2.3 GitHub Issues

The agent token can list Issues and read their live bodies. On 2026-07-29 it reports **13 open issues**, including freshness / episodic prices as [#635](https://github.com/karanmrn/pubmax/issues/635). Wave 5 triage no longer needs an owner paste or an access change.

### 2.4 PostHog (project 219466, EU)

| Finding | Severity | Link / note |
|---|---|---|
| Consent-gated production `$pageview` rail | **Resolved in #662** | Initial load and App Router pathname changes now use the first-party `/ingest` proxy; the old `no_live_events` finding no longer describes the product |
| Standard product analytics | **Shipped in #666** | Persistent device identity, browser, operating system, device type, screen and viewport size, referrer, campaign context, Web Vitals, unique-user and retention analysis |
| Provider-side error queue | Open follow-up | https://eu.posthog.com/project/219466/error_tracking: descriptions are redacted outside the authenticated UI; **open in UI before coding fixes** |

ADR 0008 already chose PostHog EU. PRs #662 and #666 closed the live-pageview and standard analytics gaps. Provider-side error triage remains W5.6; a new analytics vendor does not.

### 2.5 Live site audit (pubmaxxing.com)

Pages: `/`, `/map`, venue sheet (The Old Bell), `/pint-index`, `/privacy`, `/choose-city`.

| Severity | Finding | Wave |
|---|---|---|
| None | No P0 breakage; map paints; pins band by price; privacy honest; sources dated | None |
| P1 | Venue Drinks empty: “No menu on record yet” with no contribute CTA; resolved by W1.1 | 1 |
| P1 | Pint Index league empty copy was long/technical (zone vs league); resolved by W1.2 | 1 |
| P2 | Map load line is fine; progress could be clearer | 1 |
| Verify | Dark theme not deeply exercised; mobile sheet price-caption wrap; submit entry points | 1 |
| Docs/a11y | Resolved; current contract and remaining accent findings live in [`docs/A11Y_MATRIX_2026-07-18.md`](./A11Y_MATRIX_2026-07-18.md) | None |

Brand read: PUBMAXX·ING + coral is strong; hero photography reads stock; trust copy on landing and Pint Index is honest.

---

## 3. Non-goals carried into Firstmate backlog items

- Rebuilding shipped map/price/social features listed in §2.2.
- Five-tab nav rewrite (six-tab locked).
- Purple-glow / cream-DTC / card-dashboard first viewports ([`PRODUCT.md`](../PRODUCT.md) anti-references).
- Inventing PostHog stack traces from redacted MCP text.
- Closing GitHub Issues without reading their live bodies.
- Merging #229 while still on a MapLibre **prerelease** pin.

---

## 4. Waves

This order records original dependencies and parallel-safety reasoning. Agents take current work, branch names and ownership only from the Firstmate backlog. Gate every implementation merge with `npm run verify` and UI evidence where noted.

```text
Wave 0  ✅ Complete in #656
   ↓
Wave 1  Live-site UI honesty          ⎫
Wave 2  ✅ Design craft (D1–D8)        ⎬ complete; evidence linked below
   ↓                                  ⎭
Wave 3  Open + unblocked: MapLibre 6 + regression smoke
   ↓
Wave 4  A11y + mid-crawl Night Mode
   ↓
Wave 5  Activation (#667) + analytics (#662/#666 complete) + freshness + issue triage
   ↓
Wave 6  Memory / store / expansion (gated)
```

---

### Wave 0 - Land and stabilize (**complete in #656**)

**Goal:** Land community-observed pub signals without weakening the venue-sheet, trust, moderation or privacy contracts. Completed 2026-07-28 in [#656](https://github.com/karanmrn/pubmax/pull/656).

| ID | Ticket | Status |
|---|---|---|
| W0.1 | Rebase and merge [`#656`](https://github.com/karanmrn/pubmax/pull/656) | **Complete in #656:** `AGENTS.md` and `docs/WRITE_SURFACE_CERTIFICATION.md` kept both sets of contracts |
| W0.2 | Ship durable community venue signals | **Complete in #656:** migration `20260728130000_0060_community_venue_signals.sql` landed; memory backend remains keyless |
| W0.3 | Verify #656 | **Complete in #656:** targeted Vitest, 390px “What drinkers noticed” evidence and Vercel checks passed |
| W0.4 | Reconcile old mobile-flow wording with six-tab authority | **Retired from this document:** authority reconciliation belongs in the Firstmate backlog, not a second queue |
| W0.5 | Owner ops checklist (not agent-owned) | **Not part of this agent wave:** owner operations remain durable Firstmate backlog items |

**Contracts to preserve on #656:** character is drinkers' judgement; step-free unknown stays unknown until corroborated; entrance ≠ toilets; signals share community-price actor/rate-limit/moderation; hidden rows leave sheet + count together; privacy copy honest.

---

### Wave 1 - Live-site UI honesty

**Goal:** Fix what a real visitor hits on pubmaxxing.com without a design-system rewrite.

| ID | Ticket | Severity | Done when |
|---|---|---|---|
| W1.1 | Venue Drinks empty state: short honest line + path to contribute / log a price (not a fake menu) | P1 | **Complete:** unavailable drinks are stated plainly and the action opens the existing Pint Drop contribution flow |
| W1.2 | Pint Index league empty: shorter copy that still separates zone strip vs sourced league | P1 | **Complete:** short copy keeps the wider fare-zone picture separate from the dated public-source league |
| W1.3 | Mobile venue sheet: price captions wrap, never ellipsis | Verify | Passes `__tests__/mobileChromeFit.test.ts` spirit on real 390×844 device viewport |
| W1.4 | Dark mode pass: landing, map, venue sheet vs Night Out tokens | Verify | Both themes screenshot-read; no black-on-black pin rims |
| W1.5 | **Complete:** Nav discoverability for Plan / Near (P2) | P2 | Contextual entry points supplement More without changing the six-tab navigation model; placement is pinned in `__tests__/journeyEntryPoints.test.ts` and `e2e/today-journey-entry-points.spec.ts` |
| W1.6 | Contribute / log-price entry points from sheet | Verify | First-time drinker can find price submit without docs |

**Evidence:** desktop + 390px, light + dark for changed surfaces.

---

### Wave 2 - Design craft (Design Direction D1-D8, complete)

**Goal:** Perceived quality jump on sheets and tokens. Source: [`docs/DESIGN_DIRECTION_2026-07-18.md`](./DESIGN_DIRECTION_2026-07-18.md).

| ID | Item | Priority | Status |
|---|---|---|---|
| W2.1 | **D1** Spring-physics sheet/drawer (interruptible) | P0 | Complete |
| W2.2 | **D8** Translucent sheet material (dark-first) | P0 | Complete |
| W2.3 | **D3 / D6 / D2** Layered micro-shadow, commit radius, type hierarchy | P1 | Complete |
| W2.4 | **D7** Price-stamp signature consistency | P1 | Complete |
| W2.5 | **D5** Pointer-down feedback on core loop (non-map first) | P2 | Complete |
| W2.6 | Plan CTA AA contrast resolved; remaining accent findings stay in the accessibility matrix | Done | [`docs/A11Y_MATRIX_2026-07-18.md`](./A11Y_MATRIX_2026-07-18.md) |

D4 warm `--panel-raised` was verified without retuning. Implementation,
contrast measurements, box-hierarchy accounting, and both-theme screenshots
live in [`design-craft-d1-d8-evidence.md`](./design-craft-d1-d8-evidence.md).

The completed sheet work preserves #656's venue-signal density and trust
contracts.

---

### Wave 3 - MapLibre 6 + regression smoke (**open and unblocked**)

**Goal:** Lift the GA hold and prove recent merges still hold.

**Evidence (2026-07-29):** [#229](https://github.com/karanmrn/pubmax/pull/229) is open; `package.json` still pins `maplibre-gl` at `^5.24.0`; npm published stable `6.0.0` on 2026-07-22. The GA hold is lifted, so this wave is unblocked but not complete.

| ID | Ticket | Done when |
|---|---|---|
| W3.1 | Rebase `#229` onto main | Conflicts resolved across `PubMapCanvas.tsx`, `components/map/canvas/*`, `lib/mapBasemapTaste.ts`, `package.json` / lockfile |
| W3.2 | Pin `maplibre-gl@6.0.0` (stable `latest`) | Lockfile regenerated; no prerelease pin |
| W3.3 | Resolve `buildings-3d` paint intentionally | Native `fill-extrusion-vertical-gradient` for 6.x; drop obsolete 5.24 M6i double massing |
| W3.4 | Re-check `map.style._loaded` private-field call sites | Both sites safe on 6.x |
| W3.5 | Gates | `npm run verify`; isolated `NEXT_DIST_DIR=.next-prod` build/start; `e2e/map-gl`, `map-console-health`, `map-fallback`; 390px pin → sheet → Tonight |
| W3.6 | Smoke recent merges keyless | Visit Reports, bus departures, weather recs, drink lens, provisional base marks, rounds spend, city search; hotfix branches only for real regressions |

---

### Wave 4 - Accessibility + mid-crawl Night Mode

**Goal:** Make the map usable beyond canvas pointer hits; make an active crawl readable on a pavement phone.

| ID | Ticket | Source | Done when |
|---|---|---|---|
| W4.1 | Keyboard/AT-operable venue list parallel to pins | [`docs/A11Y_MATRIX_2026-07-18.md`](./A11Y_MATRIX_2026-07-18.md) | **Complete** |
| W4.2 | Desktop venue drawer focus trap | [`docs/A11Y_MATRIX_2026-07-18.md`](./A11Y_MATRIX_2026-07-18.md) | **Complete** |
| W4.3 | Mid-crawl Night Mode surface | Unknowns U7 / Wayfinder | Giant tap targets, next-stop glance, composes existing TfL / last-train / bus; **not** a second app |
| W4.4 | Active Plan → Round bridge E2E | `RoundStarter` + `e2e/plan-round-bridge.flag-on.spec.ts` | **Complete:** member Plan route now exercises the existing bridge end to end |

---

### Wave 5 - Activation, analytics, freshness, issue triage

**Goal:** Solo Plan activation baseline, honest ops data, and a clean GitHub issue queue.

| ID | Ticket | Done when |
|---|---|---|
| W5.1 | Progressive Plan intake (Wayfinder 2.1) | **Complete in #667:** area, time, group, budget and access steps are progressive; optional questions are skippable; no form wall |
| W5.2 | Hard-constraint generation UI + fence tests (2.2–2.4) | Inaccessible / over-budget stops never silently included |
| W5.3 | Passwordless email + Apple SIWA (2.5–2.6) | Magic link path exists; Apple ready for store review when wrapped |
| W5.4 | Live PostHog pageviews | **Complete in #662:** consent-gated `$pageview` events cover initial load and App Router pathname changes; `no_live_events` no longer describes the product |
| W5.5 | Unique-user and retention analytics | **Complete in #666:** persistent device identity, browser, operating system, device type, screen and viewport size, referrer, campaign context and Web Vitals support unique-user and retention analysis |
| W5.6 | Triage PostHog error queue | Each active issue: reproduce or suppress with rationale; fix P0/P1 in code |
| W5.7 | Freshness #635 / burndown | Either real `price_updates` parsers or explicit episodic policy + budgets; CityMCP stale-serve addressed |
| W5.8 | GitHub Issues triage | Issues are readable: close-as-shipped / re-scope / keep; stale Gate-0 tickets (#165/#166/#168/#252 historically) re-audited against current code |

---

### Wave 6 - Memory, store, expansion (gated)

**Entry gate:** Wave 5 activation instrumentation has a London PostHog baseline (Wayfinder Wave 2 exit / Wave 4 entry).

| ID | Ticket | Done when |
|---|---|---|
| W6.1 | Story editor + consent + publish confirmation UI | Memory → consented Story path complete for a real night |
| W6.2 | Offline write outbox (Wayfinder 4.4) | Writes queue offline and flush honestly |
| W6.3 | Account claim completion | Device handle preserved; claim end-to-end |
| W6.4 | Store readiness §8 | Owner enrolment, signing, first binary, TestFlight / Play closed test (owner-gated) |
| W6.5 | Nine-city core parity | After activation gate; city-two scorecard per MASTER Wave 2 |
| W6.6 | Membership / blocking / compliance floor | Wayfinder Wave 6; do not start early |

---

## 5. Acceptance rules for derived backlog items

1. `npm run verify` green on the branch tip.
2. No tooling churn commits (`next-env.d.ts` route-types rewrite, `allowScripts` noise).
3. Product copy: British spelling, no em dashes, jokes only on low-stakes surfaces ([`docs/VOICE.md`](./VOICE.md)).
4. Any new mutating API route updates [`docs/WRITE_SURFACE_CERTIFICATION.md`](./WRITE_SURFACE_CERTIFICATION.md) in the same commit.
5. Data-path changes update `/privacy` and `/terms` in the same commit ([`__tests__/legalPages.test.ts`](../__tests__/legalPages.test.ts)).
6. UI waves: both-theme evidence at 390×844; trust captions wrap, never ellipsis.
7. Map density / community-price / drink-lens / rounds / Visit Reports contracts in [`AGENTS.md`](../AGENTS.md) stay intact unless the wave explicitly amends them with tests.

---

## 6. Firstmate handoff

Do not create branches from this document. Firstmate backlog items are the durable execution units and carry current priority, ownership and completion state. This PRD supplies their original wave reasoning only.

---

## 7. Change log

| Date | Note |
|---|---|
| 2026-07-29 | Corrected the PRD rationale for `main`; made Firstmate the sole durable queue; marked Wave 0 complete in #656, W5.1 complete in #667 and analytics W5.4/W5.5 complete in #662/#666; recorded #665’s four shipped honesty fixes; updated the `main` baseline and shipped list through #667; changed Wave 3 from GA-blocked to open and unblocked with npm’s 2026-07-22 GA date and the current `^5.24.0` pin; corrected GitHub Issues access and removed the obsolete `no_live_events` claim |
| 2026-07-28 | Initial `grok_prd`: open PRs, live site audit, PostHog health, Design Direction + Wayfinder waves, shipped do-not-rebuild list from #617–#655 |
