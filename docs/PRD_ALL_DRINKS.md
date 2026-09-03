# PRD — PUBMAXXING: every drink, every rating, a colourful night out

> **AUTHORITATIVE APPENDIX:** [`MASTER_PRD.md`](./MASTER_PRD.md) is the canonical
> roadmap. This document retains the drink-family domain detail only.
>
> The pivot from "cheapest pint" to **the one-stop app for a fun night out** — every drink (beer, wine,
> whisky, gin, vodka, rum, cocktails, shots), real prices kept live, community ratings, people talking to
> each other, and a bolder, warmer, more colourful identity. Grounded in `docs/research/all-alcohol-market-research-2026-07-07.json`
> (102-agent deep research). Companion to `docs/PRD_FOR_FABLE.md` (design) and `docs/MASTER_PRD.md` (roadmap).

## Context & why now

PUBMAXXING is a mature London pub map: real pint prices, provenance-honest community Spills, 3-D map,
social spine, realtime, offline. The user's direction: (1) it's beer-only — expand to **all alcohol** with
the same price+story+provenance discipline; (2) prices should feel **live** — pull from permissible sources
(a chain's own site for its own pubs, e.g. Wetherspoons) on a schedule; (3) add **ratings** (rate the pint,
the pub, the pour); (4) add **messaging + Instagram/X-style sharing** so people talk, post, and rate together;
(5) the design "looks plain" — make it **colourful, textured, with real drink imagery**. End goal: when anyone
thinks *anything fun*, they think of us.

## What the research decided (carry forward)

- **Ratings: simple 1–5 stars (0.5 granularity)** — Vivino/Untappd both chose consumer-familiar stars over
  100-pt expert scales. Show **percentile framing** ("beats 85% of London pours"), not just the average.
- **Aggregation integrity (Untappd's model, copy it):** per-drink pure average; any venue-level summary is
  sample-size-aware; **hide ratings under ~10 votes**; activity (a Spill/check-in) is distinct from a rating
  (blank ≠ zero). Venue visit context belongs to Visit Reports, not a public star leaderboard.
- **Gamification off structured metadata** (ABV badges, styles) drives engagement — BUT an alcohol app must
  **not reward consumption frequency/streaks** (documented duty-of-care risk). Badges celebrate *breadth &
  discovery* (styles tried, regions, distilleries, boroughs), never volume/speed.
- **Provenance sources (the moat — incumbents don't offer these):** **Wikidata** (CC0, no attribution needed),
  **Open Food Facts** (ODbL — attribution + share-alike, rate-limited, bulk dumps), **US TTB COLA registry**
  (public-domain label metadata + images, ~48h latency), **TheCocktailDB** ($10 one-off full taxonomy; free
  test key to prototype). **Never scrape Vivino/Untappd** (no API; ToS). Every drink fact carries `{source, licence, observedAt}`.
- Prices stay first-party/permissible only; **never present a stale price as live** (existing rule holds).

## The model (extend, do not fork)

Today a venue has `prices: VenuePrice[]` (pints). Generalise to **drinks**:

- `Drink` = `{ id, category (beer|wine|whisky|gin|vodka|rum|cocktail|shot|other), name, producer?, abv?, style?,
  region?, servingSize?, priceGbp, provenance:{source,licence,observedAt}, rating? }`. A pint is `category:"beer"`.
- Keep the single write-path + provenance-never-flattens invariants. `VenuePrice`/`Pint Drop` stay valid as the
  beer specialisation; the map's cheapest-pint colouring keeps working (beer subset) while a venue detail now
  shows a **drinks menu** grouped by category.
- Ratings live on their own store (dual-backend seam, like every social store): `drink_ratings` /
  `venue_ratings` keyed by handle (self-asserted today; auth-linked when Google is on). Bayesian + recency
  aggregation as a pure, unit-tested lib.

## Epics (each = a wave; Opus on schema/pipeline/realtime, Sonnet on UI/data/tests)

**E1 — Drinks data model + menu UI.** `lib/drinks.ts` (types + category taxonomy + colour tokens), migration
for `drinks`/`drink_ratings`, venue-detail **Menu** grouped by category with per-category colour + icon; the
map/venue-sheet Pints tab generalises to "Menu" without breaking the beer path. Seed a real menu on the
curated heritage pubs (provenance-tagged demo, like the Pint Drop seeds).

**E2 — Live price fetch (permissible).** A scheduled fetcher (extend `scripts/refresh_prices.mjs` + the
versioned `public/data/price_updates/*.json` pipeline) that pulls **first-party** menu/prices — Wetherspoons'
own site for its own pubs is the flagship (their app/site publishes per-pub menus); an allowlist governs which
sources are permissible; every price `{source, observedAt}` stamped; opens a review PR, never auto-publishes.
Robots/ToS respected; documented ceiling where a source can't be fetched cleanly.

**E3 — Ratings.** `lib/ratings.ts` (1–5 stars, Bayesian aggregate, ≥10-vote floor, recency window, percentile),
`drink_ratings`/`venue_ratings` stores + API, star UI on the drink menu + feed cards; discovery/badges that
celebrate **breadth** (styles/regions/distilleries tried). Venue visit context belongs to Visit Reports, not a
venue star-rating or top-rated-pub surface.

**E4 — Messaging + social posting.** Direct/threaded **messages** between handles (dual-backend store, realtime
via the existing `lib/realtime.ts` signal-only pattern + polling fallback; migration for `conversations`/`messages`;
honest privacy note — self-asserted handles until auth). **Instagram/X layer**: the Spill already posts photo +
price + note; add a proper **profile grid**, follow-powered feed, @-mentions, rate-from-post, and one-tap share
of a beautiful OG card (reuse the OG pipeline). Provenance badge stays the "verified" mark.

**E5 — Colourful, textured identity.** The design "plain" fix, held to the token discipline (no rewrite):
a **category colour system** (wine burgundy, whisky amber, gin botanical-teal, rum mahogany, vodka ice, beer
brass) layered as accents on top of the brass base; subtle **paper/linen texture** on panels; **licence-safe
drink imagery** — commission clean SVG bottle/glass illustrations per category (own IP, no scraping) or CC0/
public-domain photos with credit; richer feed/menu cards, warmer empty states. Keep reduced-motion + Legacy Mode
+ contrast. Deliver before/after screenshots.

**E6 — Quality: raise the grep score.** Ratchet CI coverage up each wave (thresholds only ever rise): new pure
libs (drinks, ratings aggregation, price-merge, message model) ship with full unit tests; add E2E for the menu,
star rating, messaging, and the colourful surfaces; bump `vitest.config.ts` thresholds toward lines 75 / funcs 80.

## Guardrails
Permissible price sources only, every fact `{source,licence,observedAt}`; provenance never flattens; ratings hide
under the vote floor; **no consumption-frequency gamification** (duty of care); imagery licence-safe; realtime
always optional (polling fallback); tokens-only design; no raw ids / `@@` handles; coverage ratchets up only;
never `git add -A` (codex co-develops); responsible-drinking footer + no targeting minors.

## Verification
Per wave: `npm run ci` (lint/tsc/tests/validate-data/**raised coverage**/build) + `npm run test:e2e`; scoped
`Closes #N` commits; stash-push-pop around codex WIP; push to main; verify live on pubmaxxing.com. New unit tests
for every pure lib; live curl of new routes/data; Supabase advisors clean after each migration (needs MCP re-auth).
Deep-audit + code-review + simplify pass before the final Vercel deploy.
