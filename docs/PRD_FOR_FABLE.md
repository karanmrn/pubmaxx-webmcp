# PRD for Fable — PUBMAXXING: make the London night-out instrument unforgettable

> **AUTHORITATIVE DESIGN APPENDIX:** [`MASTER_PRD.md`](./MASTER_PRD.md) is the
> canonical roadmap. This brief supplies visual evidence, not roadmap authority.

**Role for Fable:** design lead. The engineering spine is strong and shipping; the
product now needs a **distinctive, pub-native visual identity and a finished UI** —
plus the next wave of features that turn a beautiful map into a reason to fall in love
with London. This doc gathers *everything* built and discussed across all sessions and
worktrees into one brief. Companion: `docs/MASTER_PRD.md` (the canonical roadmap).

Historical glossary (do not use where it conflicts with `CONTEXT.md`): **Pint Drop**
(a logged pint: price + photo + passed-down note + vibe tags + provenance), **Crawl Story**
(a shareable pub route), **PUBMAXXER** (obsolete here; now a community member),
**Last Pint** (nearest-station + last-train decision),
**Pint Passport** (collectible profile stats/badges), **provenance** (sourced / contributor
/ anecdote / demo — *never flattened*), **story pub**, **landmark**, **POI**, **borough page**,
**favourite pint**, **presence** ("I'm here tonight").

## Working rules for Fable (difficulty & model routing)

Fable is cost-disciplined. These are hard rules:

- **Only pick up issues labelled `difficulty:low` or `difficulty:medium`.** Leave
  `difficulty:high` alone — it's the senior lane (auth & security, data pipelines, complex map
  maths). Skipping High is the rule, not a failure.
- **Model by difficulty:**
  - `difficulty:low` **and** `difficulty:medium` → **Sonnet 5**.
  - `difficulty:high` → **Opus 4.8** — and **Sonnet 5 is also fine for High** (always use a top
    model on hard work). **Opus is reserved for High; never run it on Low/Medium.**
  - Each issue carries the matching `model:*` label(s) — trust them.
- Work the **highest existing seam**; ship + verify (`npm run ci`, incl. the coverage +
  `validate-data` score gate, and `npm run test:e2e`) before opening a PR; keep provenance
  honest and the quality floor green.

Current triage (2026-07-06):
- **Fable-eligible → Sonnet 5:** #18 (low); #14, #17, #19, #20 (medium).
- **High — NOT Fable → Opus 4.8 (or Sonnet 5):** #15, #16, #21, #22, #23 (map story-bands,
  parallel tube lines, auth ownership, social-depth backend, real-time-price pipeline).

## Problem Statement

I've built a genuinely rich London pub-crawl map — a premium basemap, recognizable landmark
markers with real photos, the true coloured Underground network, hundreds of curated places,
a working social layer (feed, profiles, Pint Drops, follows, reactions, comments, crawls),
a "Last Pint / last train home" card, and a hardened, tested, secured backend. But it still
reads like *a very good map with pub dots and features bolted on*, not a **singular product
with a point of view**. As a user I feel the ingredients but not the magic: the visual
identity isn't unmistakably "PUBMAXXING," the mobile experience (where most of my nights
happen) has rough edges, the guided loop from map → story → crawl → last pint → passport
isn't yet a finished journey, and small UI defects undercut the polish. I want it to feel
inevitable — *the* app you open on a Friday night — and beautiful enough that Gen Z, Gen X,
and Boomers all love it.

## Solution

A **design-led finishing pass** plus the next feature wave, unified by one aesthetic thesis:
*"Every pint has a story" — a candle-lit London field-guide you hold in your hand.*

1. Lock a distinctive **design system** (palette, type, motion, iconography, component
   patterns) that is unmistakably pub-native and not a templated map UI.
2. **Finish the mobile experience** — the surface most nights actually use — as a true,
   gesture-driven, beautiful instrument.
3. Turn the map's rich ingredients into a **guided loop**: landmark story → nearby pubs →
   crawl (walk/run it) → Last Pint → Pint Drop → passport → share → return.
4. Ship the **social depth** that makes it Letterboxd + Instagram for pints (passport,
   notifications, activity, custom lists, authorship).
5. Fix every known **UI defect** and raise the quality floor (accessibility, reduced-motion,
   large-text, empty states, provenance honesty).

## User Stories

