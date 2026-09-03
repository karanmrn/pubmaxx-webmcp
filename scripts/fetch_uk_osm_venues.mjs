#!/usr/bin/env node
// Fetch every place in the United Kingdom a drinker or a laptop could sit in -
// pubs, bars, beer gardens, restaurants that state a bar, late fast food, cafes,
// coffee shops, coworking desks, libraries, community centres with wifi, hotel
// bars and off-licences - from Overpass, one grid chunk at a time, then write:
//   data/osm/uk/raw_venues/<scope>/chunk_<lat>_<lon>.json  (raw, GITIGNORED)
//   data/osm/uk/venue_chunks.json                          (grid + per-chunk manifest)
//   data/osm/uk/uk_osm_venues_<group>.json                 (normalized pack, ODbL)
//   data/osm/uk/venue_counts.json                          (kind + London/UK counts)
//
// Usage:
//   npm run fetch:uk-venues                     # full pull, resumes by default
//   npm run fetch:uk-venues -- --scope=work     # retry one lane of the taxonomy
//   npm run fetch:uk-venues -- --refresh        # refetch every chunk
//   npm run fetch:uk-venues -- --from-raw       # re-normalize, no network
//   npm run fetch:uk-venues -- --list           # print the grid and exit
//
// The grid, the UK area clip and the Overpass etiquette are the pub fetcher's
// (scripts/fetch_uk_osm_pubs.mjs) unchanged: same 1° × 1° cells over the same
// UK_BBOX, same [timeout:90], same endpoint rotation, same retry and backoff,
// same inter-chunk delay. What differs is the TAXONOMY.
//
// ONE request per chunk, asking for the whole taxonomy at once, is deliberate:
// splitting it into three lanes tripled the requests against public mirrors that
// were already answering 504, which is backoff rather than data. A lane can
// still be retried on its own with --scope.
//
// The raw responses are gitignored: the pub-only pull was 13 MB and this one is
// several times that, which is a working file rather than a data drop. The
// normalized per-group packs are what a reader consumes, and the run REFUSES to
// pretend a partial pull is a whole one - a missing chunk leaves the packs alone,
// and a `--scope` retry writes ITS lane's pack alone. See `runArtifactPlan`: an
// artifact describes a complete run of its own scope or it is not rewritten,
// which is what keeps the documented lane retry from zeroing the other two packs.
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
import { coveringStamp } from "./lib/coveringStamp.mjs";
import {
  DEFAULT_LAT_STEP,
  DEFAULT_LON_STEP,
  UK_BBOX,
  buildGrid,
  chunkFileName,
} from "./lib/ukOsmSeed.mjs";
import {
  UK_VENUE_GROUPS,
  UK_VENUE_KINDS,
  UK_VENUE_QUERY_SCOPES,
  UK_VENUE_TAXONOMY,
  buildUkVenueQuery,
  countVenues,
  normalizeVenueElements,
  taxonomyForScope,
} from "./lib/ukOsmVenueSeed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const UK_DIR = path.join(ROOT, "data", "osm", "uk");
const RAW_ROOT = path.join(UK_DIR, "raw_venues");
const MANIFEST_PATH = path.join(UK_DIR, "venue_chunks.json");
const COUNTS_PATH = path.join(UK_DIR, "venue_counts.json");

/** Greater London, as the base-layer publish and the counts table read it.
 * A bbox, not a boundary: it is used only to SPLIT a count into "London" and
 * "rest of the UK", never to claim a venue is inside a borough. */
export const GREATER_LONDON_BBOX = [51.28, -0.53, 51.7, 0.34];

export function venuePackPath(group) {
  return path.join(UK_DIR, `uk_osm_venues_${group}.json`);
}

/** The chunk manifest a run of this scope owns. A lane retry keeps its own
 * record rather than overwriting the whole-taxonomy run's. */
export function manifestPathFor(scope) {
  return scope === "all" ? MANIFEST_PATH : path.join(UK_DIR, `venue_chunks_${scope}.json`);
}

/**
 * What a pack may claim it was fetched at.
 *
 * A NETWORK run stamps its own start: it really did look at the world then.
 * `--from-raw` looks at nothing, so it may not date itself today - it carries
 * the OLDEST `osm3s.timestamp_osm_base` among the raw snapshots it re-read, and
 * goes UNDATED when one of them cannot be dated rather than borrowing the wall
 * clock or another chunk's day. Old raws are still accepted there; what changes
 * is that the stamp tells the truth about their age.
 */
