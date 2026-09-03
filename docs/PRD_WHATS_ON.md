# PRD — What's-On Fusion + CityMCP Wave (mobile)

> **SUPERSEDED (2026-07-12)** by [PRD_CYCLE_TRUST_TONIGHT.md](PRD_CYCLE_TRUST_TONIGHT.md).
> Wave A (A1–A6), B1 spine, B2/B3 data, and C-1 booking links shipped from this
> document (PRs #176–#185). B4–B7 and the B6 surfaces carry forward into the
> Trust & Tonight cycle as Wave W. Kept for the thesis, owner decisions, and
> data-governance guardrails, which remain binding.

**Status: EXECUTED THROUGH B3 + C-1; remainder re-scoped (see header).**
Local document (uncommitted until the owner says commit), 2026-07-11.
Owner decisions locked via grill; research grounded in three reports (pub-ecosystem
scrape survey, live CityMCP capability probe, mobile booking/route/tonight UX audit).

## Thesis

Nobody owns "sort my night RIGHT NOW": incumbents are booking-first (DesignMyNight,
OpenTable), single-vertical (FANZO = sport, Untappd = beer), or walled gardens (chain
apps). PUBMAXXING already has the live map, real pint prices, plans/crews, and a
concierge. This wave adds the missing pull: **one What's-On layer that answers "what's
on tonight near me" — sport, quiz, deals, music — on the map and in a Tonight lane,
fed by one provenance-honest data source, understood by the concierge.** Mobile-first:
390px is the design target; desktop inherits.

## Owner decisions (binding)

1. **Flagship = What's-On fusion**, surfaced BOTH ways from one source: map badges
   (glyph on the pub pin: sport/quiz/deal/music tonight) + a Tonight lane.
2. **Vertical build order: Sport → Quiz → Deals → Music** (sport pulls the biggest
   weekly crowds; quiz has the strongest data and follows immediately).
3. **Data = hybrid**: weekly PR-gated scrape baseline (every row `{source, observedAt}`,
   UI shows "checked <date>") + CityMCP `things_to_do` as the live layer on top.
   Never presented as community data; unknown ≠ invented.
4. **Concierge understands what's-on intents this wave** ("quiz for 4 near Bank at 7"
   → ranked quiz pubs with get-in + journey).
5. **Booking staged**: deep-link out NOW (DesignMyNight/OpenTable/venue-site per
   venue); Collins (DMN) API + OpenTable affiliate integration is a separate later
   epic (owner applies for API terms).
6. **Attributes**: pursue CAMRA SearchPubs API access properly (owner action:
   request terms); meanwhile only chain-site + CityMCP-derived attributes
   (e.g. `beer_garden` place type) — no wholesale scraping of third-party databases.

## Wave A — CityMCP six-pack (cheapest, ships first; client already exists)

Each its own PR through the gate (bots + architect review). Live-probed field names.

| ID | Feature | Source fields | Tier → model |
| --- | --- | --- | --- |
| A1 | **Borough pint-price card** on borough pages + venue sheet | `get_area.pint.averagePriceGbp/borough/asOf` (tool currently NEVER called) | T2 → Sonnet 5 |
| A2 | **Fix the silently-broken venue transit strip** (latent bug: trim reads fields the live API no longer returns) | `get_place.transit.value.nearbyStops[].name/modes/distanceM` | T1-T2 → Codex/Sonnet |
| A3 | **"What people say" blurb + press badges** on the venue sheet | `get_place.buzz.value.summary/mentions[]` (Infatuation/Tripadvisor links) | T2 → Sonnet 5 |
| A4 | **Tonight-in-London signals feed** (we fetch ~8 signals, show 1) — tappable list: gigs, strikes, alerts, each with `kind/areas/timeWindow/sourceUrl` | `city_status.signals[]` | T2 → Sonnet 5 |
| A5 | **Beer-garden weather nudge** — "24° and dry: gardens open near you" | `city_status.weather.feelsLikeC/precipProbabilityPct/isDay` + `search_places` `types=beer_garden&openNow` (route must forward the filters) | T2 → Sonnet 5 |
| A6 | **Wire the dead journey API**: TfL legs in the route panel (S4 plan exists), arrive-by/step-free plan ordering, + **Google/Apple Maps handoff link** on every stop (none exists today) | `get_journey` (zero UI callers) | T3 → Opus 4.8 |

