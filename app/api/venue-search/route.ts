// GET /api/venue-search?q= - name hits from the CURATED venue index.
//
// The curated counterpart to `/api/map-search`, which searches the national UK
// base layer. Two layers, two routes, on purpose: the base layer is 38k unpriced
// pubs and the curated index is the product's own, and merging them here would
// put an unpriced pub into a surface that promises a priced one.
//
// Keyless and read-only, because the curated index is what the map already
// serves. The country-wide file never leaves the server.

import { publicApiError } from "@/lib/apiError";
import {
  CURATED_VENUE_SEARCH_MIN_QUERY,
  searchCuratedVenues,
} from "@/lib/curatedVenueSearch.server";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

export const runtime = "nodejs";

const MAX_Q = 80;
const MAX_HITS = 8;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

// A pub name does not change while somebody is typing, and the index behind
// this is a build artifact, so a short shared cache costs nothing and spares
// the lambda a scan per keystroke.
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(request: Request): Promise<Response> {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, MAX_Q);
  if (query.length < CURATED_VENUE_SEARCH_MIN_QUERY) {
    return publicApiError("Add a longer search.", "INVALID_REQUEST", 400);
  }

  const limiterKey = `venue-search:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS)) {
    return publicApiError("Too many searches, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    const venues = await searchCuratedVenues(query, MAX_HITS);
    return Response.json(
      { status: "ready", venues },
      { status: 200, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch {
    // An index we could not open is a fact about us. Say so and stay open to a
    // retry rather than reading as a city with no pubs in it.
    return publicApiError("Could not search pubs just now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
