// GET /api/citymcp/buzz?id=...
//
// Thin CityMCP London buzz proxy: `get_place` (deep:true) trimmed to the
// AI-synthesised press/review digest `{ summary, mentions:[{label,url}] }`.
// Mention links are https-only; nothing is ever invented — a venue with no
// upstream buzz returns `{ buzz: null }` and the UI renders nothing.
//
// Fail-soft: any upstream failure lands as 200 + `{ error, buzz: null }` so
// the venue sheet degrades silently. A missing `id` is a client mistake and
// returns 400.

import { publicApiError } from "@/lib/apiError";
import { CityMcpError } from "@/lib/citymcp/client";
import { fetchCityBuzz, type CityBuzz } from "@/lib/citymcp/buzz";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_ID_LEN = 200;
const CACHE_MAX_AGE_S = 300;
const CACHE_STALE_WHILE_REVALIDATE_S = 1800;

function jsonResponse(
  body: unknown,
  opts: { status?: number; cache?: boolean } = {},
): Response {
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

export const GET = withRouteTiming("citymcp/buzz", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true, compatibilityFields: { buzz: null } });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim() ?? "";
  if (id.length === 0) {
    return publicApiError("Place id is missing.", "INVALID_REQUEST", 400, { compatibilityFields: { buzz: null } });
  }
  if (id.length > MAX_ID_LEN) {
    return publicApiError("id is too long.", "INVALID_REQUEST", 400, { compatibilityFields: { buzz: null } });
  }

  let buzz: CityBuzz | null;
  try {
    buzz = await fetchCityBuzz(id);
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({ buzz: null, error: message });
  }
  return jsonResponse({ buzz }, { cache: true });
}
