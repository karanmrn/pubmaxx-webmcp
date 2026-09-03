/**
 * The ONE Overpass client the UK seed builders share: endpoints, retry and
 * backoff, what counts as a valid response, what counts as a stale snapshot,
 * and the atomic same-directory JSON write.
 *
 * Extracted from scripts/fetch_uk_osm_pubs.mjs when the venue fetcher joined it,
 * because two copies of "which statuses are retryable" is how one lane quietly
 * stops honouring Overpass etiquette while the other still does.
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Endpoints are split into two tiers because a flat rotation SPENDS attempts on
 * a mirror that is down. Probed 2026-08-16: `overpass-api.de` and the mail.ru
 * mirror both answered a trivial query in seconds off the same minute-fresh
 * snapshot; `private.coffee` answered 504, and `kumi.systems` either timed out
 * or served a snapshot ten weeks old (which `isFreshOverpassSnapshot` refuses).
 *
 * With one flat list, attempts 3 and 4 of every chunk went to those two and
 * paid their full timeouts plus the backoff behind them, which turned a two
 * hour pull into a day of waiting. So the primaries take the first attempts and
 * the degraded pair only sees the tail, where a recovered mirror is a bonus
 * rather than the cost of every chunk.
 */
export const OVERPASS_PRIMARY_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export const OVERPASS_FALLBACK_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export const OVERPASS_ENDPOINTS = [
  ...OVERPASS_PRIMARY_ENDPOINTS,
  ...OVERPASS_FALLBACK_ENDPOINTS,
];

/** Attempts before the rotation drops to the degraded mirrors. */
export const PRIMARY_ATTEMPTS = 4;

/** @param {number} attempt zero-based */
export function endpointForAttempt(attempt) {
  if (attempt < PRIMARY_ATTEMPTS) {
    return OVERPASS_PRIMARY_ENDPOINTS[attempt % OVERPASS_PRIMARY_ENDPOINTS.length];
  }
  const index = attempt - PRIMARY_ATTEMPTS;
  return OVERPASS_FALLBACK_ENDPOINTS[index % OVERPASS_FALLBACK_ENDPOINTS.length];
}

/** A hung mirror answers nothing and holds the socket open, so the request is
 * abandoned a little past the query's own [timeout:90]. Without this, one
 * unresponsive endpoint stalls a chunk for as long as it likes. */
export const REQUEST_TIMEOUT_MS = 120_000;

export const INTER_CHUNK_DELAY_MS = 8_000;
export const INTER_CHUNK_DELAY_STALE_MS = 3_000;
export const MAX_ATTEMPTS = 6;
export const MAX_BACKOFF_MS = 180_000;
export const QUERY_TIMEOUT_S = 90;
export const MAX_SOURCE_AGE_MS = 48 * 60 * 60 * 1_000;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
/** Guard from the wave brief: stop before committing a data drop this large. */
export const COMMIT_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;

export const USER_AGENT =
  "PubMaxing/0.1 (UK pub seed; contact: github.com/karanmrn/pubmax)";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function backoffMs(attempt, retryAfterHeader) {
  const retryAfterS = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterS) && retryAfterS > 0) {
    return Math.min(MAX_BACKOFF_MS, retryAfterS * 1_000);
  }
  return Math.min(MAX_BACKOFF_MS, 4_000 * 2 ** attempt);
}

export function isValidOverpassRaw(raw) {
  return (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray(raw.elements) &&
    !(typeof raw.remark === "string" && raw.remark.trim().length > 0)
  );
}

export function parseOverpassRawText(text) {
  try {
    const raw = JSON.parse(text);
    return isValidOverpassRaw(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function isFreshOverpassSnapshot(raw, nowMs = Date.now()) {
  if (!isValidOverpassRaw(raw)) return false;
  const timestampMs = Date.parse(raw.osm3s?.timestamp_osm_base ?? "");
  if (!Number.isFinite(timestampMs)) return false;
  return (
    timestampMs >= nowMs - MAX_SOURCE_AGE_MS &&
    timestampMs <= nowMs + MAX_FUTURE_CLOCK_SKEW_MS
  );
}

/**
 * POST one Overpass query, retrying retryable statuses across the endpoint list
 * with exponential backoff. Throws when every attempt is spent.
 *
 * @param {string} query
 * @param {{ allowStale?: boolean }} [options]
 */
export async function fetchOverpass(query, { allowStale = false } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const endpoint = endpointForAttempt(attempt);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const err = new Error(`Overpass ${response.status} from ${endpoint}: ${body.slice(0, 200)}`);
        if (isRetryableStatus(response.status)) {
          lastError = err;
          const backoff = backoffMs(attempt, response.headers.get("retry-after"));
          console.warn(`  rate-limit/backoff ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
          await sleep(backoff);
          continue;
        }
        err.fatal = true;
        throw err;
      }
      const raw = await response.json();
      if (!isValidOverpassRaw(raw)) {
        throw new Error(`Invalid Overpass JSON from ${endpoint}: missing elements or contains remark`);
      }
      if (!isFreshOverpassSnapshot(raw)) {
        const stamp = raw.osm3s?.timestamp_osm_base ?? "missing timestamp";
        if (!allowStale) {
          throw new Error(`Stale Overpass snapshot from ${endpoint}: ${stamp}`);
        }
        console.warn(`  accepting stale Overpass snapshot from ${endpoint}: ${stamp}`);
      }
      return raw;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.fatal) throw lastError;
      if (attempt < MAX_ATTEMPTS - 1) {
        const backoff = backoffMs(attempt, null);
        console.warn(`  fetch error, retry in ${backoff}ms: ${lastError.message}`);
        await sleep(backoff);
        continue;
      }
    }
  }
  throw lastError ?? new Error("Overpass fetch failed");
}

/**
 * Raw chunks are written compact: a full pull is hundreds of thousands of
 * elements across hundreds of files, and pretty-printing them would roughly
 * quadruple what the disk carries for zero readability gain on a
 * machine-generated dump.
 */
export async function writeJsonAtomic(filePath, content) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp`,
  );
  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function writeCompact(filePath, value) {
  await writeJsonAtomic(filePath, `${JSON.stringify(value)}\n`);
}

export async function writePretty(filePath, value) {
  await writeJsonAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
