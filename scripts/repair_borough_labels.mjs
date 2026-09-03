#!/usr/bin/env node
// Borough-label repair (Cycle 6 — data/borough-label-repair).
//
// #308's coverage report surfaced a data-quality bug: for hundreds of core
// pins the STORED borough label disagrees with the point-in-polygon borough for
// the pin's own lat/lng (Camden 89, City of London 77, …). The stored label
// comes from the scraped source site (pint-prices.com's `boroughs_visible` /
// `boroughs_raw_embedded_non_anomaly`), which `scripts/export_app_dataset_json.py`
// TRUSTS for every non-anomaly row — so systematically wrong source labels (e.g.
// Upper Street N1 pubs tagged "Camden" when they are the spine of Islington, or
// Whitechapel/Mile End E1 pubs tagged "Southwark") flow straight into
// `primary_borough`, the field the slim index and every borough consumer read.
//
// Geometry is the single source of truth (PRD): this script re-derives
// `primary_borough` for EVERY row of the canonical dataset via the SAME
// point-in-polygon classifier the export already ships
// (scripts/classify_borough_points.mjs / data/london_boroughs_simplified.json),
// making geometry authoritative whenever the pin falls inside a real Greater
// London borough polygon. Points outside every polygon (classifier returns "")
// keep their existing label — nearest-vertex snapping is never evidence.
//
// This operates on the committed source-of-truth dataset in place rather than
// re-running `export:data`, because the dataset carries curated gazetteer rows
// merged AFTER export (merge_outer_london_gazetteer / merge_london_chain_
// gazetteer) that are not present in data/pint_prices_app_dataset.csv — a bare
// re-export would drop them. Only the derived `primary_borough` field changes;
// raw scrape provenance (boroughs_visible, *_raw_embedded_*) is preserved
// untouched. The matching source-level fix lives in
// scripts/export_app_dataset_json.py#resolve_primary_borough so a future
// re-export produces the same geometry-authoritative result.
//
// Run:
//   node scripts/repair_borough_labels.mjs         # apply the repair, rebuild via `npm run build:slim`
//   node scripts/repair_borough_labels.mjs --dry    # report only, write nothing

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { boroughForPoint, loadBoroughIndex, LONDON_BOROUGH_CLASSIFIER_VERSION } from "./lib/boroughFromPoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");

function main() {
  const dry = process.argv.includes("--dry");
  const originalText = readFileSync(DATASET_PATH, "utf8");
  const rows = JSON.parse(originalText);
  if (!Array.isArray(rows)) throw new Error(`Expected an array in ${DATASET_PATH}`);

  const index = loadBoroughIndex();
  const transitions = new Map(); // "from -> to" -> count
  let changed = 0;
  let unclassified = 0; // geo blank: kept as-is

  for (const row of rows) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    const geo = Number.isFinite(lat) && Number.isFinite(lng) ? boroughForPoint(lat, lng, index) : "";
    const stored = String(row.primary_borough ?? "");
    if (!geo) {
      unclassified += 1;
      continue; // outside every polygon — no geometric evidence, keep stored
    }
    if (geo !== stored) {
      const key = `${stored || "(blank)"} -> ${geo}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
      changed += 1;
      row.primary_borough = geo;
    }
  }

  // Report (row-level).
  const sorted = [...transitions.entries()].sort((a, z) => z[1] - a[1]);
  console.log(`classifier: ${LONDON_BOROUGH_CLASSIFIER_VERSION}`);
  console.log(`rows: ${rows.length}  reassigned: ${changed}  unclassified(kept): ${unclassified}`);
  console.log(`\n=== primary_borough transitions (row-level, by count) ===`);
  for (const [key, count] of sorted) {
    console.log(`${String(count).padStart(4)}  ${key}`);
  }

  if (dry) {
    console.log(`\n[dry run] no file written`);
    return;
  }

  // Match the export's compact serialization (json.dumps, no trailing newline).
  writeFileSync(DATASET_PATH, JSON.stringify(rows), "utf8");
  console.log(`\nwrote ${DATASET_PATH}`);
  console.log(`next: npm run build:slim && npm run build:pubmaxxing-seed`);
}

main();
