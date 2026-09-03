/**
 * All-UK pub harvest: OSM enumerate + Exa enrich.
 *
 * Observations only. Every stored fact carries sourceUrl + fetchedAt.
 * Nothing is inferred from a name, a chain or a postcode.
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import { existsSync, readdirSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MAX_BACKOFF_MS, QUERY_TIMEOUT_S } from "./overpassClient.mjs";
import { UK_AREA_ID } from "./ukOsmSeed.mjs";

export const ODBL_LICENSE = "ODbL-1.0";
export const ODBL_ATTRIBUTION = "© OpenStreetMap contributors";

export const SHARD_SIZE = 500;
export const EXA_SEARCH_URL = "https://api.exa.ai/search";
export const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
export const EXA_PACE_MS = 1_500;
export const EXA_REQUEST_TIMEOUT_MS = 60_000;
export const EXA_MAX_ATTEMPTS = 6;
export const PROGRESS_FILE = "progress.json";

export const EXA_SYSTEM_PROMPT =
  "Prefer official venue sites. Collapse duplicate pages. Ground every field in a source page. If a field is not stated, return an empty string or an empty array. Do not invent a website, a history sentence, a social handle, a menu URL or a price.";

export const EXA_PUB_OUTPUT_SCHEMA = {
  type: "object",
  required: ["officialWebsite", "history", "socialHandles", "menuOrPricePages", "notableCoverage"],
  properties: {
    officialWebsite: {
      type: "string",
      description: "Official venue website URL as stated on a source page, or empty string",
    },
    history: {
      type: "string",
      description: "History or lore snippet as stated on a source page, or empty string",
    },
    socialHandles: {
      type: "array",
      items: { type: "string" },
      description: "Public social profile URLs as stated on source pages",
    },
    menuOrPricePages: {
      type: "array",
      items: { type: "string" },
      description: "Menu or drinks-price page URLs as stated on source pages",
    },
    notableCoverage: {
      type: "array",
      items: { type: "string" },
      description: "Notable coverage page URLs as stated on source pages",
    },
  },
};

export const EXA_DEPRECATED_PARAM_KEYS = Object.freeze([
  "useAutoprompt",
  "includeUrls",
  "excludeUrls",
  "numSentences",
  "highlightsPerUrl",
  "tokensNum",
  "livecrawl",
]);

const OUTPUT_FIELD_KIND = {
  officialWebsite: "website",
  history: "history",
  socialHandles: "social",
  menuOrPricePages: "menu",
  notableCoverage: "coverage",
};

const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "uk.linkedin.com",
  "threads.net",
  "letterboxd.com",
  "spotify.com",
  "open.spotify.com",
  "snapchat.com",
  "strava.com",
  "mobile.twitter.com",
]);

const SOCIAL_OSM_KEYS = [
  ["contact:facebook", "facebook"],
  ["facebook", "facebook"],
  ["contact:instagram", "instagram"],
  ["instagram", "instagram"],
  ["contact:twitter", "twitter"],
  ["twitter", "twitter"],
  ["contact:tiktok", "tiktok"],
  ["tiktok", "tiktok"],
  ["contact:youtube", "youtube"],
  ["youtube", "youtube"],
];

function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function statedYes(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().toLowerCase() !== "no";
}

/**
 * A bar is kept only when OSM states real ale, a microbrewery, or a brewery.
 * A name that contains "pub" is not evidence.
 * @param {Record<string, string> | undefined} tags
 */
export function isPubLikeBar(tags) {
  if (!tags || tags.amenity !== "bar") return false;
  return statedYes(tags.real_ale) || tags.microbrewery === "yes" || statedYes(tags.brewery);
}

export function isPlainBar(tags) {
  return Boolean(tags && tags.amenity === "bar" && !isPubLikeBar(tags));
}

export function isHarvestableTags(tags) {
  if (!tags) return false;
  if (tags.amenity === "pub") return true;
  return isPubLikeBar(tags);
}

