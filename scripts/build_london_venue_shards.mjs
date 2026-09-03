// Build the LONDON VENUE shards - the kind-tagged base layer of everywhere in
// Greater London a drinker or a laptop could sit - from the UK-wide OSM venue
// packs (data/osm/uk/uk_osm_venues_*.json).
//
// WHY A SECOND SHARD SET AND NOT THE PUB ONE. `public/data/uk_base/` is the
// country-wide amenity=pub layer, its row tuple ends in a curated venue id, and
// every reader of it draws a PUB. Putting a library into those shards would
// paint a library as a pub, and the 5 MiB whole-layer budget it is held to is
// sized for pubs alone. So this is a parallel dataset with its own directory,
// its own budgets and a KIND on every row.
//
// LONDON FIRST. The venue packs are UK-wide; this publishes only the Greater
// London window, because that is where the curated layer, the prices and the
// readers are. Widening it to the country is a later wave and needs the budgets
// re-measured, not raised.
//
// WHAT A ROW MAY SAY. Name, address, position and kind - the four things OSM
// stated. No price, no band, no opening claim, no curated ownership: those are
// questions about a pub, and this layer holds nine other kinds. A pub surface
// reads `uk_base`; nothing here reaches a price lane, a pint band or the Pint
// Index, and `isPubVenueKind` answers false for every non-pub kind in it.
//
// Run: node scripts/build_london_venue_shards.mjs   (`npm run build:london-venues`)
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publishStagedDirectory } from "./lib/atomicDirectoryPublish.mjs";
import { coveringStamp } from "./lib/coveringStamp.mjs";
import { cellBbox, cellIndexFor, cellKey } from "./lib/ukBaseGrid.mjs";
import { UK_VENUE_GROUPS } from "./lib/ukOsmVenueSeed.mjs";
import { GREATER_LONDON_BBOX } from "./fetch_uk_osm_venues.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const LONDON_VENUE_DIR_NAME = "london_venues";
export const LONDON_VENUE_SHARD_VERSION = 1;

const OUT_DIR = path.join(ROOT, "public", "data", LONDON_VENUE_DIR_NAME);

// A FINER grid than the pub layer's 0.25°. That layer's cell holds a few hundred
// pubs; the same cell over central London holds a few thousand
// pubs-plus-cafes-plus-libraries, and one came to 278 KB against a 150 KB
// per-viewport budget. The budget is a promise about one fetch, so the grid is
// what gives - splitting it is exactly what the guard asks for.
//
// 0.025° and not 0.0625°: a cell id carries as many decimals as its own step
// needs (`cellKeyDecimals`), and a step whose decimals the id cannot hold would
// collapse several cells onto one name and MERGE their rows. The origin matches
// the pub grid, so both layers' cell edges still line up.
export const LONDON_VENUE_GRID = {
  originLat: 49.75,
  originLon: -8.75,
  latStep: 0.025,
  lonStep: 0.025,
};

// The same ceilings the pub layer is held to, and for the same reasons: a cell
// is one viewport-triggered fetch, and a whole-layer ceiling means a refresh
// that doubles the dataset fails the build rather than quietly doubling what
// the repository and the cache carry.
const SHARD_BUDGET_BYTES = 150 * 1024;
const TOTAL_BUDGET_BYTES = 5 * 1024 * 1024;
const MANIFEST_BUDGET_BYTES = 64 * 1024;

