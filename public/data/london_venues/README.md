# London venue shards

Everywhere in Greater London a drinker or a laptop could sit - pubs, bars, beer
gardens, restaurants that state a bar, late fast food, cafes, coffee shops,
coworking desks, libraries, community centres with wifi, hotel bars and
off-licences - cut into one file per grid cell so a map can stream the layer a
viewport at a time.

Shard JSON is generated. This README is hand-written and survives rebuilds.
`npm run build:london-venues` rebuilds it from the UK OSM venue packs
(`data/osm/uk/uk_osm_venues_*.json`, see `data/osm/uk/VENUES.md`).

## What is here

```
manifest.json                        # { version, urlPrefix, grid, bbox, countsByKind, shards[] }
packs/<generation>/<lat>_<lon>.json  # immutable cell: { version, cell, venues[] }
```

A shard row is a tuple, not an object:
`[osmRef, name, address, lat, lng, kind]`. The decoder and the `venue-osm-…`
id salting live in [`lib/londonVenueShards.ts`](../../../lib/londonVenueShards.ts);
`__tests__/londonVenueShards.test.ts` pins the shape.

## Why this is not `uk_base`

`uk_base` is the country-wide `amenity=pub` layer. Its row tuple ends in a
curated venue id and every reader of it draws a **pub**, so a library placed in
those shards would be painted as one; its 5 MiB whole-layer budget is sized for
pubs alone. This is a parallel dataset with its own directory, its own budgets
and a KIND on every row. A pub surface still reads `uk_base`.

Ids are salted apart from both conventions - `venue-osm-…` here,
`venue-uk-…` on the base layer, `venue-…` for curated - so no reader can
mistake a cafe for either a curated venue or an unpriced pub.

## What a row may say

Name, address, position and kind: the four things OpenStreetMap stated. No
price, no band, no opening claim, no curated ownership. `isPubVenueKind` answers
false for every non-pub kind here, so nothing on this layer reaches a price
band, a pin figure, a cheapest bucket or the Pint Index.

An absent address is `""`, never invented.

## London first

The venue packs behind this are UK-wide; only the Greater London window is
published, because that is where the curated layer, the prices and the readers
are. Widening it to the country needs the per-shard and whole-layer budgets
re-measured, not raised.

## Desk pack

The amenity-bearing sibling of these shards lives in
[`public/data/london_desks/`](../london_desks/README.md), not here. Publishing
this directory sweeps its own root of every `*.json` except `manifest.json`, so
a file kept beside the shards would be deleted by the next rebuild.

## Attribution

OSM data is © OpenStreetMap contributors, ODbL 1.0. The credit is attached to
the map itself (`OSM_ATTRIBUTION` in `components/map/canvas/tokens.ts`), not to
one optional source.
