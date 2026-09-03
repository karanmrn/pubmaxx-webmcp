// GET /api/last-subway?lat=..&lng=..  →  LastRideResult (SPT Subway)

import {
  computeSptSubwayLastRide,
  nearestSptSubwayStation,
  SPT_SUBWAY_PROVENANCE,
} from "@/lib/sptSubway";
import { runLastRideRoute } from "@/lib/lastRideRoute";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return runLastRideRoute({
    request,
    rateLimitKey: "last-subway",
    cityPackSegment: "glasgow",
    nearestStation: nearestSptSubwayStation,
    computeLastRide: computeSptSubwayLastRide,
    provenance: SPT_SUBWAY_PROVENANCE,
    provider: "spt-subway",
    modeLabel: "subway",
    stationErrorFallback: "Couldn't resolve a Subway stop nearby.",
    catchErrorMessage: "Couldn't check the Subway just now. Check before you head out.",
  });
}
