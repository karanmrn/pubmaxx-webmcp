// Server-only MCP client for CityMCP London (https://citymcp.com/london/mcp).
//
// The upstream is a Streamable-HTTP MCP endpoint that answers `tools/call`
// requests as `text/event-stream` responses containing a single JSON-RPC
// message. We do NOT run a persistent client here — every call is a fresh
// POST with `Accept: application/json, text/event-stream`, matching the
// server's probe expectations (see `/tmp/citymcp-london-tools.json`).
//
// Design notes
// ------------
//  - Fail-soft: any transport, timeout, or JSON-RPC error surfaces as a typed
//    `CityMcpError` from `callCityMcpTool`, so API routes can degrade cleanly
//    without ever returning a hard 500 to the client.
//  - AbortController timeout (~10s by default; callers can override) keeps
//    the app snappy when the upstream is slow.
//  - `city_status` is cached in-process for CITY_STATUS_TTL_MS (~5min) to
//    protect the upstream from repeated pageloads and keep the map banner
//    render close to instant. The cache is module-scoped; per-instance in
//    serverless, which is fine because the TTL is short.
//  - No secrets: the endpoint is keyless. If we ever need auth headers, wire
//    them here.
//  - Test seams: exports `resetCityStatusCache()` and lets callers inject a
//    custom `fetchImpl` via options — the route tests do exactly this.

const DEFAULT_ENDPOINT = "https://citymcp.com/london/mcp";
const DEFAULT_TIMEOUT_MS = 10_000;
const CITY_STATUS_TTL_MS = 5 * 60 * 1000;
const PLACE_TTL_MS = 10 * 60 * 1000;
const THINGS_TO_DO_TTL_MS = 5 * 60 * 1000;
const JOURNEY_TTL_MS = 3 * 60 * 1000;
const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "pubmaxing-citymcp-client", version: "0.1.0" };
const JOURNEY_CAP = 3;
// Every in-memory cache below is module-scoped and gains one entry per unique
// key (place id, journey pair, things_to_do args…). In a long-lived server
// that's an unbounded memory leak, so we cap each Map and evict the oldest
// (insertion-order) entry once the cap is hit.
const CACHE_MAX_ENTRIES = 500;

/**
 * Write to a bounded Map cache. Re-inserting on write keeps the freshest key
 * sorted last so eviction drops the least-recently-written entry (LRU-ish).
 */
function setCappedCache<K, V>(cache: Map<K, V>, key: K, value: V): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

type TtlCacheEntry<V> = { value: V; expiresAt: number };

/**
 * Serve-last-known-on-error, mirroring TfL/last-train's `nearestStaticStation`
 * stale-serve (the audit's best-in-class reference).
 *
 *   fresh hit (within TTL)  → return the cached value as-is.
 *   expired / cold          → refetch (with the client's transient retry).
 *     success               → cache + return the fresh value.
 *     failure + last-known  → return the *expired* value stamped `stale:true`.
 *     failure + cold        → propagate the error (route still fail-soft empty).
 *
 * UX choice (documented in docs/adr/0003 + the audit): a slightly-stale banner
 * WITH a freshness label beats an empty one. The returned value keeps its
 * original upstream `asOf`, so the existing `checkedLabel`/`formatAsOfLabel`
 * renderers honestly show it as old ("Checked 12 Jul") rather than faking a
 * fresh timestamp. Expired entries are retained in the Map (only overwritten on
 * success, only dropped by the size cap), so no second cache tier is needed.
 * Each failing request still re-attempts upstream, so recovery is immediate —
 * exactly the stale-while-revalidate shape the CDN layer already uses.
 */
async function fetchWithStaleServe<V extends object>(
  cache: Map<string, TtlCacheEntry<V>>,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<V>,
): Promise<V> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const value = await fetcher();
    setCappedCache(cache, key, { value, expiresAt: now + ttlMs });
    return value;
  } catch (err) {
    const lastKnown = cache.get(key);
    if (lastKnown) {
      // Serve the last-known-good value, flagged stale. Spread a fresh object so
      // the marker never leaks back into the retained cache entry.
      return { ...lastKnown.value, stale: true };
    }
    throw err;
  }
}

// ---------- Public types ----------

export type CityMcpToolName =
  | "search_places"
  | "get_place"
  | "get_area"
  | "get_journey"
  | "city_status"
  | "things_to_do";

export type CityMcpCallOptions = {
  /** Abort after this many ms (default 10s). */
  timeoutMs?: number;
  /** Override endpoint (test injection; default is the live URL). */
  endpoint?: string;
  /** Override the fetch implementation (test injection). */
  fetchImpl?: typeof fetch;
  /** Override AbortSignal (advanced; usually leave alone). */
  signal?: AbortSignal;
  /**
   * Extra attempts on a *transient* failure (timeout / network / HTTP 429 or
   * 5xx), mirroring the TfL `tflGet` retry contract. Deterministic failures
   * (parse / rpc / 4xx / empty) are never retried — a second identical POST
   * would just double the latency. Defaults to 1 (one retry, two attempts).
   */
  retries?: number;
};

