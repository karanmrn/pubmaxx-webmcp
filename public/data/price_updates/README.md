# Permissible-source price updates

Versioned, provenance-stamped price files that refresh the **static baseline**
price for a venue. Community Pint Drops remain the live price signal — a fresher
Pint Drop always beats an update here (see `lib/priceUpdates.ts`
`mergePriceUpdates`). These files exist so that, absent a recent community drop,
the app can show a price sourced from a **permissible first-party source** with
full attribution, instead of an ageing baseline.

## File naming

`prices_YYYYMMDD.json` — one file per refresh run. The loader reads all files and,
per venue, keeps the **newest valid `observedAt`**.

## Schema

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-03T12:00:00.000Z", // when this file was written (ISO-8601)
  "updates": [
    {
      "venueKey": "the churchill arms|119 kensington church st|51.50700|-0.19400",
      // Canonical grouping key = lib/venues.ts venueGroupingKey:
      //   `${pub_name}|${address}|${lat.toFixed(5)}|${lng.toFixed(5)}` (lower-cased,
      //   whitespace-collapsed). Targets exactly the venue the app groups by.
      "price": 6.5,                          // finite, >= 0 (0 allowed for a promo)
      "source": {
        "label": "The Churchill Arms — official site",
        "url": "https://www.churchillarmskensington.co.uk/" // absolute http(s)
      },
      "observedAt": "2026-07-01T00:00:00.000Z" // ISO-8601, not in the future
    }
  ]
}
```

A bare top-level array (`[ {…update…}, … ]`) is also accepted by the loader.

## Governance (hard rules)

- **First-party / open sources ONLY.** Prices may come from pub or brewery
  official pages, or open-licensed datasets — see `data/price_sources.json`.
  **No scraping of competitor price-aggregator sites, ever.**
- **Every price carries `source` + `observedAt`.** The venue detail attributes a
  refreshed price as **"sourced"** (`lib/priceUpdates.ts`
  `PRICE_UPDATE_PROVENANCE`), never as a community contribution.
- **Never present stale as live.** `observedAt` is always surfaced; a future or
  malformed timestamp is rejected by the loader.

## Why this example is empty

No prices could be verified against a permissible first-party source without web
access at authoring time. Rather than ship an unverified (and therefore
governance-violating) price, this example file ships with `"updates": []`. The
committed `latest.json` keeps `generatedAt` on the bundled pint collection day
(2026-07-03) so public copy and the freshness spine do not read a fresher-looking
stamp with no rows behind it. Audit class and cadence live in
[`data/freshness_registry.json`](../../data/freshness_registry.json). The
refresh scaffold (`scripts/refresh_prices.mjs`) writes real files of this shape.
