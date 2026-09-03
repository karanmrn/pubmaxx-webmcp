# All-UK pub harvest

A two-stage gather of every UK pub. Stage 1 reads OpenStreetMap. Stage 2
reads Exa search results. Both stages store observations only: every fact
carries `sourceUrl` and `fetchedAt`. The harvest never invents a website,
a history sentence, a social handle, a menu URL or a price.

This is not the London first-party harvest. That lane stays at
`npm run harvest:run` and `docs/LONDON_HARVEST.md`.

This is not the priced map index. Harvest rows do not enter
`venues_slim.json` or pin colour.

## Command

```bash
npm run harvest:uk-pubs
# same as:
node --max-old-space-size=2048 scripts/harvest/uk-pubs/run.mjs
```

The run resumes by default.

| Flag | Effect |
|---|---|
| `--enumerate` | Overpass only |
| `--enrich` | Exa only (needs the seed file) |
| `--mock` | Exa mock mode, no network |
| `--from-osm-raw` | Build the seed from `data/osm/uk/raw` (pubs already on disk) |
| `--refresh` | Refetch every Overpass chunk |
| `--allow-stale` | Accept an Overpass snapshot older than 48 hours |
| `--limit N` | Cap rows (tests and dry runs) |
| `--chunk=lat50.80_lon-0.70` | One grid cell |
| `--bars` | Plain-bar lane. Seed from harvest Overpass raw. Enrich writes `data-harvest/bars-enriched/` |

With no stage flag, the command enumerates then enriches.

## Stage 1: enumerate

The Overpass client is `scripts/lib/overpassClient.mjs`. The UK grid and
area clip are `scripts/lib/ukOsmSeed.mjs`. The harvest query asks for
`amenity=pub` and `amenity=bar` in each 1° cell, clipped to OSM relation
62149 (United Kingdom).

A bar is kept in the pub seed only when OSM states `real_ale`,
`microbrewery=yes` or a `brewery` tag. A name that contains "pub" is not
evidence. Plain bars are dropped from that seed and counted. The bars
wave (`--bars`) reads the same Overpass raw and keeps those plain bars.

Output:

- `data-harvest/raw/chunk_*.json` - raw Overpass responses (gitignored)
- `data-harvest/uk_pubs_seed.jsonl` - canonical seed (gitignored)
- `data-harvest/uk_pubs_seed.sample.jsonl` - first 100 rows (committed)

Each seed row carries osm id, name, lat/lng, stated `addr:*` tags,
website and social tags when OSM states them, ODbL licence, attribution,
`sourceUrl` (the OSM object) and `fetchedAt`.

Licence: Open Database Licence 1.0. Attribution: © OpenStreetMap
contributors.

## Stage 2: enrich

Per pub, Exa `/search` with `outputSchema` and `systemPrompt`. The
response stores `output.content` beside `output.grounding`. A field
without an https citation in `grounding` is dropped. That is the
sourced-observation law: Exa grounding is the citation, not a guess.

When OSM already stated an https website, the harvest calls `/contents`
on that URL (cheaper than a search). Highlights sit at the top level on
`/contents`. On `/search` they nest under `contents`. Lore omits
`maxAgeHours`. Menu and price pages set `maxAgeHours` to 24.

Deprecated Exa params are not sent: `useAutoprompt`, `includeUrls`,
`excludeUrls`, `numSentences`, `highlightsPerUrl`, `tokensNum`,
`livecrawl`.

Kinds: `website`, `history`, `social`, `menu`, `coverage`. A hit with no
https URL is dropped.

Output:

- `data-harvest/enriched/shard_NNNN.jsonl` - 500 pubs per shard, atomic
  writes. Resume starts after the last complete shard.
- `data-harvest/progress.json` - counts, rate, ETA.

`EXA_API_KEY` is read from `.env.local` or the process environment. When
the key is absent the enrich stage runs mock mode and prints
`blocked: needs-decision [key=exa-key]`. Mock mode writes empty
observation lists except for a tiny named fixture, so a dry run cannot
invent coverage.

Rate limit: 1.5 s between live Exa calls. 429 uses exponential backoff
and honours `Retry-After`.

## Honesty rules

- Observations only. Never synthesise or infer a fact into the data.
- A failed Exa read is an empty observation list for that pub, not a
  guessed website.
- Harvest data is not committed. Rebuild it with the command above.

## Bars wave

After the pub enrich finishes, run:

```bash
node --max-old-space-size=2048 scripts/harvest/uk-pubs/run.mjs --bars --enumerate
node --max-old-space-size=2048 scripts/harvest/uk-pubs/run.mjs --bars --enrich
```

Or wait on the live pub run, then start the bars wave:

```bash
node scripts/harvest/uk-pubs/start-bars-when-pubs-done.mjs
```

Bars shards go to `data-harvest/bars-enriched/` with their own progress
file, so they cannot overwrite the pub harvest. Same citation law. Same
resume design.

## Fold

Fold the completed overlay into the product store. Identity is OSM id,
never the pub name. Website and menu URLs must be https. Lore folds only
with a name+town match and https citations, as HeritageFact source
`web`. Social observations are excluded. Counts must match
`data/uk-pub-harvest/fold-stats.md` or the command fails.

```bash
npm run harvest:fold -- --dry-run \
  --enriched-dir data-harvest/enriched \
  --bars-enriched-dir data-harvest/bars-enriched \
  --seed data-harvest/uk_pubs_seed.enriching.jsonl \
  --bars-seed data-harvest/uk_bars_seed.enriching.jsonl \
  --stats data/uk-pub-harvest/fold-stats.md
npm run harvest:fold -- \
  --enriched-dir data-harvest/enriched \
  --bars-enriched-dir data-harvest/bars-enriched \
  --seed data-harvest/uk_pubs_seed.enriching.jsonl \
  --bars-seed data-harvest/uk_bars_seed.enriching.jsonl \
  --stats data/uk-pub-harvest/fold-stats.md
```

The fold reads completed pub and bar `shard_*.jsonl` output plus their frozen
seed metadata. It derives the overlay in memory, so no converter file is
required. A prebuilt overlay may still be supplied with `--overlay`. Upserts
are idempotent on `osm_id`. Malformed rows fail the process.

The fold preserves comma-separated namesake HTTPS observations so the harvest
observation and fold counts stay aligned. Serving accepts only one HTTPS URL,
so a concatenated value is omitted from website and menu CTAs. Harvest `web`
lore is available only in the lazy venue sheet and heritage response; it never
headlines Today or quiet pint.

Serving: GET `/api/harvest-overlay?venueId=` is the lazy sheet overlay.
Cited lore also rides GET `/api/heritage` when the venue id maps to an
OSM object. Neither payload is in pins or `venues_slim.json`.

Migration `0123` (`harvest_venue_overlays`) is shipped, not applied.
Captain applies.
