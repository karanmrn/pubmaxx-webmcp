# Outer London gazetteer seed (Wave H4)

Curated real pubs for thin outer boroughs (Havering, Hillingdon, Redbridge,
Barnet, Harrow) where the pint-prices leaderboard / embedded scrape is empty or
anomaly-tainted.

**Not a scrape dump.** Each row is a known public venue with coordinates that
point-in-polygon into the named borough. Provenance: `sourced` gazetteer notes.

## Pipeline

```bash
node scripts/merge_outer_london_gazetteer.mjs
node scripts/build_slim_index.mjs
npm run validate-data   # if available
```

Merge is idempotent by name+rounded lat/lng. Does not invent pubs or promote
`ANOMALY_BOROUGHS` scrape blobs.

See `docs/PRD_OUTER_LONDON_COVERAGE.md` and
`docs/PRD_MEMORY_SHARE_OUTER_LONDON_WAVE_2026-07-09.md`.