/** How many transient retries `callCityMcpTool` performs when unset. */
const DEFAULT_RETRIES = 1;

/**
 * Is this failure worth a second attempt? Mirrors the TfL `tflGet`
 * classification exactly: timeouts, network blips, and HTTP 429 / 5xx are
 * transient; a parse, rpc, 4xx, or empty error is deterministic (retrying is
 * pure latency with no upside).
 */
export function isTransientCityMcpError(err: unknown): boolean {
  if (!(err instanceof CityMcpError)) return false;
  if (err.kind === "timeout" || err.kind === "network") return true;
  if (err.kind === "http") {
    const status = err.httpStatus ?? 0;
    return status === 429 || status >= 500;
  }
  return false;
}

export class CityMcpError extends Error {
  readonly kind:
    | "network"
    | "timeout"
    | "http"
    | "parse"
    | "rpc"
    | "empty";
  readonly httpStatus?: number;
  readonly rpcCode?: number;
  constructor(
    message: string,
    kind: CityMcpError["kind"],
    extras?: { httpStatus?: number; rpcCode?: number },
  ) {
    super(message);
    this.name = "CityMcpError";
    this.kind = kind;
    this.httpStatus = extras?.httpStatus;
    this.rpcCode = extras?.rpcCode;
  }
}

// ---------- Structured content types (per probe notes) ----------

export type CityStatusSeverity = "info" | "notable" | "major";

export type CityStatusSignal = {
  headline: string;
  detail?: string;
  kind?: string;
  severity?: CityStatusSeverity | string;
  areas?: string[];
  postcodes?: string[];
  timeWindow?: string;
  sourceUrl?: string;
  fetchedAt?: string;
};

export type CityStatusWeather = {
  condition?: string;
  tempC?: number;
  feelsLikeC?: number;
  todayHighC?: number;
  todayLowC?: number;
  windMph?: number;
  precipProbabilityPct?: number;
  isDay?: boolean;
};

export type CityStatusTubeLine = {
  line: string;
  status: string;
  disruption?: string;
};

export type CityStatus = {
  asOf: string;
  weather?: CityStatusWeather;
  tubeLines?: CityStatusTubeLine[];
  signals: CityStatusSignal[];
  /**
   * True when this is a last-known-good value served because a live refresh
   * failed (see `fetchWithStaleServe`). The `asOf` timestamp is the original
   * upstream one, so the UI labels it honestly as old.
   */
  stale?: boolean;
};

export type SearchPlacesRow = {
  id: string;
  name: string;
  area?: string;
  location?: { lat: number; lng: number };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceBand?: string;
  openNow?: boolean;
};

// ---------- SSE / JSON-RPC parsing ----------

/**
 * Parse a Streamable-HTTP MCP response body. The upstream returns SSE frames
 * of the shape:
 *
 *   event: message
 *   data: {"jsonrpc":"2.0","id":1,"result":{...}}
 *
 * A `tools/call` response is always a single `event: message` frame carrying
 * one JSON-RPC envelope. We return the parsed envelope, or throw a typed
 * `CityMcpError` on shape/JSON failures. Exported for unit testing.
 */
export function parseSseJsonRpcBody(body: string): {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
} {
  // Some servers might reply with a plain JSON body if the client sent the
  // Accept header wrong; accept that too as a fallback.
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new CityMcpError(
        `Invalid JSON body: ${(err as Error).message}`,
        "parse",
      );
    }
  }

  const frames = trimmed.split(/\r?\n\r?\n/);
  for (const frame of frames) {
    // Collect `data:` continuation lines within one event.
    const dataLines: string[] = [];
    let eventName = "message";
    for (const rawLine of frame.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(":")) continue; // comment / heartbeat
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      const value =
        idx === -1 ? "" : line.slice(idx + 1).replace(/^\s/, "");
      if (field === "event") eventName = value;
      else if (field === "data") dataLines.push(value);
      // ignore id / retry — MCP tools/call never uses them for payload
    }
    if (eventName !== "message" || dataLines.length === 0) continue;
    const dataStr = dataLines.join("\n");
    try {
      return JSON.parse(dataStr) as {
        jsonrpc?: string;
        id?: number | string;
        result?: unknown;
        error?: { code?: number; message?: string; data?: unknown };
      };
    } catch (err) {
      throw new CityMcpError(
        `Invalid JSON-RPC frame: ${(err as Error).message}`,
        "parse",
      );
    }
  }
  throw new CityMcpError("No SSE `message` frame found", "empty");
}

// ---------- Core POST helper ----------

