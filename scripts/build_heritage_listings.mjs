// Build the LISTED-BUILDING heritage dataset from Historic England's open data.
//
// Source: the National Heritage List for England (NHLE) "Listed Building points"
// layer, served from Historic England's ArcGIS open-data hub. Licence: Open
// Government Licence v3.0 (attribution required — see ATTRIBUTION below and the
// credits wired into the app + public/llms.txt). The list entry is the only
// official register of nationally protected buildings in England.
//
// What it does (a deterministic, provenance-honest JOIN):
//   1. Fetch London-bbox listed-building points from the NHLE FeatureServer
//      (paged, WGS84), OR read a pre-downloaded cache with --cache <path>.
//   2. Load public/data/pint_prices_app_dataset.json, group rows into venues by
//      the SAME key the app uses (venueGroupingKey → stableVenueIdFromKey), so
//      output keys are the exact venue-… ids the map + /api/heritage link by.
//   3. Match conservatively via scripts/lib/heritageMatch.mjs — a listed point
//      must carry the pub's core name AND sit on it. False positives are worse
//      than misses (owner rule), so most pubs get nothing and that is correct.
//   4. Write public/data/heritage_listings.json — ONLY matched pubs, keyed by
//      venueId, with { listEntry, grade, listedYear, name, fact, url, distanceM }.
//
// We NEVER invent a grade, an era, or a description. `fact` is grade + the
// building type only when the official listing name names one; `listedYear` is
// the DESIGNATION year (never presented as a construction date). Output is
// key-sorted and pretty-printed with a trailing newline, so re-running with the
// same inputs is byte-identical.
//
// Run:
//   node scripts/build_heritage_listings.mjs                 # fetch live NHLE
//   node scripts/build_heritage_listings.mjs --cache pts.json  # from a cache
//   node scripts/build_heritage_listings.mjs --dry-run       # print, don't write

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bestMatch,
  buildFactText,
  titleCaseName,
} from "./lib/heritageMatch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATASET_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const OUT_PATH = path.join(ROOT, "public", "data", "heritage_listings.json");

const NHLE_FEATURESERVER =
  "https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/ArcGIS/rest/services/" +
  "National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query";

// Greater-London bounding box (WGS84). Generous; the matcher's distance gate is
// what actually prevents cross-region false positives.
const LONDON_BBOX = { xmin: -0.55, ymin: 51.28, xmax: 0.34, ymax: 51.7 };

export const ATTRIBUTION =
  "Listed-building data from Historic England's National Heritage List for " +
  "England (NHLE), © Historic England, licensed under the Open Government " +
  "Licence v3.0.";

const LIST_ENTRY_URL = (listEntry) =>
  `https://historicengland.org.uk/listing/the-list/list-entry/${listEntry}`;

// --- venue keying: an exact mirror of lib/venues.ts (kept plain like the other
// scripts/*.mjs generators so this has no TS import gymnastics) -----------------
function normaliseVenueKeyPart(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}
function stableVenueIdFromKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

// One representative venue per grouping key (first row supplies name/coords),
// exactly as groupVenuePrices() does in the app.
function groupVenues(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!Number.isFinite(Number(row.latitude)) || !Number.isFinite(Number(row.longitude))) {
      continue;
    }
    const key = venueGroupingKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: stableVenueIdFromKey(key),
        name: row.pub_name,
        lat: Number(row.latitude),
        lng: Number(row.longitude),
      });
    }
  }
  return [...byKey.values()];
}

