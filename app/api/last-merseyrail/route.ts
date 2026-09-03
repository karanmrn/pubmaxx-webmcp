// GET /api/last-merseyrail?lat=..&lng=..  →  LastRideResult (Merseyrail)

import {
  computeMerseyrailLastRide,
  MERSEYRAIL_PROVENANCE,
  nearestMerseyrailStation,
} from "@/lib/merseyrail";
import { runLastRideRoute } from "@/lib/lastRideRoute";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return runLastRideRoute({
    request,
    rateLimitKey: "last-merseyrail",
    cityPackSegment: "liverpool",
    nearestStation: nearestMerseyrailStation,
    computeLastRide: computeMerseyrailLastRide,
    provenance: MERSEYRAIL_PROVENANCE,
    provider: "merseyrail",
    modeLabel: "train",
    stationErrorFallback: "Couldn't resolve a Merseyrail stop nearby.",
    catchErrorMessage: "Couldn't check Merseyrail just now. Check before you head out.",
  });
}
