# PRD — UI Next: Mobile Companion + Desktop Native (post-What's-On wave)

> **SUPERSEDED (2026-07-12)** by [PRD_CYCLE_TRUST_TONIGHT.md](PRD_CYCLE_TRUST_TONIGHT.md),
> which absorbed Waves D/E/N and F1 into the Trust & Tonight cycle after an
> owner grill locked scope. Kept as the design-review evidence base (grades,
> defect catalogue, Apple-design bar).

Local document, 2026-07-11. Grounded in two screenshot-verified design reviews
(390×844 and 1440×900, both themes, fresh main @ the 23-PR merge wave) with the
Apple-design bar (fluid interfaces, eight principles) as the grading lens.
Difficulty→model routing per house convention. PR-only, bots + architect review.

## Where the product stands (reviewed, not guessed)

Mobile grades: Feed A-, Landing A-, Borough A-, Pint stories B, Venue sheet B,
Pubs B-, Plan B-, Map C+, Crawls C. Desktop grades: Landing A-, Map B+, Pubs B+,
Borough B, Venue panel B-, Discover C+, Crawls C+, Feed C, Plan C.
The verdict in one line: **the data layers are now excellent; the map is the
only true desktop surface; mobile lacks the "companion" layer that turns the
atlas into a night out; and a handful of visual defects undermine trust.**

## Wave D — Defects first (ship this week; mostly T1-T2)

| ID | Fix | Evidence | Tier → model |
| --- | --- | --- | --- |
| D1 | **Borough ledger dedupe** — same pub listed twice at #1/#2 (Rochester Castle £1.99 / £2.43) kills the core data promise | both reviews, borough pages | T2 → Sonnet 5 |
| D2 | **Map pin soup at city zoom (light)** — hundreds of unclustered pins over an unloaded basemap; dark clusters fine. Force clustering above zoom threshold in both themes; gate pin paint on tile paint | mobile review #1 | T3 → Opus 4.8 (map canvas — coordinate with F1 freeze) |
| D3 | **Tab bar clips content** — discover brand strip and plan form fields sit half-hidden; global scroll-container `padding-bottom: calc(tabbar + safe-area)` | mobile #4 | T1 → Codex |
| D4 | **"Sort it" concierge button reads disabled** (flat grey both themes) — accent fill when valid | mobile #3 | T1 → Codex |
| D5 | **Search placeholder truncates** ("Search pubs or a") → "Search pubs" | mobile #2 | T1 → Codex |
| D6 | **Discover drink rail broken on desktop light** (tiles near-invisible — in-view animation never fires at desktop widths) + clipped carousel with no arrows | desktop #2 | T2 → Sonnet 5 |
| D7 | **Map control collisions (desktop)** — Prices pill clipped under compass; ghost "No route" chip; banner stack over search | desktop #6 | T2 → Sonnet 5 |
| D8 | **Truncation polish batch** — feed ticker "@bethnal_iris at '", venue tab "Pint", touch copy ("Tap a drink shape") on desktop | both | T1 → Haiku 4.5 |

## Wave E — Mobile companion (the flagship; sequenced)

1. **E1 · "Tonight, near me" lane on the map** (T4 → Opus 4.8 / GPT-5.6).
   The map opens as an 800-venue atlas; nobody starts there at 5:40pm. A bottom
   lane above the tab bar: 3-5 nearby cards (pint price, what's-on badge from
   the B1 spine, walk time via the journey API, garden/weather when relevant).
   This is ALSO What's-On B6's map-badge surface — one data source
   (`/api/whats-on` + `/api/citymcp/*`), two renderings (lane cards + pin
   badges). Respects the F1 canvas freeze: badges via existing pin pipeline.
2. **E2 · Night Mode — the "during" surface** (T4 → Opus 4.8). Nothing serves
   the active night: current stop, next stop + TfL leg (already wired), who's
   arrived (crew presence exists), one-tap "log this pint" in context, last-
   train countdown (exists). Compose the existing pieces into a persistent
   bottom card when a plan/round is active. Retention surface #1.
3. **E3 · Venue visual identity** (T3 → Sonnet 5 1M). Zero real pub photos
   anywhere. Sources we already hold honestly: scraped chain photos (image
   proxy shipped), community Pint Drop photos (upload pipeline exists).
   Photo/lore header on the venue sheet + card thumbnails, provenance-labelled;
   gradient fallback stays for photo-less pubs.
4. **E4 · Crawls page card-ification** (T2 → Sonnet 5). Wall of centred prose →
   tappable pack cards (route thumbnail, stop count, price range, 44px).

## Wave F′ — Desktop native (parallel lane)

1. **N1 · ⌘K command palette** (T3 → GPT-5.6): pubs, boroughs, crawls, actions
   ("Log a Pint Drop", "Plan tonight"); the single cheapest desktop-native win.
2. **N2 · Two-pane content+map shell** (T4 → Opus 4.8, AFTER F1 decomposition):
   Feed/Crawls/Borough/Plan keep the map docked right (the 40-55% dead gutters
   ARE the pane). Plan becomes a working two-pane builder above the fold with
   the app shell restored.
3. **N3 · Venue inspector desktop treatment** (T2 → Sonnet 5): drop the drag
   handle + mobile tab strip in the docked panel; wider two-column layout
   (Golden Thread beside Pint Drops); no truncated tabs.
4. **N4 · Feed desktop layout** (T2 → Sonnet 5): filters + ticker to a left
   rail, cards two-up; kill the phone-ratio dead space.

## Design bar (Apple-design skill, binding for every wave above)

- Feedback on pointer-down; 1:1 tracking on all drags; every animation
  interruptible (springs, from presentation values — never target values).
- Velocity handoff on sheet/lane release (useSheetDrag already does this —
  extend the idiom, never regress it); rubber-band at bounds.
- Critically-damped springs by default (`damping 1.0, response 0.3-0.4`);
  bounce ONLY after momentum gestures.
- Translucent chrome (`backdrop-filter`) with weight = hierarchy; never stack
  two light materials; scroll-edge fades over hard dividers.
- Size-specific tracking (tight display, neutral body); wayfinding test on
  every screen (where am I / where can I go / how do I get out).
- Reduced motion = gentle cross-fades, never nothing; honour
  prefers-reduced-transparency and prefers-contrast.
- One primary action per screen (the Pubs card 3-CTA stack and venue sheet
  6-tab strip both currently violate this — D8/E-scope fixes).

## Sequencing

Wave D immediately (parallel small PRs). E1 next (it consumes B1's spine —
merge B1 first), then E2, E3/E4 parallel. N1 anytime; N3/N4 parallel;
N2 strictly after F1 (map decomposition, issue #165) — F1 is now the critical
path for BOTH desktop N2 and any further map-canvas work, so schedule F1
directly after Wave D lands, with all agents paused on map files.

## Standing items folded in

C2 copy rewrites (issue #163, owner reviews wording) ride with Wave D.
B4 (deals) + B5 (music) verticals + B6 surfaces + B7 concierge intents follow
E1 on the same What's-On spine. U1 closes when the hub rule is confirmed.

## Metrics

Map-open → first meaningful tap < 10s (E1); active-night sessions using Night
Mode (E2); venue-sheet photo coverage % (E3); desktop ⌘K usage (N1); pin-soup
zero-incidence (D2); ledger dedupe verified on every borough (D1).

## Owner actions

Unchanged: Supabase MCP re-auth (plans on prod), GitHub billing (#41),
Firecrawl key, CAMRA/Collins/OpenTable API applications. Plus: say "go" per
wave — D is ready to fan out now.
