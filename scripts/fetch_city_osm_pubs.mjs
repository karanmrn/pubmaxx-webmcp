#!/usr/bin/env node
// Fetch amenity=pub nodes/ways for a UK city bbox via Overpass, then write:
//   data/cities/{city}/osm_pubs_raw.json   (raw Overpass response)
//   data/cities/{city}/osm_pubs.json       (normalized seed pack)
//
// Usage:
//   node scripts/fetch_city_osm_pubs.mjs --city=manchester
//   node scripts/fetch_city_osm_pubs.mjs                 # all enabled cities
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.
// One city at a time with a polite delay between requests.
//
// A city marked `promoteFromUkBase` spends no request at all: its pubs are cut
// out of the committed UK base snapshot (data/osm/uk) instead of queried again.
// That is the two-layer law read the other way round — the base layer already
// carries every UK pub, so promoting an area into the curated index must take
// the SAME rows, not a second observation of them that could disagree.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { overpassBbox } from "../lib/cityBounds.mjs";
import { boroughNameForPoint } from "../lib/londonBoroughPoint.mjs";
import {
  normalizeOsmPubElement,
  sortOsmPubs,
} from "./lib/osmPubNormalizer.mjs";
import { buildGrid, chunkFileName } from "./lib/ukOsmSeed.mjs";
import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
} from "./lib/venueCanonicalization.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** @typedef {{ id: string, displayName: string, shortPrefix: string, bbox: [number, number, number, number], enabled: boolean, promoteFromUkBase?: boolean }} CityDef */

/** Inline city map. The BOX is not here: every city's box is lib/cityBounds.mjs,
 * which lib/cities.ts and scripts/validate-data.mjs read too, so a pack can
 * never be cut to one box and rendered inside another.
 * `enabled` here means "include in OSM seed-pack fetch/build" (all non-London
 * UK cities). Runtime map switcher enablement lives in lib/cities.ts. */
const CITY_DEFINITIONS = {
  manchester: {
    id: "manchester",
    displayName: "Manchester",
    shortPrefix: "mcr",
    enabled: true,
  },
  liverpool: {
    id: "liverpool",
    displayName: "Liverpool",
    shortPrefix: "liv",
    enabled: true,
  },
  oxford: {
    id: "oxford",
    displayName: "Oxford",
    shortPrefix: "oxf",
    enabled: true,
  },
  durham: {
    id: "durham",
    displayName: "Durham",
    shortPrefix: "dur",
    enabled: true,
  },
  glasgow: {
    id: "glasgow",
    displayName: "Glasgow",
    shortPrefix: "glw",
    enabled: true,
  },
  bristol: {
    id: "bristol",
    displayName: "Bristol",
    shortPrefix: "bri",
    enabled: true,
  },
  cambridge: {
    id: "cambridge",
    displayName: "Cambridge",
    shortPrefix: "cam",
    enabled: true,
  },
  bath: {
    id: "bath",
    displayName: "Bath",
    shortPrefix: "bat",
    enabled: true,
  },
  // The North Wales coast strip: Llandudno and the Great Orme, Deganwy and
  // Llandudno Junction, Conwy inside the walls, Rhos-on-Sea and Colwyn Bay.
  // The box stops before Penmaenmawr in the west, Abergele in the east and the
  // Conwy valley in the south, so the pack is one continuous seafront rather
  // than a county. Promoted out of the committed UK base snapshot.
  llandudno: {
    id: "llandudno",
    displayName: "Llandudno",
    shortPrefix: "lla",
    enabled: true,
    promoteFromUkBase: true,
  },
};

export const CITIES = /** @type {Record<string, CityDef>} */ (
  Object.fromEntries(
    Object.entries(CITY_DEFINITIONS).map(([id, def]) => [
      id,
      { ...def, bbox: overpassBbox(id) },
    ]),
  )
);

