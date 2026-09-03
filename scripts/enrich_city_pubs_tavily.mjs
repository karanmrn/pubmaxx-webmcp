#!/usr/bin/env node
/**
 * Discover official pub pages and provenance-stamped pint prices with Tavily.
 *
 * Usage:
 *   npm run enrich:city -- --city=manchester
 *   npm run enrich:city -- --city=manchester --max-queries=200 --reset
 *
 * TAVILY_API_KEY is required. Local progress lives in ignored .tavily/ state.
 * Wetherspoons, Greene King, and Mitchells & Butlers pubs are delegated to the
 * existing chain harvesters and consume no Tavily queries.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CITY_DEFINITIONS,
  mergeCanonicalPrices,
  OFFICIAL_SITE_SOURCE_LICENCE,
  runCityEnrichment,
  selectCityPubs,
  venueKeyForOsmPub,
} from "./lib/tavilyPubEnrichment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UK_PACK_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const CHECKPOINT_DIR = path.join(ROOT, ".tavily", "enrichment");
const REPORT_ROOT = path.join(ROOT, "data", "enrichment", "tavily");
const PRICE_DIR = path.join(ROOT, "public", "data", "drink_price_updates");
const DEFAULT_MAX_QUERIES = 200;
const MAX_TAVILY_QUERIES_PER_RUN = 200;

function readArg(argv, name) {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseArgs(argv) {
  const city = String(readArg(argv, "--city") ?? "").trim().toLowerCase();
  const rawMax = readArg(argv, "--max-queries");
  const maxQueries = rawMax === undefined ? DEFAULT_MAX_QUERIES : Number(rawMax);
  if (!CITY_DEFINITIONS[city]) {
    throw new Error(`--city must be one of: ${Object.keys(CITY_DEFINITIONS).join(", ")}`);
  }
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > MAX_TAVILY_QUERIES_PER_RUN) {
    throw new Error("--max-queries must be an integer from 1 to 200.");
  }
  return {
    city,
    maxQueries,
    reset: argv.includes("--reset"),
    dryRun: argv.includes("--dry-run"),
  };
}

function atomicWriteJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function checkpointPath(city) {
  return path.join(CHECKPOINT_DIR, `${city}.json`);
}

function loadCityPubs(cityId) {
  const pack = JSON.parse(readFileSync(UK_PACK_PATH, "utf8"));
  return selectCityPubs(cityId, Array.isArray(pack.pubs) ? pack.pubs : []);
}

function readCheckpoint(city, totalPubs) {
  const filePath = checkpointPath(city);
  if (!existsSync(filePath)) {
    return {
      version: 1,
      city,
      totalPubs,
      observedAt: new Date().toISOString(),
      nextIndex: 0,
      totalQueriesSpent: 0,
      totalCreditsSpent: 0,
      prices: [],
      pages: [],
      delegatedChains: [],
    };
  }
  const state = JSON.parse(readFileSync(filePath, "utf8"));
  if (state.version !== 1 || state.city !== city || state.totalPubs !== totalPubs) {
    throw new Error(`Checkpoint ${path.relative(ROOT, filePath)} does not match current city pack. Use --reset.`);
  }
  return state;
}

function uniqueBy(rows, keyFor) {
  const byKey = new Map();
  for (const row of rows) byKey.set(keyFor(row), row);
  return [...byKey.values()];
}

function mergeState(base, progress, runQueries = 0, runCredits = 0) {
  return {
    ...base,
    nextIndex: progress.nextIndex,
    totalQueriesSpent: base.totalQueriesSpent + runQueries,
    totalCreditsSpent: base.totalCreditsSpent + runCredits,
    prices: uniqueBy(
      [...base.prices, ...progress.prices],
      (row) => `${row.venueKey}|${row.drinkName.toLowerCase()}|${row.category}`,
    ),
    pages: uniqueBy(
      [...base.pages, ...progress.pages],
      (row) => `${row.osmId}|${row.officialUrl}`,
    ),
    delegatedChains: uniqueBy(
      [...base.delegatedChains, ...progress.delegatedChains].map((row) => ({
        osmId: row.osmId ?? row.pub?.osmId,
        pubName: row.pubName ?? row.pub?.name,
        chain: row.chain,
        harvester: row.harvester,
      })),
      (row) => `${row.osmId}|${row.chain}`,
    ),
  };
}

function dateStamp(iso) {
  return iso.slice(0, 10).replace(/-/g, "");
}

export function pruneManagedCityPrices(existing, cityVenueKeys) {
  return existing.filter(
    (row) =>
      !cityVenueKeys.has(row?.venueKey) ||
      row?.source?.licence !== OFFICIAL_SITE_SOURCE_LICENCE,
  );
}

function writeEvidence(city, state, runResult, cityVenueKeys) {
  const generatedAt = new Date().toISOString();
  const stamp = dateStamp(generatedAt);
  const report = {
    version: 1,
    city,
    generatedAt,
    complete: runResult.complete,
    nextIndex: state.nextIndex,
    totalPubs: state.totalPubs,
    stats: {
      pubsProcessed: state.nextIndex,
      pubsMatched: state.pages.length,
      pricesExtracted: state.prices.length,
      queriesSpentThisRun: runResult.queriesSpent,
      creditsSpentThisRun: runResult.creditsSpent,
      queriesSpentTotal: state.totalQueriesSpent,
      creditsSpentTotal: state.totalCreditsSpent,
      chainPubsDelegated: state.delegatedChains.length,
    },
    pages: state.pages,
    delegatedChains: state.delegatedChains,
  };
  atomicWriteJson(path.join(REPORT_ROOT, city, `run_${stamp}.json`), report);

  if (state.prices.length === 0) return;
  const datedPath = path.join(PRICE_DIR, `prices_${stamp}.json`);
  const datedExisting = existsSync(datedPath)
    ? JSON.parse(readFileSync(datedPath, "utf8")).updates ?? []
    : [];
  atomicWriteJson(datedPath, {
    version: 1,
    generatedAt,
    updates: mergeCanonicalPrices(
      pruneManagedCityPrices(datedExisting, cityVenueKeys),
      state.prices,
    ),
  });

  const latestPath = path.join(PRICE_DIR, "latest.json");
  const latestExisting = existsSync(latestPath)
    ? JSON.parse(readFileSync(latestPath, "utf8")).updates ?? []
    : [];
  atomicWriteJson(latestPath, {
    version: 1,
    generatedAt,
    updates: mergeCanonicalPrices(
      pruneManagedCityPrices(latestExisting, cityVenueKeys),
      state.prices,
    ),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set.");

  const pubs = loadCityPubs(args.city);
  const statePath = checkpointPath(args.city);
  if (args.reset && existsSync(statePath)) rmSync(statePath);
  const base = readCheckpoint(args.city, pubs.length);
  if (base.nextIndex >= pubs.length) {
    console.log(`${args.city}: checkpoint complete (${pubs.length}/${pubs.length} pubs). Use --reset to restart.`);
    return;
  }

  console.log(
    `${args.city}: ${pubs.length} OSM pubs; resume index ${base.nextIndex}; ` +
      `hard Tavily cap ${args.maxQueries} queries.`,
  );

  const runResult = await runCityEnrichment({
    city: args.city,
    pubs,
    apiKey,
    maxQueries: args.maxQueries,
    startIndex: base.nextIndex,
    observedAt: new Date().toISOString(),
    onProgress: (progress) => {
      if (!args.dryRun) {
        atomicWriteJson(
          statePath,
          mergeState(base, progress, progress.queriesSpent, progress.creditsSpent),
        );
      }
    },
  });

  const finalState = mergeState(base, runResult, runResult.queriesSpent, runResult.creditsSpent);
  if (!args.dryRun) {
    atomicWriteJson(statePath, finalState);
    writeEvidence(
      args.city,
      finalState,
      runResult,
      new Set(pubs.map(venueKeyForOsmPub)),
    );
  }

  console.log(
    `${args.city}: pubs matched ${runResult.matchedPubs}; prices extracted ${runResult.prices.length}; ` +
      `queries spent ${runResult.queriesSpent}/${args.maxQueries}; Tavily credits ${runResult.creditsSpent}; ` +
      `next index ${runResult.nextIndex}/${pubs.length}${args.dryRun ? " (dry run)" : ""}.`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
