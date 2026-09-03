import { createHash } from "node:crypto";
import canonicalAreaSlugs from "../../data/area_news_areas.json" with { type: "json" };
import venueIndex from "../../public/data/venues_slim.json" with { type: "json" };
import { matchVenue, slugifyBorough } from "./areaNewsMatch.mjs";

export const KEENABLE_API_BASE = "https://api.keenable.ai";
export const KEENABLE_TITLE = "PUBMAXX area news refresh";

export const KNOWN_AREA_SLUGS = new Set(canonicalAreaSlugs);

const KINDS = new Set(["opening", "closure", "refurb", "award", "threat", "buzz"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const AREA_BOROUGH_BY_SLUG = new Map(Object.entries({
  soho: "westminster",
  fitzrovia: "westminster",
  marylebone: "westminster",
  mayfair: "westminster",
  "covent-garden": "westminster",
  bloomsbury: "camden",
  holborn: "camden",
  "notting-hill": "kensington-and-chelsea",
  hammersmith: "hammersmith-and-fulham",
  fulham: "hammersmith-and-fulham",
  chiswick: "hounslow",
  isleworth: "hounslow",
  richmond: "richmond-upon-thames",
  teddington: "richmond-upon-thames",
  hampton: "richmond-upon-thames",
  twickenham: "richmond-upon-thames",
  kingston: "kingston-upon-thames",
  shoreditch: "hackney",
  "hackney-wick": "hackney",
  dalston: "hackney",
  "stoke-newington": "hackney",
  "bethnal-green": "tower-hamlets",
  bow: "tower-hamlets",
  whitechapel: "tower-hamlets",
  limehouse: "tower-hamlets",
  "canary-wharf": "tower-hamlets",
  walthamstow: "waltham-forest",
  leyton: "waltham-forest",
  stratford: "newham",
  dagenham: "barking-and-dagenham",
  romford: "havering",
  ilford: "redbridge",
  clapham: "lambeth",
  "clapham-junction": "wandsworth",
  battersea: "wandsworth",
  brixton: "lambeth",
  streatham: "lambeth",
  peckham: "southwark",
  camberwell: "southwark",
  dulwich: "southwark",
  "tulse-hill": "lambeth",
  tooting: "wandsworth",
  putney: "wandsworth",
  wimbledon: "merton",
  deptford: "lewisham",
  "new-cross": "lewisham",
  catford: "lewisham",
  "grove-park": "lewisham",
  "forest-hill": "lewisham",
  "crystal-palace": "croydon",
  penge: "bromley",
  purley: "croydon",
  camden: "camden",
  "kentish-town": "camden",
  islington: "islington",
  highbury: "islington",
  holloway: "islington",
  archway: "islington",
  highgate: "haringey",
  hampstead: "camden",
  "west-hampstead": "camden",
  "crouch-end": "haringey",
  "muswell-hill": "haringey",
  "wood-green": "haringey",
  tottenham: "haringey",
  harringay: "haringey",
  "kings-cross": "camden",
  euston: "camden",
  greenwich: "greenwich",
  finchley: "barnet",
  "palmers-green": "enfield",
  wembley: "brent",
  pinner: "harrow",
  kilburn: "brent",
  willesden: "brent",
}));

export function areaNewsExtractPrompt(year = new Date().getUTCFullYear()) {
  return `Return JSON only with keys area, kind, title, detail for one real London pub fact explicitly stated on this page. Use area as one of ${[...KNOWN_AREA_SLUGS].join(", ")}, or null if no named pub fact maps to one of those areas. Use kind opening for a new opening, closure for a closing, refurb for refurbishment, award for an award, threat for a risk or licensing threat, and buzz for a current price or other pub news. The fact itself must describe a current ${year} event or a fact from late ${year - 1} that is still within the 21-day window, not an older historical fact. Include an exact day, month, and year, plus a venue name present in the London venue dataset. Do not infer or invent facts. Do not include em dashes or en dashes.`;
}

export const AREA_NEWS_EXTRACT_PROMPT = areaNewsExtractPrompt();

function apiUrl(apiBase, path, key) {
  const base = apiBase.replace(/\/$/, "");
  return `${base}${key ? path : `${path}/public`}`;
}

function apiKey(env) {
  const value = env?.KEENABLE_API_KEY;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requestHeaders(key, title) {
  return key
    ? { "X-API-Key": key, "content-type": "application/json" }
    : { "X-Keenable-Title": title, "content-type": "application/json" };
}

async function readJson(response, operation) {
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Keenable ${operation} returned ${response.status}.`);
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error(`Keenable ${operation} returned malformed JSON.`);
  }
}

export async function searchKeenable(
  query,
  {
    env = process.env,
    fetchImpl = fetch,
    apiBase = KEENABLE_API_BASE,
    title = KEENABLE_TITLE,
    publishedAfter,
    publishedBefore,
    queryTime,
    maxResults = 10,
    snippetMaxLength = 1200,
    signal,
  } = {},
) {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Keenable search query is required.");
  }

  const key = apiKey(env);
  const body = {
    query: query.trim(),
    max_results: maxResults,
    snippet_max_length: snippetMaxLength,
  };
  if (publishedAfter) body.published_after = publishedAfter;
  if (publishedBefore) body.published_before = publishedBefore;
  if (queryTime) body.query_time = queryTime;

  const response = await fetchImpl(apiUrl(apiBase, "/v1/search", key), {
    method: "POST",
    headers: requestHeaders(key, title),
    body: JSON.stringify(body),
    signal,
  });
  const payload = await readJson(response, "search");
  if (!Array.isArray(payload?.results)) {
    throw new Error("Keenable search response did not contain results.");
  }
  return payload.results;
}

export async function fetchKeenable(
  sourceUrl,
  {
    env = process.env,
    fetchImpl = fetch,
    apiBase = KEENABLE_API_BASE,
    title = KEENABLE_TITLE,
    maxChars = 6000,
    prompt = areaNewsExtractPrompt(),
    signal,
  } = {},
) {
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("Keenable fetch requires a valid source URL.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Keenable fetch requires an https source URL.");
  }

  const key = apiKey(env);
  const params = new URLSearchParams({
    url: parsedUrl.toString(),
    max_chars: String(maxChars),
  });
  if (prompt) params.set("prompt", prompt);

  const response = await fetchImpl(`${apiUrl(apiBase, "/v1/fetch", key)}?${params}`, {
    headers: key ? { "X-API-Key": key } : { "X-Keenable-Title": title },
    signal,
  });
  const payload = await readJson(response, "fetch");
  if (typeof payload?.content !== "string" || !payload.content.trim()) {
    throw new Error("Keenable fetch response did not contain content.");
  }
  return payload;
}

function parseJsonText(content) {
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  if (!trimmed || trimmed === "null") return null;

  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanMarkdownText(value) {
  return cleanText(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ");
}

function markdownArea(text, knownAreas) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const searchable = ` ${normalized} `;
  return [...knownAreas]
    .sort((left, right) => right.length - left.length)
    .find((slug) => {
      const areaName = slug.replace(/-/g, " ");
      return searchable.includes(` ${areaName} `);
    });
}

function markdownKind(text) {
  if (/\b(?:refurb(?:ishment)?|renovat(?:e|es|ed|ing))\b/i.test(text)) return "refurb";
  if (/\b(?:close(?:s|d|ing)?|closure|shut(?:s|ting)?)\b/i.test(text)) return "closure";
  if (/\b(?:open(?:s|ed|ing)?|reopen(?:s|ed|ing)?|launch(?:es|ed|ing)?)\b/i.test(text)) return "opening";
  if (/\b(?:award|awarded|winner|won)\b/i.test(text)) return "award";
  if (/\b(?:threat|threatened|licensing|planning|at risk|save the)\b/i.test(text)) return "threat";
  if (/\b(?:price|pint|menu|news)\b/i.test(text)) return "buzz";
  return null;
}

// The map index is revisioned for cache invalidation, while older data packs
// used a top-level array. Area-news matching needs rows only and must support
// both persisted shapes at this boundary.
const venueRows = Array.isArray(venueIndex) ? venueIndex : venueIndex?.rows;
const KNOWN_VENUES = (venueRows ?? [])
  .map((venue) => ({
    id: typeof venue?.id === "string" ? venue.id : "",
    name: typeof venue?.name === "string" ? venue.name.trim() : "",
    borough: typeof venue?.borough === "string" ? venue.borough.trim() : "",
  }))
  .filter((venue) => venue.id && venue.name && venue.borough);

function venueWords(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function areaBoroughSlug(area, knownAreas) {
  if (!knownAreas.has(area)) return null;
  return AREA_BOROUGH_BY_SLUG.get(area) ?? area;
}

function venueNameOccurs(text, name) {
  const words = venueWords(text);
  const candidate = venueWords(name);
  if (candidate.length === 0 || candidate.length > words.length) return false;
  return words.some((_, index) => candidate.every((word, offset) => words[index + offset] === word));
}

function hasNamedPub(title, detail, area, knownAreas) {
  const expectedBorough = areaBoroughSlug(area, knownAreas);
  if (!expectedBorough) return false;
  const names = new Set();
  for (const field of [title, detail]) {
    for (const venue of KNOWN_VENUES) {
      if (venueNameOccurs(field, venue.name)) names.add(venue.name);
    }
  }
  const longestNameWords = Math.max(0, ...[...names].map((name) => venueWords(name).length));
  const longestNames = [...names].filter((name) => venueWords(name).length === longestNameWords);
  const resolved = longestNames
    .map((name) => matchVenue(name, slugifyBorough(expectedBorough), KNOWN_VENUES))
    .filter(Boolean);
  return resolved.length === 1;
}

function parseMarkdownFact(content, knownAreas, fallbackTitle = "") {
  if (typeof content !== "string" || !content.trim()) return null;
  const blocks = content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const heading = blocks
    .flatMap((block) => block.split("\n"))
    .find((line) => /^#{1,6}\s+/.test(line));
  const title = cleanMarkdownText(heading?.replace(/^#{1,6}\s+/, "") || fallbackTitle);
  const detail = blocks
    .map((block) => cleanMarkdownText(block.replace(/^#{1,6}\s+.*$/gm, "")))
    .find((block) => block && block !== title);
  if (!title || !detail) return null;

  const combined = `${title} ${detail}`;
  const area = markdownArea(combined, knownAreas);
  const kind = markdownKind(combined);
  if (!area || !kind) return null;
  return { area, kind, title, detail };
}

const MONTH_NUMBERS = new Map([
  ["january", 0],
  ["february", 1],
  ["march", 2],
  ["april", 3],
  ["may", 4],
  ["june", 5],
  ["july", 6],
  ["august", 7],
  ["september", 8],
  ["october", 9],
  ["november", 10],
  ["december", 11],
]);

function eventDateRanges(text) {
  const ranges = [];
  const addRange = (year, month, day) => {
    const start = Date.UTC(year, month, day ?? 1);
    const date = new Date(start);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || (day && date.getUTCDate() !== day)) return;
    const end = day ? start : Date.UTC(year, month + 1, 0);
    ranges.push({ year, start, end });
  };
  for (const [, year, month, day] of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    addRange(Number(year), Number(month) - 1, Number(day));
  }
  for (const [, day, month, year] of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi)) {
    addRange(Number(year), MONTH_NUMBERS.get(month.toLowerCase()), Number(day));
  }
  for (const [, month, day, year] of text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/gi)) {
    addRange(Number(year), MONTH_NUMBERS.get(month.toLowerCase()), Number(day));
  }
  return ranges;
}

function factDateIsCurrent(text, now) {
  const nowTime = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowTime)) return false;
  const nowDay = new Date(nowTime);
  nowDay.setUTCHours(0, 0, 0, 0);
  const oldestAllowed = nowDay.getTime() - 21 * DAY_MS;
  return eventDateRanges(text).some(
    ({ start, end }) => end >= oldestAllowed && start <= nowDay.getTime(),
  );
}

function validateFact(raw, knownAreas, currentYear, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const area = cleanText(raw.area);
  const kind = cleanText(raw.kind);
  const title = cleanText(raw.title);
  const detail = cleanText(raw.detail);
  if (!knownAreas.has(area) || !KINDS.has(kind) || !title || !detail) return null;
  if (/[—–]/u.test(`${title} ${detail}`)) return null;
  if (title.length > 180 || detail.length > 500) return null;
  const combined = `${title} ${detail}`;
  const years = [...combined.matchAll(/\b20\d{2}\b/g)].map(([year]) => Number(year));
  const allowedYears = new Set([currentYear, currentYear - 1]);
  const eventDates = eventDateRanges(combined);
  if (
    !Number.isInteger(currentYear) ||
    years.length === 0 ||
    !eventDates.some(({ year }) => allowedYears.has(year)) ||
    years.some((year) => !allowedYears.has(year)) ||
    !factDateIsCurrent(combined, now ?? Date.now()) ||
    !hasNamedPub(title, detail, area, knownAreas)
  ) {
    return null;
  }

  return { area, kind, title, detail };
}

export function parseExtractedFact(
  payload,
  { knownAreas = KNOWN_AREA_SLUGS, currentYear = new Date().getUTCFullYear(), now } = {},
) {
  const raw = parseJsonText(payload?.content);
  const parsed = raw ?? parseMarkdownFact(payload?.content, knownAreas, payload?.title);
  return validateFact(parsed, knownAreas, currentYear, now);
}

function publishedTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function sourceName(sourceUrl) {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

export function buildAreaNewsEntry({ result, page, fact, now = Date.now(), knownAreas = KNOWN_AREA_SLUGS } = {}) {
  const candidateUrl = page?.url || result?.url;
  let url;
  try {
    url = new URL(candidateUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;

  const publishedAt = publishedTime(page?.published_at ?? result?.published_at);
  if (!Number.isFinite(publishedAt)) return null;
  const nowTime = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowTime) || publishedAt > nowTime) return null;
  const validFact = parseExtractedFact(
    { content: JSON.stringify(fact) },
    { knownAreas, currentYear: new Date(nowTime).getUTCFullYear(), now: nowTime },
  );
  if (!validFact) return null;

  const nowDay = new Date(nowTime);
  nowDay.setUTCHours(0, 0, 0, 0);
  const publishedDay = new Date(publishedAt);
  publishedDay.setUTCHours(0, 0, 0, 0);
  if (publishedDay.getTime() < nowDay.getTime() - 21 * DAY_MS) return null;

  const sourceUrl = url.toString();
  const idSeed = `${validFact.area}|${validFact.kind}|${sourceUrl}|${validFact.title}`;
  const id = `area-news-${createHash("sha256").update(idSeed).digest("hex").slice(0, 16)}`;
  return {
    id,
    ...validFact,
    sourceUrl,
    sourceName: sourceName(sourceUrl),
    observedAt: publishedDay.toISOString().slice(0, 10),
  };
}
