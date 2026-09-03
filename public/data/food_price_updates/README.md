# Permissible-source FOOD price updates

Versioned, provenance-stamped price files for food dishes on the venue Menu tab
(`lib/food.ts` / `lib/foodPriceUpdates.ts`). Parallel to
`public/data/drink_price_updates/`.

## File naming

`prices_YYYYMMDD.json` — one file per merge run (`scripts/merge_greene_king_menus.mjs`).
`latest.json` is a stable alias.

## Schema

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-11T00:00:00.000Z",
  "updates": [
    {
      "venueKey": "prospect of whitby|57 wapping wall, e1w 3sh|51.50710|-0.05113",
      "itemName": "Fish & Chips",
      "category": "mains", // one of FOOD_CATEGORIES in lib/food.ts
      "priceGbp": 19.95,
      "source": {
        "label": "Greene King — official site",
        "url": "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
        "licence": "All rights reserved — first-party publisher; attributed use only."
      },
      "observedAt": "2026-07-07T12:00:00.000Z"
    }
  ]
}
```

## City venue keys

Same formula as London `venueGroupingKey`:
`${name}|${address}|${lat.toFixed(5)}|${lng.toFixed(5)}` (lower-cased,
whitespace-collapsed) — **no city-id salt**. City slim pins recover address
from `filterHints.searchText` so updates attach without `VenuePrice` rows.
`venue.id` is also accepted as a lookup alias by `venueMenuLookupKeys`.

## Governance

First-party / permissible sources ONLY. See `data/price_sources.json`
`drinkSources` entry `greene-king-official`.