async function postJsonRpc(
  endpoint: string,
  payload: unknown,
  opts: CityMcpCallOptions,
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  // Combine caller signal + our timeout signal.
  const abortHandler = () => controller.abort();
  if (opts.signal) opts.signal.addEventListener("abort", abortHandler);
  try {
    return await fetchImpl(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // The upstream requires BOTH JSON and event-stream to be advertised.
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "user-agent": "PubMaxxing-CityMCP/0.1 (+https://pubmaxxing.com)",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // AbortError → timeout; anything else → generic network failure.
    const asErr = err as Error & { name?: string };
    if (asErr?.name === "AbortError") {
      throw new CityMcpError("CityMCP request timed out", "timeout");
    }
    throw new CityMcpError(
      `CityMCP network error: ${asErr?.message ?? String(err)}`,
      "network",
    );
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", abortHandler);
  }
}

// ---------- Public helpers ----------

let jsonRpcCounter = 1;
function nextJsonRpcId(): number {
  const id = jsonRpcCounter;
  jsonRpcCounter = jsonRpcCounter >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
  return id;
}

/**
 * Call a CityMCP London tool by name. Returns the parsed `result` object from
 * the JSON-RPC envelope (which contains at least `structuredContent`). Throws
 * `CityMcpError` on any failure — callers should try/catch and degrade.
 *
 * A single transient retry (timeout / network / 429 / 5xx) is applied by
 * default — see `opts.retries` — so a one-off blip on the third-party upstream
 * self-heals before the caller ever sees an error. Deterministic failures are
 * surfaced immediately.
 */
export async function callCityMcpTool<T = unknown>(
  name: CityMcpToolName,
  args: Record<string, unknown> = {},
  opts: CityMcpCallOptions = {},
): Promise<{ structuredContent?: T; content?: unknown; isError?: boolean }> {
  const retries = Math.max(0, opts.retries ?? DEFAULT_RETRIES);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callCityMcpToolOnce<T>(name, args, opts);
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isTransientCityMcpError(err)) continue;
      throw err;
    }
  }
  // Unreachable (the loop either returns or throws), but keeps the types honest.
  throw lastErr;
}

/** One CityMCP `tools/call` POST — no retry. See `callCityMcpTool`. */
async function callCityMcpToolOnce<T = unknown>(
  name: CityMcpToolName,
  args: Record<string, unknown> = {},
  opts: CityMcpCallOptions = {},
): Promise<{ structuredContent?: T; content?: unknown; isError?: boolean }> {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const payload = {
    jsonrpc: "2.0",
    id: nextJsonRpcId(),
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: { clientInfo: CLIENT_INFO },
    },
  };

  const res = await postJsonRpc(endpoint, payload, opts);
  if (!res.ok) {
    throw new CityMcpError(
      `CityMCP HTTP ${res.status}`,
      "http",
      { httpStatus: res.status },
    );
  }
  const text = await res.text();
  const envelope = parseSseJsonRpcBody(text);
  if (envelope.error) {
    throw new CityMcpError(
      envelope.error.message ?? "CityMCP RPC error",
      "rpc",
      { rpcCode: envelope.error.code },
    );
  }
  const result = envelope.result as
    | { structuredContent?: T; content?: unknown; isError?: boolean }
    | undefined;
  if (!result) {
    throw new CityMcpError("CityMCP RPC missing result", "empty");
  }
  if (result.isError) {
    throw new CityMcpError("CityMCP tool reported an error", "rpc");
  }
  return result;
}

// ---------- city_status: cached convenience ----------

type CityStatusCacheEntry = { value: CityStatus; expiresAt: number };
const cityStatusCache = new Map<string, CityStatusCacheEntry>();

/** Test-only: drop all cached city_status entries. */
export function resetCityStatusCache(): void {
  cityStatusCache.clear();
}

/**
 * Fetch `city_status` with an in-memory TTL of ~5 minutes. `borough` is
 * optional — the upstream filters signals when it's provided. Throws
 * `CityMcpError` on failure; callers fail-soft.
 */
export async function fetchCityStatus(
  args: { borough?: string } = {},
  opts: CityMcpCallOptions = {},
): Promise<CityStatus> {
  const cacheKey = args.borough ? `b:${args.borough}` : "_";
  return fetchWithStaleServe(cityStatusCache, cacheKey, CITY_STATUS_TTL_MS, async () => {
    const result = await callCityMcpTool<CityStatus>("city_status", args, opts);
    const structured = result.structuredContent;
    if (!structured || typeof structured !== "object") {
      throw new CityMcpError("city_status: missing structuredContent", "empty");
    }
    const normalised: CityStatus = {
      asOf: typeof structured.asOf === "string" ? structured.asOf : new Date().toISOString(),
      weather: structured.weather,
      tubeLines: Array.isArray(structured.tubeLines) ? structured.tubeLines : undefined,
      signals: Array.isArray(structured.signals) ? structured.signals : [],
    };
    return normalised;
  });
}

// ---------- search_places convenience ----------

