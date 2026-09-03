import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  KNOWN_AREA_SLUGS,
  areaNewsExtractPrompt,
  buildAreaNewsEntry,
  fetchKeenable,
  parseExtractedFact,
  searchKeenable,
} from "./lib/keenableAreaNews.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const AREA_NEWS_DATASET_PATH = join(ROOT, "data", "area_news.json");
export const AREA_NEWS_DATASET_COMMENT =
  "Sourced, dated London pub news from Keenable search_web_pages and fetch_page_content. Every entry carries a real https sourceUrl and observedAt. confidence:'social' marks self-reported price sightings, news-layer texture only, never a Pint Index input. venueMatch is written by scripts/build_area_news_matches.mjs. Refresh: npm run refresh:area-news. See lib/areaNews.ts and data/freshness_registry.json.";

export function areaNewsRefreshQueries(now = Date.now()) {
  const formatMonthYear = (time) => new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(time));
  const currentDate = new Date(now);
  const currentMonth = formatMonthYear(currentDate);
  const previousMonth = formatMonthYear(
    new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - 1, 1)),
  );
  const monthTerms = `${previousMonth} and ${currentMonth}`;
  return [
    `London pub bar opening reopening ${monthTerms}`,
    `London pub refurbishment closure threat ${monthTerms}`,
    `London pub award price pint sighting ${monthTerms}`,
    `Soho Mayfair London pub opening refurbishment closure ${monthTerms}`,
    `East London pub opening closure refurbishment ${monthTerms}`,
    `South London pub opening closure refurbishment ${monthTerms}`,
  ];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MAX_CANDIDATES = 36;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const SECONDARY_SOURCE_HOSTS = new Set([
  "newsarchyuk.com",
  "sylhetmirror.com",
  "wesearch.press",
  "worldbillionaireday.com",
]);

