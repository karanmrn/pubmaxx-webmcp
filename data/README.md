# Pint Prices Extract

Source: https://www.pint-prices.com/

Scrape timestamp: `2026-07-03T23:10:47+00:00`

The machine-readable collection stamp the app renders lives in
`data/freshness_registry.json` (the `pint_prices` entry) — the single source of
truth, anchored at noon UTC on the scrape's UTC day (`2026-07-03T12:00:00Z`).
`lib/dataFreshness.ts` `PINT_DATASET_OBSERVED_AT` is derived from it at build
time (a drift test pins them together); the export pipeline rewrites it via
`scripts/export_app_dataset_json.py --collected-at <ISO>`. This timestamp above
is documentation of the raw scrape, not an independently-authored source.

## Files

- `borough_pint_prices.csv`: canonical borough extract from visible borough leaderboard rows. Use this for borough-level analysis.
- `pint_prices_app_dataset.csv`: recommended single CSV for building an app. It dedupes the extracted sources into one row per pub/location/pint/price and folds source coverage, boroughs, pub metadata, amenities, and map coordinates into one table.
- `pint_prices_canonical_enriched.csv`: best single clean dataset for building an app. It contains the canonical borough price rows enriched with pub metadata, amenities, and map coordinates.
- `pint_prices_builder_master.csv`: full source-preserving master CSV. It includes canonical enriched rows, raw embedded map rows, and individual pub-page rows, with source flags.
- `pub_locations_map_data.csv`: pub/location marker dataset for map layers.
- `borough_leaderboard_pint_prices.csv`: same data as `borough_pint_prices.csv`, retained with the source-specific name.
- `borough_embedded_pint_prices.csv`: raw rows from each borough page's embedded `pubsData` object. This includes pub metadata, amenities, coordinates, and pints.
- `pub_page_pint_prices.csv`: rows scraped from the 932 individual pub pages listed in the sitemap.
- `all_pint_prices_combined.csv`: stacked borough and pub-page extracts with a `source_dataset` column.
- `summary_by_borough.csv`: canonical borough row and pub counts.
- `summary.json`: scrape counts, borough metadata, and scrape caveats.
- `borough_embedded_pint_prices.json` and `pub_page_pint_prices.json`: JSON copies of the two richer extracts.

## Counts

- Sitemap URLs: 1,223
- Borough pages: 32
- Pub pages: 932
- Canonical borough price rows: 3,020
- Canonical enriched rows: 3,020
- Pub-page price rows: 2,258
- Combined rows: 5,278
- App dataset rows: 3,085
- App dataset columns: 51
- Builder master rows: 17,673
- Pub/location map rows: 1,197
- Scrape errors: 0

## Caveat

Use `pint_prices_app_dataset.csv` as the single app-building file and `borough_pint_prices.csv` as the strict borough truth. At scrape time, Havering, Hillingdon, and Redbridge exposed a large embedded `pubsData` object but no visible leaderboard rows, so the app dataset keeps those raw signals in `boroughs_raw_embedded_site_anomaly` and `data_quality_notes` while `boroughs_visible` and `primary_borough` remain the safer app-facing borough fields.

`all_pint_prices_combined.csv` (5,278 rows) and
`pub_locations_map_data.csv` (1,197 rows) preserve scraper evidence. Neither is
a product input. The app builder reads the canonical enriched, embedded-price,
and pub-page extracts listed above, then publishes
`pint_prices_app_dataset.csv`. Quarantine entries keep exact `file:line`
`sourceRows` references into preserved price and location evidence. Some
embedded-only price observations never entered `all_pint_prices_combined.csv`,
so their exact price references point to
`borough_embedded_pint_prices.csv`; every quarantined location points to
`pub_locations_map_data.csv`.

## Postcode-coordinate gate

`npm run validate-data` treats a postcode and map point that identify different
areas as contradictory product data. The gate builds robust outward-code
reference points from the committed UK OpenStreetMap pub extract and fails once
a product row is more than 5 km away. That boundary came from the measured
separation in this dataset: correct rows had a 99th percentile of 3.65 km and
ended at 3.87 km, while the first contradiction started at 5.44 km. A
provenance or quality marker never bypasses the gate.

Genuinely odd but verified geography belongs in
`postcode_coordinate_exceptions.json`. An exception must exactly identify the
app price row, name, full postcode and coordinates, and state why evidence
establishes the row despite the distance. Stale, partial, duplicate, reasonless,
or no-longer-contradictory exceptions fail validation.

Unresolved rows belong in `postcode_coordinate_quarantine.json`. Each `rows`
entry names exactly one `appPriceId`, `pubName`, full `postcode`, `latitude`,
`longitude`, and substantive `reason`. `scripts/build_app_dataset.py` assigns
app price IDs before publication decisions, applies evidence-backed
`postcode_coordinate_corrections.json` decisions, validates every quarantine
entry against the complete pre-publication row, then omits the exact row. It
prints one `[postcode-coordinate quarantine]` line with the reason for every
skip. A stale, partial, duplicate, reasonless, identity-mismatched, or
no-longer-contradictory entry stops the build.

Raw scrape files, including `borough_embedded_pint_prices.csv`, remain unchanged
so they continue to record what the source said. Corrections and quarantine are
publication decisions, not rewrites of source evidence. Each successful build
writes `postcode_coordinate_build_report.json`, which fingerprints all raw
inputs and decision registries and records every applied row. `npm run
validate-data` checks those fingerprints and exact dispositions. Editing a
source or registry without rebuilding fails validation instead of silently
dropping or restoring a venue.

Run the scraper again with:

```bash
python3 -u scripts/extract_pint_prices.py
python3 scripts/build_app_dataset.py
```
