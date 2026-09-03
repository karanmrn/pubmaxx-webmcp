// Build the UK BASE-PUB shards the map streams per viewport, from the UK-wide
// OSM seed pack (data/osm/uk/uk_osm_pubs.json — see its README).
//
// WHY SHARDS AND NOT THE SLIM INDEX. The slim index (venues_slim*.json) is the
// CURATED experience: priced pins, search, filters, crawl routing. Folding
// the country-wide unpriced OSM pack into it would impose that whole payload on
// every phone and leak unverified pubs into curated product systems. So the
// base layer is a separate dataset with its own delivery: a compact manifest
// plus one file per grid cell, fetched only for cells the camera is over and
// only once the camera is zoomed in far enough for individual pins to exist
// (lib/ukBasePubs.ts owns the client half; UK_BASE_MIN_ZOOM owns the gate).
//
// DEDUPE. A matched pub stays in its shard with the owning curated venue id.
// The client suppresses it only while that exact curated venue is drawable.
//
// Ownership is answered twice, in this order. First the `curatedRef` the UK
// seed pack carries, which is the only key that can reconcile datasets with no
// OSM ids at all (curated London) or two OSM objects for one pub. Then, for a
// city pack PROMOTED out of this same base layer, the pub's own OSM id — an
// exact identity, and the one that lets a new area ship without refetching the
// country to re-annotate it. Nothing is removed from the base layer either
// way, so a `venue-uk-…` id stays resolvable.
//
// PRICES. None. OSM is not a price source (data/osm/uk/README.md). A base pub
// has no price by construction; it is the canvas the community prices in.
//
// Run: node scripts/build_uk_base_shards.mjs   (wired into `npm run prebuild`)

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHARD_DIR_NAME,
  UK_BASE_GRID,
  UK_BASE_SHARD_VERSION,
  cellIndexFor,
  cellKey,
  cellBbox,
} from "./lib/ukBaseGrid.mjs";
import { publishStagedDirectory } from "./lib/atomicDirectoryPublish.mjs";
import { cityVenueIdForPub } from "./build_city_slim_index.mjs";
import { outerLondonOwnerForPub } from "../lib/outerLondonOwnership.mjs";
import { CITIES } from "./fetch_city_osm_pubs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACK_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const OUT_DIR = path.join(ROOT, "public", "data", SHARD_DIR_NAME);
const LONDON_SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const OUTER_LONDON_PATH = path.join(ROOT, "data", "osm", "outer_london_osm_pubs.json");

// Per-shard ceiling. A cell is one viewport-triggered fetch, so a fat cell is
// felt directly as a stall while panning. The densest cell today (central
// London) sits well under this; a refresh that crosses it means the grid needs
// splitting, not a bigger allowance.
const SHARD_BUDGET_BYTES = 150 * 1024;
// Whole-layer ceiling, so a refresh that doubles the dataset fails CI rather
// than quietly doubling the repository and the cache footprint.
const TOTAL_BUDGET_BYTES = 5 * 1024 * 1024;
// The manifest is fetched in full the first time the camera crosses the zoom
// gate, so it is a real (if deferred) payload line and gets its own budget.
const MANIFEST_BUDGET_BYTES = 64 * 1024;

/** OSM "node/123" → the compact "n123" the shard rows carry. */
export function compactOsmRef(osmId) {
  const [type, id] = String(osmId ?? "").split("/");
  if (!id) return "";
  if (type === "node") return `n${id}`;
  if (type === "way") return `w${id}`;
  if (type === "relation") return `r${id}`;
  return "";
}

/** 5 dp ≈ 1.1 m — finer than the building the pub sits in, and 6 bytes shorter. */
function round5(value) {
  return Math.round(value * 1e5) / 1e5;
}

function isRenderablePub(pub) {
  return (
    typeof pub?.name === "string" &&
    pub.name.trim().length > 0 &&
    Number.isFinite(pub?.lat) &&
    Number.isFinite(pub?.lng) &&
    compactOsmRef(pub?.osmId) !== ""
  );
}

/** One shard row: [osmRef, name, address, lat, lng, curatedVenueId]. */
function toRow(pub, curatedVenueId) {
  return [
    compactOsmRef(pub.osmId),
    pub.name.trim(),
    typeof pub.address === "string" ? pub.address.trim() : "",
    round5(pub.lat),
    round5(pub.lng),
    curatedVenueId,
  ];
}

function ownerKey(source, id) {
  return `${source}\0${id}`;
}