// Fetch every London-bbox listed-building point, paged at the service max.
async function fetchListedPoints() {
  const points = [];
  const step = 1000;
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: "1=1",
      geometry: JSON.stringify({ ...LONDON_BBOX, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "ListEntry,Name,Grade,ListDate",
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: String(step),
      f: "json",
    });
    const res = await fetch(`${NHLE_FEATURESERVER}?${params.toString()}`);
    if (!res.ok) throw new Error(`NHLE fetch failed: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`NHLE error: ${JSON.stringify(body.error)}`);
    const features = body.features ?? [];
    for (const feature of features) {
      const point = feature.geometry?.points?.[0];
      if (!point) continue;
      points.push({
        listEntry: feature.attributes.ListEntry,
        name: feature.attributes.Name,
        grade: feature.attributes.Grade,
        listDate: feature.attributes.ListDate,
        lat: point[1],
        lng: point[0],
      });
    }
    process.stderr.write(`  fetched offset ${offset} (+${features.length})\n`);
    if (features.length < step) break;
    offset += step;
  }
  return points;
}

// Coarse spatial index: 0.003° cells (~330 m) so a 3×3 neighbourhood always
// covers the matcher's ≤120 m gate. Turns an O(pubs×listings) scan into a
// near-linear one without changing which match the pure matcher would pick.
const CELL = 0.003;
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

function indexPoints(points) {
  const grid = new Map();
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const key = cellKey(point.lat, point.lng);
    const bucket = grid.get(key);
    if (bucket) bucket.push(point);
    else grid.set(key, [point]);
  }
  return grid;
}

function candidatesFor(grid, lat, lng) {
  const baseLat = Math.floor(lat / CELL);
  const baseLng = Math.floor(lng / CELL);
  const out = [];
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLng = -1; dLng <= 1; dLng += 1) {
      const bucket = grid.get(`${baseLat + dLat}:${baseLng + dLng}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

function listedYearOf(listDate) {
  if (typeof listDate !== "number") return null;
  const year = new Date(listDate).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

export function buildListings(venues, points) {
  const grid = indexPoints(points);
  const listings = {};
  for (const venue of venues) {
    const candidates = candidatesFor(grid, venue.lat, venue.lng);
    const match = bestMatch(venue, candidates);
    if (!match) continue;
    const { listing, distanceM } = match;
    const fact = buildFactText(listing.grade, listing.name);
    if (!fact) continue;
    // First match wins per venueId (venues are unique by key already).
    listings[venue.id] = {
      listEntry: listing.listEntry,
      grade: String(listing.grade).trim(),
      listedYear: listedYearOf(listing.listDate),
      name: titleCaseName(listing.name),
      fact,
      url: LIST_ENTRY_URL(listing.listEntry),
      distanceM: Math.round(distanceM),
    };
  }
  return listings;
}

function serialise(listings) {
  const sortedKeys = Object.keys(listings).sort();
  const ordered = {};
  for (const key of sortedKeys) ordered[key] = listings[key];
  const doc = {
    $attribution: ATTRIBUTION,
    $source: "Historic England — National Heritage List for England (NHLE), Listed Building points",
    $licence: "Open Government Licence v3.0",
    listings: ordered,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const cacheIdx = argv.indexOf("--cache");
  const cachePath = cacheIdx !== -1 ? argv[cacheIdx + 1] : null;

  const dataset = await loadJson(DATASET_PATH);
  const rows = Array.isArray(dataset) ? dataset : dataset.venues ?? [];
  const venues = groupVenues(rows);
  process.stderr.write(`Grouped ${rows.length} rows into ${venues.length} venues.\n`);

  let points;
  if (cachePath) {
    process.stderr.write(`Reading NHLE points from cache ${cachePath}\n`);
    points = await loadJson(path.resolve(cachePath));
    // Cache may use lat/lng directly or the raw fetch shape — normalise.
    points = points.map((p) => ({
      listEntry: p.listEntry,
      name: p.name,
      grade: p.grade,
      listDate: p.listDate,
      lat: p.lat,
      lng: p.lng,
    }));
  } else {
    process.stderr.write("Fetching NHLE London listed-building points...\n");
    points = await fetchListedPoints();
  }
  process.stderr.write(`Have ${points.length} listed-building points.\n`);

  const listings = buildListings(venues, points);
  const matched = Object.keys(listings).length;
  process.stderr.write(`Matched ${matched} pubs to listed buildings.\n`);

  const output = serialise(listings);
  if (dryRun) {
    process.stdout.write(output);
    return;
  }
  await writeFile(OUT_PATH, output);
  process.stderr.write(`Wrote ${path.relative(ROOT, OUT_PATH)} (${matched} listed pubs).\n`);
}

// Run only as a script, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`build_heritage_listings failed: ${error.message}\n`);
    process.exit(1);
  });
}