export type SearchCityPlacesOpts = {
  limit?: number;
  near?: string;
  openNow?: boolean;
  minRating?: number;
  maxPrice?: "free" | "£" | "££" | "£££" | "££££";
  sort?: "relevance" | "rating" | "random";
  timeoutMs?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Search London venues by natural-language query and return thin rows for
 * scanning. Throws `CityMcpError` on failure.
 */
export async function searchCityPlaces(
  query: string,
  opts: SearchCityPlacesOpts = {},
): Promise<SearchPlacesRow[]> {
  const args: Record<string, unknown> = { query };
  if (typeof opts.limit === "number") args.limit = opts.limit;
  if (opts.near) args.near = opts.near;
  if (typeof opts.openNow === "boolean") args.openNow = opts.openNow;
  if (typeof opts.minRating === "number") args.minRating = opts.minRating;
  if (opts.maxPrice) args.maxPrice = opts.maxPrice;
  if (opts.sort) args.sort = opts.sort;
  const result = await callCityMcpTool<{ places?: unknown }>(
    "search_places",
    args,
    {
      timeoutMs: opts.timeoutMs,
      endpoint: opts.endpoint,
      fetchImpl: opts.fetchImpl,
    },
  );
  const places = result.structuredContent?.places;
  if (!Array.isArray(places)) return [];
  return places.filter((p): p is SearchPlacesRow => {
    return (
      p != null &&
      typeof p === "object" &&
      typeof (p as { id?: unknown }).id === "string" &&
      typeof (p as { name?: unknown }).name === "string"
    );
  });
}

// ---------- get_place: dossier fetch + short-TTL cache ----------

/**
 * Trimmed CityMCP place dossier the app is willing to render. This is a
 * defensive whitelist over the upstream `get_place` result — anything not
 * listed here is dropped before the value ever reaches the client so we
 * never leak giant raw dumps or invent fields.
 *
 * Only `deep:true` returns hygiene / transit / air / weather / michelin.
 * Every field is optional because the upstream may omit anything at any
 * time; the UI must render "nothing" rather than a fabricated fact.
 */
export type CityTransitStop = {
  name: string;
  modes?: string[];
  distanceM?: number;
};

export type CityPlace = {
  id: string;
  name?: string;
  address?: string;
  area?: string;
  location?: { lat: number; lng: number };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceBand?: string;
  openNow?: boolean;
  hours?: string[];
  // Optional enrichment (deep:true) — each carries the source when present,
  // never faked. Keep shape flexible; UI checks `value`.
  hygiene?: {
    value?: { businessName?: string; rating?: string | number };
    source?: string;
    fetchedAt?: string;
  };
  transit?: {
    value?: {
      /* Live get_place shape (2026): a list of nearby stops. */
      nearbyStops?: CityTransitStop[];
      /* Legacy fields kept for back-compat with older payloads/fixtures. */
      nearest?: string;
      lines?: string[];
      walkMinutes?: number;
      summary?: string;
    };
    source?: string;
  };
  air?: {
    value?: { index?: string | number; site?: string };
    source?: string;
  };
  weather?: {
    value?: {
      condition?: string;
      tempC?: number;
      precipProbabilityPct?: number;
    };
    source?: string;
  };
  /** Last-known-good value served after a failed live refresh. See CityStatus.stale. */
  stale?: boolean;
};

type PlaceCacheEntry = { value: CityPlace; expiresAt: number };
const placeCache = new Map<string, PlaceCacheEntry>();

/** Test-only: drop all cached place entries. */
export function resetCityPlaceCache(): void {
  placeCache.clear();
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function pickString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function pickStringArray(v: unknown, cap = 8): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, cap);
  return out.length > 0 ? out : undefined;
}

function pickLocation(v: unknown): { lat: number; lng: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const lat = pickNumber((v as { lat?: unknown }).lat);
  const lng = pickNumber((v as { lng?: unknown }).lng);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function pickScalar(v: unknown): string | number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function readEnrichmentBlock(
  raw: unknown,
): { value: Record<string, unknown>; source?: string; fetchedAt?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const value = b.value && typeof b.value === "object" ? (b.value as Record<string, unknown>) : undefined;
  if (!value) return null;
  return { value, source: pickString(b.source), fetchedAt: pickString(b.fetchedAt) };
}

function trimHygiene(raw: unknown): CityPlace["hygiene"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  const businessName = pickString(block.value.businessName);
  const rating = pickScalar(block.value.rating);
  if (!businessName && rating === undefined) return undefined;
  return {
    value: {
      ...(businessName ? { businessName } : {}),
      ...(rating !== undefined ? { rating } : {}),
    },
    source: block.source,
    fetchedAt: block.fetchedAt,
  };
}

function pickTransitStop(raw: unknown): CityTransitStop | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const name = pickString(rec.name);
  if (!name) return null;
  const modes = pickStringArray(rec.modes, 4);
  const distanceM = pickNumber(rec.distanceM);
  return {
    name,
    ...(modes ? { modes } : {}),
    ...(distanceM !== undefined ? { distanceM } : {}),
  };
}

function pickTransitStops(raw: unknown, cap = 3): CityTransitStop[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stops = raw
    .map(pickTransitStop)
    .filter((stop): stop is CityTransitStop => stop !== null)
    .slice(0, cap);
  return stops.length > 0 ? stops : undefined;
}

