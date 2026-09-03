// GET /api/citymcp/status
//
// Thin CityMCP London city_status proxy for the map status strip. Returns the
// upstream `asOf` and `weather`, the tube-line summary trimmed to non-good
// lines only, and the top ~6 signals by severity. Always fail-soft: any
// upstream failure surfaces as a 200 with `{ error, signals: [] }` so the map
// banner can degrade silently — never a hard 500 to the browser.
//
// Runtime: nodejs — the CityMCP client uses AbortController + fetch text().

import { publicApiError } from "@/lib/apiError";
import {
  CityMcpError,
  fetchCityStatus,
  filterNightShapingSignals,
  trimSignals,
  type CityStatus,
  type CityStatusTubeLine,
} from "@/lib/citymcp/client";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

// A4: the banner's expanded feed shows every signal; the upstream sends ~8.
const SIGNAL_CAP = 8;
const CACHE_MAX_AGE_S = 60;
const CACHE_STALE_WHILE_REVALIDATE_S = 300;

function jsonResponse(body: unknown, opts: { status?: number; cache?: boolean } = {}): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`
        : "no-store",
    },
  });
}

function trimTubeLines(lines: readonly CityStatusTubeLine[] | undefined): CityStatusTubeLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter((l) => {
    const status = String(l?.status ?? "").toLowerCase();
    // "Good Service" is the null signal; drop it so the banner focuses on
    // things a Londoner should actually notice tonight.
    return status && status !== "good service";
  });
}

export const GET = withRouteTiming("citymcp/status", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      compatibilityFields: { asOf: null, weather: null, tubeLines: [], signals: [] },
    });
  }

  const params = new URL(request.url).searchParams;
  const borough = params.get("borough")?.trim();
  const cityStatusArgs: { borough?: string } = {};
  if (borough && borough.length > 0 && borough.length <= 60) {
    cityStatusArgs.borough = borough;
  }

  let status: CityStatus;
  try {
    status = await fetchCityStatus(cityStatusArgs);
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({
      asOf: null,
      weather: null,
      tubeLines: [],
      signals: [],
      error: message,
    });
  }

  // Drop flight-side aviation noise (airline incidents / airport-terminal
  // stories) BEFORE trimming to the severity top-N, so the compact feed spends
  // its slots on things that actually shape getting around London tonight.
  const nightShapingSignals = filterNightShapingSignals(status.signals);
  const trimmedSignals = trimSignals(nightShapingSignals, SIGNAL_CAP);
  const trimmedLines = trimTubeLines(status.tubeLines);

  // A stale (last-known-good) answer must never be pinned at the edge — serve it
  // no-store so the next request re-attempts a live refresh (mirrors last-train's
  // never-cache-a-fallback contract).
  const stale = status.stale === true;
  return jsonResponse(
    {
      asOf: status.asOf,
      weather: status.weather ?? null,
      tubeLines: trimmedLines,
      signals: trimmedSignals,
      ...(stale ? { stale: true } : {}),
    },
    { cache: !stale },
  );
}
