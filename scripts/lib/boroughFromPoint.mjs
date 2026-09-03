/**
 * Point-in-polygon borough lookup for Greater London.
 * Mirrors scripts/export_app_dataset_json.py against london_boroughs_simplified.json.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { boroughNameForPoint, LONDON_BOROUGH_CLASSIFIER_VERSION } from "../../lib/londonBoroughPoint.mjs";

export { LONDON_BOROUGH_CLASSIFIER_VERSION };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BOROUGH_PATH = join(ROOT, "data/london_boroughs_simplified.json");

let cachedIndex = null;

export function loadBoroughIndex() {
  if (cachedIndex) return cachedIndex;
  const data = JSON.parse(readFileSync(BOROUGH_PATH, "utf8"));
  cachedIndex = data;
  return cachedIndex;
}

export function boroughForPoint(lat, lng, index = loadBoroughIndex()) {
  return boroughNameForPoint(lat, lng, index) ?? "";
}
