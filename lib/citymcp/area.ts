// Server-only convenience wrapper around CityMCP London's `get_area` tool,
// scoped to the one field the borough page cares about: the average pint
// price. `get_area` has never been called anywhere else in the app, so this
// is its only caller and the shape below is trimmed defensively rather than
// typed against a full upstream contract.
//
// Live shape (probed against https://citymcp.com/london/mcp `get_area`):
//   structuredContent.pint.asOf                   — ISO date/time string
//   structuredContent.pint.value.averagePriceGbp   — number (GBP)
//   structuredContent.pint.value.borough           — string, echoes the query (optional)
//   ...plus weather/air/crime sibling blocks we don't need here.
//
// Design notes
// ------------
//  - Fail-soft at the call site: `callCityMcpTool` throws `CityMcpError` on
//    any transport/RPC failure; callers (the API route) catch and degrade.
//  - In-memory TTL cache, capped at ~100 entries (one per borough name we've
//    ever been asked about), insertion-order eviction — same house pattern
//    as `lib/citymcp/client.ts`'s per-tool caches, reimplemented locally
//    here because this file must not import non-exported helpers from
//    client.ts (client.ts has its own owner and is off-limits for edits).

import {
  callCityMcpTool,
  CityMcpError,
  type CityMcpCallOptions,
} from "@/lib/citymcp/client";

const AREA_TTL_MS = 30 * 60 * 1000; // 30 min — pint prices don't move fast
const CACHE_MAX_ENTRIES = 100;

export type CityArea = {
  borough: string;
  averagePintGbp: number | null;
  asOf: string | null;
};

type AreaCacheEntry = { value: CityArea; expiresAt: number };
const areaCache = new Map<string, AreaCacheEntry>();

/** Test-only: drop all cached get_area entries. */
export function resetCityAreaCache(): void {
  areaCache.clear();
}

// Bounded write: re-inserting on write keeps the freshest key sorted last so
// eviction drops the oldest (insertion-order) entry once the cap is hit.
function setCappedAreaCache(key: string, value: AreaCacheEntry): void {
  if (areaCache.has(key)) areaCache.delete(key);
  areaCache.set(key, value);
  while (areaCache.size > CACHE_MAX_ENTRIES) {
    const oldest = areaCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    areaCache.delete(oldest);
  }
}

/**
 * Trim the raw `get_area` structuredContent down to the borough pint-price
 * card's needs. Exported for unit testing — never throws; a malformed or
 * absent `pint` block yields nulls rather than a crash.
 */
export function trimCityArea(borough: string, raw: unknown): CityArea {
  const structured = (raw ?? {}) as { pint?: unknown };
  const pint = (structured.pint ?? {}) as {
    asOf?: unknown;
    value?: { averagePriceGbp?: unknown; borough?: unknown };
  };
  const value = (pint.value ?? {}) as {
    averagePriceGbp?: unknown;
    borough?: unknown;
  };

  const averagePintGbp =
    typeof value.averagePriceGbp === "number" &&
    Number.isFinite(value.averagePriceGbp)
      ? value.averagePriceGbp
      : null;
  const asOf =
    typeof pint.asOf === "string" && pint.asOf.length > 0 ? pint.asOf : null;
  const resolvedBorough =
    typeof value.borough === "string" && value.borough.trim().length > 0
      ? value.borough
      : borough;

  return { borough: resolvedBorough, averagePintGbp, asOf };
}

/**
 * Fetch `get_area` for a borough name, trimmed to the pint-price card's
 * needs and cached in-memory for ~30 minutes. Throws `CityMcpError` on
 * upstream failure — callers (the API route) should try/catch and degrade.
 */
export async function fetchCityArea(
  borough: string,
  opts: CityMcpCallOptions = {},
): Promise<CityArea> {
  const key = borough.trim().toLowerCase();
  const now = Date.now();
  const cached = areaCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const result = await callCityMcpTool("get_area", { borough }, opts);
  const structured = result.structuredContent;
  if (!structured || typeof structured !== "object") {
    throw new CityMcpError("get_area: missing structuredContent", "empty");
  }
  const trimmed = trimCityArea(borough, structured);
  setCappedAreaCache(key, { value: trimmed, expiresAt: now + AREA_TTL_MS });
  return trimmed;
}
