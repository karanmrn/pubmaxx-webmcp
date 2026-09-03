#!/usr/bin/env node
// All-UK pub harvest. Enumerate from Overpass, then enrich via Exa.
//
//   node --max-old-space-size=2048 scripts/harvest/uk-pubs/run.mjs
//   npm run harvest:uk-pubs
//
// Resumes by default: Overpass raw chunks under data-harvest/raw/ and
// complete Exa shards under data-harvest/enriched/ are skipped.
// Without EXA_API_KEY the enrich stage runs mock mode and exits 0 with a
// blocked notice. Observations only: every stored fact carries sourceUrl
// and fetchedAt.
//
// The London first-party harvest stays at scripts/harvest/run.mjs
// (`npm run harvest:run`). Do not point that command here.
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { createRequire } from "node:module";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTER_CHUNK_DELAY_MS,
  MAX_SOURCE_AGE_MS,
  fetchOverpass,
  isFreshOverpassSnapshot,
  parseOverpassRawText,
  sleep,
  writeCompact,
} from "../../lib/overpassClient.mjs";
import { buildGrid, chunkFileName } from "../../lib/ukOsmSeed.mjs";
import {
  EXA_PACE_MS,
  ODBL_ATTRIBUTION,
  SHARD_SIZE,
  buildHarvestOverpassQuery,
  createExaClient,
  enrichPubWithClient,
  estimateEta,
  isExaConfigured,
  isFatalExaError,
  loadProgress,
  isMainModule,
  nextShardIndex,
  normalizeHarvestElements,
  persistedShardRowCount,
  readJsonl,
  seedSample,
  writeJsonlAtomic,
  writeProgress,
  writeShardAtomic,
} from "../../lib/ukPubHarvest.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HARVEST_DIR = path.join(ROOT, "data-harvest");
const RAW_DIR = path.join(HARVEST_DIR, "raw");
const ENRICHED_DIR = path.join(HARVEST_DIR, "enriched");
const SEED_PATH = path.join(HARVEST_DIR, "uk_pubs_seed.jsonl");
const ENRICH_SEED_PATH = path.join(HARVEST_DIR, "uk_pubs_seed.enriching.jsonl");
const SAMPLE_PATH = path.join(HARVEST_DIR, "uk_pubs_seed.sample.jsonl");
const OSM_RAW_DIR = path.join(ROOT, "data", "osm", "uk", "raw");

