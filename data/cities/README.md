# UK city OSM venue seed packs

Per-city OpenStreetMap pub extracts used to seed multi-city maps. Prices are **not** taken from OSM — `cheapestPrice` stays `null` until Pint Drops (community prices) fill them in.

## Layout

```
data/cities/{city}/
  osm_pubs_raw.json   # raw Overpass response
  osm_pubs.json       # normalized seed pack (ODbL)

public/data/cities/{city}/
  venues_slim.json             # complete slim index
  venues_slim.core.json        # compatibility first-read shard
  venues_slim.manifest.json    # shard manifest
```

Which packs ship, and therefore which cities browse, is
`lib/cityVenuePacks.mjs`. Every shipped pack is validated on each build by
`npm run validate-data`. City packs currently use one compatibility core shard;
London uses spatial cells for location-first loading.

## Two ways a pack is made

A pack is either **queried** (its own Overpass request for its bbox) or **promoted** (cut out of the committed UK base snapshot in `data/osm/uk`). `promoteFromUkBase` on the city definition in `scripts/fetch_city_osm_pubs.mjs` decides which, and a promoted pack spends no request at all.

Promote whenever the base layer already carries the area. It takes the SAME rows the base layer holds rather than a second observation that could disagree, it keeps the snapshot's own `fetchedAt` because a promotion looks at nothing new, and it lets `scripts/build_uk_base_shards.mjs` hand each base row to its curated pin by exact OSM id, so no pub is pinned twice. Two OSM objects for one building under one name are collapsed, and every collapse is listed in the pack as `droppedDuplicateObjects`.

## What a pin says it knows

`name`, position and address come from OSM and nothing else is invented. A pin's area label is the locality OSM states for that pub (`addr:city` and its siblings), and the pack's own display name only where OSM states none: a pack covering a stretch of coast would otherwise put Llandudno on a Conwy pub. No website, no opening hours and no price reaches `venues_slim.json` — it has no field for them.

## Refresh

```bash
# One city
npm run fetch:city-pubs -- --city=manchester
npm run build:city-slim -- --city=manchester

# All enabled cities (Overpass etiquette: one at a time + delay)
npm run fetch:city-pubs
npm run build:city-slim

# Re-normalize from an existing raw dump (no network)
npm run fetch:city-pubs -- --city=manchester --from-raw

# A promoted city needs no flag and no network; it re-cuts from data/osm/uk
npm run fetch:city-pubs -- --city=llandudno

# Skip cities that already have osm_pubs_raw.json
npm run fetch:city-pubs -- --skip-if-present
```

Venue ids are city-salted (`venue-mcr-…`, `venue-glw-…`, …) so they never collide with London `venue-…` ids.

## Licence / attribution

OpenStreetMap data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).

When you redistribute or publicly display these packs, keep the ODbL attribution. Do not claim OSM as a price source — pint prices on PubMaxing come from Pint Drops and curated London datasets, not from OpenStreetMap.
