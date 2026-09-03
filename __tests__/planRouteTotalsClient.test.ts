import { describe, expect, it, vi } from "vitest";

import type { PlanRouteTotals } from "@/lib/planIntelligence";
import {
  planRouteTotalsFallbackLabel,
  routedKmByFromIndex,
  upgradeRouteSummary,
  venuesForStops,
} from "@/lib/planRouteTotalsClient";
import { buildRouteLegs } from "@/lib/routeLegs";
import type { Venue } from "@/lib/venues";

function venue(id: string, lat: number, lng: number): Venue {
  return {
    id,
    name: id,
    latitude: lat,
    longitude: lng,
  } as Venue;
}

describe("planRouteTotalsClient", () => {
  it("falls back to honest straight-line API totals when venues are unavailable", () => {
    const totals: PlanRouteTotals = {
      stopCount: 3,
      straightLineWalkingKm: 1.2,
      estimatedWalkingMinutes: 18,
      distanceBasis: "straight-line",
    };
    expect(planRouteTotalsFallbackLabel(totals)).toBe("18 min walk total · 1.2 km, straight-line");
    expect(venuesForStops(["a", "b", "c"], undefined)).toBeNull();
  });

  it("resolves venues only when every stop id is present with coordinates", () => {
    const map = new Map<string, Venue>([
      ["a", venue("a", 51.5, -0.12)],
      ["b", venue("b", 51.51, -0.11)],
    ]);
    expect(venuesForStops(["a", "b"], map)?.map((row) => row.id)).toEqual(["a", "b"]);
    expect(venuesForStops(["a", "c"], map)).toBeNull();
  });

  it("upgrades a straight summary with routed leg distances", () => {
    const route = [venue("a", 51.5, -0.12), venue("b", 51.51, -0.11), venue("c", 51.52, -0.1)];
    const straight = buildRouteLegs(route);
    const upgraded = upgradeRouteSummary(straight, [
      { fromIndex: 0, toIndex: 1, distanceKm: 0.9, source: "ors" },
      { fromIndex: 1, toIndex: 2, distanceKm: 1.1, source: "ors" },
    ]);
    expect(upgraded.distanceBasis).toBe("routed");
    expect(upgraded.totalKm).toBeCloseTo(2.0, 5);
    expect(routedKmByFromIndex([{ fromIndex: 0, toIndex: 1, distanceKm: 0, source: "straight" }]).size).toBe(0);
  });

  it("fetchRoutedRouteSummary stays fail-soft when the walk-route API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const route = [venue("a", 51.5, -0.12), venue("b", 51.51, -0.11)];
    const { fetchRoutedRouteSummary } = await import("@/lib/planRouteTotalsClient");
    const summary = await fetchRoutedRouteSummary(route);
    expect(summary.distanceBasis).toBeUndefined();
    expect(summary.legs).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
