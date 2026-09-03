# PRD — UK Multi-City Maps (Wave U)

**Status:** Planned — next cult-growth wave after London flagship  
**Date:** 2026-07-09  
**Product:** PUBMAXXING  
**Supersedes (scope only):** Canonical PRD “out of scope: multi-city before London is excellent.” London remains the flagship; this PRD reframes multi-city as the **next growth wave**, not a replacement.

## One line

Ship city-scoped maps at `/map/[city]` so PUBMAXXING becomes the UK’s cult pub-crawl map — starting with Manchester’s Last Tram, then Glasgow’s Subcrawl — without diluting London’s map-first excellence.

## Problem

London is the product today: slim index, price-coloured pins, Last Pint (TfL), Place stories, Pint Drops, provenance. That loop works. Growth beyond London is blocked by three product facts:

1. **Canonical deferral is stale.** The London loop is strong enough to *export the pattern* while London stays flagship. Waiting for “perfect London” forever leaves cult cities (student towns, match-day cities, Subcrawl lore) to competitors or group chats.
2. **Price data does not travel.** Outside London there is no trustworthy pint-prices baseline. Inventing prices would break the honesty contract. Pins must exist without fake £ buckets; **Pint Drops become the primary price layer**.
3. **Transport is London-shaped.** Last Pint is TfL-coupled. Manchester Metrolink, Glasgow Subway, Merseyrail, and National Rail + bus nights need a **pluggable provider**, not a TfL fork per city.

Without a city config + route + data contract, every new city becomes a one-off rewrite.

## Solution

Expand as **config-driven city maps** that reuse London’s map principles:

| Principle | Preserve |
|-----------|----------|
| Map-first | Full-bleed MapLibre; planner/sheet on intent |
| Price-coloured pins | When a price exists (Drop or curated); otherwise honest “no price yet” |
| Slim index + lazy detail | Per-city `venues_slim` (~id, name, lat/lng, price bucket\|null, area); detail via `/api/venue/[id]` |
| Drink shapes | Existing drink-glyph pins / filters |
| Place stories | City-scoped story bands + curated crawls |
| Provenance never flattens | Every pin and price stamped; no silent scrape |
| Keyless static data | Bundled OSM/Open Pubs extracts + community Drops; no required API keys to browse |

**URL contract**

- London stays `/map` (and `/map?…`) as the flagship default.
- Other cities: **`/map/[city]`** where `city` is a stable slug (`manchester`, `glasgow`, …).
- Deep links: `/map/manchester?crawl=northern-quarter`, `/map/glasgow?band=subcrawl`.
- City switcher in map chrome; rivalry / Freshers entry points deep-link into the right city.

**Data contract (non-London)**

- **Venue pins:** OSM + Open Pubs (ODbL) extracts, curated + validated — not competitor scrapes.
- **Prices:** Pint Drops are the primary live price layer. Optional later: allowlisted first-party / open-data refresh only. **Never invent prices.**
- **Transport:** `LastPintProvider` interface (nearest stop, last departure, decision). London = TfL; Manchester = Metrolink; Glasgow = SPT Subway; Liverpool = Merseyrail; others = National Rail + bus where data allows, else honest unavailable.

**Viral loops (product, not marketing fluff)**

- **Subcrawl** (Glasgow) — shareable corridor + completion passport chip.
- **King Street Run** (Cambridge) — timed / ordered crawl pack.
- **Bailey crawl** (Durham) — compact student night route.
- **Match-day** packs (Manchester, Liverpool, Glasgow) — pre-kickoff / post-match corridors.
- **Freshers** weeks — city landing + “first night” crawls.
- **City rivalry leaderboards** — drops / crawls completed per city (honest counts, no fake density).

## User stories

1. As a visitor in Manchester, I open `/map/manchester` and see pubs on a map in seconds without downloading London’s dataset.
2. As a crawler late at night in Manchester, I check **Last Tram** on the venue sheet and get an honest leave-by decision (or clear “live data unavailable”).
3. As a Glasgow visitor, I open the **Subcrawl** pack, walk it, and share a completion card that deep-links back to `/map/glasgow`.
4. As a contributor outside London, I Drop a pint with price + photo; that price colours the pin for others without inventing a baseline.
5. As a Freshers organiser, I share `/map/oxford` or `/map/durham` with a curated first-night crawl.
6. As a match-day group in Liverpool, I follow a pre-kickoff corridor that ends near a Merseyrail / bus exit with Last Pint context when available.
7. As a London user, I still land on `/map` as the flagship; multi-city never regresses London slim-load, provenance, or Last Pint.
8. As a maintainer, I add a city by filling a **CityConfig** (bbox, slug, providers, crawl packs, attribution) rather than forking `PubMap`.
9. As a rivalry-minded user, I see city leaderboards (drops / crawls) that compare Manchester vs Glasgow without implying fake price coverage.
10. As a licensing-conscious maintainer, every OSM-derived pin carries ODbL attribution and every price carries source + observedAt.