/**
 * Overpass QL for one grid cell: UK-area-clipped pubs and bars.
 * Pub-like filtering of bars happens after the response, so a drop is counted.
 * @param {[number, number, number, number]} bbox
 * @param {{ timeout?: number }} [options]
 */
export function buildHarvestOverpassQuery(bbox, { timeout = QUERY_TIMEOUT_S } = {}) {
  const box = bbox.map((n) => roundCoord(n)).join(",");
  return `
[out:json][timeout:${timeout}];
area(id:${UK_AREA_ID})->.uk;
(
  node["amenity"="pub"](area.uk)(${box});
  way["amenity"="pub"](area.uk)(${box});
  node["amenity"="bar"](area.uk)(${box});
  way["amenity"="bar"](area.uk)(${box});
);
out center tags;
`.trim();
}

export function osmObjectUrl(type, id) {
  if (!isNonEmptyString(type) || !Number.isFinite(Number(id))) return null;
  return `https://www.openstreetmap.org/${type}/${id}`;
}

function observation(kind, value, sourceUrl, fetchedAt) {
  if (!isNonEmptyString(value) || !isNonEmptyString(sourceUrl) || !isNonEmptyString(fetchedAt)) {
    return null;
  }
  return { kind, value: value.trim(), sourceUrl, fetchedAt };
}

function collectAddressTags(tags) {
  /** @type {Record<string, string>} */
  const addressTags = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (!key.startsWith("addr:")) continue;
    if (!isNonEmptyString(value)) continue;
    addressTags[key] = value.trim();
  }
  return addressTags;
}

function collectSocialTags(tags, sourceUrl, fetchedAt) {
  /** @type {Record<string, { value: string, sourceUrl: string, fetchedAt: string }>} */
  const socialTags = {};
  for (const [osmKey, field] of SOCIAL_OSM_KEYS) {
    if (socialTags[field]) continue;
    const value = tags?.[osmKey];
    const row = observation("social", value, sourceUrl, fetchedAt);
    if (!row) continue;
    socialTags[field] = { value: row.value, sourceUrl, fetchedAt };
  }
  return socialTags;
}

/**
 * @param {any} element
 * @param {{ fetchedAt: string }} options
 */
export function seedRowFromElement(element, { fetchedAt, lane = "pubs" } = {}) {
  const tags = element?.tags ?? {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!name) return null;
  if (lane === "plain-bars") {
    if (!isPlainBar(tags)) return null;
  } else if (!isHarvestableTags(tags)) {
    return null;
  }

  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const type = typeof element.type === "string" ? element.type : null;
  const id = element.id;
  const sourceUrl = osmObjectUrl(type, id);
  if (!sourceUrl || !isNonEmptyString(fetchedAt)) return null;

  const websiteValue = tags.website || tags["contact:website"] || null;
  const website = isNonEmptyString(websiteValue)
    ? { value: websiteValue.trim(), sourceUrl, fetchedAt }
    : null;

  const addressTags = collectAddressTags(tags);
  const socialTags = collectSocialTags(tags, sourceUrl, fetchedAt);

  return {
    osmId: `${type}/${id}`,
    name,
    amenity: tags.amenity,
    lat,
    lng,
    addressTags,
    website,
    socialTags: Object.keys(socialTags).length > 0 ? socialTags : {},
    license: ODBL_LICENSE,
    attribution: ODBL_ATTRIBUTION,
    sourceUrl,
    fetchedAt,
  };
}

/**
 * Normalize raw Overpass elements into OSM-id-unique seed rows.
 * Bars that are not pub-like are dropped and counted.
 * @param {Iterable<any>} elements
 * @param {{ fetchedAt: string }} options
 */
