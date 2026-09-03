# London price harvest — 2026-07-18

Honest, first-party **draught pint prices** for London venues that ship without a
current price observation. Branch `data/outer-price-harvest` (on the unmerged
`data/outer-london-osm`, #315). Started as the Outer-London OSM cohort; expanding
to all-London under the owner directive (batched, checkpoint-committed).

**Evidence rules (absolute).** A price is accepted only with an explicit
first-party source (the pub's OWN website/menu page), an observed-at date, and
licence-respecting collection. Every £ value is **verbatim-validated** (must
appear literally in the scraped page text) and **band-guarded** to a plausible
London pint range (£3.00–£9.50). Then **manual QA** rejects: promotional /
happy-hour / app-only "deal" prices (not the standard price), non-pint measures
(1/3, 2/3, 330ml cans, online-shop cases), contaminated names, and chains whose
web pages carry no standard prices. **No invented, guessed, or LLM-summarised
prices. No aggregator scraping.**

## Scripts

- `scripts/harvest_outer_london_prices.mjs` — bucket unpriced venues by website
  host, skip no-web-price chains for free, Firecrawl-scrape independents
  (homepage + drinks page), strict draught-pint JSON extraction → verbatim +
  band validation. `--resume` reprocesses only prior credit-blocked venues.
- `scripts/apply_outer_london_prices.mjs` — applies ONLY the manually-verified
  survivors to `pint_prices_app_dataset.json` (cheapest pint → `price_gbp`,
  provenance stamped) and merges per-drink rows into the sanctioned
  `public/data/drink_price_updates/latest.json`.
- Per-venue log: `data/osm/outer_price_harvest_log.json`.

## Outer-London cohort — COMPLETE (2 sweeps)

660 unpriced OSM presence rows; 273 carry a `website`. Two Firecrawl sweeps
(the second resumed the credit-blocked remainder) evaluated **all 210
independent** targets; 63 chains logged for free.

Raw extraction surfaced 12 candidates; **4 survived strict QA** (8 dropped):

| Result | Count |
|---|---|
| Unpriced OSM rows (total) | 660 |
| — with a `website` tag | 273 |
| Chains skipped (no web prices) | 63 |
| Independents evaluated | 210 |
| — **verified & applied** | **4** |
| — no price published / QA-dropped | 200 |
| — real fetch error (500/DNS) | 6 |

### Applied (verified)

| Borough | Pub | Cheapest pint | Basis | Source |
|---|---|---|---|---|
| Newham | Tattoo Bar | £6.00 Aspall Draught Cyder | 6-line draught menu £6.00–£6.80 | tattoo-bar.co.uk/menu |
| Greenwich | Boom Battle Bar (The O2) | £5.00 BOOM Lager | house draught | boombattlebar.com/uk/theo2 |
| Haringey | Small Beer | £5.50 Best Bitter (Almasty) | `/drinks` list; 2/3 pours marked, unmarked = pint | smallbeern8.co.uk/drinks |
| Haringey | Langham Working Mens Club | £3.60 Pint of Beer | homepage standard pint range £3.60–£4.25 | langhamclub.co.uk |

### QA-dropped candidates (recorded honestly in the log)

- **SALT Woolwich** — £3.25/£4.00 are third/two-third measures + contaminated name + dubious brewery-site match.
- **The City Barge** — single generic "Stout £5.00", unverifiable as a named pint.
- **Pretty Decent Beer Co** — Shopify online-shop can/case prices, not draught pints.
- **Little Mercies** — 330ml canned servings (cocktail bar), not pints.
- **Leytonstone Tavern / Queer Brewing Project / Tavern On The Hill** — Monday/Friday/Mon-Tue promo & happy-hour prices, not standard.
- **Greene Man** — Hungry Horse (Greene King chain), £3 app-only promo (23–26 Jul).

## Per-borough hit-rate (Outer-London independents)

| Borough | OSM pins | w/ website | evaluated | verified |
|---|---:|---:|---:|---:|
| Barking and Dagenham | 23 | 4 | 3 | 0 |
| Brent | 65 | 18 | 13 | 0 |
| Enfield | 60 | 14 | 6 | 0 |
| Greenwich | 88 | 48 | 37 | 1 |
| Haringey | 84 | 47 | 44 | 2 |
| Hounslow | 71 | 27 | 23 | 0 |
| Kingston upon Thames | 61 | 32 | 25 | 0 |
| Newham | 68 | 22 | 16 | 1 |
| Sutton | 43 | 18 | 8 | 0 |
| Waltham Forest | 97 | 43 | 35 | 0 |
| **Total** | **660** | **273** | **210** | **4** |

Priced-count before → after: **Newham 0→1, Greenwich 0→1, Haringey 0→2**; all
other outer boroughs 0→0.

## Hit rate & credit burn (guardrail)

- **Verified hit rate: 4 / 210 evaluated independents = 1.9%** (4 / 273
  website-bearing venues = 1.5%). Raw extraction hit ~12/210 (5.7%) but **more
  than half of raw hits were promos, non-pint measures, or chains** — the honest
  standard-pint rate is ~2%.
- Firecrawl requests: sweep 1 ≈ 264, resume sweep ≈ 155, QA re-verification ≈ 18
  → **≈ 437 scrape requests** for 4 verified prices.

**The owner's <5% guard is triggered.** Standard first-party web pint prices are
rare for the outer-London cohort. Before burning the balance on all 320
website-bearing unpriced venues London-wide, the next step is a single **bounded
inner-London batch** (~40 central venues that already carry a website in the
dataset — Camden, Soho, Covent Garden, City of London, Wandsworth, Hackney) to
test the owner's hypothesis that central craft/independent bars publish more.
If that batch also lands <5%, PAUSE and report rather than spend further.

## Inner/central-London test batch (owner hypothesis test)

The owner believed central craft/independent bars publish pint prices more often.
Tested it cheaply: swept the 48 **non-OSM** unpriced venues that already carry a
website in the dataset (Soho, Camden, Covent Garden, Mayfair, City of London,
Wandsworth, Hackney, Tower Hamlets, Victoria, …) via
`--scope non-osm` (log: `data/osm/inner_london_price_harvest_log.json`).

| Metric | Value |
|---|---|
| Non-OSM unpriced venues with a website | 48 |
| Chains skipped (no web prices) | 19 |
| Independents evaluated | 29 |
| Raw extraction hits | 1 |
| **Verified after QA** | **0** |
| Firecrawl requests | 43 |

The single raw hit — The Phoenix (Victoria), "Young's ale & treacle soda bread
£4.00" — is a **food item**, dropped in QA. Central London published *fewer*
extractable standard pint prices than outer London, not more.

## Decision — PAUSE (owner <5% guard)

| Cohort | Evaluated | Verified | Hit rate |
|---|---:|---:|---:|
| Outer-London | 210 | 4 | 1.9% |
| Inner/central-London | 29 | 0 | 0.0% |
| **Combined** | **239** | **4** | **1.7%** |

Across **239 evaluated independents in ~493 scrape requests, 4 verified standard
pint prices (1.7%)** — decisively under the 5% guard, and the inner-London probe
refuted the "central bars publish more" hypothesis. The honest reason is
structural: UK pubs put standard prices behind bar boards and loyalty/Order &
Pay apps; the web £ figures that do exist are overwhelmingly promos, happy-hour
deals, non-pint measures (1/3, 2/3, 330ml cans, online-shop cases), food, or
chains.

**Paused before spending the balance** on the ~637 unpriced venues that have **no
website in the dataset** — pricing them would first require a Firecrawl *search*
per venue to resolve an official site (expensive), for an expected yield <2%.

### If the owner still wants to proceed
Highest-EV next step is NOT a blanket sweep but a curated pass over a shortlist
of venues known to publish real online drink menus (craft taprooms with e-menus,
specific independents), resolving each official site by hand/search — accepting
the ~2% hit rate and the credit cost with eyes open.

## Cycle 11 — sweep close-out + drink-menu ENRICHMENT (guard-exempt)

**(a) Price sweep — closed.** One inner-London venue left credit-blocked was
reprocessed (`--resume`): its only hit — The Coach & Horses "Berry Hugo 0.0% /
Amalfi Spritz 0.0%" — is non-alcoholic spritz cocktails, dropped in QA. Every
unpriced venue that carries a website in the dataset is now evaluated (outer 210
+ inner 29 = 239 independents, 4 verified, 1.7%). The <5% guard **remains** in
force for the price metric; the ~637 website-less unpriced venues stay paused.

**(b) Drink-menu enrichment — a separate metric (venue-detail richness), exempt
from the price guard.** Ran the existing first-party chain harvester
`scripts/firecrawl_greene_king_prices.mjs` against the new Outer-London OSM
Greene King pubs (built `.firecrawl/gk-outer-london-menu-urls.txt` = each pub's
own `/menu` page). All 10 matched by name; 4 published a structured drinks menu
(wine + cocktails, with genuinely per-venue prices), following the script's own
provenance (source "Greene King — official menu" + licence + observedAt):

| Metric | Before | After |
|---|---:|---:|
| Venues with a drink menu (`drink_price_updates` venueKeys) | 65 | 68 |
| Drink-menu rows total | 3381 | 3468 |

New menus: **The Golden Fleece** (25), **Crown & Horseshoes** (22), **Druids
Head** (40), **The Yacht** (47). The other 6 GK pubs published no menu page.
`merge_london_chain_scrapes.mjs` (free Young's/Nicholson's re-match) added no new
venues (the OSM cohort's URL formats don't match those lists). M&B/Ember/Vintage
outer pubs were not harvested — their pages carry no web menu (app-only), so the
Nicholson's-tuned MBPLC harvester would yield nothing.

## Validation

- `npm run validate-data`: PASS (12 datasets; pint 3773 rows, slim 1919, drink
  updates 3468).
- Affected tests: `venuesSlim`, `venueCanonicalization`, `greeneKingMenuParser`,
  `drinkPriceUpdates`, `validateDrinkPriceUpdatesScript`, `venueMenuEnrichment`,
  `drinkMenu`, `mbplcMenuParser` all green. Full `vitest run` 3097 earlier.