## Wave B — What's-On fusion core

- **B1 · Data model + store** (T4 → Opus 4.8 / GPT-5.6): `whats_on` rows
  `{venueId?, placeName, kind: sport|quiz|deal|music, startsAt?, endsAt?,
  timeEvidence?, listedWindow?, title, detail (fixture/entry fee/deal terms),
  price?, source: {label,url}, observedAt, confidence}`; dual-backend store seam;
  weekly refresh script on the PR-gated rail (same governance as prices).
  CityMCP live rows preserve a firm `startsAt` when supplied and keep listed-time
  wording separately; a requested window never becomes an invented exact start.
- **B2 · Sport vertical** (T3 → GPT-5.6): fixture → pubs-screening-it. Sources:
  Greene King live-sport finder (900+ pubs, public), chain what's-on pages; fixture
  calendar from a permissible feed. UI: team picker → map badges + lane.
- **B3 · Quiz vertical** (T3 → Sonnet 5 1M): supplier finders first-party
  (SpeedQuizzing 2k+, Redtooth 3k+, Question One), cross-checked against
  pubquizzers.com/londonquizmap; day/time/entry per venue.
- **B4 · Deals vertical** (T2 → Sonnet 5): chain deal days + DMN happy-hour guides
  (links out, not copied wholesale); pairs with our own pint prices ("cheap round").
- **B5 · Music vertical** (T2 → Sonnet 5, LAST — weakest data): CityMCP `event`
  signals + chain what's-on; honest thin-coverage labelling.
- **B6 · Surfaces** (T3 → Opus 4.8): map pin badges (one glyph per kind, tokens per
  design system, no clutter regression — respects the frozen-canvas rule: badges via
  the existing pin pipeline only) + Tonight lane (replaces/absorbs TonightNearbyLane)
  with kind filter chips. 390px first, both themes, reduced-motion.
- **B7 · Concierge intents** (T3 → Opus 4.8): deterministic parser gains
  sport/quiz/music/deal moods + rank boost for venues with a matching what's-on row
  tonight; LLM schema extends mood enum only. Promoted venues still excluded.

## Wave C — Booking loop, staged

- **C-1 · Deep-link booking everywhere** (T2 → Sonnet 5): booking resolution order
  venue `bookingUrl` (71 venues today) → DMN venue page → OpenTable search deep-link
  → venue website; every venue sheet + plan stop gets a working "Book" that opens
  SOMETHING useful. Honest labelling ("Books via DesignMyNight").
- **C-2 · Rails epic (LATER, separate PRD)**: Collins API + OpenTable affiliate —
  in-app availability, revenue share. Blocked on owner's API applications.

## Guardrails (house rules apply in full)

Provenance `{source, observedAt}` on every scraped row + visible "checked <date>";
weekly refresh PR-gated, never pushes to main; no third-party database wholesale
scraping (CAMRA/useyourlocal = API-or-nothing); store seam memory+Supabase with 503
on failed durable writes; signal-only realtime; frozen map canvas (badges through
existing pipelines; decomposition F1 still precedes any canvas surgery); coverage
ratchet only rises; every PR: bots + architect review + local-ci green.

## Sequencing & routing summary

1. Wave A (A1-A6) — parallel PRs, mostly T2 Sonnet; A6 Opus.
2. B1 data model lands before B2; then B2 → B3 → B4 → B5 with B6 surfaces built
   against B1's contract from day one; B7 after B2 (first vertical proves the shape).
3. C-1 anytime (independent); C-2 waits on owner.

## Metrics

North star unchanged (weekly active crews). Wave metrics: % of map sessions that tap
a what's-on badge; Tonight-lane → plan conversions; booking deep-link CTR; quiz/sport
row coverage (venues with ≥1 row, by borough); data freshness (median observedAt age).

## Owner actions

1. Re-auth the **Firecrawl key** (agents got 401 — research fell back to web search).
2. Apply for **CAMRA SearchPubs API** terms and **Collins/OpenTable** partner access.
3. **Supabase MCP re-auth** (still pending — blocks plans on prod + the B1 migration).
4. Say **go** to execute (this PRD is planning-only), and say **commit** when this
   document may enter the repo.