export function normalizeHarvestElements(elements, { fetchedAt, lane = "pubs" } = {}) {
  const byOsmId = new Map();
  let droppedUnnamed = 0;
  let droppedPlainBar = 0;
  let droppedPubOrPubLike = 0;
  let droppedNoPoint = 0;
  for (const element of elements ?? []) {
    const tags = element?.tags ?? {};
    if (lane === "plain-bars") {
      if (tags.amenity === "pub" || isPubLikeBar(tags)) {
        droppedPubOrPubLike += 1;
        continue;
      }
    } else if (isPlainBar(tags)) {
      droppedPlainBar += 1;
      continue;
    }
    const row = seedRowFromElement(element, { fetchedAt, lane });
    if (!row) {
      const name = typeof tags.name === "string" ? tags.name.trim() : "";
      if (!name) droppedUnnamed += 1;
      else droppedNoPoint += 1;
      continue;
    }
    if (byOsmId.has(row.osmId)) continue;
    byOsmId.set(row.osmId, row);
  }
  const rows = [...byOsmId.values()].sort((a, b) => a.osmId.localeCompare(b.osmId));
  return {
    rows,
    drops: {
      unnamed: droppedUnnamed,
      plainBar: droppedPlainBar,
      pubOrPubLike: droppedPubOrPubLike,
      noPoint: droppedNoPoint,
    },
  };
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function pathnameOf(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function httpsUrl(value) {
  if (!isNonEmptyString(value)) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function looksLikeMenu(url, title) {
  const pathName = pathnameOf(url);
  const blob = `${pathName} ${title ?? ""}`.toLowerCase();
  return /\b(menu|drinks-list|wine-list|price-list)\b/.test(blob) || /\/(menu|menus|drinks)(\/|$)/.test(pathName);
}

function looksLikeHistory(text, title) {
  const blob = `${title ?? ""} ${text ?? ""}`;
  return /\b(since\s+\d{3,4}|founded|history|established|opened in)\b/i.test(blob);
}

function hitBody(hit) {
  if (isNonEmptyString(hit?.text)) return hit.text;
  if (Array.isArray(hit?.highlights)) {
    return hit.highlights.filter((part) => isNonEmptyString(part)).join(" ");
  }
  return "";
}

/**
 * @param {{ query: string, purpose?: "lore" | "menu" }} input
 */
export function buildExaSearchBody({ query, purpose = "lore" } = {}) {
  /** @type {{ highlights: true, maxAgeHours?: number }} */
  const contents = { highlights: true };
  if (purpose === "menu") contents.maxAgeHours = 24;
  return {
    query,
    type: "auto",
    numResults: 8,
    systemPrompt: EXA_SYSTEM_PROMPT,
    outputSchema: EXA_PUB_OUTPUT_SCHEMA,
    contents,
  };
}

/**
 * /contents takes highlights at the top level, not nested under contents.
 * @param {{ urls: string[], purpose?: "lore" | "menu" }} input
 */
export function buildExaContentsBody({ urls, purpose = "lore" } = {}) {
  /** @type {{ urls: string[], highlights: true, maxAgeHours?: number }} */
  const body = { urls: [...(urls ?? [])], highlights: true };
  if (purpose === "menu") body.maxAgeHours = 24;
  return body;
}

export function officialWebsiteUrl(pub) {
  return httpsUrl(pub?.website?.value);
}

/**
 * Classify one Exa hit. Null when there is no https source URL.
 * Never invents a kind from the pub's name alone.
 * @param {{ url?: string, title?: string, text?: string }} hit
 */
export function classifyExaHit(hit) {
  const url = httpsUrl(hit?.url);
  if (!url) return null;
  const host = hostnameOf(url);
  const body = hitBody(hit);
  if (host && SOCIAL_HOSTS.has(host)) return { kind: "social", url };
  if (looksLikeMenu(url, hit?.title)) return { kind: "menu", url };
  const pathName = pathnameOf(url);
  if (pathName === "/" || pathName === "") return { kind: "website", url };
  if (looksLikeHistory(body, hit?.title)) return { kind: "history", url };
  if (isNonEmptyString(body) || isNonEmptyString(hit?.title)) return { kind: "coverage", url };
  return { kind: "website", url };
}

/**
 * @param {{ osmId: string, name: string }} pub
 * @param {any[]} results
 * @param {string} fetchedAt
 */
function pushObservation(observations, seen, kind, value, sourceUrl, fetchedAt, snippet) {
  const key = `${kind}|${sourceUrl}|${value}`;
  if (seen.has(key)) return;
  const row = observation(kind, value, sourceUrl, fetchedAt);
  if (!row) return;
  if (isNonEmptyString(snippet)) row.snippet = snippet.trim().slice(0, 1_200);
  seen.add(key);
  observations.push(row);
}

export function observationsFromExaResults(pub, results, fetchedAt) {
  const observations = [];
  const seen = new Set();
  for (const hit of Array.isArray(results) ? results : []) {
    const classified = classifyExaHit(hit);
    if (!classified) continue;

    const body = hitBody(hit);
    if (classified.kind === "history") {
      const snippet = isNonEmptyString(body) ? body.trim() : hit.title?.trim();
      pushObservation(observations, seen, "history", snippet, classified.url, fetchedAt, snippet);
    } else if (classified.kind === "social") {
      pushObservation(observations, seen, "social", classified.url, classified.url, fetchedAt);
    } else if (classified.kind === "coverage") {
      const value = isNonEmptyString(hit.title) ? hit.title.trim() : classified.url;
      pushObservation(observations, seen, "coverage", value, classified.url, fetchedAt);
    } else {
      pushObservation(observations, seen, classified.kind, classified.url, classified.url, fetchedAt);
    }

    // A first-party page may also STATE history. That is a second observation
    // from the same sourceUrl, never a guess from the pub name.
    if (classified.kind !== "history" && looksLikeHistory(body, hit?.title)) {
      const snippet = isNonEmptyString(body) ? body.trim() : hit.title?.trim();
      pushObservation(observations, seen, "history", snippet, classified.url, fetchedAt, snippet);
    }
  }
  return observations;
}

function firstCitationUrl(entry) {
  const citations = Array.isArray(entry?.citations) ? entry.citations : [];
  for (const citation of citations) {
    const url = httpsUrl(citation?.url);
    if (url) return url;
  }
  return null;
}

function groundingEntriesFor(grounding, field, index) {
  const rows = Array.isArray(grounding) ? grounding : [];
  const indexed = `${field}[${index}]`;
  const exact = rows.filter((row) => row?.field === indexed);
  if (exact.length > 0) return exact;
  return rows.filter((row) => row?.field === field);
}

/**
 * Observations from Exa structured output. A field without an https citation
 * is dropped: grounding is the source, not the model text.
 * @param {Record<string, unknown> | undefined} content
 * @param {any[]} grounding
 * @param {string} fetchedAt
 */
export function groundedMenuUrls(output) {
  const pages = output?.content?.menuOrPricePages;
  const grounding = output?.grounding;
  if (!Array.isArray(pages)) return [];
  const urls = [];
  const seen = new Set();
  pages.forEach((item, index) => {
    if (!isNonEmptyString(item)) return;
    const sourceUrl = firstCitationUrl(groundingEntriesFor(grounding, "menuOrPricePages", index)[0]);
    if (!sourceUrl) return;
    const href = httpsUrl(item);
    if (!href || seen.has(href)) return;
    seen.add(href);
    urls.push(href);
  });
  return urls;
}

export function observationsFromExaOutput(content, grounding, fetchedAt) {
  const observations = [];
  const seen = new Set();
  if (!content || typeof content !== "object") return observations;

  for (const [field, kind] of Object.entries(OUTPUT_FIELD_KIND)) {
    const raw = content[field];
    if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        if (!isNonEmptyString(item)) return;
        const sourceUrl = firstCitationUrl(groundingEntriesFor(grounding, field, index)[0]);
        if (!sourceUrl) return;
        pushObservation(observations, seen, kind, item.trim(), sourceUrl, fetchedAt);
      });
      continue;
    }
    if (!isNonEmptyString(raw)) continue;
    const sourceUrl = firstCitationUrl(groundingEntriesFor(grounding, field, 0)[0]);
    if (!sourceUrl) continue;
    const snippet = kind === "history" ? raw.trim() : undefined;
    pushObservation(observations, seen, kind, raw.trim(), sourceUrl, fetchedAt, snippet);
  }
  return observations;
}

