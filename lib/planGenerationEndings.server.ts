import "server-only";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import { haversineKm } from "@/lib/haversine";
import { getLateFoodForArea, normalizeLateFoodArea } from "@/lib/lateFood";
import type { NightContext } from "@/lib/nightPlanning";
import { buildPlanEndingRecommendations } from "@/lib/planEndings";

type Candidate = { venue: ConciergeVenue };

export function planGenerationEndings(input: {
  chosen: readonly Candidate[];
  candidates: readonly Candidate[];
  groundedAlternatives: readonly (readonly { value: Candidate }[])[] | null;
  hasIntake: boolean;
  context: NightContext;
  areaSlug: string;
  transportAnchor: string;
  now: number;
}) {
  const lastStop = input.chosen.at(-1)?.venue;
  const extensionCandidates = input.hasIntake
    ? input.context.budgetLimitPence !== null
      ? []
      : [...new Map((input.groundedAlternatives ?? []).flat()
        .map((stop) => [stop.value.venue.id, stop.value])).values()].slice(0, 2)
    : input.candidates.slice(3, 5);
  const extensions = extensionCandidates.map(({ venue }) => ({
    venueId: venue.id,
    venueName: venue.name,
    distanceKm: lastStop ? haversineKm([lastStop.lng, lastStop.lat], [venue.lng, venue.lat]) : 0,
    estimatedPintPricePence: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
  }));
  const lateFoodArea = normalizeLateFoodArea(input.areaSlug);
  const rankedLateFood = lateFoodArea ? getLateFoodForArea(lateFoodArea, input.context.foodNeeds, {
    from: lastStop ? { lat: lastStop.lat, lng: lastStop.lng } : null,
    now: input.now,
  }) : [];
  return buildPlanEndingRecommendations({
    daypart: input.context.daypart,
    foodRequested: input.context.foodNeeds.length > 0,
    transportAnchor: input.transportAnchor,
    lateFood: rankedLateFood,
    extensions,
  });
}
