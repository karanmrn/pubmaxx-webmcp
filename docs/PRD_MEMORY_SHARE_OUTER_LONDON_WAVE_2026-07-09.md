# PRD: Shareable Memories & Outer London (Wave H)

Date: 2026-07-09

## Problem Statement

Waves F and G are on `main` (merge PRs #59 / #61): Hungry CTA, Place stories,
Last Train at compose, crawl-complete celebration, band deep-link chip, For You
friends boost. The cheap-pints → crawls → memories funnel still leaks after a
crawl is finished, when Drop intent auto-picks the wrong pub, when quests stay
one-shot, and when outer boroughs read as empty map edges.

Open parallel work must not be rebuilt:

- [#63](https://github.com/karanmrn/pubmax/pull/63) — mobile Layers declutter + Outer London P0
- [#64](https://github.com/karanmrn/pubmax/pull/64) — security hardening

## Solution

Ship **Wave H** from `origin/main`:

| ID | Deliverable |
| --- | --- |
| H1 | Shareable crawl-complete memory (copyable map URL from G2 celebration) |
| H2 | `/map?log=1` nearby Drop picker trust (never auto-pick first visible pub) |
| H3 | Place-story / crawl breadth quest events (B2-lite, never drink volume) |
| H4 | Outer London P1: borough deep-links, thin-coverage honesty, curated gazetteer seed + slim rebuild |

## Built And Should Not Be Rebuilt

- #51–#53, #59–#62 on main (mobile UX, design/drink, Wave F, visual redesign, Wave G, lint fixes).
- G2 celebration UI, G1 Last Train compose fields, G3 band chip, G4 For You boost.
- Admin import notes (staff-only). Light cuisine tags (no full menus).

## This Wave Ships (acceptance)

### H1 — Shareable crawl memory
- Celebration exposes **Copy link** / share href built as
  `/map?mode=build&pubs=…` (+ `band=` when Place-story crawl).
- Link round-trips via existing `lib/crawlUrl.ts` / map seed.

### H2 — Log-intent picker trust
- With `?log=1` and **no** resolvable `sel=`, show nearby picker (`fallback`) —
  do **not** auto-open composer on first filtered / first route venue.
- With explicit `sel=` that resolves, keep auto-open behaviour.

### H3 — Breadth quest events
- Time-windowed place/crawl quests (e.g. walk 2 Place stories this week).
- Surfaced on `NextBadgeChips`; never “drink more”.

### H4 — Outer London P1
- Check in `docs/PRD_OUTER_LONDON_COVERAGE.md`.
- Borough pages: browse deep-link `/map?q=<Borough>` + thin-coverage banner when
  pub count &lt; 15.
- Curated gazetteer seed for thin boroughs (real pubs, sourced provenance) merged
  into app dataset / slim index — no anomaly dump, no invented venues.

## Out Of Scope

Duplicating #63 Layers FAB / #64 security; live scrapers; full food menus;
Legacy T; area busyness; View Transitions; Round crew presence.

## Test Plan

- Unit: crawl share URL helper; resolveMapLogIntent no longer auto-picks without sel;
  place quest chips; borough map URL; outer seed validation.
- Smoke: complete crawl → copy link; `/map?log=1` → picker; `/borough/barnet` → map q=;
  slim pins in Havering/Hillingdon after seed.