### Visual identity & design system
1. As a first-time visitor, I want the landing and map to share one unmistakable visual
   identity, so that PUBMAXXING feels like a designed product, not a generic map.
2. As a design lead, I want a documented token scale (colour, type, spacing, radius, shadow,
   motion) derived from the pub/field-guide world, so that every surface stays coherent.
3. As a user, I want the two themes (candle-lit night / printed-guidebook day) to feel like
   one system flipping, so that dark and light are equally intentional.
4. As a user, I want a characterful display typeface paired with a readable body face and a
   utility/data face for prices, so that typography carries the brand rather than delivering it neutrally.
5. As a user, I want the "price stamp," provenance chips, and vibe tags to feel like pressed
   ink / bar-mat stamps, so that the interface has tactile pub character.
6. As a user, I want one memorable signature element (e.g. the brass price stamp or the
   candle-lit map) used with restraint, so that the product is remembered by one thing done well.
7. As a user with reduced-motion set, I want ambient motion (map orbit, reveals) to respect
   my preference, so that the experience is comfortable and accessible.

### The map as a living instrument
8. As a map user, I want tapping a landmark to open a rich story card (real photo, credit,
   short sourced history, source link, nearby pubs, "start a crawl here", "ask the PUBMAXXER"),
   so that London history becomes part of my night rather than a decorative marker.
9. As a user, I want **story bands** — typed overlays connecting clusters of landmarks and pubs
   (river history, writers/Fleet Street, markets & theatre, royal/civic, Thames-side industrial,
   coding-pint) — so that I can follow a cultural thread across the city.
10. As a user, I want landmark pictograms and TfL symbols to read instantly at any zoom, so
    that the map is legible and delightful, not cluttered.
11. As a user, I want the coloured Underground lines to fan into **parallel side-by-side lines**
    on shared track (Circle/District/H&C), so that the network looks like the real tube map.
12. As a user, I want the map's sky, pins, and marker contrast tuned against the new colourful
    base, so that pubs and landmarks always pop and never get lost.
13. As a user, I want beautiful, honest empty states everywhere (no pubs in a borough, no crawl
    yet, no drops yet), so that the product never feels broken or blank.

### Mobile-first (most nights are mobile)
14. As a mobile user, I want the venue detail to be a true **drag bottom-sheet** with snap
    points (peek / half / full) and clear tabs (Pints · Story · Crawl · Last Pint), so that I
    can move between them without losing the map.
15. As a mobile user, I want the sheet's primary action to always clear the bottom tab bar, so
    that I can log/save/add without awkward scrolling.
16. As a mobile user, I want the top nav to never crowd or clip (the "Continue with Google"
    button currently overflows at 390px), so that the map chrome feels finished.
17. As a mobile user, I want map controls (toolbar, legend, POI toggles) to be reachable with a
    thumb and never overlap, so that one-handed use at the bar is easy.
18. As a mobile user, I want large-text and screen-reader support across the sheet and tabs, so
    that the app is usable by older drinkers and everyone else.

### Last Pint (the signature utility)
19. As a user going out, I want a Last Pint card for the selected pub, so that I know if I can
    order one more and still get home.
20. As a user at 7pm, I want to see **next departures** (not just the last train), so that the
    feature is useful all evening, not only near closing.
21. As a user, I want a pub-native answer — "Order one more", "Half pint only", "Settle up now",
    "Train risk" — plus the last-train time and any line disruption, so that it feels like
    PUBMAXXING, not a transit dashboard.
22. As a user, I want the 3 nearest pubs to my station surfaced, so that I can have a final pint
    right by the platform.
23. As a privacy-conscious user, I want my destination to be session-only unless I explicitly
    save it, so that the app never builds a movement profile or infers my home.
24. As a user, I want Last Pint to degrade to static station context if TfL is down, so that the
    map never feels broken.

### Explore London (fall in love with the city)
25. As a walker, I want a crawl to show walking distance + time between stops, so that a crawl is
    a real route, not just a list.
26. As a runner/walker, I want themed routes ("a pint, a park, a view") that thread pubs past the
    gardens, markets, historic sites and viewpoints on the map, so that a night out becomes a way
    to explore the city.
27. As a tourist, I want to start a crawl from Big Ben, Tower Bridge, Borough Market or Camden
    Lock, so that a landmark becomes the beginning of a route.
28. As a Londoner, I want borough pages to offer a clear night-out path (stories, crawls,
    transport, cheap pints), so that each area feels like its own chapter.

