// GET /api/last-tram?lat=..&lng=..  →  LastRideResult (Metrolink)

import {
  computeMetrolinkLastRide,
  METROLINK_PROVENANCE,
  nearestMetrolinkStation,
} from "@/lib/metrolink";
import { runLastRideRoute } from "@/lib/lastRideRoute";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return runLastRideRoute({
    request,
    rateLimitKey: "last-tram",
    cityPackSegment: "manchester",
    nearestStation: nearestMetrolinkStation,
    computeLastRide: computeMetrolinkLastRide,
    provenance: METROLINK_PROVENANCE,
    provider: "metrolink",
    modeLabel: "tram",
    stationErrorFallback: "Couldn't resolve a Metrolink stop nearby.",
    catchErrorMessage: "Couldn't check Metrolink just now. Check before you head out.",
  });
}
