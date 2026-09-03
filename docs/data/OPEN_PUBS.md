# Open Pubs evaluation

Dry-run scaffold for the [Open Pubs](https://www.getthedata.com/open-pubs) CSV
(FSA FHRS-derived names/addresses/coordinates + ONS postcode directory). Part of
Wave S3 densification; see [`SOURCE_LEDGER.md`](./SOURCE_LEDGER.md).

## What this is

- Pure helpers: `scripts/lib/openPubs.mjs` (parse CSV, match identity)
- CLI report: `scripts/evaluate_open_pubs.mjs`
- Unit fixture: `__tests__/fixtures/open_pubs_sample.csv`

## What this is not

- Not an automatic merge into `venues_slim` or the UK base shards
- Not a price source (Open Pubs carries no drink prices; we invent none)
- Not a write path into `community_prices`

## Licence posture

Open data, free to use for any purpose per getthedata.com. Upstream sources:

- Food Standards Agency Food Hygiene Ratings (FSA terms)
- ONS Postcode Directory (Open Government Licence)

Keep attribution honest if rows ever enter a curator queue. Do not treat the
file as a CAMRA / WhatPub substitute.

## How to run (dry-run)

Against a local CSV (no network):

```bash
node scripts/evaluate_open_pubs.mjs \
  --csv __tests__/fixtures/open_pubs_sample.csv \
  --identity curated
```

### London curated identity report

Evaluate Open Pubs rows whose `local_authority` is one of the 33 Greater London
boroughs against the curated London slim index only. Writes matched / unmatched /
ambiguous / skipped totals plus up to 20 sample unmatched names. Still dry-run:
never merges into `venues_slim`.

```bash
node scripts/evaluate_open_pubs.mjs \
  --csv path/to/open_pubs.csv \
  --london \
  --report data/generated/open_pubs_london.json
```

`--city london` is an alias for `--london`. Identity is forced to `curated`
(London product slim at `public/data/venues_slim.json`).

Or via npm:

```bash
npm run evaluate:open-pubs:london -- --csv path/to/open_pubs.csv \
  --report data/generated/open_pubs_london.json
```

Fixture smoke (no network):

```bash
npm run evaluate:open-pubs:london -- \
  --csv __tests__/fixtures/open_pubs_sample.csv \
  --report /tmp/open_pubs_london_fixture.json
```

Download the official zip into `data/generated/open_pubs/` then evaluate
(curated slim + OSM UK pack when present):

```bash
node scripts/evaluate_open_pubs.mjs --download
```

Useful filters:

```bash
# One borough / local authority label from the CSV
node scripts/evaluate_open_pubs.mjs --download --authority "Tower Hamlets"

# Cap rows while iterating
node scripts/evaluate_open_pubs.mjs --csv path/to/open_pubs.csv --limit 500

# JSON report (still no slim merge)
node scripts/evaluate_open_pubs.mjs --csv path/to/open_pubs.csv \
  --report data/generated/open_pubs_eval.json
```

Or via npm: `npm run evaluate:open-pubs -- --csv __tests__/fixtures/open_pubs_sample.csv`

## Match rules

A row matches curated or OSM identity when:

1. Coordinates are present (rows with `\N` lat/lng are skipped)
2. Normalised pub names are equal (`normalisePubName`, leading “the” stripped),
   or operator-stripped identity names are equal
3. Great-circle distance ≤ 150 m (same gate as curated ↔ OSM overlap)
4. Postcode outward codes do not conflict when both sides have one

Curated wins over OSM when both qualify. When two distinct ids share the best
name tier and layer, the row is **ambiguous** (counted separately; the report
refuses to guess by distance alone). Far same-shape names stay unmatched.

## Next step (owner decision)

A green-lit curator promotion path may use these match reports. Until then the
CLI remains report-only.
