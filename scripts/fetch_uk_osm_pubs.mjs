#!/usr/bin/env node
// Fetch every amenity=pub node/way in the United Kingdom (Great Britain +
// Northern Ireland) from Overpass, one grid chunk at a time, then write:
//   data/osm/uk/raw/chunk_<lat>_<lon>.json  (raw Overpass response per chunk)
//   data/osm/uk/chunks.json                 (grid + per-chunk manifest)
//   data/osm/uk/uk_osm_pubs.json            (normalized seed pack, ODbL)
//   data/osm/uk/dedupe_report.json          (overlap vs curated/city datasets)
//
// Usage:
//   npm run fetch:uk-pubs                       # full pull, resumes by default
//   npm run fetch:uk-pubs -- --skip-if-present # explicit resume alias
//   npm run fetch:uk-pubs -- --refresh          # refetch every chunk
//   npm run fetch:uk-pubs -- --chunk=lat50.80_lon-0.70  # one grid cell (--list for ids)
//   npm run fetch:uk-pubs -- --from-raw         # re-normalize, no network
//   npm run fetch:uk-pubs -- --list             # print the grid and exit
//
// The country-wide query is split into a lat/lon grid so no single request has
// to hold GB in one bbox, and every chunk's raw response is kept on disk so an
// interrupted pull resumes where it stopped. Overpass etiquette: one request at
// a time, a delay between chunks, exponential backoff on 429/502/503/504.
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { access, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMIT_SIZE_LIMIT_BYTES,
  INTER_CHUNK_DELAY_MS,
  INTER_CHUNK_DELAY_STALE_MS,
  MAX_SOURCE_AGE_MS,
  QUERY_TIMEOUT_S,
  fetchOverpass,
  formatMb,
  isFreshOverpassSnapshot,
  parseOverpassRawText,
  sleep,
  writeCompact,
  writePretty,
} from "./lib/overpassClient.mjs";
import {
  DEFAULT_LAT_STEP,
  DEFAULT_LON_STEP,
  UK_BBOX,
  UK_TAXONOMY,
  annotateCuratedOverlap,
  buildGrid,
  buildUkOverpassQuery,
  chunkFileName,
  normalizeElements,
} from "./lib/ukOsmSeed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const UK_DIR = path.join(ROOT, "data", "osm", "uk");
const RAW_DIR = path.join(UK_DIR, "raw");
const MANIFEST_PATH = path.join(UK_DIR, "chunks.json");
const DATASET_PATH = path.join(UK_DIR, "uk_osm_pubs.json");
const DEDUPE_REPORT_PATH = path.join(UK_DIR, "dedupe_report.json");

const CURATED_LONDON_SLIM = path.join(ROOT, "public", "data", "venues_slim.json");
const OUTER_LONDON_SEED = path.join(ROOT, "data", "osm", "outer_london_osm_pubs.json");
const CITIES_DIR = path.join(ROOT, "data", "cities");

// The Overpass client contract (endpoints, retries, backoff, staleness, atomic
// writes) is shared with the venue fetcher - see scripts/lib/overpassClient.mjs.
// Re-exported here because __tests__/ukOsmSeedPacks.test.ts pins them through
// this module's public surface.
export { isFreshOverpassSnapshot, parseOverpassRawText };