export function exaApiKey(env = process.env) {
  const value = typeof env.EXA_API_KEY === "string" ? env.EXA_API_KEY.trim() : "";
  return value.length > 0 ? value : null;
}

export function isExaConfigured(env = process.env) {
  return exaApiKey(env) !== null;
}

export function backoffMs(attempt, retryAfterHeader) {
  const retryAfterS = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterS) && retryAfterS > 0) {
    return Math.min(MAX_BACKOFF_MS, retryAfterS * 1_000);
  }
  return Math.min(MAX_BACKOFF_MS, 4_000 * 2 ** attempt);
}

const MOCK_HISTORY = {
  "the turks head": {
    results: [
      {
        url: "https://www.turksheadscilly.co.uk/",
        title: "The Turks Head",
        text: "The Turks Head has served St Agnes since the nineteenth century.",
      },
      {
        url: "https://www.instagram.com/turksheadscilly",
        title: "Instagram",
      },
    ],
    output: {
      content: {
        officialWebsite: "https://www.turksheadscilly.co.uk/",
        history: "The Turks Head has served St Agnes since the nineteenth century.",
        socialHandles: ["https://www.instagram.com/turksheadscilly"],
        menuOrPricePages: [],
        notableCoverage: [],
      },
      grounding: [
        {
          field: "officialWebsite",
          citations: [{ url: "https://www.turksheadscilly.co.uk/", title: "The Turks Head" }],
          confidence: "high",
        },
        {
          field: "history",
          citations: [{ url: "https://www.turksheadscilly.co.uk/", title: "The Turks Head" }],
          confidence: "high",
        },
        {
          field: "socialHandles[0]",
          citations: [{ url: "https://www.instagram.com/turksheadscilly", title: "Instagram" }],
          confidence: "high",
        },
      ],
    },
  },
};