function trimTransit(raw: unknown): CityPlace["transit"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  // Live get_place shape first (transit.value.nearbyStops[]); the older
  // nearest/lines/walkMinutes/summary fields are kept as a fallback so old
  // payloads and fixtures still render. Without this remap the strip showed
  // NOTHING — the live API stopped sending the legacy fields.
  const nearbyStops = pickTransitStops(block.value.nearbyStops);
  const nearest = pickString(block.value.nearest);
  const lines = pickStringArray(block.value.lines, 4);
  const walkMinutes = pickNumber(block.value.walkMinutes);
  const summary = pickString(block.value.summary);
  if (!nearbyStops && !nearest && !lines && walkMinutes === undefined && !summary) {
    return undefined;
  }
  return {
    value: {
      ...(nearbyStops ? { nearbyStops } : {}),
      ...(nearest ? { nearest } : {}),
      ...(lines ? { lines } : {}),
      ...(walkMinutes !== undefined ? { walkMinutes } : {}),
      ...(summary ? { summary } : {}),
    },
    source: block.source,
  };
}

function trimAir(raw: unknown): CityPlace["air"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  const index = pickScalar(block.value.index);
  const site = pickString(block.value.site);
  if (index === undefined && !site) return undefined;
  return {
    value: {
      ...(index !== undefined ? { index } : {}),
      ...(site ? { site } : {}),
    },
    source: block.source,
  };
}

function trimPlaceWeather(raw: unknown): CityPlace["weather"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  const condition = pickString(block.value.condition);
  const tempC = pickNumber(block.value.tempC);
  const precipProbabilityPct = pickNumber(block.value.precipProbabilityPct);
  if (!condition && tempC === undefined && precipProbabilityPct === undefined) return undefined;
  return {
    value: {
      ...(condition ? { condition } : {}),
      ...(tempC !== undefined ? { tempC } : {}),
      ...(precipProbabilityPct !== undefined ? { precipProbabilityPct } : {}),
    },
    source: block.source,
  };
}

/**
 * Whitelist/trim an upstream `get_place` structuredContent into `CityPlace`.
 * Every field is optional — we only surface upstream-provided values, never
 * invent hygiene/transit facts. Exported for tests.
 */
export function trimCityPlace(id: string, raw: unknown): CityPlace {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const nested = obj.place && typeof obj.place === "object" ? (obj.place as Record<string, unknown>) : obj;

  const place: CityPlace = { id };
  const name = pickString(nested.name);
  if (name) place.name = name;
  const address = pickString(nested.address) ?? pickString(nested.formattedAddress);
  if (address) place.address = address;
  const area = pickString(nested.area);
  if (area) place.area = area;
  const location = pickLocation(nested.location);
  if (location) place.location = location;
  const types = pickStringArray(nested.types, 6);
  if (types) place.types = types;
  const rating = pickNumber(nested.rating);
  if (rating !== undefined) place.rating = rating;
  const userRatingCount = pickNumber(nested.userRatingCount);
  if (userRatingCount !== undefined) place.userRatingCount = userRatingCount;
  const priceBand = pickString(nested.priceBand);
  if (priceBand) place.priceBand = priceBand;
  if (typeof nested.openNow === "boolean") place.openNow = nested.openNow;
  const hours = pickStringArray(nested.hours, 8) ?? pickStringArray(nested.weekdayText, 8);
  if (hours) place.hours = hours;

  const hygiene = trimHygiene(nested.hygiene);
  if (hygiene) place.hygiene = hygiene;
  const transit = trimTransit(nested.transit);
  if (transit) place.transit = transit;
  const air = trimAir(nested.air);
  if (air) place.air = air;
  const weather = trimPlaceWeather(nested.weather);
  if (weather) place.weather = weather;

  return place;
}

export type FetchCityPlaceOpts = CityMcpCallOptions & { deep?: boolean };

/**
 * Fetch and trim a CityMCP `get_place` dossier. Cached in-process for ~10min
 * per (id, deep) tuple. Throws `CityMcpError` on failure — callers fail-soft.
 */
export async function fetchCityPlace(
  id: string,
  opts: FetchCityPlaceOpts = {},
): Promise<CityPlace> {
  if (!id) throw new CityMcpError("get_place: id is required", "empty");
  const deep = opts.deep === true;
  const cacheKey = `${deep ? "d" : "s"}:${id}`;
  return fetchWithStaleServe(placeCache, cacheKey, PLACE_TTL_MS, async () => {
    const args: Record<string, unknown> = { id };
    if (deep) args.deep = true;
    const result = await callCityMcpTool<unknown>("get_place", args, opts);
    return trimCityPlace(id, result.structuredContent);
  });
}

// ---------- things_to_do: curated opportunities + short-TTL cache ----------

export type ThingsToDoWindow = "tonight" | "tomorrow_night" | "this_weekend";

export const THINGS_TO_DO_WINDOWS: readonly ThingsToDoWindow[] = [
  "tonight",
  "tomorrow_night",
  "this_weekend",
];