function loadEnv() {
  try {
    require("@next/env").loadEnvConfig(ROOT);
  } catch {
    const envPath = path.join(ROOT, ".env.local");
    if (!existsSync(envPath)) return;
    const text = require("node:fs").readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")).map((arg) => arg.split("=")[0]));
  const valueOf = (name, fallback = null) => {
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (inline) return inline.split("=").slice(1).join("=");
    const index = argv.indexOf(`--${name}`);
    if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
    return fallback;
  };
  const anyStage = flags.has("--enumerate") || flags.has("--enrich");
  return {
    enumerate: flags.has("--enumerate") || !anyStage,
    enrich: flags.has("--enrich") || !anyStage,
    mock: flags.has("--mock"),
    refresh: flags.has("--refresh"),
    fromOsmRaw: flags.has("--from-osm-raw"),
    allowStale: flags.has("--allow-stale"),
    bars: flags.has("--bars"),
    limit: Number(valueOf("limit", "0")) || 0,
    chunk: valueOf("chunk"),
  };
}

function harvestPaths(bars) {
  if (bars) {
    return {
      lane: "plain-bars",
      label: "bars",
      seed: path.join(HARVEST_DIR, "uk_bars_seed.jsonl"),
      enrichSeed: path.join(HARVEST_DIR, "uk_bars_seed.enriching.jsonl"),
      sample: path.join(HARVEST_DIR, "uk_bars_seed.sample.jsonl"),
      enriched: path.join(HARVEST_DIR, "bars-enriched"),
      progressDir: path.join(HARVEST_DIR, "bars-enriched"),
    };
  }
  return {
    lane: "pubs",
    label: "pubs",
    seed: SEED_PATH,
    enrichSeed: ENRICH_SEED_PATH,
    sample: SAMPLE_PATH,
    enriched: ENRICHED_DIR,
    progressDir: HARVEST_DIR,
  };
}

async function readRawFile(filePath) {
  if (!existsSync(filePath)) return null;
  return parseOverpassRawText(await readFile(filePath, "utf8"));
}

async function enumerateFromOverpass({ refresh, allowStale, chunkId, startedAt, lane = "pubs", paths }) {
  const grid = buildGrid();
  const selected = chunkId ? grid.filter((chunk) => chunk.id === chunkId) : grid;
  if (chunkId && selected.length === 0) {
    throw new Error(`Unknown chunk "${chunkId}". Pass --list via the OSM fetcher for ids.`);
  }
  await mkdir(RAW_DIR, { recursive: true });
  const elements = [];
  let fetched = 0;
  let skipped = 0;
  for (const [index, chunk] of selected.entries()) {
    const rawPath = path.join(RAW_DIR, chunkFileName(chunk));
    let raw = refresh ? null : await readRawFile(rawPath);
    if (raw && (isFreshOverpassSnapshot(raw) || allowStale)) {
      skipped += 1;
      elements.push(...(raw.elements ?? []));
      continue;
    }
    if (index > 0 && fetched > 0) await sleep(INTER_CHUNK_DELAY_MS);
    console.log(`fetching ${chunk.id} (${index + 1}/${selected.length}) …`);
    raw = await fetchOverpass(buildHarvestOverpassQuery(chunk.bbox), { allowStale });
    await writeCompact(rawPath, raw);
    fetched += 1;
    elements.push(...(raw.elements ?? []));
    const progress = {
      stage: "enumerate",
      seedCount: 0,
      enrichedCount: 0,
      completeShards: 0,
      lastCompleteShard: null,
      startedAt,
      updatedAt: new Date().toISOString(),
      attribution: ODBL_ATTRIBUTION,
      chunksFetched: fetched,
      chunksSkipped: skipped,
      chunksTotal: selected.length,
    };
    await writeProgress(paths?.progressDir ?? HARVEST_DIR, progress);
  }
  const fetchedAt = new Date().toISOString();
  const { rows, drops } = normalizeHarvestElements(elements, { fetchedAt, lane });
  return { rows, drops, fetched, skipped };
}

async function enumerateFromDirectory(rawDir, { startedAt, lane = "pubs", paths, source }) {
  if (!existsSync(rawDir)) {
    throw new Error(`No OSM raw pack at ${path.relative(ROOT, rawDir)}`);
  }
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(rawDir)).filter((name) => name.endsWith(".json") && !name.startsWith("."));
  const elements = [];
  for (const name of files) {
    const filePath = path.join(rawDir, name);
    const raw = await readRawFile(filePath);
    if (!raw) {
      throw new Error(`Unreadable Overpass raw ${path.relative(ROOT, filePath)}`);
    }
    elements.push(...(raw.elements ?? []));
  }
  const fetchedAt = new Date().toISOString();
  const { rows, drops } = normalizeHarvestElements(elements, { fetchedAt, lane });
  await writeProgress(paths?.progressDir ?? HARVEST_DIR, {
    stage: "enumerate",
    seedCount: rows.length,
    enrichedCount: 0,
    completeShards: 0,
    lastCompleteShard: null,
    startedAt,
    updatedAt: fetchedAt,
    attribution: ODBL_ATTRIBUTION,
    source,
    drops,
  });
  return { rows, drops, fetched: 0, skipped: files.length };
}

async function enumerateFromOsmRaw({ startedAt, lane = "pubs", paths }) {
  return enumerateFromDirectory(OSM_RAW_DIR, {
    startedAt,
    lane,
    paths,
    source: "data/osm/uk/raw",
  });
}

async function enumerateFromHarvestRaw({ startedAt, lane = "plain-bars", paths }) {
  return enumerateFromDirectory(RAW_DIR, {
    startedAt,
    lane,
    paths,
    source: "data-harvest/raw",
  });
}

