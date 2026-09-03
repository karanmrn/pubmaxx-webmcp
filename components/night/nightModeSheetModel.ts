import { clampStopIndex } from "@/lib/activePlan";
import type { CrewMemberDTO } from "@/lib/crew";
import { haversineKm } from "@/lib/haversine";
import type { PlanGetInReportDTO, PlanGetInStopDTO } from "@/lib/planGetIn";
import type { PlanState, PlanStopDTO } from "@/lib/plan";
import { legMinutes } from "@/lib/routeLegs";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

export type VenueCoord = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  kind?: VenueKind;
};

export type KeepGoingExtension = VenueCoord & { distanceKm: number };

export type LastTrainSlim = {
  station?: { name?: string } | null;
  decision?: { leaveByIso?: string | null; decision?: string } | null;
};

type TaggedLastTrain = {
  venueId: string;
  data: LastTrainSlim;
};

export type NightModeSheetRouteModel = {
  stops: PlanStopDTO[];
  cursor: number;
  currentStop: PlanStopDTO | null;
  nextStop: PlanStopDTO | null;
  currentSignal: PlanGetInStopDTO | null;
  currentCoord: VenueCoord | null;
  nextStopWalkMinutes: number | null;
  keepGoingExtensions: KeepGoingExtension[];
  currentTrain: LastTrainSlim | null;
  arrived: CrewMemberDTO[];
};

const ARRIVED: ReadonlySet<CrewMemberDTO["status"]> = new Set([
  "here",
  "on_the_way",
]);

export function rankKeepGoingExtensions(
  coords: readonly VenueCoord[],
  currentCoord: VenueCoord,
  routeVenueIds: ReadonlySet<string>,
): KeepGoingExtension[] {
  return coords
    .filter(
      (venue) => isPubVenueKind(venue.kind) && !routeVenueIds.has(venue.id),
    )
    .map((venue) => ({
      ...venue,
      distanceKm: haversineKm(
        [currentCoord.lng, currentCoord.lat],
        [venue.lng, venue.lat],
      ),
    }))
    .filter((venue) => venue.distanceKm <= 2.5)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, 2);
}

export function deriveNightModeSheetRouteModel({
  plan,
  report,
  stopIndex,
  coords,
  lastTrain,
}: {
  plan: PlanState | null;
  report: PlanGetInReportDTO | null;
  stopIndex: number;
  coords: readonly VenueCoord[] | null;
  lastTrain: TaggedLastTrain | null;
}): NightModeSheetRouteModel {
  const stops = plan?.stops ?? [];
  const cursor = clampStopIndex(stopIndex, stops.length);
  const currentStop = stops[cursor] ?? null;
  const nextStop = stops[cursor + 1] ?? null;
  const signals = new Map(
    (report?.stops ?? []).map((signal) => [signal.venueId, signal]),
  );
  const currentSignal = currentStop
    ? (signals.get(currentStop.venueId) ?? null)
    : null;
  const currentCoord = currentStop
    ? (coords?.find((venue) => venue.id === currentStop.venueId) ?? null)
    : null;
  const nextCoord = nextStop
    ? (coords?.find((venue) => venue.id === nextStop.venueId) ?? null)
    : null;
  const nextStopWalkMinutes =
    currentCoord && nextCoord
      ? legMinutes(
          haversineKm(
            [currentCoord.lng, currentCoord.lat],
            [nextCoord.lng, nextCoord.lat],
          ),
          "walk",
        )
      : null;
  const keepGoingExtensions =
    currentCoord && coords
      ? rankKeepGoingExtensions(
          coords,
          currentCoord,
          new Set(stops.map((stop) => stop.venueId)),
        )
      : [];
  const currentTrain =
    currentCoord && lastTrain?.venueId === currentCoord.id
      ? lastTrain.data
      : null;
  const arrived = (plan?.crew ?? []).filter((member) =>
    ARRIVED.has(member.status),
  );

  return {
    stops,
    cursor,
    currentStop,
    nextStop,
    currentSignal,
    currentCoord,
    nextStopWalkMinutes,
    keepGoingExtensions,
    currentTrain,
    arrived,
  };
}