function packPathFor(group) {
  return path.join(ROOT, "data", "osm", "uk", `uk_osm_venues_${group}.json`);
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

/** `node/123` → `n123`: the same compaction the pub shards use. */
function compactOsmRef(osmId) {
  const raw = String(osmId ?? "");
  if (raw.startsWith("node/")) return `n${raw.slice(5)}`;
  if (raw.startsWith("way/")) return `w${raw.slice(4)}`;
  if (raw.startsWith("relation/")) return `r${raw.slice(9)}`;
  return "";
}

export function inGreaterLondon(lat, lng) {
  const [south, west, north, east] = GREATER_LONDON_BBOX;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/**
 * The layer's own bbox in the order the manifest speaks: GeoJSON
 * [minLng, minLat, maxLng, maxLat], the same order every `shards[].bbox` in the
 * document carries. `GREATER_LONDON_BBOX` is lat-first and stays that way for
 * `inGreaterLondon`; a document that mixed the two orders would have a reader
 * intersect 51.28 as a longitude and match no shard at all.
 */
export function londonLayerBbox() {
  const [south, west, north, east] = GREATER_LONDON_BBOX;
  return [west, south, east, north];
}

function isRenderable(venue) {
  return Boolean(
    typeof venue?.name === "string" &&
      venue.name.trim().length > 0 &&
      typeof venue?.kind === "string" &&
      venue.kind.length > 0 &&
      Number.isFinite(venue?.lat) &&
      Number.isFinite(venue?.lng) &&
      compactOsmRef(venue?.osmId) !== "",
  );
}

/** One shard row: [osmRef, name, address, lat, lng, kind]. */
export function toVenueRow(venue) {
  return [
    compactOsmRef(venue.osmId),
    venue.name.trim(),
    typeof venue.address === "string" ? venue.address.trim() : "",
    round5(venue.lat),
    round5(venue.lng),
    venue.kind,
  ];
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  /** @type {Map<string, {latIndex: number, lonIndex: number, rows: unknown[][]}>} */
  const cells = new Map();
  const byKind = {};
  const seen = new Set();
  const packStamps = [];
  let dropped = 0;
  let read = 0;

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
      read += 1;
      if (!isRenderable(venue)) {
        dropped += 1;
        continue;
      }
      // The three packs are already OSM-id-unique among themselves, but a run
      // that rebuilt one pack alone could repeat a row here.
      if (seen.has(venue.osmId)) continue;
      seen.add(venue.osmId);
      byKind[venue.kind] = (byKind[venue.kind] ?? 0) + 1;
      const { latIndex, lonIndex } = cellIndexFor(venue.lat, venue.lng, LONDON_VENUE_GRID);
      const key = cellKey(latIndex, lonIndex, LONDON_VENUE_GRID);
      let cell = cells.get(key);
      if (!cell) {
        cell = { latIndex, lonIndex, rows: [] };
        cells.set(key, cell);
      }
      cell.rows.push(toVenueRow(venue));
    }
  }

  if (seen.size === 0) {
    throw new Error("No London venues in the packs - refresh them with `npm run fetch:uk-venues`.");
  }

  const fetchedAt = coveringStamp(packStamps);
  if (fetchedAt === null) {
    console.warn(
      "One of the venue packs carries no usable fetchedAt, so the layer publishes undated rather than " +
        "borrowing another pack's day.",
    );
  }

  await mkdir(path.dirname(OUT_DIR), { recursive: true });
  const stagedDir = await mkdtemp(
    path.join(path.dirname(OUT_DIR), `.${LONDON_VENUE_DIR_NAME}-stage-`),
  );

  try {
    const shards = [];
    const shardBytes = [];
    let totalBytes = 0;
    let fattest = { id: "", bytes: 0, count: 0 };

    for (const key of [...cells.keys()].sort()) {
      const cell = cells.get(key);
      cell.rows.sort(
        (a, b) => a[3] - b[3] || a[4] - b[4] || String(a[0]).localeCompare(String(b[0])),
      );
      const body = JSON.stringify({
        version: LONDON_VENUE_SHARD_VERSION,
        cell: key,
        venues: cell.rows,
      });
      const bytes = Buffer.byteLength(body);
      totalBytes += bytes;
      shardBytes.push(bytes);
      if (bytes > fattest.bytes) fattest = { id: key, bytes, count: cell.rows.length };
      if (bytes > SHARD_BUDGET_BYTES) {
        throw new Error(
          `Shard ${key} is ${formatBytes(bytes)} (${cell.rows.length} venues), over the ` +
            `${formatBytes(SHARD_BUDGET_BYTES)} per-viewport budget. Split the grid rather than raising it.`,
        );
      }
      await writeFile(path.join(stagedDir, `${key}.json`), body);
      shards.push({
        id: key,
        core: false,
        count: cell.rows.length,
        bbox: cellBbox(cell.latIndex, cell.lonIndex, LONDON_VENUE_GRID),
      });
    }

    const manifestBody = JSON.stringify({
      version: LONDON_VENUE_SHARD_VERSION,
      urlPrefix: `/data/${LONDON_VENUE_DIR_NAME}/`,
      grid: LONDON_VENUE_GRID,
      bbox: londonLayerBbox(),
      source: "OpenStreetMap Overpass",
      license: "ODbL",
      attribution: "© OpenStreetMap contributors",
      generatedFrom: { fetchedAt, count: seen.size },
      countsByKind: byKind,
      shards,
    });
    await writeFile(path.join(stagedDir, "manifest.json"), manifestBody);

    const publication = await publishStagedDirectory({
      stagedDir,
      targetDir: OUT_DIR,
      requiredFiles: ["manifest.json"],
      manifestBudgetBytes: MANIFEST_BUDGET_BYTES,
      totalBudgetBytes: TOTAL_BUDGET_BYTES,
      urlPrefix: `/data/${LONDON_VENUE_DIR_NAME}/`,
    });

    console.log(
      [
        `London venues → ${shards.length} shards in public/data/${LONDON_VENUE_DIR_NAME}/`,
        `  read (London window) . ${read}`,
        `  unusable (dropped) ... ${dropped}`,
        `  shipped .............. ${seen.size}`,
        ...Object.entries(byKind)
          .sort()
          .map(([kind, n]) => `    ${kind.padEnd(14)} ${n}`),
        `  manifest ............. ${formatBytes(publication.manifestBytes)}`,
        `  shards total ......... ${formatBytes(totalBytes)}`,
        `  fattest shard ........ ${fattest.id} - ${formatBytes(fattest.bytes)} (${fattest.count} venues)`,
        `  median shard ......... ${formatBytes(median(shardBytes))}`,
      ].join("\n"),
    );
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