## City dossiers (brief)

| City | Slug | Why it wins | Signature loop | Transport provider | Seed notes |
|------|------|-------------|----------------|--------------------|------------|
| **Manchester** | `manchester` | Scale + nightlife + Metrolink “Last Tram” mirror of Last Pint | Northern Quarter / Ancoats / Deansgate corridors; match-day | **Metrolink** Last Tram | Wave U1 flagship non-London |
| **Glasgow** | `glasgow` | Subcrawl is already cult folklore | Subcrawl corridor + West End / Merchant City | **SPT Subway** (+ rail/bus fallback) | Wave U2 viral |
| **Oxford** | `oxford` | Dense student + tourist pubs; compact walk | Freshers / college-adjacent night | National Rail + bus | Wave U3 wedge |
| **Liverpool** | `liverpool` | Match-day + waterfront + Merseyrail | Pre/post-match packs; Baltic / Ropewalks | **Merseyrail** | Wave U3 wedge |
| **Cambridge** | `cambridge` | King Street Run lore | King Street Run ordered pack | National Rail + bus | Post-U3 |
| **Bristol** | `bristol` | Strong indie pub culture; walkable core | Harbourside / Stokes Croft | National Rail + bus | Post-U3 |
| **Bath** | `bath` | Compact heritage + tourist nights | Circus / Abbey corridor stories | National Rail + bus | Post-U3 |
| **Durham** | `durham` | Bailey crawl + student density | Bailey crawl | National Rail + bus | Post-U3 |

London remains **not** a `[city]` peer in UX copy: it is the home map. Internally it may still be `CityConfig { slug: "london" }` for shared code.

## Phased delivery

### Wave U0 — City config spine (no new public cities yet)

**Goal:** Make multi-city *possible* without shipping empty maps.

- Introduce `CityConfig`: `slug`, display name, bbox, default camera, data paths (`venues_slim`, POIs, crawls, story bands), `LastPintProvider` id, attribution block, feature flags (prices-from-drops-only, rivalry eligible).
- Route scaffolding: `/map/[city]` resolves config or 404; London `/map` unchanged.
- Shared map shell reads config (dataset URL, provider, chrome labels) instead of hardcoding London.
- Empty-city guard: do not list a city in the switcher until slim index validates ≥ floor pins.
- Docs + `validate-data` hooks for per-city JSON.
- **Acceptance:** London behaviour unchanged; `[city]` 404s for unknown slugs; config unit-tested.

### Wave U1 — Manchester (Metrolink Last Tram)

**Goal:** First non-London city that feels like PUBMAXXING, not a pin dump.

- OSM / Open Pubs extract → slim index for Greater Manchester core bbox (curated, deduped).
- Price layer: Drops only (pins without price stay neutral / “awaiting a Drop”).
- Curated crawls: Northern Quarter, Ancoats, Deansgate/Castlefield; optional match-day pack.
- **Metrolink LastPintProvider** wired into Getting home / Last Pint card (graceful degradation).
- City switcher: London ↔ Manchester.
- Freshers / rivalry stubs behind flag if social stack ready; otherwise share cards only.
- **Acceptance:** `/map/manchester` loads slim pins keylessly; Drop colours a pin; Last Tram decision states mirror London honesty; provenance + OSM attribution visible; London `/map` unregressed.

### Wave U2 — Glasgow (Subcrawl viral)

**Goal:** Cult share loop.

- Glasgow slim index + Subcrawl corridor as first-class crawl/band with deep link + completion chip.
- SPT Subway LastPintProvider (+ honest fallback).
- Rivalry leaderboard v1: Manchester vs Glasgow (drops / crawl completions).
- **Acceptance:** Subcrawl share URL opens the corridor; completion → passport/quest credit; no invented prices.

### Wave U3 — Oxford + Liverpool wedge

**Goal:** Prove the config machine with two contrasting cities (compact student vs match-day port).

- Oxford + Liverpool slim indexes, Freshers pack (Oxford), match-day pack (Liverpool).
- Merseyrail provider for Liverpool; National Rail + bus for Oxford where feasible.
- City switcher expands; rivalry table becomes multi-city.
- **Acceptance:** both cities pass validate-data floors; deep links work; providers degrade honestly.