function dateOnly(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function withOperationTimeout(operation, timeoutMs, label) {
  const controller = new AbortController();
  let timer;
  const operationResult = Promise.resolve().then(() => operation(controller.signal));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Area news ${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  return Promise.race([operationResult, timeout]).finally(() => clearTimeout(timer));
}

export function readAreaNewsDataset(path = AREA_NEWS_DATASET_PATH) {
  if (!existsSync(path)) return { version: 1, generatedAt: "", entries: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeAreaNewsDataset(snapshot, path = AREA_NEWS_DATASET_PATH) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

function sortedEntries(entries) {
  return [...entries].sort((left, right) => {
    const dateOrder = String(right.observedAt).localeCompare(String(left.observedAt));
    return dateOrder || String(left.id).localeCompare(String(right.id));
  });
}

function isCurrentGeneratedEntry(entry, nowTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.observedAt ?? "")) return false;
  const observedDate = new Date(`${entry.observedAt}T00:00:00Z`);
  const observedTime = observedDate.getTime();
  if (
    !Number.isFinite(observedTime) ||
    observedDate.toISOString().slice(0, 10) !== entry.observedAt
  ) return false;
  const nowDay = new Date(nowTime);
  nowDay.setUTCHours(0, 0, 0, 0);
  return observedTime >= nowDay.getTime() - 21 * DAY_MS && observedTime <= nowDay.getTime();
}

function isValidHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isRetainableGeneratedEntry(entry, nowTime, knownAreas) {
  if (
    typeof entry?.id !== "string" ||
    !entry.id.trim() ||
    typeof entry.area !== "string" ||
    typeof entry.kind !== "string" ||
    typeof entry.title !== "string" ||
    typeof entry.detail !== "string" ||
    typeof entry.sourceName !== "string" ||
    !entry.sourceName.trim() ||
    !isCurrentGeneratedEntry(entry, nowTime) ||
    !isValidHttpsUrl(entry.sourceUrl)
  ) return false;
  return Boolean(parseExtractedFact(
    { content: JSON.stringify(entry) },
    { knownAreas, currentYear: new Date(nowTime).getUTCFullYear(), now: nowTime },
  ));
}

function archiveWithFreshEntries(previousEntries, freshEntries, nowTime, knownAreas) {
  const generatedById = new Map(freshEntries.map((entry) => [entry.id, entry]));
  const archiveEntries = [];
  for (const entry of previousEntries) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
    if (entry.id.startsWith("area-news-")) {
      if (isRetainableGeneratedEntry(entry, nowTime, knownAreas) && !generatedById.has(entry.id)) {
        generatedById.set(entry.id, entry);
      }
    } else {
      archiveEntries.push(entry);
    }
  }
  return [...sortedEntries(generatedById.values()), ...archiveEntries];
}

function deduplicateFreshEntries(entries) {
  const byFact = new Map();
  for (const entry of entries) {
    byFact.set(entry.id, entry);
  }
  return [...byFact.values()];
}

async function collectCandidates({ queries, env, searchFn, logger, publishedAfter, maxResults, maxCandidates, operationTimeoutMs }) {
  const candidates = [];
  const seenUrls = new Set();
  for (const query of queries) {
    let results;
    try {
      results = await withOperationTimeout(
        (signal) => searchFn(query, { env, publishedAfter, maxResults, signal }),
        operationTimeoutMs,
        "search",
      );
    } catch (error) {
      throw new Error(`Area news search failed for "${query}": ${errorMessage(error)}`, { cause: error });
    }
    if (!Array.isArray(results)) {
      throw new Error(`Area news search failed for "${query}": response was not an array.`);
    }
    logger(`SEARCH ${query}: ${results.length} results`);

    for (const result of results) {
      if (candidates.length >= maxCandidates) break;
      let parsed;
      try {
        parsed = new URL(result?.url);
        if (parsed.protocol !== "https:") throw new Error("source is not https");
        if (SECONDARY_SOURCE_HOSTS.has(parsed.hostname.toLowerCase())) {
          logger(`DROP ${parsed.toString()}: secondary copy of a primary source`);
          continue;
        }
      } catch {
        logger(`DROP search result without an https URL: ${String(result?.url ?? "")}`);
        continue;
      }
      const sourceUrl = parsed.toString();
      if (seenUrls.has(sourceUrl)) continue;
      seenUrls.add(sourceUrl);
      candidates.push({ result, sourceUrl });
    }
  }
  return candidates;
}

async function collectFreshEntries({ candidates, env, fetchFn, logger, nowTime, knownAreas, extractPrompt, operationTimeoutMs }) {
  const freshEntries = [];
  let fetchFailures = 0;
  for (const { result, sourceUrl } of candidates) {
    let page;
    try {
      page = await withOperationTimeout(
        (signal) => fetchFn(sourceUrl, { env, prompt: extractPrompt, signal }),
        operationTimeoutMs,
        "fetch",
      );
    } catch (error) {
      fetchFailures += 1;
      logger(`FETCH FAILED ${sourceUrl}: ${errorMessage(error)}`);
      continue;
    }

    const entry = buildAreaNewsEntry({
      result,
      page,
      fact: parseExtractedFact(page, {
        knownAreas,
        currentYear: new Date(nowTime).getUTCFullYear(),
        now: nowTime,
      }),
      now: nowTime,
      knownAreas,
    });
    if (!entry) {
      logger(`DROP ${sourceUrl}: no current, dated, mapped pub fact`);
      continue;
    }
    freshEntries.push(entry);
  }
  return { freshEntries, fetchFailures };
}

export async function refreshAreaNews({
  now = Date.now(),
  queries,
  env = process.env,
  knownAreas = KNOWN_AREA_SLUGS,
  searchFn = searchKeenable,
  fetchFn = fetchKeenable,
  previousDataset = { version: 1, generatedAt: "", entries: [] },
  writeDataset = writeAreaNewsDataset,
  logger = (line) => console.log(line),
  maxResults = DEFAULT_MAX_RESULTS,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
} = {}) {
  const nowTime = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowTime)) throw new Error("Area news refresh requires a valid current time.");
  const refreshQueries = queries ?? areaNewsRefreshQueries(nowTime);
  const currentYear = new Date(nowTime).getUTCFullYear();
  const extractPrompt = areaNewsExtractPrompt(currentYear);
  if (!Number.isInteger(maxResults) || maxResults <= 0) {
    throw new Error("--max-results must be a positive integer.");
  }
  if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) {
    throw new Error("--max-candidates must be a positive integer.");
  }
  if (!Number.isInteger(operationTimeoutMs) || operationTimeoutMs <= 0) {
    throw new Error("operationTimeoutMs must be a positive integer.");
  }
  const candidates = await collectCandidates({
    queries: refreshQueries,
    env,
    searchFn,
    logger,
    publishedAfter: dateOnly(nowTime - 21 * DAY_MS),
    maxResults,
    maxCandidates,
    operationTimeoutMs,
  });

  if (candidates.length === 0) {
    throw new Error("Area news refresh found no valid facts. Existing dataset was not changed.");
  }

  const { freshEntries, fetchFailures } = await collectFreshEntries({
    candidates,
    env,
    fetchFn,
    logger,
    nowTime,
    knownAreas,
    extractPrompt,
    operationTimeoutMs,
  });

  if (fetchFailures > 0) {
    throw new Error(
      `Area news refresh failed: ${fetchFailures} fetch failure${fetchFailures === 1 ? "" : "s"}. Existing dataset was not changed.`,
    );
  }

  if (freshEntries.length === 0) {
    throw new Error(
      `Area news refresh found no valid facts after ${candidates.length} fetches (${fetchFailures} fetch failures). Existing dataset was not changed.`,
    );
  }

  const deduplicatedFreshEntries = deduplicateFreshEntries(freshEntries);
  const previousEntries = Array.isArray(previousDataset?.entries) ? previousDataset.entries : [];
  const snapshot = {
    ...(previousDataset && typeof previousDataset === "object" ? previousDataset : {}),
    $comment: AREA_NEWS_DATASET_COMMENT,
    version: 1,
    generatedAt: new Date(nowTime).toISOString(),
    entries: archiveWithFreshEntries(previousEntries, deduplicatedFreshEntries, nowTime, knownAreas),
  };
  writeDataset(snapshot);
  logger(
    `READY area news: ${deduplicatedFreshEntries.length} fresh facts from ${freshEntries.length} candidates, ${fetchFailures} fetch failures, ${snapshot.entries.length} total archive rows`,
  );
  return snapshot;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--max-results" && flag !== "--max-candidates") {
      throw new Error(`Unsupported argument: ${flag}`);
    }
    const value = argv[index + 1];
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${flag} must be a positive integer.`);
    }
    options[flag === "--max-results" ? "maxResults" : "maxCandidates"] = parsed;
    index += 1;
  }
  return options;
}

async function main() {
  const previousDataset = readAreaNewsDataset();
  await refreshAreaNews({ previousDataset, ...parseArgs(process.argv.slice(2)) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