export function packFetchedAt({ fromRaw, runStartedAt, chunkStamps }) {
  return fromRaw ? coveringStamp(chunkStamps) : runStartedAt;
}

/**
 * Which artifacts a run may rewrite. An artifact describes a COMPLETE run of
 * its OWN scope, so:
 *   - a lane retry (`--scope=work`) rewrites that lane's pack alone, and leaves
 *     the two packs it never fetched exactly as they are on disk;
 *   - the counts file and the report that cites it are whole-taxonomy figures,
 *     so a lane retry leaves them alone rather than writing a partial total;
 *   - a run that did not read every grid chunk (`--chunk`, or a pull that lost
 *     chunks to failures) rewrites nothing at all.
 */
export function runArtifactPlan(scope, { missingChunks = 0 } = {}) {
  const complete = missingChunks === 0;
  const packGroups = !complete ? [] : scope === "all" ? [...UK_VENUE_GROUPS] : [scope];
  return {
    complete,
    packGroups,
    manifestPath: complete ? manifestPathFor(scope) : null,
    countsPath: complete && scope === "all" ? COUNTS_PATH : null,
  };
}

export function inGreaterLondon(venue) {
  const [south, west, north, east] = GREATER_LONDON_BBOX;
  return venue.lat >= south && venue.lat <= north && venue.lng >= west && venue.lng <= east;
}

