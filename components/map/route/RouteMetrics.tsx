"use client";

import {
  Anchor,
  BadgePoundSterling,
  BookOpen,
  Footprints,
  Landmark,
  MapPin,
  TrainFront,
  Trophy,
} from "lucide-react";

import { formatPrice } from "@/lib/venues";
import type { RouteLegsSummary, RoutePace } from "@/lib/routeLegs";

type RouteMetricsProps = {
  summaryTotal: number;
  summaryDistance: number;
  legSummary: RouteLegsSummary;
  pace: RoutePace;
  journeyTotalMinutes: number | null;
  journeyLoading: boolean;
  routeLength: number;
  stopNoun: string;
  routeHeritageCount: number;
  routeWaterCount: number;
  routeWriterCount: number;
};

export default function RouteMetrics({
  summaryTotal,
  summaryDistance,
  legSummary,
  pace,
  journeyTotalMinutes,
  journeyLoading,
  routeLength,
  stopNoun,
  routeHeritageCount,
  routeWaterCount,
  routeWriterCount,
}: RouteMetricsProps) {
  return (
    <div className="routeMetrics">
      <div>
        <BadgePoundSterling size={17} />
        <span>{formatPrice(summaryTotal)}</span>
        <small>estimated round</small>
      </div>
      <div
        title="Haversine (straight-line) distance between stops. Walking distance will be longer."
      >
        <MapPin size={17} />
        <span>{summaryDistance.toFixed(1)} km</span>
        <small>straight-line, between stops</small>
      </div>
      {legSummary.legs.length > 0 ? (
        <div
          title="Estimated at 4.8 km/h (walking) or 9 km/h (running), over the same straight-line distance. Real pavement time will be longer."
        >
          <Footprints size={17} />
          <span>{legSummary.totalMinutes} min</span>
          <small>{pace === "run" ? "running, straight-line" : "walking, straight-line"}</small>
        </div>
      ) : null}
      {typeof journeyTotalMinutes === "number" ? (
        <div title="Live TfL itinerary between stops via CityMCP London (leave-now).">
          <TrainFront size={17} />
          <span>{Math.round(journeyTotalMinutes)} min</span>
          <small>TfL between stops</small>
        </div>
      ) : journeyLoading ? (
        <div>
          <TrainFront size={17} />
          <span>…</span>
          <small>TfL loading</small>
        </div>
      ) : null}
      <div>
        <Trophy size={17} />
        <span>{routeLength}</span>
        <small>{routeLength === 1 ? stopNoun : `${stopNoun}s`}</small>
      </div>
      <div>
        <Landmark size={17} />
        <span>{routeHeritageCount}</span>
        <small>story pubs</small>
      </div>
      <div>
        <Anchor size={17} />
        <span>{routeWaterCount}</span>
        <small>by water</small>
      </div>
      <div>
        <BookOpen size={17} />
        <span>{routeWriterCount}</span>
        <small>writer picks</small>
      </div>
    </div>
  );
}