### Later (not this PRD’s commit bar)

Cambridge (King Street Run), Bristol, Bath, Durham (Bailey) — same U0 config path; schedule after U3 learnings.

## Non-goals

- Replacing or demoting London as flagship.
- Inventing pint prices or scraping competitor apps / closed price datasets.
- Shipping all eight cities in one release.
- Native apps, payments, pub-owner dashboards, taxi booking.
- Storing home addresses; inferring “home” for Last Pint (session destination only, as today).
- Per-city design-system forks (one candle-lit field guide).
- Full national coverage or every UK town.
- Blind OSM dumps without curation / dedupe / validate-data floors.

## Acceptance criteria (cross-wave)

| # | Criterion |
|---|-----------|
| A1 | `/map/[city]` serves only configured cities; unknown → 404. |
| A2 | London `/map` keeps slim-first load, price colours, Last Pint TfL, provenance labels. |
| A3 | Non-London pins come from OSM/Open Pubs (or later allowlisted open sources) with attribution; **no competitor scrape**. |
| A4 | Non-London map never shows an invented baseline price; Drops (and future allowlisted refresh) only. |
| A5 | `LastPintProvider` is pluggable; unavailable live data → existing decision kinds / copy, never fake departures. |
| A6 | Signature crawls (Subcrawl, etc.) are deep-linkable and completable without breaking passport honesty. |
| A7 | `npm run validate-data` covers each shipped city’s slim index (pin floor TBD per city; Manchester propose ≥ 200 core pins). |
| A8 | Keyless browse: no Supabase / OpenRouter required to see map + pins (Drops may be in-memory/demo as today). |
| A9 | Licensing footer / about: ODbL + any OGL transport attribution where used. |
| A10 | City rivalry stats are computed from real events — no seeded fake density to “win” a city. |

## Data licensing & governance

| Source | Licence / rule | Use |
|--------|----------------|-----|
| **OpenStreetMap** | ODbL — share-alike for derived DB; attribution required | Venue geometry / names where used |
| **Open Pubs / similar open registers** | Respect upstream licence (often ODbL or OGL) | Pin enrichment |
| **Transport APIs / open timetables** | Provider ToS + attribution (TfL open data; Metrolink/SPT/Merseyrail/National Rail as available) | Last Pint providers |
| **Pint Drops** | User-contributed; provenance + moderation | Primary non-London prices |
| **OGL** (where applicable) | Attribute; no claim of Crown endorsement | Official open datasets only |
| **Competitor sites / apps** | **Forbidden** to scrape for prices or venues | — |

Pipeline rule (same as Outer London / price-refresh governance): allowlisted parsers and open data only; every price `{ source, observedAt }`; never show stale as live.

## Technical notes (implementation pointers)

- Prefer one `CityConfig` module + per-city data under `public/data/cities/[slug]/` (or equivalent) over forking `PubMap.tsx`.
- Extract TfL-specific fetch from `/api/last-train` behind `LastPintProvider`; keep `computeLastPintDecision` pure and shared.
- Slim build scripts gain a `--city=` (or manifest) so London rebuilds stay isolated.
- Analytics later: city slug on map load, Drop, crawl complete — not a U0 blocker.
- Coordinate with Outer London coverage: that work stays London-only; multi-city must not steal the London density agenda.

## Success metrics (directional)

- Manchester: time-to-first-pin &lt; London’s current bar on mid network; ≥ 1 curated crawl walked in demos.
- Glasgow: Subcrawl share CTR / completion rate as the viral north star.
- Cross-city: Drop rate per active city user ≥ London’s early Drop rate (honest cold-start expected).
- Trust: zero incidents of invented prices or unattributed OSM derivatives in shipped cities.

## Open questions

1. Exact pin floor per city for switcher inclusion (Manchester 200 — confirm after first extract).
2. Should `/map/london` redirect to `/map` or coexist?
3. Rivalry: public by default or opt-in city participation?
4. Metrolink / SPT data access: live API vs static last-tram tables for v1?
5. How aggressively to merge Open Pubs names vs OSM when they conflict?

## Relationship to other PRDs

- **PRD_CANONICAL** — London excellence remains; this document **opens** multi-city as Wave U while keeping Canonical’s London non-goals for payments/native/etc.
- **PRD_OUTER_LONDON_COVERAGE** — parallel London density track; do not conflate.
- **PRD_MOBILE_FIRST / map taste waves** — multi-city inherits mobile sheet + map chrome; no separate mobile redesign.
- **Last Pint / TfL** — generalise via providers; do not regress London Getting home.
