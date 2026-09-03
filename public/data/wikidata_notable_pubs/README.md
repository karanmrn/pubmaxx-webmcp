# Wikidata notable UK pubs

Generated seed from Wikidata Query Service: UK pubs (`Q212198`) with
coordinates and an English Wikipedia article. Facts are CC0; any Wikipedia
prose pulled later for sheets is CC BY-SA and must be credited.

```bash
node scripts/fetch_wikidata_notable_pubs.mjs
```

The JSON output is generated on demand and is not shipped in the repo.

The generated JSON is enrichment / join material. It does **not** invent
prices and is never merged into `venues_slim*`. Map pins stay on the OSM UK
base layer (ODbL). See `docs/prd/UK_MAP_COVERAGE_AND_SEARCH_PRD.md`.
