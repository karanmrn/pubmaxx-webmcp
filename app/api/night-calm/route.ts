// GET /api/night-calm?area=<night-area-slug>
//
// A CALM safety-context hint for the get-home flow, derived from data.police.uk
// street-level crime (keyless open data). Returns ONE quiet band + one plain line
// per coarse Night Area, never counts or per-street detail. See lib/nightCalm.ts
// for the product posture (reassuring guardian, never fear-mongering).
//
// Contract:
//   - invalid / missing area  -> 422 flat public error (lib/apiError.ts).
//   - rate limited            -> 429 flat public error.
//   - upstream unavailable    -> 200 with `available: false` + null band (the UI
//                                shows nothing). A calm hint fails to SILENCE,
//                                never to an error surface.
//   - success                 -> 200, edge-cached hard (monthly data).

import { publicApiError } from "@/lib/apiError";
import { jsonCached } from "@/lib/apiResponses";
import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { NIGHT_CALM_VERSION } from "@/lib/nightCalm";
import { isNightCalmLimited } from "@/lib/nightCalmRateLimit";
import { loadNightCalmForArea } from "@/lib/nightCalmSource";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

function isNightAreaSlug(value: string | null): value is NightAreaSlug {
  return value !== null && (NIGHT_AREA_SLUGS as readonly string[]).includes(value);
}

export const GET = withRouteTiming("night-calm", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isNightCalmLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const area = new URL(request.url).searchParams.get("area")?.trim() ?? null;
  if (!isNightAreaSlug(area)) {
    return publicApiError("Pick an area we cover.", "NIGHT_AREA_REQUIRED", 422);
  }

  const result = await loadNightCalmForArea(area);
  // Monthly data: hold hard at the edge (6h) with a month-long stale window so a
  // returning walker gets an instant hint. Unavailable results cache briefly so a
  // transient upstream blip clears within minutes.
  const sMaxAge = result.available ? 21_600 : 300;
  return jsonCached(
    { version: NIGHT_CALM_VERSION, ...result },
    { sMaxAge, staleWhileRevalidate: 2_592_000 },
  );
}
