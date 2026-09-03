# PRD: Stickiness & Memory Wave (Wave G)

Date: 2026-07-08

## Problem Statement

PUBMAXXING now has a credible London pub product: mobile map core loop (#51),
design / drink / Place stories (#53), and discovery dead-end fixes (#55 / Wave F).
The cheap-pints → crawls → memories funnel still leaks at the seams between
shipped systems:

- Last Train stamps appear on **seeded** Spills and venue-sheet drops, but a
  **new** Spill from the composer does not capture leave-by / decision.
- Crawl progress is tracked locally, but finishing a crawl does not celebrate
  or push the walker into a memory / passport moment.
- Arriving via `?band=` opens Place stories quietly — no first-visit corridor
  explainer tying the deep link to a walkable night.
- For You ranking exists, but does not boost followed handles when the viewer
  has a follow graph (friends gravity is underused).

This wave wires those seams. It does not rebuild map beauty, drink brands,
Hungry CTA, or import notes.

## Solution

Ship **Wave G — Stickiness & Memory** in four parallel slices:

| ID | Deliverable |
| --- | --- |
| G1 | Capture Last Train context at Spill compose time |
| G2 | Crawl complete → memory prompt + passport / quest credit |
| G3 | Place story deep-link onboarding chip when `?band=` is present |
| G4 | For You friends boost when `followingHandles` is non-empty |

## Built And Should Not Be Rebuilt

- Mobile UX loops, PWA, pub-first map, round↔drop, quest chips (#51).
- Transit, drink glyphs, brand lens, Place stories Lore + toggle, cuisine tags,
  POI seed, Admin import stub (#53).
- Hungry CTA, Walk this story, Feed Last Train stamp plumbing, slim cuisine
  hints, story crawl packs, durable import notes (#55 / Wave F).
- Cheers button, optimistic Spill, prefetch-on-intent, Speculation Rules,
  followable lists, ratings math — already in tree.

## Admin vs You

Unchanged: Admin = staff moderation only; You = consumer passport. No Admin in
public nav. No live Reddit/X scrapers. No full food menus. No Legacy T remount.

## This Wave Ships (acceptance)

### G1 — Last Train at compose time
- When the venue sheet has a **live** Last Pint decision, submitting a Spill
  persists `leaveByIso` + `lastTrainDecision` on the drop.
- Feed and venue cards stamp via existing `lastTrainBadge` (honest null when
  TfL was unavailable or no session).
- Never invent “made the last train” as a factual claim — keep before/after
  leave-by copy from `lib/lastTrainBadge.ts`.

### G2 — Crawl complete → memory
- When crawl progress reaches 100% (`lib/crawlCompletion.ts`), show a one-shot
  celebration with CTAs: Drop a pint / Share crawl / View passport.
- Credit a passport / quest chip for completing a curated or Place-story crawl
  (breadth of places, not volume of drinks).

### G3 — Band deep-link onboarding
- First map visit with `?band={id}` shows a dismissible corridor chip:
  title + full wrapping story copy + “Walk this story” / dismiss.
- Does not fight the existing curated-crawl onboarding; band chip wins when
  `bandId` is set from the URL.

### G4 — For You friends boost
- `rankForYou` (or feed filter context) boosts items whose authors are in
  `followingHandles` without removing others.
- With an empty follow set, behaviour matches today.

## Explicitly Out Of Scope

- Live scrapers, full food menus, area-busyness heatmap (B1), View Transitions
  (B4), Lock-In/Ledger remount, native apps, payments, live Wetherspoons parser.

## User Stories

1. As someone spilling a pint with Last Train open, I want my Spill to carry
   honest transport context so the feed remembers the night’s leave-by clock.
2. As someone who finished a curated crawl, I want a clear “you did it” moment
   that invites a Drop or passport look, so the walk becomes a memory.
3. As someone opening a Place story link, I want to understand the corridor
   before I wander, so the deep link feels intentional.
4. As someone who follows friends, I want For You to surface their Spills
   sooner, so the social graph feels alive.

## Technical Notes

- G1: thread Last Pint decision from `VenueInspector` / `LastTrainCard` into
  `PintDropComposer` create payload; store fields already on `PintDrop`.
- G2: listen to `markVisited` / completion in crawl UI (`RoutePanel` or crawls
  page); localStorage progress already exists.
- G3: `PubMap.tsx` already seeds `activeBandId` from URL; add chip UI + session
  dismiss key distinct from curated onboarding.
- G4: extend `lib/forYou.ts` + ensure `/feed` passes `followingHandles` into
  For You context.

## Test Plan

- Unit: lastTrainBadge still honest; composer payload includes fields when live;
  crawlCompletion celebration triggers once; forYou boost order; band chip
  dismiss persistence.
- Smoke: post Spill with Last Train live → feed stamp; complete crawl → prompt;
  `/map?band=river-history` → chip; follow someone → For You order.

## Related Docs

- `docs/PRD_PLACE_DRINK_FOOD_NEXT_WAVE_2026-07-08.md` — Wave F (prior).
- `docs/IDEAS_2026-07-07.md` — A5 finish, B2-lite quests, social gravity.
- `docs/PRD_CURRENT_STATE_AND_COMPLETION_2026-07-08.md` — overall completion.
