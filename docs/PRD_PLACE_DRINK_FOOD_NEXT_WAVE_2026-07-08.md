# PRD: Place Stories, Drink & Food Next Wave

Date: 2026-07-08

## Problem Statement

The Mobile UX growth loops (#51) and Design / Map Beauty / Drink Discovery wave
(#53) shipped the chrome of a pocket London pub guide: pub-first map taps,
round↔drop stickiness, Transit POI groups, drink-glyph pins, category→brand
lenses, on-demand Place stories, light cuisine tags, a wider POI seed, and a
staff-only Import note stub.

Discovery loops still have dead ends:

- Discover has drink brand chips but no **Hungry?** lane into `/map?food=1`.
- Venue Lore shows Place stories but cannot **walk the corridor** on the map.
- Non-beer brand coverage and cuisine tags are thin; cuisine is not in the slim
  `filterHints` index.
- Import notes are in-memory only — they vanish on process restart.
- Feed Spill cards never show the honest Last Train stamp already used on the
  venue sheet.
- Place stories are not packaged as curated crawls.

This wave closes those holes without rebuilding Waves A–E, without live social
scrapers, and without full food menus.

## Solution

Ship **Wave F** on top of the design-wave branch:

1. **F0 — Close dead ends.** Discover Hungry CTA, Lore → `/map?band=` deep
   links, Feed Last Train stamp (honest null when data is missing).
2. **F1 — Deepen discovery data.** Stronger slim `filterHints` for brands and
   cuisine; non-beer map lens honesty (filter/dim, never fake brand prices);
   expand curated cuisine + Place story membership.
3. **F2 — Place stories → crawls.** Curated crawl packs anchored to Place story
   corridors with clear provenance labels.
4. **F3 — Durable import notes.** Persist staff-entered research notes and add
   review/dismiss in Admin.

## Built And Should Not Be Rebuilt

From #51 (merged) and #53 (design wave):

- Mobile core loop: pub-first hit testing, venue sheet speed, round↔drop,
  quest chips, crawl progress, JWT-aware messages, PWA manifest.
- Map beauty: wider London viewport, 3-D buildings, drink-glyph pins, Transit
  POI group, Place stories map toggle (off by default).
- Drink discovery: `lib/drinkBrands.ts`, Discover brand chips, map Drink lens,
  URL round-trip for `drink` / `brand` / `food` / `band`.
- Place stories: `bandsForVenue`, Lore “Place stories” / “Around here” copy.
- Food light start: `servesFood` filter, `lib/cuisineTags.ts` chips on Overview.
- Research: ~573 POIs, `docs/research/london-poi-seed-notes-2026-07-08.md`.
- Admin Import note form + in-memory queue stub (to be hardened in F3).

## Admin vs You

- **Admin** (`/admin`): staff moderation only — reported Pint Drops, hidden
  comments, import notes. Token-gated. Never a consumer feature. Stay out of
  public nav.
- **You** (`/u/you`): consumer identity, passport, crawls, memories.

## This Wave Ships (acceptance)

| ID | Deliverable | Done when |
| --- | --- | --- |
| F0a | Discover Hungry lane | CTA → `/map?food=1`; cuisine chips deep-link with food filter |
| F0b | Walk this story | Lore Place story cards link to `/map?band={id}` |
| F0c | Feed Last Train stamp | Spill cards show `lastTrainBadge` when live decision fields exist; null otherwise |
| F1a | Slim filterHints | `drinkBrands` + `cuisineTags` mined/written into `venues_slim.json` |
| F1b | Non-beer lens honesty | Non-beer drink/brand filters dim or hide non-matches; pin price stays beer/pint path |
| F1c | Cuisine + story density | More curated cuisine venues; more central pubs in Place stories |
| F2 | Story crawl packs | Curated crawls linked to Place story corridors on Crawls and/or Lore |
| F3 | Import note persistence | Notes survive restart; Admin can list, dismiss, keep queued |

## Explicitly Out Of Scope

- Live Reddit / X scrapers or polling APIs.
- Full food / plate menus.
- Remounting Legacy “T” or Lock-In / Ledger ViewModeSwitch.
- Native apps, payments.
- Live Wetherspoons price parser as a hard gate (follow-up).
- Re-implementing Waves A–E.

## User Stories

1. As a hungry visitor on Discover, I want a clear path to pubs that serve food,
   so that I can open the map already filtered.
2. As a reader of venue Lore, I want to walk a Place story on the map, so that
   the corridor becomes a crawl I can follow.
3. As a feed reader, I want honest Last Train context on Spills when it exists,
   so that nights feel grounded in transport reality without invented claims.
4. As a drink explorer, I want brand and cuisine filters to match more pubs, so
   that Discover and map lenses feel useful beyond beer.
5. As staff, I want import research notes to persist and be dismissible, so that
   curated seeding work is not lost between deploys.

## Technical Notes

- Prefer existing URL helpers in `lib/crawlUrl.ts` (`food`, `band`, `drink`,
  `brand`).
- Last Train badge: reuse `lib/lastTrainBadge.ts` — never invent “made the last
  train.”
- Import notes: file-backed or existing durable demo-store pattern; provenance
  remains staff-entered only.
- Regenerate slim index via `scripts/build_slim_index.mjs` after hint changes.

## Test Plan

- Unit: crawlUrl food/band round-trip; cuisine/brand filterHints; lastTrainBadge
  on feed-shaped inputs; import note persist + dismiss.
- Component / page: Discover Hungry links; Lore “Walk this story” hrefs.
- Smoke: `/map?food=1`, `/map?band=…`, Admin import note queue after restart
  simulation (store reload).
- Run focused tests then the repo CI gate before merge.

## Related Docs

- `docs/PRD_CURRENT_STATE_AND_COMPLETION_2026-07-08.md` — overall completion.
- `docs/PRD_MOBILE_FIRST_NEXT_WAVE_2026-07-08.md` — mobile shell (shipped #51).
- `docs/PRD_ALL_DRINKS.md` — all-drinks north star.
- `docs/IDEAS_2026-07-07.md` — A5 Last Train on Spills, B-tier stickiness.
- `docs/research/london-poi-seed-notes-2026-07-08.md` — POI research rules.