async function writeSeed(rows, paths) {
  await mkdir(HARVEST_DIR, { recursive: true });
  await writeJsonlAtomic(paths.seed, rows);
  await copyFile(paths.seed, paths.enrichSeed);
  if (!existsSync(paths.sample)) {
    const sample = seedSample(rows, 100);
    await writeJsonlAtomic(paths.sample, sample);
    console.log(`wrote sample ${sample.length} → ${path.relative(ROOT, paths.sample)}`);
  }
  console.log(`wrote ${rows.length} seed rows → ${path.relative(ROOT, paths.seed)}`);
}

async function loadSeed(paths) {
  if (!existsSync(paths.seed)) return [];
  return readJsonl(paths.seed);
}

async function loadSeedForEnrich(paths) {
  if (!existsSync(paths.enrichSeed) && existsSync(paths.seed)) {
    await copyFile(paths.seed, paths.enrichSeed);
    console.log(`froze enrich seed → ${path.relative(ROOT, paths.enrichSeed)}`);
  }
  const pathToRead = existsSync(paths.enrichSeed) ? paths.enrichSeed : paths.seed;
  if (!existsSync(pathToRead)) return [];
  return readJsonl(pathToRead);
}

async function enrichSeed(rows, { mock, startedAt, seedCount, paths }) {
  const client = createExaClient({ mock });
  if (!client) {
    const blocked = {
      stage: "blocked",
      seedCount,
      enrichedCount: 0,
      completeShards: 0,
      lastCompleteShard: null,
      startedAt,
      updatedAt: new Date().toISOString(),
      attribution: ODBL_ATTRIBUTION,
      blockedReason: "EXA_API_KEY required to start enrichment",
    };
    await writeProgress(paths.progressDir, blocked);
    return { blocked: true, enriched: 0, mock: false };
  }

  await mkdir(paths.enriched, { recursive: true });
  const startIndex = nextShardIndex(paths.enriched);
  const startOffset = await persistedShardRowCount(paths.enriched);
  const remaining = rows.slice(startOffset);
  const runStarted = Date.now();
  let enriched = 0;
  let shardIndex = startIndex;
  let buffer = [];

  async function reportProgress(note) {
    const elapsedMs = Date.now() - runStarted;
    const eta = estimateEta({
      remaining: remaining.length - enriched,
      elapsedMs,
      done: enriched,
    });
    await writeProgress(paths.progressDir, {
      stage: "enrich",
      seedCount,
      enrichedCount: startOffset + enriched,
      completeShards: shardIndex,
      lastCompleteShard: shardIndex > 0 ? shardIndex - 1 : null,
      startedAt,
      updatedAt: new Date().toISOString(),
      mock: Boolean(client.mock),
      attribution: ODBL_ATTRIBUTION,
      etaIso: eta.etaIso,
      ratePerHour: eta.ratePerHour,
      lane: paths.label,
    });
    if (note) console.log(note);
  }

  await reportProgress(
    `enrich start ${startOffset}/${seedCount} mock=${client.mock} remaining=${remaining.length}`,
  );

  async function flush() {
    if (buffer.length === 0) return;
    await writeShardAtomic(paths.enriched, shardIndex, buffer);
    const completeShards = shardIndex + 1;
    const elapsedMs = Date.now() - runStarted;
    const eta = estimateEta({
      remaining: remaining.length - enriched,
      elapsedMs,
      done: enriched,
    });
    await writeProgress(paths.progressDir, {
      stage: "enrich",
      seedCount,
      enrichedCount: startOffset + enriched,
      completeShards,
      lastCompleteShard: shardIndex,
      startedAt,
      updatedAt: new Date().toISOString(),
      mock: Boolean(client.mock),
      attribution: ODBL_ATTRIBUTION,
      etaIso: eta.etaIso,
      ratePerHour: eta.ratePerHour,
      lane: paths.label,
    });
    if (completeShards % 1 === 0 && (startOffset + enriched) % 500 === 0) {
      console.log(
        `enrich ${startOffset + enriched}/${seedCount} shards=${completeShards} eta=${eta.etaIso ?? "n/a"}`,
      );
    }
    shardIndex += 1;
    buffer = [];
  }

  for (const pub of remaining) {
    if (!client.mock) await sleep(EXA_PACE_MS);
    const fetchedAt = new Date().toISOString();
    try {
      buffer.push(await enrichPubWithClient(pub, client, fetchedAt));
    } catch (error) {
      if (isFatalExaError(error)) {
        throw error;
      }
      console.warn(`  enrich failed for ${pub.osmId}: ${error instanceof Error ? error.message : error}`);
      buffer.push({
        osmId: pub.osmId,
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        observations: [],
        fetchedAt,
      });
    }
    enriched += 1;
    if (enriched === 1 || enriched % 25 === 0) {
      const eta = estimateEta({
        remaining: remaining.length - enriched,
        elapsedMs: Date.now() - runStarted,
        done: enriched,
      });
      await reportProgress(
        `enrich ${startOffset + enriched}/${seedCount} shards=${shardIndex} eta=${eta.etaIso ?? "n/a"}`,
      );
    }
    if (buffer.length >= SHARD_SIZE) await flush();
  }
  await flush();
  return { blocked: false, enriched: startOffset + enriched, mock: Boolean(client.mock) };
}

