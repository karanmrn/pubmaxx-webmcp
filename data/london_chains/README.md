# London chain scrapes

Working data for integrating **Young's**, **Nicholson's**, and **Eating Europe** into the London map (menu enrichment, heritage curation, curated crawls).

## Governance

| Source | Menus / prices | Heritage / crawls |
| --- | --- | --- |
| **Young's** (`youngs.co.uk` + pub microsites) | First-party OK | OK |
| **Nicholson's** (`nicholsonspubs.co.uk`) | First-party OK | OK |
| **Eating Europe** (`eatingeurope.com`) | **NEVER** — editorial only | OK (attribute the guide) |

Hard rules:

- Do not invent £ prices. Prefer honest `venue_menu_enrichment.json` links over fake `drink_price_updates`.
- Do not commit `FIRECRAWL_API_KEY` or other secrets. Archived markdown under `*/raw/` is public scrape text only.
- Eating Europe notes go in `lib/curation.ts` / `lib/curatedCrawls.ts`, never into drink price feeds or `price_sources.json` as a price source.

Allowlisted drink sources (documentation for future fetchers): `youngs-official` and `nicholsons-official` in `data/price_sources.json`.

## Layout

```
data/london_chains/
  README.md                 ← this file
  match_report.json         ← matched/unmatched counts from the merge script
  nicholsons/
    london_pub_urls.json    ← 44 London restaurant base URLs
    menu_targets.json       ← foodmenu / drinks / bookings URLs per slug
    raw/                    ← archived .firecrawl nicholsonspubs*.md
  youngs/
    garden_pubs_raw.json    ← garden-guide URL harvest by region
    raw/                    ← archived .firecrawl youngs.co.uk-*.md
  eatingeurope/
    raw/                    ← archived eatingeurope.com-blog-londons-pubs.md
```

Live overlay written by the merge script:

- `public/data/venue_menu_enrichment.json` — keyed by stable `venue-*` ids (merges with existing Greene King entries; does not replace them).

## Merge

```bash
node scripts/merge_london_chain_scrapes.mjs
```

What it does:

1. Copies useful `.firecrawl/` markdown into `*/raw/` (no secrets).
2. Parses Nicholson's slugs → display names (`lib/nicholsons.ts`).
3. Matches pubs to `public/data/pint_prices_app_dataset.json` via website hostname / Nicholson's path, or conservative fuzzy name + London locality.
4. Updates `venue_menu_enrichment.json`:
   - Nicholson's: `menuUrl=…/foodmenu`, `bookingUrl=…/bookings`, Food + Drinks tiles
   - Young's garden pubs: `menuUrl` = pub microsite, beer-garden hint in the match report
5. Refuses drink-price emission when foodmenu markdown has no reliable £ text (current Nicholson's hubs are image-only).
6. Writes `match_report.json` (including `youngs.beerGardenHints` for a future slim rebuild — not forced into `venues_slim.json` here).

Helpers + unit tests: `lib/nicholsons.ts`, `lib/youngs.ts`, `__tests__/londonChains.test.ts`.

## Editorial

- Eating Europe pubs (Mayflower, Lord Wargrave, Ye Old Mitre, The Albion, Spaniards Inn, Ship Soho, Grenadier, …) → `lib/curation.ts` `curatedVenues` with `sourceLabel: "Eating Europe"`.
- Curated crawl `eating-europe-london-pubs` — **matched venues only** (sparse until more guide pubs appear in the dataset).
- Optional crawl `youngs-beer-gardens` — matched Young's garden pubs with `crawlStyle: "beerGarden"`.
