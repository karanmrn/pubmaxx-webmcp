"use client";

import { useEffect, useMemo, useState } from "react";

import { loadPoisFromPath, type Poi } from "@/lib/pois";
import { poisOnRoute, type OnTheWayPoi, type RouteLegsSummary } from "@/lib/routeLegs";

// "On the way" POI threading (story 26): garden/market/historic/viewpoint
// POIs within ~250m of a leg. Loaded independently of the map canvas — a
// second, cheap client fetch of the same bundled dataset — so RoutePanel
// doesn't need PubMapCanvas's internal POI state lifted out.
export function useRoutePois(
  legSummary: RouteLegsSummary,
  poisPath: string | null,
): Map<number, OnTheWayPoi[]> {
  const [pois, setPois] = useState<Poi[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadPoisFromPath(poisPath)
      .then((loaded) => {
        if (!cancelled) setPois(loaded);
      })
      .catch(() => {
        // "On the way" is a nicety — a fetch failure just leaves it empty.
      });
    return () => {
      cancelled = true;
    };
  }, [poisPath]);
  const onTheWayByLeg = useMemo(
    () => poisOnRoute(legSummary.legs, pois),
    [legSummary.legs, pois],
  );
  return onTheWayByLeg;
}