/**
 * Deterministic Exa stand-in. Returns sourced hits for a tiny named fixture
 * set, and an empty result list for every other pub. Empty is honest: the mock
 * did not observe a page.
 * @param {{ name: string }} pub
 */
export function mockExaPayload(pub) {
  const haystack = String(pub?.name ?? "")
    .trim()
    .toLowerCase();
  for (const [key, payload] of Object.entries(MOCK_HISTORY)) {
    if (haystack === key || haystack.includes(key)) return payload;
  }
  return { results: [] };
}

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, mock?: boolean, requestTimeoutMs?: number }} [options]
 */
export function createExaClient({
  env = process.env,
  fetchImpl = fetch,
  sleep = sleepDefault,
  mock = false,
  requestTimeoutMs = EXA_REQUEST_TIMEOUT_MS,
} = {}) {
  if (mock) {
    return {
      mock: true,
      async search(query) {
        return mockExaPayload({ name: query });
      },
      async contents() {
        return { results: [] };
      },
    };
  }
  const key = exaApiKey(env);
  if (!key) return null;

  async function post(url, body) {
    let lastError = null;
    for (let attempt = 0; attempt < EXA_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const aborted =
          error?.name === "AbortError" ||
          (error instanceof Error && /aborted|timeout/i.test(error.message));
        if (aborted && attempt < EXA_MAX_ATTEMPTS - 1) {
          lastError = new Error(`Exa timeout after ${requestTimeoutMs}ms`);
          await sleep(backoffMs(attempt, null));
          continue;
        }
        throw error;
      }
      if (response.status === 429 || response.status === 502 || response.status === 503) {
        clearTimeout(timer);
        const wait = backoffMs(attempt, response.headers.get("retry-after"));
        lastError = new Error(`Exa ${response.status}`);
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        clearTimeout(timer);
        const text = await response.text().catch(() => "");
        throw new Error(`Exa ${response.status}: ${text.slice(0, 200)}`);
      }
      try {
        const payload = await response.json();
        clearTimeout(timer);
        return payload;
      } catch (error) {
        clearTimeout(timer);
        const aborted =
          error?.name === "AbortError" ||
          (error instanceof Error && /aborted|timeout/i.test(error.message));
        if (aborted && attempt < EXA_MAX_ATTEMPTS - 1) {
          lastError = new Error(`Exa timeout after ${requestTimeoutMs}ms`);
          await sleep(backoffMs(attempt, null));
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error("Exa request failed");
  }

  return {
    mock: false,
    async search(query, { purpose = "lore" } = {}) {
      const payload = await post(EXA_SEARCH_URL, buildExaSearchBody({ query, purpose }));
      return {
        results: Array.isArray(payload?.results) ? payload.results : [],
        output: payload?.output,
      };
    },
    async contents(urls, { purpose = "lore" } = {}) {
      const payload = await post(EXA_CONTENTS_URL, buildExaContentsBody({ urls, purpose }));
      return { results: Array.isArray(payload?.results) ? payload.results : [] };
    },
  };
}

function mergeObservations(rows) {
  const seen = new Set();
  const merged = [];
  for (const row of rows) {
    if (!row) continue;
    const key = `${row.kind}|${row.sourceUrl}|${row.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

export function enrichPub(pub, exaPayload, fetchedAt) {
  const observations = mergeObservations([
    ...observationsFromExaOutput(exaPayload?.output?.content, exaPayload?.output?.grounding, fetchedAt),
    ...observationsFromExaResults(pub, exaPayload?.results, fetchedAt),
  ]);
  const record = {
    osmId: pub.osmId,
    name: pub.name,
    lat: pub.lat,
    lng: pub.lng,
    observations,
    fetchedAt,
  };
  if (exaPayload?.output && typeof exaPayload.output === "object") {
    record.output = {
      content: exaPayload.output.content ?? null,
      grounding: Array.isArray(exaPayload.output.grounding) ? exaPayload.output.grounding : [],
    };
  }
  return record;
}

/**
 * One pub: cheaper /contents on an OSM-stated website, then /search with
 * structured output. Menu page URLs from that output use maxAgeHours 24.
 * @param {HarvestSeedRow} pub
 * @param {ExaClient} client
 * @param {string} fetchedAt
 */
export async function enrichPubWithClient(pub, client, fetchedAt) {
  const results = [];
  const site = officialWebsiteUrl(pub);
  if (site) {
    try {
      const page = await client.contents([site], { purpose: "lore" });
      results.push(...(page?.results ?? []));
    } catch (error) {
      if (isFatalExaError(error)) throw error;
      // A failed contents read is absence, not a guessed website.
    }
  }

  let searchPayload = { results: [] };
  try {
    searchPayload = await client.search(harvestSearchQuery(pub), { purpose: "lore" });
    results.push(...(searchPayload?.results ?? []));
  } catch (error) {
    if (isFatalExaError(error)) throw error;
    // A failed search is an empty observation list, not a guessed fact.
  }

  const record = enrichPub(pub, { results, output: searchPayload?.output }, fetchedAt);

  const menuUrls = groundedMenuUrls(searchPayload?.output).filter((href) => href !== site);
  if (menuUrls.length === 0) return record;
  try {
    const menu = await client.contents(menuUrls.slice(0, 2), { purpose: "menu" });
    record.observations = mergeObservations([
      ...record.observations,
      ...observationsFromExaResults(pub, menu?.results, fetchedAt),
    ]);
  } catch (error) {
    if (isFatalExaError(error)) throw error;
    // Keep the search observations. A failed menu fetch does not invent a menu.
  }
  return record;
}

export function isFatalExaError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Exa 401\b|Exa 402\b|NO_MORE_CREDITS|INVALID_API_KEY/.test(message);
}

export function shardFileName(index) {
  return `shard_${String(index).padStart(4, "0")}.jsonl`;
}

export function nextShardIndexFromNames(names) {
  const complete = (Array.isArray(names) ? names : [])
    .filter((name) => /^shard_\d{4}\.jsonl$/.test(name))
    .map((name) => Number(name.slice(6, 10)));
  if (complete.length === 0) return 0;
  return Math.max(...complete) + 1;
}

export function nextShardIndex(dirOrNames) {
  if (Array.isArray(dirOrNames)) return nextShardIndexFromNames(dirOrNames);
  if (typeof dirOrNames !== "string" || !existsSync(dirOrNames)) return 0;
  return nextShardIndexFromNames(readdirSync(dirOrNames));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listCompleteShardIndexes(dir) {
  if (!(await fileExists(dir))) return [];
  const names = await readdir(dir);
  return names
    .filter((name) => /^shard_\d{4}\.jsonl$/.test(name))
    .map((name) => Number(name.slice(6, 10)))
    .sort((a, b) => a - b);
}

export async function persistedShardRowCount(dir) {
  const indexes = await listCompleteShardIndexes(dir);
  let count = 0;
  for (const index of indexes) {
    const rows = await readJsonl(path.join(dir, shardFileName(index)));
    count += Array.isArray(rows) ? rows.length : 0;
  }
  return count;
}

export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!metaUrl || !argv1) return false;
  try {
    return metaUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

export async function writeJsonlAtomic(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp`);
  const body = `${(Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n")}${
    rows?.length ? "\n" : ""
  }`;
  try {
    await writeFile(temporaryPath, body);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function readJsonl(filePath) {
  const text = await readFile(filePath, "utf8");
  if (!text.trim()) return [];
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

export async function writeShardAtomic(dir, index, rows) {
  await mkdir(dir, { recursive: true });
  await writeJsonlAtomic(path.join(dir, shardFileName(index)), rows);
}

export async function writeProgress(dir, progress) {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, PROGRESS_FILE);
  const temporaryPath = path.join(dir, `.${PROGRESS_FILE}.tmp`);
  const body = `${JSON.stringify(progress, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, body);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function loadProgress(dir) {
  const filePath = path.join(dir, PROGRESS_FILE);
  if (!(await fileExists(filePath))) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function estimateEta({ remaining, elapsedMs, done, now = Date.now() }) {
  const ratePerMs = done > 0 && elapsedMs > 0 ? done / elapsedMs : 0;
  const ratePerHour = ratePerMs * 3_600_000;
  const remainingMs = ratePerMs > 0 ? remaining / ratePerMs : null;
  const etaIso =
    remainingMs === null ? null : new Date(now + remainingMs).toISOString();
  return { ratePerHour, remainingMs, etaIso };
}

export function harvestSearchQuery(pub) {
  const place =
    pub?.addressTags?.["addr:city"] ||
    pub?.addressTags?.["addr:town"] ||
    pub?.addressTags?.["addr:village"] ||
    "";
  const kind = pub?.amenity === "bar" ? "bar" : "pub";
  const bits = [pub?.name, place, `UK ${kind} official website history`].filter(Boolean);
  return bits.join(" ");
}

export function pubsEnrichComplete(progress) {
  if (!progress || typeof progress !== "object") return false;
  const seedCount = Number(progress.seedCount);
  const enrichedCount = Number(progress.enrichedCount);
  if (!Number.isFinite(seedCount) || seedCount <= 0) return false;
  if (!Number.isFinite(enrichedCount) || enrichedCount < seedCount) return false;
  if (progress.mock === true) return false;
  return progress.stage === "done" || progress.stage === "enrich";
}

export function seedSample(rows, limit = 100) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit);
}
