# CODE_HEALTH_REMEDIATION.md — execution record

Consolidated remediation of the code-health / security / UI-consistency debt
identified by the three read-only audits (bloat, security, UI/design). This
document is both the routing plan and the **execution log** for the fix-waves.

Owner-confirmed priority order (see plan): **Design/UI consistency FIRST →
mechanical cleanup + the one security fix → component splits → map
decomposition last.** All refactors are behaviour-preserving (no feature
changes — those live in the feature PRDs).

Guardrails held this round: behaviour-preserving only · every extraction keeps
tests green + adds tests where none existed · no new runtime deps · never
`git add -A` (codex develops live in the same tree) · z-index/spill token
swaps chosen to be value-identical so stacking order does not change.

---

## Status summary

| Wave | Scope | Status |
| --- | --- | --- |
| **A — Design/UI consistency** | z-index token scale + adoption, mobile tap targets, reduced-motion, spill dedupe, ink-stamp adoption, `:focus-visible` | **DONE (this session)** — partial items deferred (see below) |
| **B — Cleanup + Security** | M-1 fail-closed, distance math, relativeTime, dead code, parser guards, tests, knip | **DONE (this session)** |
| **C — Component splits** | VenueInspector / PintDropComposer / RoutePanel / LastTrainCard | **DEFERRED** — composer/inspector are codex-hot; needs codex paused |
| **D — Map decomposition** | PubMapCanvas + PubMap | **DEFERRED** — flagship, highest risk; plan mandates side agents paused on `components/PubMap*.tsx` + `components/map/**` for its duration |

Baseline at start of session: typecheck clean; `npm run test` = 1999 tests,
6 pre-existing failures all isolated to
`__tests__/validateDrinkPriceUpdatesScript.test.ts` (generated-data-artifact
drift from live scraping — unrelated to this work).

After Wave A+B: typecheck **clean (exit 0)**; tests **2016 passed / 6 failed**
(same pre-existing 6; +23 new passing tests); lint **0 errors** (10
pre-existing warnings in unrelated `scripts/`).

---

## Wave A — Design/UI consistency (DONE)

**Z-index token scale.** Added a semantic ladder to `:root` in
`app/globals.css` (`--z-float`, `--z-backdrop`, `--z-map-base`…`--z-map-toolbar`,
`--z-nav`, `--z-tabbar`, `--z-modal`, `--z-overlay-top`). Each token's value
EQUALS the literal it replaces, so adoption is a 1:1 swap with **zero stacking
change**. Adopted across: `app/globals.css`, `app/theme.css`, the map control
CSS (`mapPriceControl`, `mapLayersControl`, `cityStatusBanner`,
`citySuggestBanner`, `activeRoundChip`, `logIntentFallback`, `citySwitcher`),
`components/nav/siteNav.css`, `app/auth/auth.css`, `components/landing/landing.css`.
Component-internal small z-indexes (0–20) left as-is (local stacking contexts,
no cross-component value).

**Mobile tab-bar tap targets.** `components/nav/mobileNav.css`: `.mobileTab`
min-height 40px → **44px** (WCAG), label font 0.52rem → 0.625rem, icon 18 → 20px,
bottom reserve 58 → 64px. Fixed the `≤360px` override that had re-shrunk targets
to 38px / 0.48rem back up to 44px.

**Spill palette dedupe.** Added `--spill-surface` / `--spill-veil` /
`--spill-veil-strong` tokens; replaced the hardcoded always-dark `#0c0b08` /
`rgba(12,11,8,·)` in `app/feed/feed.css` and `components/map/spillComposer.css`.

**Reduced-motion guard.** `app/auth/auth.css`: added
`@media (prefers-reduced-motion: reduce)` disabling `claimNightFade`/
`claimNightRise` animations.

**`:focus` → `:focus-visible`.** Outline-applying rules in `app/admin/admin.css`,
`app/rounds/[code]/round.css`, `components/round/roundStarter.css` now only ring
on keyboard focus.

**Ink-stamp token adoption.** `app/borough/[slug]/borough.css` `.priceStamp`
now consumes `--ink-stamp-border/-radius/-tilt` (values were already identical).

### Wave A — deferred (with rationale)
- **SiteNav into a shared layout segment.** SiteNav is deliberately mounted
  per-page on 15 pages; the map/landing pages omit it on purpose. Doing this
  "correctly" needs a Next.js route-group restructure (mass directory moves) —
  behaviour-sensitive and high-collision with live codex edits. Defer to a
  dedicated PR with codex paused.
