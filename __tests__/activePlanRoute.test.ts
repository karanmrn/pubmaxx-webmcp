import { describe, it, expect } from "vitest";

import { planStopsToRouteVenues } from "@/lib/activePlanRoute";
import type { PlanStopDTO } from "@/lib/plan";
import type { Venue } from "@/lib/venues";

// Minimal Venue fixture — the mapper only needs id/name/lat/lng to be a Venue;
// the map paint (routeToLine/routeToStops) reads the coordinates downstream.
function v(id: string, longitude: number, latitude: number): Venue {
  return { id, name: id, latitude, longitude } as Venue;
}

function stop(venueId: string, position: number): PlanStopDTO {
  return { venueId, venueName: venueId, position };
}

function index(...venues: Venue[]): Map<string, Venue> {
  return new Map(venues.map((venue) => [venue.id, venue]));
}

describe("planStopsToRouteVenues", () => {
  const a = v("a", -0.13, 51.51);
  const b = v("b", -0.14, 51.52);
  const c = v("c", -0.12, 51.5);

  it("maps stops to ordered venues for the route paint", () => {
    const stops = [stop("a", 0), stop("b", 1), stop("c", 2)];
    const out = planStopsToRouteVenues(stops, index(a, b, c));
    expect(out.map((venue) => venue.id)).toEqual(["a", "b", "c"]);
  });

  it("orders by stored position, not array order", () => {
    // Stops arriving out of order still walk in the intended sequence.
    const stops = [stop("c", 2), stop("a", 0), stop("b", 1)];
    const out = planStopsToRouteVenues(stops, index(a, b, c));
    expect(out.map((venue) => venue.id)).toEqual(["a", "b", "c"]);
  });

  it("drops stops whose venue isn't on the map (honest-empty geometry)", () => {
    // "z" isn't in the index — the line must never join a phantom pin.
    const stops = [stop("a", 0), stop("z", 1), stop("b", 2)];
    const out = planStopsToRouteVenues(stops, index(a, b, c));
    expect(out.map((venue) => venue.id)).toEqual(["a", "b"]);
  });

  it("collapses duplicate venue ids to their first appearance", () => {
    const stops = [stop("a", 0), stop("b", 1), stop("a", 2)];
    const out = planStopsToRouteVenues(stops, index(a, b, c));
    expect(out.map((venue) => venue.id)).toEqual(["a", "b"]);
  });

  it("returns [] when fewer than two stops resolve", () => {
    // A single locatable stop is not a walk — no line, no lone overlay marker.
    expect(planStopsToRouteVenues([stop("a", 0)], index(a, b, c))).toEqual([]);
    expect(planStopsToRouteVenues([stop("a", 0), stop("z", 1)], index(a, b, c))).toEqual([]);
  });

  it("is honest-empty for missing / empty / malformed input", () => {
    expect(planStopsToRouteVenues(null, index(a, b))).toEqual([]);
    expect(planStopsToRouteVenues(undefined, index(a, b))).toEqual([]);
    expect(planStopsToRouteVenues([], index(a, b))).toEqual([]);
    // Blank / non-string venue ids are skipped, not resolved.
    const junk = [
      { venueId: "", venueName: "", position: 0 } as PlanStopDTO,
      { venueId: undefined as unknown as string, venueName: "", position: 1 } as PlanStopDTO,
      stop("a", 2),
      stop("b", 3),
    ];
    expect(planStopsToRouteVenues(junk, index(a, b)).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input stops array", () => {
    const stops = [stop("c", 2), stop("a", 0), stop("b", 1)];
    const snapshot = stops.map((s) => s.venueId);
    planStopsToRouteVenues(stops, index(a, b, c));
    expect(stops.map((s) => s.venueId)).toEqual(snapshot);
  });
});