export type ThingsToDoKind =
  | "exhibition"
  | "gig"
  | "comedy"
  | "theatre"
  | "popup"
  | "food_drink"
  | "market"
  | "family"
  | "talk"
  | "nightlife"
  | "free_event"
  | "other";

export type ThingsToDoPrice = "any" | "cheap" | "free";

export type ThingsToDoOpportunity = {
  title: string;
  kind?: ThingsToDoKind | string;
  startsAt?: string;
  areas?: string[];
  price?: string;
  availability?: string;
  timeEvidence?: string;
  place?: {
    id?: string;
    name?: string;
    area?: string;
    postcode?: string;
    location?: { lat: number; lng: number };
  };
  source?: { label?: string; url?: string };
};

export type ThingsToDoResult = {
  window: ThingsToDoWindow;
  area?: string;
  asOf?: string;
  opportunities: ThingsToDoOpportunity[];
  /** Last-known-good value served after a failed live refresh. See CityStatus.stale. */
  stale?: boolean;
};

type ThingsToDoCacheEntry = { value: ThingsToDoResult; expiresAt: number };
const thingsToDoCache = new Map<string, ThingsToDoCacheEntry>();

/** Test-only: drop all cached things_to_do entries. */
export function resetThingsToDoCache(): void {
  thingsToDoCache.clear();
}

/**
 * Upstream may send price/availability as a plain string (older fixtures) or
 * as `{ label, ... }` (live CityMCP). Prefer the label when present.
 */
function pickLabelOrString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (v && typeof v === "object") {
    return pickString((v as { label?: unknown }).label);
  }
  return undefined;
}

function trimOpportunity(raw: unknown): ThingsToDoOpportunity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = pickString(o.title);
  if (!title) return null;

  const out: ThingsToDoOpportunity = { title };
  const kind = pickString(o.kind);
  if (kind) out.kind = kind;
  const startsAt = pickString(o.startsAt);
  if (startsAt) out.startsAt = startsAt;
  const areas = pickStringArray(o.areas, 3);
  if (areas) out.areas = areas;
  const price = pickLabelOrString(o.price);
  if (price) out.price = price;
  const availability = pickLabelOrString(o.availability);
  if (availability) out.availability = availability;
  const timeEvidence = pickString(o.timeEvidence);
  if (timeEvidence) out.timeEvidence = timeEvidence;

  const place = o.place;
  if (place && typeof place === "object") {
    const p = place as Record<string, unknown>;
    const placeId = pickString(p.id);
    const placeName = pickString(p.name);
    const placeArea = pickString(p.area);
    const placePostcode = pickString(p.postcode);
    const placeLoc = pickLocation(p.location);
    if (placeId || placeName || placeArea || placePostcode || placeLoc) {
      out.place = {
        ...(placeId ? { id: placeId } : {}),
        ...(placeName ? { name: placeName } : {}),
        ...(placeArea ? { area: placeArea } : {}),
        ...(placePostcode ? { postcode: placePostcode } : {}),
        ...(placeLoc ? { location: placeLoc } : {}),
      };
    }
  }

  const source = o.source;
  if (source && typeof source === "object") {
    const s = source as Record<string, unknown>;
    // Live upstream uses `name`; older fixtures / trimmed clients use `label`.
    const label = pickString(s.label) ?? pickString(s.name);
    const url = pickString(s.url);
    if (label || url) {
      out.source = {
        ...(label ? { label } : {}),
        ...(url ? { url } : {}),
      };
    }
  }

  return out;
}

export type FetchThingsToDoOpts = CityMcpCallOptions & {
  window: ThingsToDoWindow;
  area?: string;
  kinds?: readonly ThingsToDoKind[];
  price?: ThingsToDoPrice;
  limit?: number;
};

/**
 * Fetch and trim CityMCP `things_to_do` opportunities for a plan window.
 * Cached in-process for ~5min per (window, area, kinds, price, limit) key.
 * Throws `CityMcpError` on failure — callers fail-soft.
 */
export async function fetchThingsToDo(
  opts: FetchThingsToDoOpts,
): Promise<ThingsToDoResult> {
  const { window, area, kinds, price, limit } = opts;
  if (!THINGS_TO_DO_WINDOWS.includes(window)) {
    throw new CityMcpError(`things_to_do: invalid window ${String(window)}`, "empty");
  }

  const args: Record<string, unknown> = { window };
  if (area) args.area = area;
  if (kinds && kinds.length > 0) args.kinds = [...kinds];
  if (price) args.price = price;
  if (typeof limit === "number" && limit > 0) args.limit = limit;

  const cacheKey = JSON.stringify(args);
  return fetchWithStaleServe(thingsToDoCache, cacheKey, THINGS_TO_DO_TTL_MS, async () => {
    const result = await callCityMcpTool<Record<string, unknown>>("things_to_do", args, opts);
    const structured = result.structuredContent ?? {};

    const rawOpps = Array.isArray(structured.opportunities) ? structured.opportunities : [];
    const opportunities: ThingsToDoOpportunity[] = [];
    for (const item of rawOpps) {
      const trimmed = trimOpportunity(item);
      if (trimmed) opportunities.push(trimmed);
      if (typeof limit === "number" && opportunities.length >= limit) break;
    }

    const value: ThingsToDoResult = {
      window,
      area: pickString(structured.area) ?? area,
      asOf: pickString(structured.asOf),
      opportunities,
    };
    return value;
  });
}

