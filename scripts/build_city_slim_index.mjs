#!/usr/bin/env node
// Build per-city slim venue indexes from OSM seed packs:
//   data/cities/{city}/osm_pubs.json
// → public/data/cities/{city}/venues_slim.json
//
// Venue shape matches London slim venues (lib/venuesSlim.ts) so the map can
// load city packs the same way. IDs are city-salted FNV-1a hashes so they
// never collide with London `venue-…` ids:
//   venue-{shortPrefix}-{fnv36}   e.g. venue-mcr-1ufn31x
//
// cheapestPrice is always null — OSM has no prices; Pint Drops fill them later.
//
// Usage:
//   node scripts/build_city_slim_index.mjs --city=manchester
//   node scripts/build_city_slim_index.mjs
//
// Each city also gets an eager core shard and manifest beside the canonical
// venues_slim.json so the browser never probes a missing manifest before its
// first map paint.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CITIES } from "./fetch_city_osm_pubs.mjs";
import {
  computeBbox,
  CORE_FILE,
  buildShardPayload,
  DATA_REVISION,
  MANIFEST_FILE,
  SHARD_VERSION,
} from "./lib/slimShards.mjs";
import { cityVenueIdForPub as sharedCityVenueIdForPub } from "../lib/cityVenueId.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let city = null;
  for (const arg of argv) {
    if (arg.startsWith("--city=")) city = arg.slice("--city=".length).trim().toLowerCase();
  }
  return { city };
}

export function cityVenueIdForPub(city, pub) {
  return sharedCityVenueIdForPub(city.id, pub);
}

function inBbox(lat, lng, bbox) {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function truthyOutdoor(pub) {
  return pub.outdoorSeating === true;
}

/**
 * The area a pin prints. A pack covering one town labels every pin with that
 * town; a pack covering a stretch of coast would then put "Llandudno" on a
 * Conwy pub, so the pub's OWN stated locality wins wherever OSM records one.
 * The pack's name is the fallback, never a guess from the postcode.
 */
export function areaLabelForPub(pub, displayName) {
  const locality = String(pub?.locality ?? "").trim();
  return locality || displayName;
}

function buildFilterHints(pub, displayName) {
  const searchParts = new Set(
    [pub.name, pub.address, displayName, pub.locality, pub.cuisine, pub.brewery]
      .map((part) => String(part ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    searchText: Array.from(searchParts).join(" "),
    amenities: {
      food: Boolean(pub.cuisine),
      cocktails: false,
      beerGarden: truthyOutdoor(pub),
      liveSports: false,
      nonAlcoholic: false,
    },
    curation: {
      nearWater: false,
      hasStory: Boolean(pub.wikidata || pub.wikipedia),
    },
    canonical: false,
  };
}

/**
 * @param {{ id: string, displayName: string, shortPrefix: string, bbox: [number, number, number, number] }} city
 * @param {{ city?: string, pubs: any[] }} pack
 */
export function buildCitySlim(city, pack) {
  const pubs = Array.isArray(pack.pubs) ? pack.pubs : [];
  const slim = [];
  const seenIds = new Set();
  let droppedOob = 0;
  let droppedDup = 0;

  for (const pub of pubs) {
    const lat = Number(pub.lat);
    const lng = Number(pub.lng);
    const name = String(pub.name ?? "").trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!inBbox(lat, lng, city.bbox)) {
      droppedOob += 1;
      continue;
    }

    const id = cityVenueIdForPub(city, { name, address: pub.address, lat, lng });
    if (seenIds.has(id)) {
      droppedDup += 1;
      continue;
    }
    seenIds.add(id);

    slim.push({
      id,
      name,
      lat,
      lng,
      cheapestPrice: null,
      borough: areaLabelForPub(pub, city.displayName),
      filterHints: buildFilterHints(pub, city.displayName),
    });
  }

  return { slim, droppedOob, droppedDup };
}

async function buildCity(city) {
  const packPath = path.join(ROOT, "data", "cities", city.id, "osm_pubs.json");
  const outDir = path.join(ROOT, "public", "data", "cities", city.id);
  const outPath = path.join(outDir, "venues_slim.json");

  try {
    await access(packPath);
  } catch {
    throw new Error(`Missing OSM pack: ${path.relative(ROOT, packPath)} — run fetch:city-pubs first`);
  }

  const pack = JSON.parse(await readFile(packPath, "utf8"));
  const { slim, droppedOob, droppedDup } = buildCitySlim(city, pack);

  await mkdir(outDir, { recursive: true });
  const text = JSON.stringify(buildShardPayload(slim));
  await writeFile(outPath, text);
  await writeFile(path.join(outDir, CORE_FILE), JSON.stringify(buildShardPayload(slim)));
  await writeFile(
    path.join(outDir, MANIFEST_FILE),
    JSON.stringify({
      version: SHARD_VERSION,
      revision: DATA_REVISION,
      shards: [
        {
          id: "core",
          core: true,
          url: `/data/cities/${city.id}/${CORE_FILE}`,
          count: slim.length,
          bbox: computeBbox(slim),
        },
      ],
    }),
  );

  const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
  console.log(
    `${city.id}: ${slim.length} venues → ${path.relative(ROOT, outPath)} (${kb} KB)` +
      (droppedOob || droppedDup
        ? `  [dropped oob=${droppedOob} dup=${droppedDup}]`
        : ""),
  );
  return slim.length;
}

async function main() {
  const { city: cityArg } = parseArgs(process.argv.slice(2));
  const targets = cityArg
    ? [CITIES[cityArg]].filter(Boolean)
    : Object.values(CITIES).filter((c) => c.enabled);

  if (cityArg && !CITIES[cityArg]) {
    console.error(`Unknown city "${cityArg}". Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    console.error("No cities to build.");
    process.exit(1);
  }

  for (const city of targets) {
    await buildCity(city);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
