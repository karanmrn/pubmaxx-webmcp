# PRD: PUBMAXXING Next Wave — QA-Driven Fixes + Core-Loop Features

Sources: full browser QA sweep (desktop 1440 / mobile 390, `.context/qa-2026-07-07/`), three
independent design reviews (visual/design-system, mobile UX, product gaps — `REVIEW_*.md` in the
same directory), and re-verification of `docs/AUDIT_FINDINGS_2026-07-07.md` at today's HEAD.

## Problem Statement

The app's foundations are strong (map, Last Pint, Spill posting, drinks menu, moderation), but QA
shows the polish layer is undermining trust in three ways: (1) visible breakage — the mobile nav
overlaps the wordmark on every page, the Activity page nav wraps into three rows, the crawls
surface still uses pre-pivot Georgia serif, and the map console 404s on every load; (2) dead ends
into the core loop — the mobile "Log" FAB links to a query param nothing reads, and posting a pint
is only reachable four levels deep inside the map venue sheet; (3) a dead-city feel — every demo
Spill is stamped May/June 2026, so the feed that claims "every pint logged in London tonight"
reads as abandoned. Two audit privacy gaps also remain open, and a venue→borough join bug puts
Wapping pubs in Havering.

## Solution

One consolidation wave, two tiers, shipped as scoped commits behind local CI:

- **Fix tier** — repair everything above that is visible breakage, privacy risk, or data trust.
- **Feature tier** — three auth-free features that close the loop and make demos feel alive:
  wire the Log FAB into a real "drop a pint here" flow with entry points on feed and activity;
  re-stamp demo content relative to now with ambient presence; surface badge progress as
  forward-looking quest chips (IDEAS B2-lite).

## User Stories

1. As a mobile user, I want the header readable on every page, so the app never looks broken.
2. As a mobile user, I want the Log button to actually start logging a pint, so the core action is one tap away.
3. As a feed reader, I want a way to post from the feed, so I don't have to know the map is the only door.
4. As a demo viewer, I want tonight's feed to look like tonight, so the city feels alive.
5. As a privacy-conscious contributor, I want ledger-only drops to not expose my full handle and price publicly, so "ledger-only" means something.
6. As a lurker, I want comments/reactions on hidden drops to be invisible, so moderation actually removes content.
7. As a pub-goer in Wapping, I want my pub in the right borough, so I trust the data.
8. As a returning user, I want to see the next badge I could earn, so there's a reason to log another pint.
9. As a map user on bad Wi-Fi, I want map labels that don't depend on a 404ing font CDN.
10. As a crawl explorer hitting a dead link, I want a branded not-found page that routes me back to crawls.

## Implementation Decisions

### Fix tier (commit per item or small groups)