/**
 * London-borough OSM ingestion (Cycle-4 `data/outer-london-osm`).
 *
 * The city map above is scoped to the non-London Wave-2 cities. Greater London
 * pins come from a different pipeline (`public/data/pint_prices_app_dataset.json`
 * → canonicalize → build:slim), so London OSM pubs are fetched into a
 * provenance-stamped SEED pack (`data/osm/outer_london_osm_pubs.json`) that
 * `scripts/merge_outer_london_osm.mjs` folds into that dataset — never written
 * as a city slim index.
 *
 * These are the worst-covered Outer London boroughs from
 * docs/BOROUGH_COVERAGE_2026-07-17.md (the persona-hollow ring). Each borough is
 * queried by the bounding box of its own polygon in
 * data/london_boroughs_simplified.json, then every element is confirmed to fall
 * INSIDE that borough's polygon (point-in-polygon) before it is kept — a bbox
 * overlaps neighbours, the polygon does not. Borough names are exactly the
 * classifier's names (lib/londonBoroughPoint.mjs).
 */
export const LONDON_TARGET_BOROUGHS = [
  "Barking and Dagenham",
  "Kingston upon Thames",
  "Hounslow",
  "Brent",
  "Newham",
  "Sutton",
  "Waltham Forest",
  "Haringey",
  "Greenwich",
  "Enfield",
];

const LONDON_BOUNDARIES_PATH = path.join(ROOT, "data", "london_boroughs_simplified.json");
const LONDON_OSM_SEED_PATH = path.join(ROOT, "data", "osm", "outer_london_osm_pubs.json");
// Pad each borough bbox slightly so a pub sitting right on the boundary isn't
// clipped by the Overpass query before the point-in-polygon filter can judge it.
const LONDON_BBOX_PAD_DEG = 0.004;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const INTER_CITY_DELAY_MS = 8_000;
const MAX_ATTEMPTS = 5;