export async function main(argv = process.argv.slice(2)) {
  loadEnv();
  const args = parseArgs(argv);
  const paths = harvestPaths(args.bars);
  const startedAt = new Date().toISOString();
  await mkdir(HARVEST_DIR, { recursive: true });

  let rows = [];
  if (args.enumerate) {
    const result = args.fromOsmRaw
      ? await enumerateFromOsmRaw({ startedAt, lane: paths.lane, paths })
      : args.bars && !args.refresh
        ? await enumerateFromHarvestRaw({ startedAt, lane: paths.lane, paths })
        : await enumerateFromOverpass({
            refresh: args.refresh,
            allowStale: args.allowStale,
            chunkId: args.chunk,
            startedAt,
            lane: paths.lane,
            paths,
          });
    rows = result.rows;
    if (!args.chunk) await writeSeed(rows, paths);
    if (args.limit > 0) rows = rows.slice(0, args.limit);
    await writeProgress(paths.progressDir, {
      stage: "enumerate",
      seedCount: args.chunk ? rows.length : result.rows.length,
      enrichedCount: 0,
      completeShards: 0,
      lastCompleteShard: null,
      startedAt,
      updatedAt: new Date().toISOString(),
      attribution: ODBL_ATTRIBUTION,
      drops: result.drops,
      chunksFetched: result.fetched,
      chunksSkipped: result.skipped,
      lane: paths.label,
    });
    console.log(
      `enumerate: ${rows.length} ${paths.label} (fetched ${result.fetched}, skipped ${result.skipped}); drops ${JSON.stringify(result.drops)}`,
    );
    console.log(`attribution: ${ODBL_ATTRIBUTION} (${MAX_SOURCE_AGE_MS / 3_600_000}h snapshot window)`);
  } else {
    rows = args.enrich ? await loadSeedForEnrich(paths) : await loadSeed(paths);
  }

  if (args.limit > 0) rows = rows.slice(0, args.limit);

  if (!args.enrich) return { stage: "enumerate", seedCount: rows.length, lane: paths.label };

  const mock = args.mock || !isExaConfigured();
  if (mock && !isExaConfigured()) {
    console.warn("EXA_API_KEY is not set. Enrichment will run in mock mode and write no live observations.");
  }
  if (rows.length === 0 && !args.enumerate) rows = await loadSeedForEnrich(paths);
  const outcome = await enrichSeed(rows, {
    mock,
    startedAt,
    seedCount: rows.length,
    paths,
  });
  if (outcome.blocked) {
    console.warn("blocked: needs-decision [key=exa-key] EXA_API_KEY required to start enrichment");
    return outcome;
  }
  await writeProgress(paths.progressDir, {
    stage: "done",
    seedCount: rows.length,
    enrichedCount: outcome.enriched,
    completeShards: nextShardIndex(paths.enriched),
    lastCompleteShard: nextShardIndex(paths.enriched) - 1,
    startedAt,
    updatedAt: new Date().toISOString(),
    mock: outcome.mock,
    attribution: ODBL_ATTRIBUTION,
    lane: paths.label,
  });
  console.log(`enrich: ${outcome.enriched} ${paths.label} records mock=${outcome.mock}`);
  if (outcome.mock && !isExaConfigured()) {
    console.warn("blocked: needs-decision [key=exa-key] EXA_API_KEY required to start enrichment");
  }
  return outcome;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