async function loadCuratedVenueOwners() {
  const owners = new Map();
  /** OSM id → curated venue id, for city packs cut out of this base layer. */
  const ownersByOsmId = new Map();
  const londonSlim = JSON.parse(await readFile(LONDON_SLIM_PATH, "utf8"));
  const londonVenues = Array.isArray(londonSlim)
    ? londonSlim
    : Array.isArray(londonSlim?.rows)
      ? londonSlim.rows
      : [];

  for (const venue of londonVenues) {
    owners.set(ownerKey("curated-london-slim", venue.id), venue.id);
  }

  const outerPack = JSON.parse(await readFile(OUTER_LONDON_PATH, "utf8"));
  for (const pub of Array.isArray(outerPack?.pubs) ? outerPack.pubs : []) {
    const venueId = outerLondonOwnerForPub(pub, londonVenues) ?? "";
    if (venueId) {
      owners.set(ownerKey("outer-london-osm-seed", pub.osmId), venueId);
    }
  }

  for (const [cityId, city] of Object.entries(CITIES)) {
    if (!city.enabled) continue;
    const cityPackPath = path.join(ROOT, "data", "cities", cityId, "osm_pubs.json");
    const citySlimPath = path.join(
      ROOT,
      "public",
      "data",
      "cities",
      cityId,
      "venues_slim.json",
    );
    const [cityPack, citySlim] = await Promise.all([
      readFile(cityPackPath, "utf8").then(JSON.parse),
      readFile(citySlimPath, "utf8").then(JSON.parse),
    ]);
    const cityRows = Array.isArray(citySlim)
      ? citySlim
      : Array.isArray(citySlim?.rows)
        ? citySlim.rows
        : [];
    const cityVenueIds = new Set(cityRows.map((venue) => venue.id));
    for (const pub of Array.isArray(cityPack?.pubs) ? cityPack.pubs : []) {
      const venueId = cityVenueIdForPub(city, pub);
      if (cityVenueIds.has(venueId)) {
        owners.set(ownerKey(`city:${cityId}`, pub.osmId), venueId);
        ownersByOsmId.set(String(pub.osmId), venueId);
      }
    }
  }

  return { owners, ownersByOsmId };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  const pubs = Array.isArray(pack?.pubs) ? pack.pubs : [];
  if (pubs.length === 0) {
    throw new Error(`${PACK_PATH} has no pubs — refresh it with npm run fetch:uk-pubs`);
  }

  const { owners: curatedVenueOwners, ownersByOsmId } =
    await loadCuratedVenueOwners();
  const renderable = pubs.filter(isRenderablePub);
  const skipped = pubs.length - renderable.length;
  let matchedOwners = 0;

  /** @type {Map<string, {latIndex: number, lonIndex: number, rows: unknown[][]}>} */
  const cells = new Map();
  for (const pub of renderable) {
    const { latIndex, lonIndex } = cellIndexFor(pub.lat, pub.lng);
    const key = cellKey(latIndex, lonIndex);
    let cell = cells.get(key);
    if (!cell) {
      cell = { latIndex, lonIndex, rows: [] };
      cells.set(key, cell);
    }
    const source = pub.curatedRef?.source;
    const id = pub.curatedRef?.id;
    const curatedVenueId =
      (typeof source === "string" && typeof id === "string"
        ? curatedVenueOwners.get(ownerKey(source, id))
        : undefined) ??
      ownersByOsmId.get(String(pub.osmId)) ??
      "";
    if (curatedVenueId) matchedOwners += 1;
    cell.rows.push(toRow(pub, curatedVenueId));
  }

  await mkdir(path.dirname(OUT_DIR), { recursive: true });
  const stagedDir = await mkdtemp(
    path.join(path.dirname(OUT_DIR), `.${SHARD_DIR_NAME}-stage-`),
  );

  try {
    const shards = [];
    const shardBytes = [];
    let totalBytes = 0;
    let fattest = { id: "", bytes: 0, count: 0 };

    for (const key of [...cells.keys()].sort()) {
      const cell = cells.get(key);
      cell.rows.sort((a, b) => a[3] - b[3] || a[4] - b[4] || String(a[0]).localeCompare(String(b[0])));
      const body = JSON.stringify({
        version: UK_BASE_SHARD_VERSION,
        cell: key,
        pubs: cell.rows,
      });
      const bytes = Buffer.byteLength(body);
      totalBytes += bytes;
      shardBytes.push(bytes);
      if (bytes > fattest.bytes) fattest = { id: key, bytes, count: cell.rows.length };
      if (bytes > SHARD_BUDGET_BYTES) {
        throw new Error(
          `Shard ${key} is ${formatBytes(bytes)} (${cell.rows.length} pubs), over the ` +
            `${formatBytes(SHARD_BUDGET_BYTES)} per-viewport budget. Split UK_BASE_GRID rather than raising it.`,
        );
      }
      await writeFile(path.join(stagedDir, `${key}.json`), body);
      shards.push({
        id: key,
        core: false,
        count: cell.rows.length,
        bbox: cellBbox(cell.latIndex, cell.lonIndex),
      });
    }

    const manifestBody = JSON.stringify({
      version: UK_BASE_SHARD_VERSION,
      urlPrefix: `/data/${SHARD_DIR_NAME}/`,
      grid: UK_BASE_GRID,
      generatedFrom: { fetchedAt: pack.fetchedAt ?? null, count: pack.count ?? pubs.length },
      shards,
    });
    await writeFile(path.join(stagedDir, "manifest.json"), manifestBody);

    const publication = await publishStagedDirectory({
      stagedDir,
      targetDir: OUT_DIR,
      requiredFiles: ["manifest.json"],
      manifestBudgetBytes: MANIFEST_BUDGET_BYTES,
      totalBudgetBytes: TOTAL_BUDGET_BYTES,
    });

    console.log(
      [
        `UK base pubs → ${shards.length} shards in public/data/${SHARD_DIR_NAME}/`,
        `  pack ................ ${pubs.length} pubs`,
        `  curated owners ...... ${matchedOwners}`,
        `  unusable (dropped) .. ${skipped}`,
        `  shipped ............. ${renderable.length}`,
        `  manifest ............ ${formatBytes(publication.manifestBytes)} (deferred until the zoom gate)`,
        `  shards total ........ ${formatBytes(totalBytes)}`,
        `  fattest shard ....... ${fattest.id} — ${formatBytes(fattest.bytes)} (${fattest.count} pubs)`,
        `  median shard ........ ${formatBytes(median(shardBytes))}`,
      ].join("\n"),
    );
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