### Social depth — Letterboxd + Instagram for pints
29. As a returning user, I want a **Pint Passport** on my profile (pubs, boroughs, beers, crawls,
    cheapest pint, story posts, badges), so that my nights become collectible identity.
30. As a demo visitor, I want `/u/you` to show a compelling first-run passport/profile state, so
    that the profile tab is never empty before sign-in.
31. As a signed-in user, I want my edits, follows, saves and drops tied to my authenticated
    account, so that no one can act as my handle.
32. As a user who contributed before signing in, I want my local activity to migrate to my
    account, so that I don't lose my earlier Pint Drops.
33. As a user, I want **custom lists** ("my locals", "date-night", "coding pints") beyond the
    built-in categories, so that I can curate pubs like film lists.
34. As a user, I want to be **notified** when someone follows me, reacts to my drop, or saves my
    crawl, and to see an **activity feed**, so that the social layer has gravity.
35. As a crawl author, I want my Crawl Stories attributed to my profile and editable, so that I
    build a portfolio of routes.
36. As a feed user, I want story/transport context on drops ("made the last train", "started at
    Tower Bridge"), so that a pint carries its night.
37. As a moderator, I want hidden comments (not just drops) reviewable in the admin console, so
    that moderation is complete.

### Real-time & trustworthy prices
38. As a user, I want to see how fresh a pub's price is ("logged 2h ago") and community prices to
    override the stale baseline, so that prices feel real and current.
39. As a maintainer, I want prices gathered only from permissible sources, each stamped with
    source + date, so that the product is trustworthy and shareable without weak provenance.
40. As a user, I want mis-located pubs (coordinates outside London) filtered out, so that the map
    and rankings only show real London pubs.

### Trust, honesty & quality floor
41. As a user, I want provenance (sourced / contributor / anecdote / demo) to stay visibly
    distinct on every card, so that I can trust what the app says.
42. As a maintainer, I want landmark facts/images to carry source + licence + last-reviewed
    metadata, so that the app can be shared publicly with strong provenance.
43. As a user, I want no raw `venue-…` ids and no `@@`-doubled handles anywhere, so that the
    product reads as finished (these are fixed — keep them fixed via tests).

## Implementation Decisions

- **Design system as tokens first.** Establish the palette (candle-lit night / guidebook day),
  a deliberate display+body+data type pairing, a spacing/radius/shadow scale, and a motion
  language, expressed as CSS custom properties that both themes flip from. Every new component
  derives from these tokens; the map's colours already read from them (`readTokens`) — extend,
  don't fork.
- **One signature element, held with restraint** — the brass price stamp and the candle-lit map
  are the memory hooks; keep surrounding UI quiet.
- **Mobile bottom-sheet is the primary mobile seam.** The venue panel is already a bottom sheet
  (`.mapDrawer` translateY) with a grabber and accessible tabs; add pointer-drag with snap points
  on the existing seam rather than a new component. Keyboard/close paths unchanged; gesture only ≤640px.
- **Landmark → journey.** Promote landmark cards from markers to route/story entry points
  (nearby pubs via the shared haversine, "start crawl here" into `?mode=build&pubs=…`, seeded
  PUBMAXXER prompt). **Story bands** are typed map overlays (anchors + candidate pubs + copy +
  URL state + fallback), not ad-hoc UI.
- **Last Pint** stays a server-owned feature (TfL proxied via `/api/last-train`, keys private,
  cached). Extend the existing card with next-departures + nearest pubs; the normalized decision
  shape (from prior prototyping) is: `decision ∈ {order_one_more, half_pint_only, settle_up_now,
  train_risk, live_data_unavailable}` with `leaveByIso`, `stationName`, `lineNames`,
  `disruptionSummary`, `walkMinutesEstimate`, `bufferMinutes`, `destinationLabel`, `live`.
  Destination is session-scoped by default.
- **Explore-London routing** reuses the shared `haversine` for distance/time; a crawl gains a
  "walk this" mode threading the new garden/market/historic/viewpoint POIs.
- **Social depth is schema + one render seam each.** Auth ownership links `auth.uid()` →
  `profiles.user_id` with RLS ownership policies (needs the owner to enable Google in Supabase);
  a `notifications` table + bell + activity lane; custom lists table; crawl-story `author_id`.
  The stores are already dual-backend (memory + Supabase) at one seam — extend that seam.
- **Prices:** community Pint Drops are the live layer (surface freshness, override baseline); a
  permissible-source refresh writes a versioned, provenance-stamped price file merged at build.
  A build-time bounds filter drops out-of-London coordinates.
- **Quality floor:** provenance chips on every claim; accessible tabs (roving tabindex, arrow
  keys); reduced-motion respected; honest empty states; the CI **coverage + validate-data score
  gate** already blocks regressions.

## Testing Decisions

- **Test external behaviour at the highest seam, not MapLibre internals.** Prior art:
  `e2e/smoke.spec.ts` (WebGL-agnostic map mount, theme toggle) and `e2e/social-loop.spec.ts`
  (read-only social surfaces, guarded with `.count()` for empty-vs-populated). New E2E: landmark
  story card opens (image/credit/source/nearby/route); venue tabs switch; the mobile drag-sheet
  opens/snaps; Last Pint renders each decision state + a TfL-outage fallback; `/u/you` first-run
  passport renders; owner-only profile edit is rejected for non-owners; public pages render under
  CSP; POI + non-alcoholic filters toggle.
- **Unit/integration** (node, `__tests__/**`, prior art `venues.test`, `pois.test`, `tfl.test`,
  `feed.test`): landmark→nearby-pub matching, story-band DTO, Last-Pint leave-by calc,
  passport-metrics aggregation, profile-ownership checks, custom-list model, price-merge +
  provenance, out-of-London bounds filter, notification model.
- **Regression guards to keep green:** no raw `venue-…` ids or `@@` handles leak; header-only
  admin token; store tests clear Supabase env; the coverage threshold ratchets up, never down.
- A good test asserts what the user sees/gets, tolerates empty data, and never couples to
  implementation detail.

## Out of Scope

Native iOS/Android apps; payments / pub-owner dashboards; taxi booking; DMs / real-time chat;
storing home addresses by default; ML recommendations; replacing MapLibre/OpenFreeMap; a full
design-system rewrite (extend the existing tokens); multi-city expansion before the London loop
is excellent.

## Further Notes

- **Do not re-build shipped work** (verify current state against the repository and
  `docs/MASTER_PRD.md`): the
  premium basemap, landmark markers + photos, coloured TfL network, 296 POIs across typed
  categories, non-alcoholic filter, tabbed venue sheet, Last Pint card, the full social spine,
  and Epic-B hardening (slim index, CSP, quality gate, governance) are done.
- **Strongest bets:** *Last Pint* (specific, useful, memorable) and *landmark→pub story bands*
  (turns history, photos and crawls into one loop). The strongest **design** bet is finishing the
  mobile sheet and locking the candle-lit field-guide identity.
- **Generational appeal:** camera-first + viral for Gen Z; heritage, voice input and large text
  for Boomers; honest cheap-pint utility for everyone. Provenance-honesty is the trust moat.
- Copy stays grounded: *"Every pint has a story. Bring back cheap pints, chaotic nights, and the
  pub stories worth remembering. Last Pint: know when to order one more, and when to settle up."*
- **Publishing:** this PRD lives in-repo (`docs/PRD_FOR_FABLE.md`) and is filed as GitHub issues
  labelled `ready-for-agent` with `difficulty:*` + `model:*` triage.

## The Spill — social layer & broad appeal (combined Grok briefs)

Two strategy briefs (Grok, 2026-07-06) fold in here. Their **atomic idea**: reframe the Pint Drop
as **"The Spill"** — the universal verb for capturing a moment at the bar (photo + observed price +
one passed-down sentence) — and render that *one provenance-preserving data stream* as different
generational surfaces rather than building separate products. The map stays the single source of
truth; social activity makes it more alive, not a second feed app. **Never flatten provenance** —
the trust moat across every generation.

**Generational surfaces (same data, different renderings):**
- **The Lock-In** (Gen Z): live "tonight" feed, pulsing map dots, Chaos Score, short clips, virality.
- **The Golden Thread** (Gen X): Golden-Days / Then-vs-Now price charts, sourced heritage.
- **The Ledger** (Boomers/Gen X): a large-text, high-contrast, voice-friendly venue *logbook*.
- **The Family Table** (Boomers): Legacy-visibility Spills + one-tap "share with family".
- **The Round** (all, group): a crawl that builds itself live as friends add their own Spills.

**Already SHIPPED — do NOT rebuild** (much of Grok Doc 2's Phase 1–2): Pint Drops + Supabase photos,
reactions / comments / reports (+ per-actor report constraint), durable Crawl Stories + OG cards,
Pint Drop permalinks + OG, live presence + a "Tonight" feed lane, "Golden Days" + Then-vs-Now on
Discover, non-alcoholic filter, venue-name resolution (no raw ids), shared `<SiteNav>`, mobile tabbed
venue sheet, provenance model, the grounded PUBMAXXER, migration 0006/0008 applied, slim index +
client-fetch resilience, CSP + the CI score gate.

**NEW to build (filed as issues #24–#34):** The Spill composer (voice-to-text + Public/Friends/Legacy/
Anonymous visibility + price stepper + "with"); The Ledger venue logbook; The Round group live crawl;
The Family Table + email-to-family; Accessibility & Legacy Mode (global large-text/high-contrast/
reduced-motion/voice toggle + accessible-venue filters: step-free, seating, quiet hours); drop
visibility & privacy (schema + RLS); Chaos Score + meme export; alt crawl styles (food / coffee /
mocktail) + calendar export (`.ics`); offline resilience (Service Worker + IndexedDB); media hardening
(EXIF strip + magic-byte validation, groundwork for 15s clips); Then-vs-Now price charts + inflation
on venue pages.

**Principles carried from the briefs:** start with the composer (Spill from the map in < 3 taps);
ship the emotional extremes first (The Lock-In + The Ledger); camera + voice + large-text remove the
keyboard barrier without losing Gen-Z speed; viral mechanics are always *optional* (a Boomer never
sees a Chaos Score); make the Spill/Round OG image beautiful enough that sharing feels like a postcard.

## The For-You map — X / TikTok / Instagram lens (Grok, next iteration)

**Progress:** 17 issues shipped (design system, map storytelling, parallel tube lines, mobile
drag-sheet, Last Pint, explore-London routes, Passport+auth, social depth, real-time prices, The
Ledger, The Round, Legacy Mode, drop visibility/privacy, Chaos Score, offline, media hardening,
then-vs-now, `.ics`). The Spill composer (#24) is in flight.

**The #1 remaining gap (honest):** the **map's loading / first impression**. The landing is
instant and polished; `/map` still feels abrupt (thin shell → MapLibre with no skeleton, no route-
level `loading.tsx`, no optimistic pins). The map must feel *faster and more alive than the landing*
— that's the difference between "beautiful marketing site" and "daily-habit app".

**Design thesis:** treat the **map like TikTok's For-You page** and every **Spill like an IG/TikTok
post**, while keeping **X-style provenance** (make the provenance badge as visible and trusted as a
verified checkmark). Never doom-scroll without the pub/story anchor; never a dark pattern that loses
an older user.

**Priorities (first-principles order):**
1. **Map loading experience** — a beautiful skeleton (pitched London outline + pulsing price-coloured
   dots), route-level `loading.tsx` + Suspense, and optimistic/cached pins that paint instantly then
   hydrate live. Target: map-click → first interactive pin **< 1.5s p95**. → **#35**.
2. **Camera-first Spill composer** — camera opens first (rear/front), voice-to-text default, price
   quick-add chips, one-tap "Add to Tonight / My Round / Family Table / Ledger", visibility secondary,
   an **instant preview card** matching the final OG style. → enriches **#24**.
3. **Vertical, beautiful Spill cards** — 9:16 full-bleed cards (TikTok/IG-Stories ratio), a "For You"
   feed feel, a venue **Bar-Tab** page that reads like an Instagram grid, and one-tap share
   (WhatsApp / iMessage / IG Story) using the dynamic OG image. → **#36**.
4. **Live / real-time** — Supabase Realtime (or polling) so map pins + feed update as Spills post; an
   "X people spilling right now" indicator; X-style **threaded replies** on a Spill. → **#37**.
5. **Dual modes** — Lock-In (Tonight, default for new/young users) vs Ledger (Heritage, large-text) as
   a light view layer over one data stream — mostly shipped (#25/#28/#30); just needs the mode switch.
6. **One-tap production-quality OG share** — folded into #36.

**Success metrics:** map-click → first pin < 1.5s p95; Spill completion > 70%; external-share rate >
25%; cross-generational interaction (a Ledger-mode Spill drawing reactions from users < 30).