function parseArgs(argv) {
  const options = {
    fromRaw: false,
    refresh: false,
    list: false,
    chunk: null,
    allowStale: false,
  };
  for (const arg of argv) {
    if (arg === "--from-raw") options.fromRaw = true;
    else if (arg === "--skip-if-present") {
      // Raw chunk skipping is already the default. Accept city-fetcher syntax
      // so existing data-pipeline commands can switch to the UK builder.
      continue;
    }
    else if (arg === "--refresh") options.refresh = true;
    else if (arg === "--allow-stale") options.allowStale = true;
    else if (arg === "--list") options.list = true;
    else if (arg.startsWith("--chunk=")) options.chunk = arg.slice("--chunk=".length).trim();
    else {
      console.error(`Unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  return options;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchChunk(chunk, { refresh, allowStale }) {
  const rawPath = path.join(RAW_DIR, chunkFileName(chunk));
  if (!refresh) {
    const raw = await readChunkRaw(chunk);
    if (raw && (isFreshOverpassSnapshot(raw) || allowStale)) {
      if (!isFreshOverpassSnapshot(raw) && allowStale) {
        console.warn(
          `skip ${chunk.id} (stale raw kept via --allow-stale, ${raw.elements.length} elements)`,
        );
      } else {
        console.log(`skip ${chunk.id} (raw present, ${raw.elements.length} elements) - use --refresh to refetch`);
      }
      return { raw, fetched: false };
    }
    if (await fileExists(rawPath)) {
      const reason = raw
        ? `snapshot is older than ${MAX_SOURCE_AGE_MS / 3_600_000} hours`
        : "raw is truncated, malformed, or contains an Overpass remark";
      console.warn(`refetch ${chunk.id} (cached ${reason})`);
    }
  }
  console.log(`fetching ${chunk.id} bbox=${chunk.bbox.join(",")} …`);
  const raw = await fetchOverpass(buildUkOverpassQuery(chunk.bbox, { timeout: QUERY_TIMEOUT_S }), {
    allowStale,
  });
  await writeCompact(rawPath, raw);
  const count = Array.isArray(raw?.elements) ? raw.elements.length : 0;
  console.log(`  wrote ${path.relative(ROOT, rawPath)} (${count} elements)`);
  return { raw, fetched: true };
}

async function readChunkRaw(chunk) {
  const rawPath = path.join(RAW_DIR, chunkFileName(chunk));
  if (!(await fileExists(rawPath))) return null;
  return parseOverpassRawText(await readFile(rawPath, "utf8"));
}

// --- curated / already-seeded datasets ---------------------------------------

async function loadCuratedEntries() {
  const entries = [];

  // Curated London (the 900+ priced venues plus their canonical siblings). No
  // OSM ids at all, so these can only ever match on name + distance.
  if (await fileExists(CURATED_LONDON_SLIM)) {
    const payload = JSON.parse(await readFile(CURATED_LONDON_SLIM, "utf8"));
    const rows = Array.isArray(payload) ? payload : payload?.rows;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row?.name !== "string") continue;
      entries.push({
        source: "curated-london-slim",
        id: String(row.id),
        name: row.name,
        lat: Number(row.lat),
        lng: Number(row.lng),
        osmId: null,
      });
    }
  }

  // Outer London OSM seed pack (already folded into the London pipeline).
  if (await fileExists(OUTER_LONDON_SEED)) {
    const seed = JSON.parse(await readFile(OUTER_LONDON_SEED, "utf8"));
    for (const pub of Array.isArray(seed?.pubs) ? seed.pubs : []) {
      entries.push({
        source: "outer-london-osm-seed",
        id: String(pub.osmId),
        name: String(pub.name ?? ""),
        lat: Number(pub.lat),
        lng: Number(pub.lng),
        osmId: String(pub.osmId),
      });
    }
  }

  // Per-city seed packs (Manchester, Liverpool, …).
  if (await fileExists(CITIES_DIR)) {
    const cityDirs = (await readdir(CITIES_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const city of cityDirs) {
      const packPath = path.join(CITIES_DIR, city, "osm_pubs.json");
      if (!(await fileExists(packPath))) continue;
      const pack = JSON.parse(await readFile(packPath, "utf8"));
      for (const pub of Array.isArray(pack?.pubs) ? pack.pubs : []) {
        entries.push({
          source: `city:${city}`,
          id: String(pub.osmId),
          name: String(pub.name ?? ""),
          lat: Number(pub.lat),
          lng: Number(pub.lng),
          osmId: String(pub.osmId),
        });
      }
    }
  }

  return entries;
}

async function dirSizeBytes(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSizeBytes(full);
    else total += (await stat(full)).size;
  }
  return total;
}

// --- main --------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const grid = buildGrid();

  if (options.list) {
    for (const chunk of grid) console.log(`${chunk.id}\t${chunk.bbox.join(",")}`);
    console.log(`${grid.length} chunks (${DEFAULT_LAT_STEP}° × ${DEFAULT_LON_STEP}°)`);
    return;
  }

  const targets = options.chunk ? grid.filter((chunk) => chunk.id === options.chunk) : grid;
  if (options.chunk && targets.length === 0) {
    console.error(`Unknown chunk "${options.chunk}". Run with --list to see the grid.`);
    process.exit(1);
  }

  await mkdir(RAW_DIR, { recursive: true });

  const chunkStats = [];
  const allElements = [];
  const failures = [];
  let needDelay = false;

  for (const chunk of targets) {
    let raw;
    if (options.fromRaw) {
      raw = await readChunkRaw(chunk);
      if (!raw) {
        console.log(`skip ${chunk.id} (no raw file; --from-raw does not fetch)`);
        continue;
      }
    } else {
      if (needDelay) {
        const delayMs = options.allowStale ? INTER_CHUNK_DELAY_STALE_MS : INTER_CHUNK_DELAY_MS;
        console.log(`  waiting ${delayMs}ms before next chunk (Overpass etiquette)…`);
        await sleep(delayMs);
      }
      // One chunk exhausting its retries must not throw away the other 131:
      // the raw files already on disk are the resume state, so record the
      // failure, keep going, and let a rerun pick the chunk up.
      let result;
      try {
        result = await fetchChunk(chunk, {
          refresh: options.refresh,
          allowStale: options.allowStale,
        });
      } catch (err) {
        failures.push({ id: chunk.id, error: err instanceof Error ? err.message : String(err) });
        console.error(`  FAILED ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`);
        needDelay = true;
        continue;
      }
      raw = result.raw;
      needDelay = result.fetched;
    }
    const elements = Array.isArray(raw?.elements) ? raw.elements : [];
    allElements.push(...elements);
    chunkStats.push({
      id: chunk.id,
      bbox: chunk.bbox,
      elements: elements.length,
      timestamp: raw?.osm3s?.timestamp_osm_base ?? null,
    });
  }

  // A single-chunk run refreshes one raw file only; rebuilding the UK dataset
  // from that alone would silently truncate it to one cell.
  if (options.chunk) {
    if (failures.length > 0) {
      for (const failure of failures) console.error(`  ${failure.id}: ${failure.error}`);
      console.error(`chunk ${options.chunk} FAILED - rerun \`npm run fetch:uk-pubs -- --chunk=${options.chunk}\` to retry`);
      process.exitCode = 1;
      return;
    }
    console.log(`chunk ${options.chunk} done - rerun without --chunk (or with --from-raw) to rebuild the dataset`);
    return;
  }

  // Chunks that were never fetched (interrupted pull) must not masquerade as
  // empty cells in the manifest, or a later --from-raw run would look complete.
  const missing = grid.filter((chunk) => !chunkStats.some((stats) => stats.id === chunk.id));

  await writePretty(MANIFEST_PATH, {
    source: "OpenStreetMap Overpass",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    generatedAt: new Date().toISOString(),
    bbox: UK_BBOX,
    latStep: DEFAULT_LAT_STEP,
    lonStep: DEFAULT_LON_STEP,
    taxonomy: UK_TAXONOMY,
    areaFilter: "OSM relation 62149 (United Kingdom)",
    chunks: grid.length,
    chunksWithData: chunkStats.filter((stats) => stats.elements > 0).length,
    missingChunks: missing.map((chunk) => chunk.id),
    elements: chunkStats.reduce((sum, stats) => sum + stats.elements, 0),
    chunkStats,
  });

  // A partial pull must never overwrite a complete dataset - the raw chunks are
  // the resume state, so rerun the command and it writes the pack once the grid
  // is whole.
  if (missing.length > 0) {
    console.error(`\n${missing.length} of ${grid.length} chunk(s) missing - dataset NOT rewritten.`);
    for (const failure of failures) console.error(`  ${failure.id}: ${failure.error}`);
    console.error(`Rerun \`npm run fetch:uk-pubs\` to resume: ${missing.map((chunk) => chunk.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const pubs = normalizeElements(allElements);
  const curatedEntries = await loadCuratedEntries();
  const { pubs: annotated, report } = annotateCuratedOverlap(pubs, curatedEntries);

  await writeCompact(DATASET_PATH, {
    source: "OpenStreetMap Overpass",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    fetchedAt: new Date().toISOString(),
    bbox: UK_BBOX,
    taxonomy: UK_TAXONOMY,
    areaFilter: "OSM relation 62149 (United Kingdom)",
    grid: { latStep: DEFAULT_LAT_STEP, lonStep: DEFAULT_LON_STEP, chunks: grid.length },
    count: annotated.length,
    curatedOverlap: report.matchedTotal,
    pubs: annotated,
  });

  await writePretty(DEDUPE_REPORT_PATH, {
    generatedAt: new Date().toISOString(),
    ...report,
  });

  console.log(`\nwrote ${path.relative(ROOT, DATASET_PATH)} (${annotated.length} named pubs)`);
  console.log(`wrote ${path.relative(ROOT, DEDUPE_REPORT_PATH)}`);
  console.log(
    `overlap: ${report.matchedTotal} of ${report.ukPubs} already in curated/seeded data ` +
      `(${report.byMatchType["osm-id"]} by OSM id, ${report.byMatchType["name-distance"]} by name+distance); ` +
      `${report.uniqueToUk} new`,
  );
  for (const source of report.sources) {
    console.log(`  ${source.source}: ${source.matched}/${source.entries} matched`);
  }
  const bytes = await dirSizeBytes(UK_DIR);
  console.log(`\ndata/osm/uk total: ${formatMb(bytes)}`);
  if (bytes > COMMIT_SIZE_LIMIT_BYTES) {
    console.warn(
      `WARNING: ${formatMb(bytes)} exceeds the ${formatMb(COMMIT_SIZE_LIMIT_BYTES)} commit budget - ` +
        "do not commit these packs without a decision on where they should live.",
    );
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
