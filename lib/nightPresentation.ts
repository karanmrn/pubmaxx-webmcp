import { isNightAreaRouteReady, type NightArea } from "@/lib/nightAreas";

export function nightAreaCoverageDetail(area: NightArea, now: Date): string {
  if (isNightAreaRouteReady(area, now)) {
    return "Prices here are fresh and checked. Plan a crawl whenever.";
  }
  const openChecks = area.missingEvidence.length;
  return openChecks > 0
    ? `${openChecks} more ${openChecks === 1 ? "check" : "checks"} to do here before a crawl.`
    : "Not enough fresh information here yet to plan a crawl.";
}

export function getHomeEndingDescription(
  stationName: string | null,
  leaveByIso: string | null,
): string {
  return leaveByIso
    ? `Live leave-by time for ${stationName ?? "the nearest station"}.`
    : `Check ${stationName ?? "the nearest station"} before you confirm.`;
}

export function keepGoingDistanceDescription(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km straight-line`;
}

export function nextStopWalkDescription(minutes: number): string {
  return `about ${minutes} min on foot, straight-line estimate`;
}