- **`globals.css` split into `tokens.css` + partials / delete LEGACY blocks.**
  Large structural churn on the single hottest CSS file; the `html[data-legacy]`
  blocks are an intentional theme MODE (LegacyToggle), not dead code. Defer.
- **Bespoke empty states → `<EmptyState>`** and **`--cat-*` into ledger/bar-tab**
  are partially scoped; the remaining sites need product-tsx edits that overlap
  codex-hot files. Track for a follow-up.

---

## Wave B — Cleanup + Security (DONE)

**M-1 (security) — heritage rate-limit fail-CLOSED.** `lib/pintDrops.ts`
`isLimited` gained an optional `{ failClosed?: boolean }` (default off → all
other callers unchanged). When Supabase is configured but the durable RPC
returns a null verdict (`missing-rpc`/`no-client`/error), a `failClosed` caller
now returns limited (429) instead of falling back to the per-instance in-memory
budget. `app/api/heritage/route.ts` passes `failClosed: true` on its paid
OpenRouter path. Pure local-dev (no Supabase) still uses the in-memory limiter.
Not gated on `NODE_ENV` (Vercel runs vitest under production) — gated on
"Supabase configured".

**H1 — distance math consolidated onto `lib/haversine.ts`.**
`lib/venues.ts` `distanceKm(Venue,Venue)` is now a thin adapter over
`haversineKm`. Deleted the **equirectangular** (flat-earth, `KM_PER_DEG_LAT=111`)
`haversineKm` in `components/map/CityPlaceStrip.tsx` — a silent correctness bug —
and routed it to the canonical haversine. New `__tests__/venuesDistance.test.ts`
asserts the adapter equals `haversineKm`.

**M1 — relativeTime dedupe.** `app/activity/page.tsx` local `timeAgo` removed;
imports canonical `lib/relativeTime.ts`.

**M3 — dead code.** Deleted `components/nav/ViewModeSwitch.tsx` +
`viewModeSwitch.css` (confirmed unused). Added `knip` + `ts-prune` devDeps and a
`deadcode` script — intentionally NOT wired into `ci`/`verify` yet (pre-existing
dead code would red the shared-tree build; wire it once the tree is clean).

**L1 — parser guards on unchecked DB-row casts.**
`lib/ratingsStore.ts` (both query paths), `lib/pintDropLookup.ts` (VisibleRow +
status-union narrowing, fail-safe to `hidden`), `lib/startRoundWithStops.ts`
(RoundState shape guard) now validate rows before use instead of trusting
`as unknown as` casts. Valid rows behave identically; malformed rows are skipped
or fall to the existing not-found path.

**H3 — tests.** New `__tests__/nicholsons.test.ts` (25 assertions over the pure
slug/identity/match functions).

---

## Wave E — mobile + desktop UI audit

Screenshot harness extended (`e2e/screenshots.spec.ts`) with a **1280 desktop**
viewport alongside the existing 390 / 430 mobile passes, light + dark. Run:
`NEXT_DIST_DIR=.next-prod PW_SCREENSHOTS=1 npx playwright test --project=screenshots`.

**Audit result (390 / 430 / 1280, light + dark):** production build compiled
successfully against the combined live tree; 39/46 shots captured (the 7 misses
are Playwright `captureScreenshot` infra failures on very tall `fullPage` routes
and the mobile bottom-sheet wait — not UI defects). Reviewed landing, map
(clean/log/sheet), feed, crawls, profile, activity across both themes and all
three widths:
- Z-index token migration **held all stacking** — onboarding modal correctly
  above map chrome + drawer + tab bar in both themes; map controls below.
- Mobile tab bar: 44px targets + legible ~10px labels at 390/430/360; single
  row preserved; coexists cleanly with codex's new gliding active-tab highlight.
- Spill card, price stamps, focus rings, reduced-motion: no regressions.
- **No UI regressions from Wave A/B.** One pre-existing cosmetic inconsistency
  confirmed (profile "Timeline" bespoke empty state vs the `<EmptyState>` card
  used directly below it) — this is the deferred empty-state item, tracked above.

Reference PNGs in `docs/screenshots/`.

---

## Verification

Per wave: `npm run typecheck` + `npm run test` + `npm run lint`. The map
console-error probe (`e2e/map-console-health.spec.ts`) remains the gate for any
future Wave D. Design pass: 390 + 1280 screenshots, light/dark.