// ---------- get_journey: TfL itineraries + short-TTL cache ----------

export type CityJourneyLeg = {
  mode: string;
  summary?: string;
  durationMinutes?: number;
  departureTime?: string;
  arrivalTime?: string;
};

export type CityJourney = {
  durationMinutes: number;
  departureTime?: string;
  arrivalTime?: string;
  legs: CityJourneyLeg[];
};

export type FetchJourneyArgs = {
  from: string;
  to: string;
  arriveBy?: string;
  stepFreeOnly?: boolean;
};

export type FetchJourneyResult = {
  journeys: CityJourney[];
};

export type FetchJourneyOptions = CityMcpCallOptions & {
  /** Disable the process cache when an itinerary contains viewer location. */
  cache?: boolean;
};

type JourneyCacheEntry = { value: FetchJourneyResult; expiresAt: number };
const journeyCache = new Map<string, JourneyCacheEntry>();

/** Test-only: drop all cached get_journey entries. */
export function resetJourneyCache(): void {
  journeyCache.clear();
}

/** Format venue coords as the `"lat,lng"` string CityMCP `get_journey` expects. */
export function formatJourneyPoint(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function trimJourneyLeg(raw: unknown): CityJourneyLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode = pickString(o.mode);
  if (!mode) return null;

  const out: CityJourneyLeg = { mode };
  const summary = pickString(o.summary);
  if (summary) out.summary = summary;
  const durationMinutes = pickNumber(o.durationMinutes);
  if (durationMinutes !== undefined) out.durationMinutes = durationMinutes;
  const departureTime = pickString(o.departureTime);
  if (departureTime) out.departureTime = departureTime;
  const arrivalTime = pickString(o.arrivalTime);
  if (arrivalTime) out.arrivalTime = arrivalTime;
  return out;
}

export function trimJourney(raw: unknown): CityJourney | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const durationMinutes = pickNumber(o.durationMinutes);
  if (durationMinutes === undefined) return null;

  const legs: CityJourneyLeg[] = [];
  if (Array.isArray(o.legs)) {
    for (const item of o.legs) {
      const leg = trimJourneyLeg(item);
      if (leg) legs.push(leg);
    }
  }

  const out: CityJourney = { durationMinutes, legs };
  const departureTime = pickString(o.departureTime);
  if (departureTime) out.departureTime = departureTime;
  const arrivalTime = pickString(o.arrivalTime);
  if (arrivalTime) out.arrivalTime = arrivalTime;
  return out;
}

/**
 * Fetch and trim CityMCP `get_journey` itineraries between two string points
 * (prefer `formatJourneyPoint(lat, lng)` — free-text names often Ambiguous).
 * Cached in-process for ~3min per args key. Throws `CityMcpError` on failure.
 * Returns at most 3 trimmed journeys.
 *
 * Deliberately does NOT serve-last-known-on-error (unlike city_status /
 * get_place / things_to_do): a journey's whole value IS its departure/arrival
 * timing, so a stale itinerary is actively misleading in a way a "checked
 * earlier" label cannot rescue — the honest degrade here is empty, letting the
 * caller fall back to live TfL last-train timing. It still benefits from the
 * transient retry baked into `callCityMcpTool`.
 */
export async function fetchJourney(
  args: FetchJourneyArgs,
  opts: FetchJourneyOptions = {},
): Promise<FetchJourneyResult> {
  const { cache: cacheEnabled = true, ...callOptions } = opts;
  const from = typeof args.from === "string" ? args.from.trim() : "";
  const to = typeof args.to === "string" ? args.to.trim() : "";
  if (!from || !to) {
    throw new CityMcpError("get_journey: from and to are required", "empty");
  }

  const callArgs: Record<string, unknown> = { from, to };
  if (args.arriveBy) callArgs.arriveBy = args.arriveBy;
  if (typeof args.stepFreeOnly === "boolean") {
    callArgs.stepFreeOnly = args.stepFreeOnly;
  }

  const cacheKey = JSON.stringify(callArgs);
  const now = Date.now();
  const cached = cacheEnabled ? journeyCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  const result = await callCityMcpTool<Record<string, unknown>>(
    "get_journey",
    callArgs,
    callOptions,
  );
  const structured = result.structuredContent ?? {};
  const rawJourneys = Array.isArray(structured.journeys)
    ? structured.journeys
    : [];

  const journeys: CityJourney[] = [];
  for (const item of rawJourneys) {
    const trimmed = trimJourney(item);
    if (trimmed) journeys.push(trimmed);
    if (journeys.length >= JOURNEY_CAP) break;
  }

  const value: FetchJourneyResult = { journeys };
  if (cacheEnabled) {
    setCappedCache(journeyCache, cacheKey, { value, expiresAt: now + JOURNEY_TTL_MS });
  }
  return value;
}

