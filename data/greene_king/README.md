# Greene King menu scrape drops

Local-only staging area for first-party Greene King menu payloads.
`scripts/merge_greene_king_menus.mjs` reads these files — **no network** in the
merge step. Never commit API keys (`FIRECRAWL_API_KEY` etc.).

## Layout

```
data/greene_king/
  README.md                 (this file)
  osm_city_pubs.json        city OSM GK pubs (name/address/lat/lng/menuUrl)
  raw/                      optional drink menu scrapes
    {slug}.menu.json        { name, menuUrl, city?, lat?, lng?, address?, markdown, scrapedAt }
  food/                     optional food interact / markdown drops
    {slug}.interact.txt     ### **Starters** / * **Item**: £x.xx
    {slug}.json             { text|markdown, menuUrl, venueKey?|name+lat+lng, scrapedAt }
```

## Workflow

1. Scrape a pub menu page (outside this repo / with your own key) into markdown.
2. Drop the JSON under `raw/` (drinks) and/or interact text under `food/`.
3. Run: `node scripts/merge_greene_king_menus.mjs`
4. That writes `public/data/drink_price_updates/` + `public/data/food_price_updates/`.

Without any scrape drops, the merge script still converts the London pubmaxxing
beverage CSV (`data/pubmaxxing/london_pub_all_beverages_expanded.csv`) for pubs
whose Greene King website slug matches a row in
`public/data/pint_prices_app_dataset.json`.

## Firecrawl notes

First-party scrapes use Firecrawl against `greeneking.co.uk` only (allowlisted
as `greene-king-official` in `data/price_sources.json`). Menu pages often
default to **food** (`## Main Menu`); drink sections need a Drinks filter click
(interact) or appear on drink-default pubs. Store the API key in the
environment (`FIRECRAWL_API_KEY`) — never commit it.

## Venue keys

Updates use `name|address|lat|lng` (lower-cased, whitespace-collapsed) — the
same formula as `lib/venues.ts` `venueGroupingKey` / `venueCoordsGroupingKey`.
City venues have **no** city-id salt on the update key; `venueMenuLookupKeys`
also accepts `venue.id` as an alias.