- **F1 Mobile nav overlap** — `components/nav/siteNav.css`: let `.siteNavBrand` shrink ≤640px
  (collapse wordmark toward icon), `white-space: nowrap` on mode-switch labels. (visual+UX #1)
- **F2 Activity nav blowout** — `app/activity/page.tsx`: move `<SiteNav />` outside the
  640px-capped `<main>`, matching other pages' structure.
- **F3 Comments/reactions GET gating** — comments and reactions GET routes must not return data
  for drops that are hidden or not publicly visible; gate on parent-drop visibility server-side.
  Behavior-seam tests.
- **F4 Ledger privacy redaction** — public `/ledger/[id]` renders legacy/ledger-visibility drops
  with redacted handle (initials-style) and without price/note detail. Full viewer-gating waits
  for Supabase Auth (out of scope).
- **F5 Map glyphs + missing image** — `components/PubMapCanvas.tsx`: replace the six
  `"Open Sans Semibold"/"Arial Unicode MS Bold"` text-font stacks with Noto Sans equivalents
  (OpenFreeMap serves Noto only); add a `styleimagemissing` handler for upstream `wood-pattern`.
- **F6 Crawls type pivot** — `app/crawls/crawls.css`: replace 6× hardcoded Georgia with
  `var(--serif)` per `docs/DESIGN_SYSTEM.md`.
- **F7 Borough join bug** — venue→borough assignment mislabels (Prospect of Whitby → "Havering";
  Havering tops `/borough`). Root-cause the join (point-in-polygon or lookup table), fix, add a
  regression test pinning a few known venue→borough pairs.
- **F8 Contrast repairs** — landing "Open the map" nav CTA and "Start with heritage" ghost button
  to ≥4.5:1 on their fills; dark-theme POI chip label colour. Tokens only, no new palette.
- **F9 Crawls not-found** — `app/crawls/[slug]/not-found.tsx` branded 404 matching the honest
  rounds empty-state pattern.

### Feature tier (one commit each, sequential)

- **P1 Log FAB → real logging flow** — `/map?log=1` (currently dead, `components/nav/MobileTabBar.tsx:35`)
  opens a nearest-pub picker (reuse slim venue index + haversine util) that selects the pub and
  opens the existing `PintDropComposer` in the venue sheet Pints tab. Add "Drop a pint" CTAs on
  `/feed` (links to `/map?log=1`) and in the `/activity` empty state. No new composer surface —
  reuse the map one to keep a single posting path.
- **P2 Demo liveness pack** — `lib/pintDropSeeds.ts`: stamp seed drops relative to `Date.now()`
  at load (spread over the last ~6 hours, deterministic order), keeping historic "lore" entries
  in the Golden Days/discover lane only. Deterministic ambient presence curve for
  PresenceStrip/TonightBoard seeds (time-of-day shaped, seeded PRNG — no `Math.random` in render).
  Honest label rule stays: demo content keeps its "Demo" provenance chip.
- **P3 Quest chips (IDEAS B2-lite)** — new pure helper `nextBadgeProgress(stats)` beside
  `computeBadges` (`lib/profiles.ts`), rendering "next badge" progress chips on `/activity`
  (after F2 lands) and the venue sheet Overview tab. Computed from existing stats; no schema, no
  auth, no notifications.
- **P4 Provenance vocabulary** — unify EXAMPLE/SAMPLE/DEMO chip wording to DEMO (SOURCED reserved
  for sourced prices) across feed/drinks/ledger chips.

### Constraints

- Codex is live-building IDEAS B3 (followable lists): do not touch `lib/savedPubsStore.ts`,
  saved-lists surfaces, `app/u/[handle]/page.tsx`, or migration slot 0018. New migrations (none
  expected) start at 0019.
- No Supabase Auth dependencies anywhere in this wave.
- Waves run sequentially with disjoint file sets; `npm run ci` between waves.

## Testing Decisions

- Behavior-seam vitest: comments/reactions GET gating on hidden/legacy drops; ledger redaction
  output; borough join regression pairs; seed-timestamp freshness (all within last N hours,
  deterministic order); `nextBadgeProgress` thresholds/edge cases (zero stats, all badges earned);
  nearest-pub picker selection helper.
- `npm run ci` (validate-data, lint, typecheck, coverage, build) green per commit.
- Post-implementation browser spot-check of: mobile header, activity page, log FAB flow,
  feed timestamps, map console (no glyph 404s).

## Acceptance Criteria

- Mobile 390px: wordmark and mode switch never overlap; activity nav renders one row.
- Tapping the mobile Log FAB reaches an open composer in ≤2 taps from anywhere.
- Fresh load of `/feed` shows demo Spills timestamped within hours, not weeks.
- Hidden drops return no comments/reactions via GET.
- Public ledger page shows no full handle and no price for ledger-only drops.
- Prospect of Whitby resolves to Tower Hamlets; borough index no longer led by a mis-join.
- Map loads with zero glyph 404s; crawls pages use the design-system serif token.
- `/activity` and venue Overview show at least one truthful "next badge" progress chip.
- `npm run ci` green; changes pushed; Vercel production deploy succeeds and serves the new build.

## Out of Scope

- Supabase Auth (Epic D) and anything needing ownership (true ledger viewer-gating, list authorship).
- IDEAS B3 (Codex in flight), B1/B6 realtime layers, C1 push ritual, C2 time-scrub, C3 postcard email.
- New migrations, native apps, scraping.
