// GET /api/tfl-disruption?lat=..&lng=..  →  { disruption: PatchDisruption | null }
//
// The material-disruption layer (ticket 3.7): given the drinker's rough point,
// resolve the night patch they are in, and return the ONE line-status disruption
// severe enough to reshape a night out there tonight — a suspension, a severe
// delay, or a planned closure whose window is tonight, on a line that actually
// serves that patch. When nothing material touches the patch, `disruption` is
// null and the surface renders nothing (no status board, no "all good" line).
//
// TfL Line Status is fetched once for every night mode and cached server-side
// (lib/tflDisruption fetchLineStatuses, 5-min revalidate via the Next data
// cache), so this route never fetches per render. Like /api/last-train it never
// throws and never 500s: any failure degrades to `{ disruption: null }`.

import { publicApiError } from "@/lib/apiError";
import {
  disruptionForPatch,
  fetchLineStatuses,
} from "@/lib/tflDisruption";
import { CITIES, pointInCityBounds } from "@/lib/cities";
import { coarsenViewerPoint } from "@/lib/geo";
import { nearestNightPatch } from "@/lib/nearestNightPatch";

export const runtime = "nodejs";
export const maxDuration = 15;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The upstream TfL call is already cached with a 5-min revalidate; this
      // per-patch response is cheap to recompute, so we let the browser reuse it
      // briefly but never pin it long at a shared edge.
      //
      // WHY A SHARED CACHE IS HONEST HERE, given the URL carries lat and lng.
      // The invariant is that no UN-COARSENED viewer point ever reaches a URL
      // or a shared cache key; a bucket many people share by construction may.
      // Every caller coarsens BEFORE it builds this URL - DisruptionLine and
      // TodayTubeCard both run coarsenViewerPoint first - so the key holds only
      // bucket values, and the server's own call below is the defensive second
      // pass for a direct caller rather than the first reduction.
      //
      // The bucket is three decimal places, roughly a 70 to 110 metre cell in
      // the UK (lib/geo.ts). In the London the disruption strip serves, a cell
      // that size is a city block and holds many people, so it is a genuinely
      // shared key rather than one that could name a reader. The answer itself
      // is a whole transport patch, coarser again than the cell that selected
      // it. __tests__/sharedCacheHonesty.test.ts holds the callers to it.
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const params = requestUrl.searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lng = Number.parseFloat(params.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return publicApiError("Add valid lat and lng coordinates.", "INVALID_REQUEST", 400, { compatibilityFields: { disruption: null } });
  }
  const viewerPoint = coarsenViewerPoint({ lat, lng });
  const canonicalUrl = new URL(requestUrl);
  canonicalUrl.searchParams.set("lat", String(viewerPoint.lat));
  canonicalUrl.searchParams.set("lng", String(viewerPoint.lng));
  if (canonicalUrl.href !== requestUrl.href) {
    return new Response(null, {
      status: 307,
      headers: {
        location: canonicalUrl.href,
        "cache-control": "no-store",
      },
    });
  }
  if (!pointInCityBounds(viewerPoint.lat, viewerPoint.lng, CITIES.london)) {
    // The patch relevance table is London-only; anywhere else is honestly silent.
    return json({ disruption: null, generatedAt: new Date().toISOString() });
  }

  const patch = nearestNightPatch(viewerPoint.lat, viewerPoint.lng);
  if (!patch) {
    return json({ disruption: null, generatedAt: new Date().toISOString() });
  }

  const statuses = await fetchLineStatuses();
  const disruption = disruptionForPatch(statuses, patch.id, new Date());

  return json({ disruption, generatedAt: new Date().toISOString() });
}
