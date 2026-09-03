// Three-lane contribution stats for the profile page's arrival card.
//
// GET /api/profiles/[handle]/lane-stats -> the honest wider record beyond
// pint drops: prices, visit reports, and recommendations for ONE viewed
// handle. Reads public.public_contributor_leaderboard() only, never the raw
// community_prices / structured_visit_reports / weather_recommendations
// tables directly - the 0079 claimed_at bound lives in that function, and a
// direct table read would resurrect the handle-claim back-dating bug it
// fixed. Exposes nothing beyond the handle and its four lane counts.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { readContributorLaneStats } from "@/lib/contributorLeaderboardStore";
import { clientIp, hashIp } from "@/lib/supabase";

const PER_IP_LIMIT = 30;
const GLOBAL_LIMIT = 600;
const WINDOW_MS = 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle ?? "");
  if (!handle) {
    return publicApiError("Add a handle.", "handle_required", 400);
  }

  const ipHash = hashIp(clientIp(request));
  if (
    (await isLimited(`lane-stats:${ipHash}`, `lane-stats:${ipHash}`, PER_IP_LIMIT, WINDOW_MS)) ||
    (await isLimited("lane-stats:global", "lane-stats:global", GLOBAL_LIMIT, WINDOW_MS))
  ) {
    return publicApiError("Too many requests, slow down.", "rate_limited", 429, {
      retryable: true,
    });
  }

  try {
    const stats = await readContributorLaneStats(handle);
    return jsonNoStore({ stats }, { status: 200 });
  } catch (err) {
    log("error", "profiles.lane_stats_failed", {
      route: "GET /api/profiles/[handle]/lane-stats",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Contribution stats are unavailable.", "stats_unavailable", 503, {
      retryable: true,
    });
  }
}