function parseArgs(argv) {
  let city = null;
  let skipIfPresent = false;
  let fromRaw = false;
  let london = false;
  for (const arg of argv) {
    if (arg.startsWith("--city=")) city = arg.slice("--city=".length).trim().toLowerCase();
    if (arg === "--skip-if-present") skipIfPresent = true;
    if (arg === "--from-raw") fromRaw = true;
    if (arg === "--london") london = true;
  }
  return { city, skipIfPresent, fromRaw, london };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOverpassQuery(bbox) {
  const [south, west, north, east] = bbox;
  // out center so ways get a representative lat/lon without full geometry.
  return `
[out:json][timeout:90];
(
  node["amenity"="pub"](${south},${west},${north},${east});
  way["amenity"="pub"](${south},${west},${north},${east});
);
out center tags;
`.trim();
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchOverpass(query) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "PubMaxing/0.1 (UK city pub seed; contact: github.com/karanmrn/pubmax)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const err = new Error(
          `Overpass ${response.status} from ${endpoint}: ${body.slice(0, 200)}`,
        );
        if (isRetryableStatus(response.status)) {
          lastError = err;
          const backoff = Math.min(60_000, 2_000 * 2 ** attempt);
          console.warn(`  rate-limit/backoff ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
          await sleep(backoff);
          continue;
        }
        err.fatal = true;
        throw err;
      }
      return /** @type {Record<string, unknown>} */ (await response.json());
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.fatal) throw lastError;
      if (attempt < MAX_ATTEMPTS - 1) {
        const backoff = Math.min(60_000, 2_000 * 2 ** attempt);
        console.warn(`  fetch error, retry in ${backoff}ms: ${lastError.message}`);
        await sleep(backoff);
        continue;
      }
    }
  }
  throw lastError ?? new Error("Overpass fetch failed");
}

/**
 * @param {any} raw
 * @param {CityDef} city
 */
export function normalizeOverpass(raw, city) {
  const elements = Array.isArray(raw?.elements) ? raw.elements : [];
  const pubs = [];
  for (const element of elements) {
    const pub = normalizeOsmPubElement(element, { fallbackCity: city.displayName });
    if (pub) pubs.push(pub);
  }
  sortOsmPubs(pubs);
  return {
    city: city.id,
    source: "OpenStreetMap Overpass",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    fetchedAt: new Date().toISOString(),
    bbox: city.bbox,
    count: pubs.length,
    pubs,
  };
}

async function writeNormalized(city, raw, rawPath, normPath) {
  if (rawPath) {
    await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
    console.log(
      `  wrote ${path.relative(ROOT, rawPath)} (${Array.isArray(raw.elements) ? raw.elements.length : 0} elements)`,
    );
  }
  const normalized = normalizeOverpass(raw, city);
  await writeFile(normPath, `${JSON.stringify(normalized, null, 2)}\n`);
  console.log(`  wrote ${path.relative(ROOT, normPath)} (${normalized.count} named pubs)`);
  return normalized.count;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// --- promotion out of the UK base layer --------------------------------------

const UK_PACK_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const UK_RAW_DIR = path.join(ROOT, "data", "osm", "uk", "raw");
// Two OSM objects for one building this close, under one name, are one pub —
// a node dropped on top of an existing way, not a second bar next door. Kept
// deliberately tighter than the 150 m curated-match radius, which exists to
// reconcile two DIFFERENT datasets rather than two rows of the same one.
const DUPLICATE_OBJECT_METERS = 30;

function inCityBbox(lat, lng, bbox) {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** How much this row actually STATES. Ties are broken toward the fuller row. */
function statedFactCount(pub) {
  return [
    pub.address,
    pub.locality,
    pub.postcode,
    pub.website,
    pub.phone,
    pub.openingHours,
    pub.brewery,
    pub.operator,
    pub.cuisine,
    pub.wikidata,
    pub.wikipedia,
  ].filter(Boolean).length;
}

/**
 * Collapse the same physical pub mapped twice in OSM (a node inside its own
 * way). Returns the kept rows plus every drop, because a silent collapse would
 * read as a pub that was never there.
 *
 * @param {Array<Record<string, any>>} pubs
 */
export function collapseDuplicateOsmObjects(pubs) {
  const kept = [];
  const dropped = [];
  for (const pub of pubs) {
    const normalized = normalizeVenueIdentityName(pub.name);
    const twinIndex = kept.findIndex(
      (candidate) =>
        haversineMeters(pub.lat, pub.lng, candidate.lat, candidate.lng) <=
          DUPLICATE_OBJECT_METERS &&
        namesLikelySamePub(normalized, normalizeVenueIdentityName(candidate.name)),
    );
    if (twinIndex === -1) {
      kept.push(pub);
      continue;
    }
    const twin = kept[twinIndex];
    const [keep, drop] =
      statedFactCount(pub) > statedFactCount(twin) ? [pub, twin] : [twin, pub];
    kept[twinIndex] = keep;
    dropped.push({ osmId: drop.osmId, name: drop.name, keptAs: keep.osmId });
  }
  return { kept, dropped };
}

/**
 * Cut one city out of the committed UK base snapshot. The raw Overpass chunks
 * are the source, because they still carry the locality tags the normalized
 * pack folds into an address string; every promoted pub is then required to
 * exist in that pack, so the curated pin and the base row it suppresses are
 * provably the same OSM object rather than two observations of one pub.
 *
 * @param {CityDef} city
 */
async function promoteCityFromUkBase(city) {
  const pack = JSON.parse(await readFile(UK_PACK_PATH, "utf8"));
  const basePubs = Array.isArray(pack?.pubs) ? pack.pubs : [];
  if (basePubs.length === 0) {
    throw new Error(
      `${path.relative(ROOT, UK_PACK_PATH)} has no pubs — run npm run fetch:uk-pubs first`,
    );
  }
  const baseOsmIds = new Set(basePubs.map((pub) => String(pub.osmId)));

  const chunks = buildGrid().filter((chunk) => bboxesOverlap(chunk.bbox, city.bbox));
  const elements = [];
  for (const chunk of chunks) {
    const rawPath = path.join(UK_RAW_DIR, chunkFileName(chunk));
    if (!(await fileExists(rawPath))) {
      throw new Error(`missing UK snapshot chunk ${path.relative(ROOT, rawPath)}`);
    }
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    if (Array.isArray(raw?.elements)) elements.push(...raw.elements);
  }

  const byOsmId = new Map();
  let droppedOutsideBase = 0;
  for (const element of elements) {
    const pub = normalizeOsmPubElement(element);
    if (!pub) continue;
    if (!inCityBbox(pub.lat, pub.lng, city.bbox)) continue;
    if (!baseOsmIds.has(pub.osmId)) {
      droppedOutsideBase += 1;
      continue;
    }
    if (!byOsmId.has(pub.osmId)) byOsmId.set(pub.osmId, pub);
  }

  const { kept, dropped } = collapseDuplicateOsmObjects([...byOsmId.values()]);
  sortOsmPubs(kept);
  return {
    city: city.id,
    source: "OpenStreetMap Overpass",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    // The day the pubs were OBSERVED, carried over from the snapshot they are
    // cut from. A promotion looks at nothing new, so it may not claim a date.
    fetchedAt: pack.fetchedAt ?? null,
    promotedFrom: "data/osm/uk/uk_osm_pubs.json",
    bbox: city.bbox,
    count: kept.length,
    droppedDuplicateObjects: dropped,
    droppedOutsideBaseLayer: droppedOutsideBase,
    pubs: kept,
  };
}

// --- London-borough ingestion ------------------------------------------------

/** Bounding box [south, west, north, east] of a GeoJSON borough feature. */
function featureBbox(feature) {
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  const polygons =
    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const rings of polygons) {
    for (const [lng, lat] of rings[0]) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
  }
  return [south, west, north, east];
}

/** Overpass query for amenity=pub AND amenity=bar (nodes + ways) in a bbox.
 * Mirrors the city query taxonomy but widens it to `pub/bar` per the Cycle-4
 * PRD — bars are legitimate cheap-pint venues and the mission is venue
 * PRESENCE. `out center` gives ways a representative point. */
function buildLondonOverpassQuery(bbox) {
  const [south, west, north, east] = bbox;
  const box = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:90];
(
  node["amenity"="pub"](${box});
  way["amenity"="pub"](${box});
  node["amenity"="bar"](${box});
  way["amenity"="bar"](${box});
);
out center tags;
`.trim();
}

async function fetchLondonBoroughs(boundaries, { targets, fromRaw }) {
  const rawDir = path.join(ROOT, "data", "osm");
  await mkdir(rawDir, { recursive: true });

  const featureByName = new Map(
    boundaries.features.map((f) => [f?.properties?.name, f]).filter(([n]) => typeof n === "string"),
  );
  const allowed = new Set(targets);

  const byBorough = {};
  const seen = new Set();
  const pubs = [];
  let needDelay = false;

  for (const boroughName of targets) {
    const feature = featureByName.get(boroughName);
    if (!feature) {
      console.error(`  unknown borough "${boroughName}" — not in ${path.relative(ROOT, LONDON_BOUNDARIES_PATH)}`);
      process.exit(1);
    }
    const [south, west, north, east] = featureBbox(feature);
    const padded = [
      south - LONDON_BBOX_PAD_DEG,
      west - LONDON_BBOX_PAD_DEG,
      north + LONDON_BBOX_PAD_DEG,
      east + LONDON_BBOX_PAD_DEG,
    ];
    const rawPath = path.join(rawDir, `${boroughName.replace(/\s+/g, "_").toLowerCase()}_osm_raw.json`);

    let raw;
    if (fromRaw) {
      if (!(await fileExists(rawPath))) {
        throw new Error(`--from-raw requested but missing ${path.relative(ROOT, rawPath)}`);
      }
      raw = JSON.parse(await readFile(rawPath, "utf8"));
      console.log(`normalizing ${boroughName} from existing raw …`);
    } else {
      if (needDelay) {
        console.log(`  waiting ${INTER_CITY_DELAY_MS}ms before next borough (Overpass etiquette)…`);
        await sleep(INTER_CITY_DELAY_MS);
      }
      console.log(`fetching ${boroughName} bbox=${padded.map((n) => n.toFixed(4)).join(",")} …`);
      raw = await fetchOverpass(buildLondonOverpassQuery(padded));
      await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
      needDelay = true;
    }

    const elements = Array.isArray(raw?.elements) ? raw.elements : [];
    let kept = 0;
    for (const element of elements) {
      const pub = normalizeOsmPubElement(element, { fallbackCity: boroughName });
      if (!pub) continue;
      // A bbox overlaps neighbouring boroughs; the polygon does not. Only keep a
      // pub whose point lands inside one of the TARGET borough polygons, and
      // stamp that borough as its own (never the bbox's borough — a pub near the
      // Kingston/Sutton line is classified by geometry, not by which query found it).
      const borough = boroughNameForPoint(pub.lat, pub.lng, boundaries, allowed);
      if (!borough) continue;
      if (seen.has(pub.osmId)) continue; // padded bboxes overlap; dedupe by OSM id
      seen.add(pub.osmId);
      pubs.push({ ...pub, primary_borough: borough });
      byBorough[borough] = (byBorough[borough] ?? 0) + 1;
      kept += 1;
    }
    console.log(`  ${boroughName}: ${elements.length} elements → ${kept} pubs inside polygon`);
  }

  pubs.sort(
    (a, b) =>
      a.lat - b.lat || a.lng - b.lng || a.name.localeCompare(b.name) || a.osmId.localeCompare(b.osmId),
  );

  const seed = {
    source: "OpenStreetMap Overpass",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    fetchedAt: new Date().toISOString(),
    classifier: "london-borough-point-v1",
    taxonomy: ["amenity=pub", "amenity=bar"],
    boroughs: targets,
    count: pubs.length,
    byBorough,
    pubs,
  };
  await writeFile(LONDON_OSM_SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, LONDON_OSM_SEED_PATH)} (${pubs.length} pubs)`);
  console.log("by borough:", byBorough);
  return seed;
}

/**
 * @returns {Promise<"fetched" | "from-raw" | "skipped" | "promoted">}
 */
async function fetchCity(city, { fromRaw = false, skipIfPresent = false } = {}) {
  const outDir = path.join(ROOT, "data", "cities", city.id);
  await mkdir(outDir, { recursive: true });
  const rawPath = path.join(outDir, "osm_pubs_raw.json");
  const normPath = path.join(outDir, "osm_pubs.json");

  if (city.promoteFromUkBase) {
    console.log(`promoting ${city.id} out of the UK base snapshot …`);
    const pack = await promoteCityFromUkBase(city);
    await writeFile(normPath, `${JSON.stringify(pack, null, 2)}\n`);
    console.log(
      `  wrote ${path.relative(ROOT, normPath)} (${pack.count} pubs` +
        (pack.droppedDuplicateObjects.length > 0
          ? `, ${pack.droppedDuplicateObjects.length} duplicate OSM object(s) collapsed`
          : "") +
        (pack.droppedOutsideBaseLayer > 0
          ? `, ${pack.droppedOutsideBaseLayer} not in the base layer`
          : "") +
        ")",
    );
    for (const drop of pack.droppedDuplicateObjects) {
      console.log(`    collapsed ${drop.osmId} "${drop.name}" into ${drop.keptAs}`);
    }
    return "promoted";
  }

  const rawExists = await fileExists(rawPath);

  if (skipIfPresent && rawExists) {
    console.log(`skip ${city.id} (raw already present; use without --skip-if-present to refresh)`);
    if (!(await fileExists(normPath))) {
      const raw = JSON.parse(await readFile(rawPath, "utf8"));
      await writeNormalized(city, raw, null, normPath);
    }
    return "skipped";
  }

  if (fromRaw) {
    if (!rawExists) {
      throw new Error(`--from-raw requested but missing ${path.relative(ROOT, rawPath)}`);
    }
    console.log(`normalizing ${city.id} from existing raw …`);
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    await writeNormalized(city, raw, null, normPath);
    return "from-raw";
  }

  const query = buildOverpassQuery(city.bbox);
  console.log(`fetching ${city.id} bbox=${city.bbox.join(",")} …`);
  const raw = await fetchOverpass(query);
  await writeNormalized(city, raw, rawPath, normPath);
  return "fetched";
}

async function main() {
  const { city: cityArg, skipIfPresent, fromRaw, london } = parseArgs(process.argv.slice(2));

  if (london) {
    const boundaries = JSON.parse(await readFile(LONDON_BOUNDARIES_PATH, "utf8"));
    await fetchLondonBoroughs(boundaries, { targets: LONDON_TARGET_BOROUGHS, fromRaw });
    return;
  }

  const targets = cityArg
    ? [CITIES[cityArg]].filter(Boolean)
    : Object.values(CITIES).filter((c) => c.enabled);

  if (cityArg && !CITIES[cityArg]) {
    console.error(`Unknown city "${cityArg}". Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    console.error("No cities to fetch.");
    process.exit(1);
  }

  let needDelay = false;
  for (const city of targets) {
    if (needDelay) {
      console.log(`  waiting ${INTER_CITY_DELAY_MS}ms before next city (Overpass etiquette)…`);
      await sleep(INTER_CITY_DELAY_MS);
    }
    const result = await fetchCity(city, { fromRaw, skipIfPresent });
    needDelay = result === "fetched";
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
