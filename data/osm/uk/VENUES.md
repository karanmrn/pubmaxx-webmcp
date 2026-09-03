# UK OSM venue packs

Every place in the United Kingdom a drinker or a laptop could sit in, taken from
OpenStreetMap through Overpass. This is the widening of the pub pack beside it
(`README.md`, `uk_osm_pubs.json`, `amenity=pub` alone).

The packs beside this file are generated. This file is hand-written and
survives a rebuild.

```
uk_osm_venues_drink.json   # pubs, bars, beer gardens, restaurants with a bar,
                           # hotel bars, off-licences
uk_osm_venues_food.json    # cafes, coffee shops, late fast food
uk_osm_venues_work.json    # coworking, libraries, community centres with wifi
venue_chunks.json          # the grid, per-chunk element counts, failures
venue_counts.json          # counts by kind and taxonomy key, London and UK
raw_venues/                # raw Overpass responses, GITIGNORED
```

Refresh: `npm run fetch:uk-venues` (resumes by default; `--from-raw` rebuilds the
packs with no network; `--scope=work` retries one lane; `--list` prints the grid).

An artifact describes a complete run of its own scope: a `--scope` retry writes
that lane's pack and its own `venue_chunks_<scope>.json`, and leaves the other
packs, `venue_counts.json` and the extract report untouched. Rerun without
`--scope` to refresh those.

## What earns a row

`scripts/lib/ukOsmVenueSeed.mjs` is the taxonomy and the only place it is
written down. THE RULE is that a row exists because OSM **states** the thing:

| Taxonomy key | Venue kind | Taken when |
| --- | --- | --- |
| `pub` | `pub` | `amenity=pub` |
| `bar` | `bar` | `amenity=bar` |
| `biergarten` | `bar` | `amenity=biergarten` |
| `restaurant_bar` | `restaurant` | `amenity=restaurant` **and** a stated `bar`, `microbrewery` or `real_ale` |
| `hotel_bar` | `hotel_lounge` | `tourism=hotel` **and** a stated `bar` |
| `off_licence` | `other` | `shop=alcohol` or `shop=off_licence` |
| `cafe` | `cafe` | `amenity=cafe` |
| `coffee_shop` | `cafe` | `shop=coffee` |
| `late_fast_food` | `food` | `amenity=fast_food` **and** stated `alcohol` or `opening_hours=24/7` |
| `coworking` | `coworking` | `amenity=coworking_space` or `office=coworking` |
| `library` | `library` | `amenity=library` |
| `community_centre_wifi` | `other` | `amenity=community_centre` **and** stated `internet_access` |

A plain restaurant is not a drinking venue and a plain fast-food counter is not
a night venue, so both are taken only where a tag says otherwise. Nothing is
inferred from a name, a chain or a postcode. An element the table does not claim
is dropped and **counted** in `venue_chunks.json`, because a silent drop is how
a selector change stops covering a lane with nothing saying so.

Rows are evaluated in table order and the first match wins, so a pub that also
sells bottles to take away stays a pub.

## What a row carries

The pub contract (`scripts/lib/osmPubNormalizer.mjs`) plus the work-spot tags
the vertical needs: `internetAccess`, `internetAccessFee`, `internetAccessSsid`,
`wheelchair`, `capacity`, `brand`, `laptop`, `laptopFriendly`, `takeaway`,
`food`, `alcohol`, and the raw `shop` / `tourism` / `office` tag. A tag OSM does
not state stays **absent** rather than becoming a guessed default.

`kind` and `taxonomyKey` are on every row. `kind` is a `VenueKind`
(`lib/venues.ts`), and the non-pub kinds are present-but-neutral:
`isPubVenueKind` is false for them, so no price is assumed, no pint lane opens,
and no pub surface claims them.

## The fetch contract

Unchanged from the pub fetcher: the same 1° × 1° grid over the same `UK_BBOX`,
clipped to OSM relation 62149, `[timeout:90]`, the same retry, backoff and
inter-chunk delay, and a partial pull never overwrites a whole pack.

**One request per chunk** asks for the whole taxonomy. Splitting it into three
lanes tripled the requests against public mirrors that were already answering
504, which is backoff rather than data.

Endpoints are tiered in `scripts/lib/overpassClient.mjs`. That is a measured
order, not a preference: a flat rotation spent two attempts of every chunk on a
mirror that was down or serving a ten-week-old snapshot.

## Provenance

`source=osm`, `license=ODbL`, `attribution=© OpenStreetMap contributors`, and
`fetchedAt` is the run's own timestamp when the run asked Overpass. A
`--from-raw` rebuild asked nobody, so it carries the oldest OSM snapshot
timestamp among the raws it re-read, and no stamp at all when one of them
cannot be dated. Nothing here is a price source, and no
row from these packs may reach a price band, a pin figure, a cheapest bucket or
the Pint Index. See `data/osm/uk/README.md`.

## Raw responses

`raw_venues/` is gitignored: it is hundreds of megabytes of working files that
rebuild from the command above. The normalized packs are what a reader consumes
and those are committed.
