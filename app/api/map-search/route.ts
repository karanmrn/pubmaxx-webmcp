// GET /api/map-search — intent + national UK base pub name hits.
// Keyless. The country-wide index stays on the server (phones never download it).

import { publicApiError } from "@/lib/apiError";
import {
  classifyMapSearchIntent,
  intentLooksLikeVenueSearch,
} from "@/lib/mapSearchIntent";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { recordMapSearchEvent } from "@/lib/mapSearchEvents.server";
import { searchUkNationalPubs } from "@/lib/ukNationalPubSearch.server";

export const runtime = "nodejs";

const MAX_Q = 80;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=120";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get("q") ?? "";
    const q = raw.trim().slice(0, MAX_Q);
    if (q.length < 2) {
      return publicApiError("Add a longer search.", "INVALID_REQUEST", 400);
    }

    const limiterKey = `map-search:${hashIp(clientIp(request))}`;
    if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS)) {
      return publicApiError("Too many searches, slow down.", "RATE_LIMITED", 429, {
        retryable: true,
      });
    }

    const intent = classifyMapSearchIntent(q);
    const wantPubs = intentLooksLikeVenueSearch(intent);
    const national = wantPubs
      ? searchUkNationalPubs(q, 8)
      : { status: "ready" as const, hits: [] };

    void recordMapSearchEvent({
      intentPrimary: intent.primary,
      queryLength: intent.query.length,
      nationalHitCount: national.hits.length,
      nationalStatus: national.status,
    });

    const body = {
      intent: {
        primary: intent.primary,
        candidates: intent.candidates.slice(0, 6).map((row) => ({
          kind: row.kind,
          label: row.label,
          score: row.score,
        })),
      },
      nationalPubs: national.hits,
      nationalStatus: national.status,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.error("[map-search]", error);
    return publicApiError("Search is unavailable right now.", "SEARCH_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
