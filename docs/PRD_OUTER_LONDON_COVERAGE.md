# PRD — Outer London pub coverage

**Status:** P0 shipped with map declutter; P1–P3 planned  
**Date:** 2026-07-09  
**Product:** PUBMAXXING

## Goal

Trustworthy pubs across **all 32 London boroughs**, not Zone-1-only density. A visitor who lives in Barnet, Croydon, or Hillingdon should see their area as part of the product — not an empty map edge.

## Problem

The live map feels “central London only” for three stacked reasons:

1. **Source skew** — [pint-prices.com](https://www.pint-prices.com) leaderboard rows dominate City / Westminster / Camden / Southwark. Outer boroughs are thin (e.g. **Barnet ≈ 4** canonical pubs).
2. **Default camera** — first paint historically framed Zone 1; outer pins were easy to miss even when present.
3. **UI clutter** — mid-map Transit/Parks strips competed with the map itself (addressed in the declutter PR).

The Greater London bbox already includes Barnet (`LAT` 51.26–51.72, `LON` −0.55–0.30). This is **not** a clipping bug.

## Current state (baseline)

| Signal | Approx. value |
|--------|----------------|
| Slim map venues | See [`venues_slim.manifest.json`](../public/data/venues_slim.manifest.json) |
| Canonical app rows | See [`summary.json`](../data/summary.json) (`app_dataset_clean_canonical_rows`) |
| Barnet canonical pubs | 4 |
| Havering / Hillingdon / Redbridge leaderboard | 0 (large **embedded** scrape blobs exist — anomaly; do not blindly promote) |

Pipeline: `extract_pint_prices.py` → `build_app_dataset.py` → `export_app_dataset_json.py` → `build_slim_index.mjs` → `validate-data`.

## Success metrics

- **Borough floor:** every borough has ≥ N trustworthy map pins (propose N=15 for P1, N=40 for P2).
- **Outer share:** ≥ 35% of map pins outside a Zone-1 bounding box (define in analytics later).
- **Deep-link:** `/map?q=Barnet` (and borough “View on the map”) shows the borough’s existing pins without opening the planner (`shouldOpenPlanningInitially` ignores bare `q=`).
- **Honesty:** no invented pubs; every pin keeps provenance.

## Phased delivery

### P0 — This wave (shipped alongside map declutter)

- Clean mobile map chrome shipped; the [README map feature](../README.md#features) owns current key and control placement. POI layers default **off** on mobile.
- Slightly wider default camera so Greater London reads at a glance.
- Borough pages deep-link to `/map?q=<Borough>` for browse; optional crawl link retained; thin-coverage banner when pubCount &lt; 15.
- This PRD checked into `docs/`.

### P1 — Re-scrape + curated embedded promotion

- Re-run pint-prices extract + rebuild slim index.
- For Havering / Hillingdon / Redbridge: curated promotion of high-quality **embedded** rows only after:
  - point-in-polygon borough fix (`london_boroughs_simplified.json`),
  - dedupe against canonical IDs,
  - quality flags (no anomaly dump).
- Raise per-borough floor toward N=15 where source allows.

### P2 — Seed merge + allowlisted refresh

- Normalize/merge `data/pubmaxxing/` seed into live venue IDs (today IDs do not match).
- Implement allowlisted parsers in `scripts/refresh_prices.mjs` (first-party / open data only — no competitor scraping).

### P3 — Community suggest-a-pub

- Moderated “suggest a pub” → new venue pin (not only Pint Drops on existing IDs).
- Admin review queue; provenance required.

## Non-goals

- Inventing fake pubs to fill outer boroughs.
- Scraping competitor apps or closed datasets.
- Changing desktop planner filter semantics without a separate review.
- Blindly promoting anomaly embedded borough dumps.

## Implementation notes

- Turning off “Canonical only” alone **cannot** invent Barnet density — pipeline work is required.
- Map layers (Tube/Parks/…) are optional chrome; they must not block coverage work.
- Validate with `npm run validate-data` after any dataset rebuild (venue floor ≥ 900).

## Open questions (for P1)

1. What minimum provenance is required to promote an embedded-only row?
2. Should borough pages show an honest “thin coverage” banner when pubCount &lt; N?
3. Analytics: how do we define Zone 1 for the outer-share metric?
