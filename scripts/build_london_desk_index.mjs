// Build the London desk pack from the UK OSM venue packs. The kind-tagged
// shards under public/data/london_venues/packs strip amenity tags, and desk
// mode cannot rank honestly without them. This file keeps wifi, laptop and
// opening_hours for cafe / coworking / library / hotel_lounge plus pubs that
// state wifi.
//
// It publishes to its OWN directory. The shard publisher sweeps the shard
// directory's root of every *.json that is not manifest.json, so a desk pack
// written beside the shards is deleted by the next build:london-venues.
//
// Run: node scripts/build_london_desk_index.mjs   (`npm run build:london-desks`)
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coveringStamp } from "./lib/coveringStamp.mjs";
import { UK_VENUE_GROUPS } from "./lib/ukOsmVenueSeed.mjs";
import { inGreaterLondon } from "./build_london_venue_shards.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const DESK_PACK_DIR_NAME = "london_desks";
export const DESK_PACK_FILE_NAME = "desks.json";
const OUT_PATH = path.join(ROOT, "public", "data", DESK_PACK_DIR_NAME, DESK_PACK_FILE_NAME);
const DESK_PACK_VERSION = 1;
const DESK_KINDS = new Set(["cafe", "coworking", "library", "hotel_lounge"]);
const BUDGET_BYTES = 2.5 * 1024 * 1024;

function packPathFor(group) {
  return path.join(ROOT, "data", "osm", "uk", `uk_osm_venues_${group}.json`);
}

function compactOsmRef(osmId) {
  const raw = String(osmId ?? "");
  if (raw.startsWith("node/")) return `n${raw.slice(5)}`;
  if (raw.startsWith("way/")) return `w${raw.slice(4)}`;
  if (raw.startsWith("relation/")) return `r${raw.slice(9)}`;
  return "";
}

function wifiToken(value) {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (token === "yes" || token === "wlan" || token === "wired" || token === "terminal") {
    return "yes";
  }
  if (token === "no") return "no";
  return "unknown";
}

function isDeskEligible(venue) {
  if (DESK_KINDS.has(venue?.kind)) return true;
  return venue?.kind === "pub" && wifiToken(venue?.internetAccess) === "yes";
}

function laptopRaw(venue) {
  for (const value of [venue?.laptop, venue?.laptopFriendly]) {
    if (typeof value === "string" && value.trim().toLowerCase() === "yes") return "yes";
  }
  return "";
}

function hoursRaw(venue) {
  return typeof venue?.openingHours === "string" ? venue.openingHours.trim() : "";
}

export function toDeskRow(venue) {
  return [
    compactOsmRef(venue.osmId),
    String(venue.name).trim(),
    typeof venue.address === "string" ? venue.address.trim() : "",
    Math.round(Number(venue.lat) * 1e5) / 1e5,
    Math.round(Number(venue.lng) * 1e5) / 1e5,
    venue.kind,
    typeof venue.internetAccess === "string" ? venue.internetAccess.trim() : "",
    laptopRaw(venue),
    hoursRaw(venue),
  ];
}

function isRenderable(venue) {
  return Boolean(
    typeof venue?.name === "string"
      && venue.name.trim().length > 0
      && typeof venue?.kind === "string"
      && Number.isFinite(venue?.lat)
      && Number.isFinite(venue?.lng)
      && compactOsmRef(venue?.osmId) !== "",
  );
}

async function main() {
  const seen = new Set();
  const rows = [];
  const packStamps = [];
  const byKind = {};

  for (const group of UK_VENUE_GROUPS) {
    const packPath = packPathFor(group);
    let pack;
    try {
      pack = JSON.parse(await readFile(packPath, "utf8"));
    } catch {
      throw new Error(
        `${path.relative(ROOT, packPath)} is missing - build it with \`npm run fetch:uk-venues\`.`,
      );
    }
    packStamps.push(pack?.fetchedAt);
    for (const venue of Array.isArray(pack?.venues) ? pack.venues : []) {
      if (!inGreaterLondon(Number(venue?.lat), Number(venue?.lng))) continue;
      if (!isRenderable(venue) || !isDeskEligible(venue)) continue;
      if (seen.has(venue.osmId)) continue;
      seen.add(venue.osmId);
      byKind[venue.kind] = (byKind[venue.kind] ?? 0) + 1;
      rows.push(toDeskRow(venue));
    }
  }

  if (rows.length === 0) {
    throw new Error("No London desks in the packs - refresh them with `npm run fetch:uk-venues`.");
  }

  rows.sort((a, b) => a[3] - b[3] || a[4] - b[4] || String(a[0]).localeCompare(String(b[0])));

  const body = {
    version: DESK_PACK_VERSION,
    source: "osm",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    observedAt: coveringStamp(packStamps),
    count: rows.length,
    countsByKind: byKind,
    venues: rows,
  };
  const json = `${JSON.stringify(body)}\n`;
  const bytes = Buffer.byteLength(json);
  if (bytes > BUDGET_BYTES) {
    throw new Error(`Desk pack ${bytes} bytes exceeds ${BUDGET_BYTES} budget.`);
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, json);
  console.log(
    `Wrote ${rows.length} desks (${(bytes / 1024).toFixed(1)} KB) to ${path.relative(ROOT, OUT_PATH)}`,
  );
  console.log(`kinds ${JSON.stringify(byKind)}`);
  console.log(`observedAt ${body.observedAt ?? "none"}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