// ---------- Signal trimming (shared by /api/citymcp/status) ----------

const SEVERITY_ORDER: Record<string, number> = {
  major: 3,
  notable: 2,
  info: 1,
};

// ---------- Night-shaping filter: drop airline / airport-flight noise ----------
//
// CityMCP occasionally surfaces aviation stories (an EasyJet cancellation at
// Gatwick, an airline strike) in the city-status feed. For a London pub-night
// app those are noise: they don't shape whether you can get across town
// tonight. This pure filter drops airline / flight-side airport signals, but
// KEEPS any signal that also carries a ground-transport term — a rail, coach,
// or road link is exactly how a Londoner reaches (or is blocked from) an
// airport tonight, so "Gatwick Express suspended" stays while "EasyJet cancels
// flights" goes.

// Terms that mark a signal as flight-side aviation.
const AVIATION_NOISE_PATTERNS: readonly RegExp[] = [
  /\bairlines?\b/,
  /\baviation\b/,
  /\bflights?\b/,
  /\beasyjet\b/,
  /\bryanair\b/,
  /\bbritish airways\b/,
  /\bwizz ?air\b/,
  /\bvueling\b/,
  /\bjet2\b/,
  /\blufthansa\b/,
  /\bemirates\b/,
  /\brunway\b/,
  /\bcheck-?in desk\b/,
  /\bdepartures? board\b/,
  /\bbaggage\b/,
  /\bboarding\b/,
  /\bair traffic\b/,
  /\bcabin crew\b/,
];

// Airport references that read as flight-side on their own — but each doubles
// as a rail/coach destination, so an airport mention only counts as noise when
// no ground-transport term rescues it.
const AIRPORT_PATTERNS: readonly RegExp[] = [
  /\bgatwick\b/,
  /\bheathrow\b/,
  /\bstansted\b/,
  /\bluton airport\b/,
  /\bcity airport\b/,
  /\bsouthend airport\b/,
  /\bairport\b/,
];

// Ground-transport terms that keep a signal in — it's about GETTING around
// London tonight, whatever else it mentions.
const GROUND_TRANSPORT_PATTERNS: readonly RegExp[] = [
  /\btube\b/,
  /\bunderground\b/,
  /\boverground\b/,
  /\belizabeth line\b/,
  /\bnational rail\b/,
  /\brail\b/,
  /\btrains?\b/,
  /\bexpress\b/,
  /\bdlr\b/,
  /\bthameslink\b/,
  /\bsouthern\b/,
  /\bsoutheastern\b/,
  /\bcoach\b/,
  /\bbus\b/,
  /\btram\b/,
  /\broad\b/,
  /\bm25\b/,
  /\ba\d{1,4}\b/,
  /\bstation\b/,
  /\bline\b/,
];

/**
 * Is this signal flight-side aviation noise (an airline incident or an
 * airport-terminal story with no bearing on getting around London tonight)?
 * A signal that also mentions any ground-transport term is never noise — the
 * ground link is the night-shaping part. Pure and exported for tests.
 */
export function isAviationNoiseSignal(signal: CityStatusSignal): boolean {
  const text = `${signal.headline ?? ""} ${signal.detail ?? ""}`.toLowerCase();
  if (!text.trim()) return false;
  if (GROUND_TRANSPORT_PATTERNS.some((re) => re.test(text))) return false;
  if (AVIATION_NOISE_PATTERNS.some((re) => re.test(text))) return true;
  if (AIRPORT_PATTERNS.some((re) => re.test(text))) return true;
  return false;
}

/**
 * Drop flight-side aviation noise from a city-status signal list, keeping
 * genuinely night-shaping London items (tube / rail / bus / road). Pure —
 * returns a new array, never mutates. Exported for tests + the status route.
 */
export function filterNightShapingSignals(
  signals: readonly CityStatusSignal[] | undefined,
): CityStatusSignal[] {
  if (!Array.isArray(signals)) return [];
  return signals.filter((signal) => !isAviationNoiseSignal(signal));
}

/**
 * Return the top-N signals by severity (major > notable > info > unknown),
 * preserving upstream order for equal severities. Used by the status route
 * to keep the UI banner compact. Exported for tests.
 */
export function trimSignals(
  signals: readonly CityStatusSignal[] | undefined,
  limit: number,
): CityStatusSignal[] {
  if (!Array.isArray(signals) || signals.length === 0) return [];
  if (limit <= 0) return [];
  const decorated = signals.map((s, idx) => ({
    s,
    idx,
    rank: SEVERITY_ORDER[String(s.severity ?? "").toLowerCase()] ?? 0,
  }));
  decorated.sort((a, b) => b.rank - a.rank || a.idx - b.idx);
  return decorated.slice(0, limit).map((d) => d.s);
}
