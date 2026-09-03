# UK-wide OSM pub seed packs

Every `amenity=pub` node/way in the United Kingdom (Great Britain + Northern
Ireland), pulled from Overpass in grid chunks. These source packs feed the
separate, unpriced map layer described in
[`public/data/uk_base/README.md`](../../../public/data/uk_base/README.md); they
never feed the curated venue index.

Prices are **not** taken from OSM. Everything in these packs is venue presence
and metadata; pint prices come from community submissions and curated datasets.

The WIDER extraction - bars, cafes, coworking desks, libraries and the rest of
the places a drinker or a laptop could sit in - lives beside this one in
[`VENUES.md`](VENUES.md). It is a separate taxonomy, separate packs and a
separate London publish; this pack stays `amenity=pub` alone, because the base
map layer and every reader of it draw a pub.

## Layout

```
data/osm/uk/
  raw/chunk_lat<south>_lon<west>.json   # raw Overpass response, one per grid cell
  chunks.json                           # grid definition + per-chunk element counts
  uk_osm_pubs.json                      # normalized pack (the thing to consume)
  dedupe_report.json                    # overlap vs curated London + city packs
```

`raw/` and `uk_osm_pubs.json` are compact because indentation would multiply
repository size without making machine-generated dumps easier to review.
`chunks.json`, `dedupe_report.json`, and `uk_osm_pubs.json` own current counts,
timestamps, and overlap measurements. The fetcher prints total pack size and
warns if a refresh crosses the commit budget.

## Refresh

```bash
npm run fetch:uk-pubs                       # full pull; resumes automatically
npm run fetch:uk-pubs -- --skip-if-present # explicit alias for default resume
npm run fetch:uk-pubs -- --refresh          # refetch every chunk from scratch
npm run fetch:uk-pubs -- --allow-stale      # accept Overpass mirrors whose planet base is older than 48h
npm run fetch:uk-pubs -- --chunk=lat50.80_lon-0.70  # one grid cell (--list for ids)
npm run fetch:uk-pubs -- --from-raw         # re-normalize on-disk chunks, no network
npm run fetch:uk-pubs -- --list             # print the grid and exit
```

A plain `npm run fetch:uk-pubs` is the one command that produces or refreshes the
whole dataset. It **resumes by default**: a valid raw snapshot less than 48 hours
old is skipped, while missing, truncated, remarked, or stale snapshots are
refetched. An interrupted or rate-limited run is restarted by rerunning the same
command. Raw responses and generated artifacts are written through atomic
renames, so interruption cannot replace a good file with a partial one.
`--refresh` is the opt-in that ignores otherwise reusable snapshots.
`--allow-stale` is for when public Overpass mirrors answer with an older planet
base (busy primary, lagging mirror): still OSM, still ODbL, just not within the
usual 48-hour freshness window.

Overpass etiquette lives in `scripts/lib/overpassClient.mjs`, the one client this
fetcher shares with the venue fetcher beside it: one request at a time, a delay
between chunks, exponential backoff on transient failures, and a per-request
timeout so a hung mirror cannot stall a chunk on its own. Endpoints are tiered
there rather than rotated flat, because a flat rotation spent two attempts of
every chunk on a mirror that was down or serving a ten-week-old snapshot. A full
cold pull takes roughly an hour.

## How the query is chunked

`scripts/lib/ukOsmSeed.mjs` owns the UK bbox and 1° × 1° grid, so no single
request carries the whole country. Keeping one fixed grid prevents raw files
from incompatible chunk layouts being mixed during resume.

Each cell's query is clipped to the UK **area** (OSM relation 62149) as well as
the bbox. The area filter is what keeps the Republic of Ireland, the Isle of Man
and the Channel Islands out of border cells - a bbox alone cannot separate
Armagh from Monaghan. Cells share edges, and Overpass bboxes are inclusive, so
elements on a shared edge come back twice; normalization dedupes by OSM id.

Taxonomy is `amenity=pub` only (nodes + ways, `out center`). Bars are a London
seed-pack concern (`data/osm/outer_london_osm_pubs.json`) and are deliberately
not pulled here.

## Normalized fields

Same shape as the per-city packs (`data/cities/{city}/osm_pubs.json`) plus:

- `outdoorSeating` - `outdoor_seating=yes` (kept, as in the city packs)
- `smoking` - every `smoking` / `smoking:*` tag **verbatim**, or `null`. A
  possible future smoking filter needs the raw OSM vocabulary (`outside`,
  `isolated`, `separated`, `dedicated_room`, …), not a boolean we would have to
  re-derive from a fresh country-wide pull.
- `postcode`, `operator` - cheap to retain, useful for later matching
- `curatedRef` - present only when the pub already exists in curated or
  previously-seeded data (see below)

## Dedupe report

`dedupe_report.json` counts how much of the UK pack the app already has, against:

| Source | Key |
| --- | --- |
| `curated-london-slim` (`public/data/venues_slim.json`) | name + distance only - curated London carries no OSM ids |
| `outer-london-osm-seed` (`data/osm/outer_london_osm_pubs.json`) | OSM id, else name + distance |
| `city:<city>` (`data/cities/{city}/osm_pubs.json`) | OSM id, else name + distance |

Name matching uses `normalisePubName` from `scripts/lib/venueMatch.mjs` (the
same normalization the price harvesters use) within 150 m - curated coordinates
and OSM coordinates disagree by a building's width, not by a street.

Matched pubs keep a `curatedRef: { source, id, matchType, distanceM }` in
`uk_osm_pubs.json`, so a consumer can drop or defer to the existing record
without recomputing the join.

## Consuming these packs

`scripts/build_uk_base_shards.mjs` is the pack's consumer: it turns
`uk_osm_pubs.json` into the map's UK **base layer** under `public/data/uk_base/`
(see that directory's README). It records the actual curated owner when one
exists, salts base ids to `venue-uk-…`, and never invents a price. Runtime
rendering suppresses a base row only when that owner is loaded and drawable.

`scripts/build_uk_place_index.mjs` reads `raw/chunk_*.json` directly, because
the chooser's place index is built from the `addr:city` / `addr:town` /
`addr:village` / `addr:place` / `addr:suburb` tags, which normalization folds
into one address string rather than retaining as separate fields. It writes only
place names and coordinates, never a pub count or a price, and adds no second
geography source. Both run under `npm run build:uk-base`;
`public/data/uk_base/README.md` owns the index's shape and budget.

Nothing here feeds `venues_slim*.json`. Base pubs are not venues: they carry no
price, do not enter search or the price filters, and are not routable stops.

Enrichment crons (heritage, prices, what's-on) are explicitly **not** wired to
these packs.

`chunks.json` remains the fetch grid, not the serving grid: `chunkStats[].bbox`
bounds every raw file, and `missingChunks` must be empty for the pack to be
complete.

## Licence / attribution

OpenStreetMap data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
licensed under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).

When you redistribute or publicly display these packs, keep the ODbL
attribution. Do not claim OSM as a price source.