function parseArgs(argv) {
  const options = { fromRaw: false, refresh: false, list: false, chunk: null, scope: "all", allowStale: false };
  for (const arg of argv) {
    if (arg === "--from-raw") options.fromRaw = true;
    else if (arg === "--skip-if-present") continue; // resume is already the default
    else if (arg === "--refresh") options.refresh = true;
    else if (arg === "--allow-stale") options.allowStale = true;
    else if (arg === "--list") options.list = true;
    else if (arg.startsWith("--chunk=")) options.chunk = arg.slice("--chunk=".length).trim();
    else if (arg.startsWith("--scope=")) options.scope = arg.slice("--scope=".length).trim();
    else {
      console.error(`Unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  if (!UK_VENUE_QUERY_SCOPES.includes(options.scope)) {
    console.error(`Unknown scope "${options.scope}". Known: ${UK_VENUE_QUERY_SCOPES.join(", ")}`);
    process.exit(1);
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

function rawPathFor(scope, chunk) {
  return path.join(RAW_ROOT, scope, chunkFileName(chunk));
}

async function readChunkRaw(scope, chunk) {
  const rawPath = rawPathFor(scope, chunk);
  if (!(await fileExists(rawPath))) return null;
  return parseOverpassRawText(await readFile(rawPath, "utf8"));
}

async function fetchChunk(scope, chunk, { refresh, allowStale }) {
  const rawPath = rawPathFor(scope, chunk);
  if (!refresh) {
    const raw = await readChunkRaw(scope, chunk);
    if (raw && (isFreshOverpassSnapshot(raw) || allowStale)) {
      console.log(`skip ${chunk.id} (raw present, ${raw.elements.length} elements)`);
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
  const raw = await fetchOverpass(buildUkVenueQuery(chunk.bbox, scope, { timeout: QUERY_TIMEOUT_S }), {
    allowStale,
  });
  await writeCompact(rawPath, raw);
  const count = Array.isArray(raw?.elements) ? raw.elements.length : 0;
  console.log(`  wrote ${path.relative(ROOT, rawPath)} (${count} elements)`);
  return { raw, fetched: true };
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

/**
 * A raw chunk is read, normalized and dropped before the next is opened, so the
 * peak the process holds is the unique venue set, never every raw response at
 * once. Chunks the run could not read are returned rather than counted as empty
 * cells: a missing chunk that reads as "no venues here" is how a partial pull
 * comes to look complete.
 */
async function collect(scope, grid, targets, options) {
  /** @type {Map<string, Map<string, Record<string, any>>>} one map per pack group */
  const byGroup = new Map(UK_VENUE_GROUPS.map((group) => [group, new Map()]));
  const groupOf = new Map(UK_VENUE_TAXONOMY.map((row) => [row.key, row.group]));
  const chunkStats = [];
  const failures = [];
  let unclassified = 0;
  let unnamed = 0;
  let needDelay = false;

  for (const chunk of targets) {
    let raw;
    if (options.fromRaw) {
      raw = await readChunkRaw(scope, chunk);
      if (!raw) continue;
    } else {
      if (needDelay) {
        await sleep(options.allowStale ? INTER_CHUNK_DELAY_STALE_MS : INTER_CHUNK_DELAY_MS);
      }
      let result;
      try {
        result = await fetchChunk(scope, chunk, {
          refresh: options.refresh,
          allowStale: options.allowStale,
        });
      } catch (err) {
        // One chunk exhausting its retries must not throw away the rest: the raw
        // files on disk are the resume state, so record it and keep going.
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ id: chunk.id, error: message });
        console.error(`  FAILED ${chunk.id}: ${message}`);
        needDelay = true;
        continue;
      }
      raw = result.raw;
      needDelay = result.fetched;
    }

    const elements = Array.isArray(raw?.elements) ? raw.elements : [];
    const normalized = normalizeVenueElements(elements);
    unclassified += normalized.unclassified;
    unnamed += normalized.unnamed;
    for (const venue of normalized.venues) {
      const bucket = byGroup.get(groupOf.get(venue.taxonomyKey));
      if (bucket && !bucket.has(venue.osmId)) bucket.set(venue.osmId, venue);
    }
    chunkStats.push({
      id: chunk.id,
      bbox: chunk.bbox,
      elements: elements.length,
      timestamp: raw?.osm3s?.timestamp_osm_base ?? null,
    });
  }

  const missing = grid.filter((chunk) => !chunkStats.some((stats) => stats.id === chunk.id));
  return { byGroup, chunkStats, failures, missing, unclassified, unnamed };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const grid = buildGrid();

  if (options.list) {
    for (const chunk of grid) console.log(`${chunk.id}\t${chunk.bbox.join(",")}`);
    console.log(`${grid.length} chunks (${DEFAULT_LAT_STEP}° × ${DEFAULT_LON_STEP}°)`);
    console.log(`scopes: ${UK_VENUE_QUERY_SCOPES.join(", ")}`);
    return;
  }

  const targets = options.chunk ? grid.filter((chunk) => chunk.id === options.chunk) : grid;
  if (options.chunk && targets.length === 0) {
    console.error(`Unknown chunk "${options.chunk}". Run with --list to see the grid.`);
    process.exit(1);
  }

  await mkdir(path.join(RAW_ROOT, options.scope), { recursive: true });

  const runStartedAt = new Date().toISOString();
  console.log(`=== UK venue pull, scope=${options.scope}, ${targets.length} chunk(s) ===`);
  const result = await collect(options.scope, grid, targets, options);

  const plan = runArtifactPlan(options.scope, { missingChunks: result.missing.length });

  if (plan.manifestPath) {
    await writePretty(plan.manifestPath, {
      source: "OpenStreetMap Overpass",
      license: "ODbL",
      attribution: "© OpenStreetMap contributors",
      generatedAt: runStartedAt,
      completedAt: new Date().toISOString(),
      scope: options.scope,
      bbox: UK_BBOX,
      latStep: DEFAULT_LAT_STEP,
      lonStep: DEFAULT_LON_STEP,
      areaFilter: "OSM relation 62149 (United Kingdom)",
      taxonomy: taxonomyForScope(options.scope).map(({ key, kind, group, selectors, note }) => ({
        key,
        kind,
        group,
        selectors,
        note,
      })),
      chunks: grid.length,
      chunksRead: result.chunkStats.length,
      chunksWithData: result.chunkStats.filter((stats) => stats.elements > 0).length,
      elements: result.chunkStats.reduce((sum, stats) => sum + stats.elements, 0),
      unclassifiedElements: result.unclassified,
      unnamedElements: result.unnamed,
      missingChunks: result.missing.map((chunk) => chunk.id),
      failures: result.failures,
      chunkStats: result.chunkStats,
    });
  }

  if (options.chunk) {
    console.log(`chunk ${options.chunk} done - rerun without --chunk (or with --from-raw) to rebuild the packs`);
    if (result.failures.length > 0) process.exitCode = 1;
    return;
  }

  if (!plan.complete) {
    console.error(`\n${result.missing.length} of ${grid.length} chunk(s) missing - packs NOT rewritten.`);
    for (const failure of result.failures) console.error(`  ${failure.id}: ${failure.error}`);
    console.error("Rerun `npm run fetch:uk-venues` to resume.");
    process.exitCode = 1;
    return;
  }

  const fetchedAt = packFetchedAt({
    fromRaw: options.fromRaw,
    runStartedAt,
    chunkStamps: result.chunkStats.map((stats) => stats.timestamp),
  });
  if (fetchedAt === null) {
    console.warn(
      "At least one raw chunk carries no usable OSM snapshot timestamp, so the packs publish undated " +
        "rather than claiming this run's day for data nobody looked at today.",
    );
  }

  const summaries = [];
  const totals = { byKind: {}, byTaxonomyKey: {} };
  const londonTotals = { byKind: {}, byTaxonomyKey: {} };
  let totalVenues = 0;
  let londonVenues = 0;

  const add = (into, from) => {
    for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + n;
  };

  for (const group of plan.packGroups) {
    const venues = [...(result.byGroup.get(group)?.values() ?? [])];
    const counts = countVenues(venues);
    const london = venues.filter(inGreaterLondon);
    const londonCounts = countVenues(london);
    totalVenues += venues.length;
    londonVenues += london.length;
    add(totals.byKind, counts.byKind);
    add(totals.byTaxonomyKey, counts.byTaxonomyKey);
    add(londonTotals.byKind, londonCounts.byKind);
    add(londonTotals.byTaxonomyKey, londonCounts.byTaxonomyKey);

    await writeCompact(venuePackPath(group), {
      source: "OpenStreetMap Overpass",
      license: "ODbL",
      attribution: "© OpenStreetMap contributors",
      fetchedAt,
      bbox: UK_BBOX,
      areaFilter: "OSM relation 62149 (United Kingdom)",
      group,
      taxonomy: UK_VENUE_TAXONOMY.filter((row) => row.group === group).map(
        ({ key, kind, selectors, note }) => ({ key, kind, selectors, note }),
      ),
      grid: { latStep: DEFAULT_LAT_STEP, lonStep: DEFAULT_LON_STEP, chunks: grid.length },
      count: venues.length,
      countsByKind: counts.byKind,
      countsByTaxonomyKey: counts.byTaxonomyKey,
      venues,
    });

    const bytes = (await stat(venuePackPath(group))).size;
    summaries.push({ group, venues: venues.length, bytes });
    console.log(
      `wrote ${path.relative(ROOT, venuePackPath(group))} (${venues.length} venues, ${formatMb(bytes)})`,
    );
  }

  if (plan.countsPath) {
    await writePretty(plan.countsPath, {
      generatedAt: runStartedAt,
      source: "OpenStreetMap Overpass",
      license: "ODbL",
      attribution: "© OpenStreetMap contributors",
      note:
        "London is a bounding box over Greater London, used only to split a count. " +
        "It is never a claim that a venue is inside a borough.",
      greaterLondonBbox: GREATER_LONDON_BBOX,
      kinds: UK_VENUE_KINDS,
      uk: { total: totalVenues, byKind: totals.byKind, byTaxonomyKey: totals.byTaxonomyKey },
      london: { total: londonVenues, byKind: londonTotals.byKind, byTaxonomyKey: londonTotals.byTaxonomyKey },
      groups: summaries,
    });
  } else {
    console.log(
      `\n${path.relative(ROOT, COUNTS_PATH)} left alone: it carries whole-taxonomy figures, and this ` +
        `run covered the ${options.scope} lane only. Rerun without --scope to refresh it and the report.`,
    );
  }

  let packBytes = 0;
  for (const group of UK_VENUE_GROUPS) {
    const packPath = venuePackPath(group);
    if (await fileExists(packPath)) packBytes += (await stat(packPath)).size;
  }
  const rawBytes = (await fileExists(RAW_ROOT)) ? await dirSizeBytes(RAW_ROOT) : 0;
  console.log(`\nUK venues (scope=${options.scope}): ${totalVenues} (London ${londonVenues})`);
  for (const [kind, n] of Object.entries(totals.byKind).sort()) {
    console.log(`  ${kind}: ${n} (London ${londonTotals.byKind[kind] ?? 0})`);
  }
  console.log(`normalized packs total: ${formatMb(packBytes)}`);
  console.log(`raw (gitignored) total: ${formatMb(rawBytes)}`);
  if (packBytes > COMMIT_SIZE_LIMIT_BYTES) {
    console.warn(
      `WARNING: normalized packs are ${formatMb(packBytes)}, past the ${formatMb(COMMIT_SIZE_LIMIT_BYTES)} budget - ` +
        "report the per-group sizes and stop rather than committing them.",
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
