# London desk pack

`desks.json` is the amenity-bearing sibling of the London venue shards, cut by
`npm run build:london-desks` from the same UK OSM packs
(`data/osm/uk/uk_osm_venues_*.json`, see `data/osm/uk/VENUES.md`).

`desks.json` is generated. This README is hand-written and survives rebuilds.

## Why its own directory

`public/data/london_venues/` is published by `publishStagedDirectory`, which
ends by deleting every `*.json` in that directory's root that is not
`manifest.json`. A desk pack written there is removed by the next
`npm run build:london-venues`, and desk mode then reads a 404 as a failed pack.
`__tests__/londonDeskPackPublish.test.ts` runs the real publisher and pins that
this pack survives it.

## What a row may say

A row is a tuple:
`[osmRef, name, address, lat, lng, kind, internetAccess, laptop, hours]`.

The shards keep name, address, position and kind only; desk mode needs wifi,
laptop and `opening_hours`, so those tags live here and nowhere on a shard row.
Eligible kinds are cafe, coworking, library and hotel_lounge, plus a pub only
when OSM states wifi. The covering `observedAt` is the oldest pack `fetchedAt`.

Nothing here is a price source, and nothing here states occupancy. A card prints
only the amenities OSM stated, and "No amenity data yet" when it stated none.
The `hours` string is read into one plain line for the day the reader is on, and
the raw OSM syntax stays behind "Full hours".

`/near?mode=desk` is the reader (`lib/nearDeskVenues.ts`).

## Attribution

OSM data is © OpenStreetMap contributors, ODbL 1.0.

The shard and base layers credit the MAP, because that is where they are drawn.
This pack is read by `/near?mode=desk`, which renders no map canvas, so
`OSM_ATTRIBUTION` never reaches it. The desk answer therefore carries its own
credit (`components/nearme/DeskDataCredit.tsx`), the way `UnverifiedPubSheet`
and `CityChooser` credit the OSM rows they show.
