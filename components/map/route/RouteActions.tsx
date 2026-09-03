"use client";

import { ArrowUpDown, CalendarPlus, Route, TrainFront } from "lucide-react";

import { formatRouteTotal, type RouteLegsSummary, type RoutePace } from "@/lib/routeLegs";
import { type CrawlMode } from "@/components/map/ControlRail";
import type { Venue } from "@/lib/venues";
import RoundStarter from "@/components/round/RoundStarter";

type RouteActionsProps = {
  mode: CrawlMode;
  route: Venue[];
  legSummary: RouteLegsSummary;
  pace: RoutePace;
  setPace: (pace: RoutePace) => void;
  routeMapped: boolean;
  cityDisplayName: string;
  originDistanceKm?: number | null;
  onMapRoute: () => void;
  onHideRoute: () => void;
  onReverseRoute?: () => void;
  onCheckLastTrain?: () => void;
  crawlTitle: string;
  onRoundStarted?: (code: string) => void;
  addToCalendar: () => void;
};

export default function RouteActions({
  mode,
  route,
  legSummary,
  pace,
  setPace,
  routeMapped,
  cityDisplayName,
  originDistanceKm,
  onMapRoute,
  onHideRoute,
  onReverseRoute,
  onCheckLastTrain,
  crawlTitle,
  onRoundStarted,
  addToCalendar,
}: RouteActionsProps) {
  return (
    <>
      {route.length === 0 ? (
        <p className="emptyRoute">
          {mode === "build"
            ? "No stops yet. Tap pubs on the map or use the Add stops list below."
            : "No suggested route matches these filters. Reset filters or widen the route window."}
        </p>
      ) : null}

      {mode === "build" && route.length >= 2 && onReverseRoute ? (
        <button
          type="button"
          className="addStopBtn"
          style={{ marginTop: 0, marginBottom: "12px" }}
          onClick={onReverseRoute}
        >
          <ArrowUpDown size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} /> Reverse
          route
        </button>
      ) : null}

      {legSummary.legs.length > 0 ? (
        <div className="routePace" role="group" aria-label="Walking or running pace">
          <button
            type="button"
            className={pace === "walk" ? "routePaceBtn active" : "routePaceBtn"}
            aria-pressed={pace === "walk"}
            onClick={() => setPace("walk")}
          >
            Walk
          </button>
          <button
            type="button"
            className={pace === "run" ? "routePaceBtn active" : "routePaceBtn"}
            aria-pressed={pace === "run"}
            onClick={() => setPace("run")}
          >
            Run
          </button>
          <span className="routePaceTotal">{formatRouteTotal(legSummary)}</span>
        </div>
      ) : null}

      {legSummary.legs.length > 0 && pace === "run" ? (
        <p className="routeSafetyNote" role="note">
          Run pace is for getting between stops. Drink water, keep to well-lit routes, and
          never treat running as a reason to drink more.
        </p>
      ) : null}

      {route.length >= 2 ? (
        <div className={routeMapped ? "routeMapPrompt active" : "routeMapPrompt"}>
          <div>
            <strong>{routeMapped ? `Mapped on ${cityDisplayName}` : "Map this plan?"}</strong>
            <span>
              {legSummary.totalKm.toFixed(1)} km, {legSummary.totalMinutes} min{" "}
              {pace === "run" ? "run" : "walk"},
              straight-line.
            </span>
            {typeof originDistanceKm === "number" ? (
              <small>From you: {originDistanceKm.toFixed(1)} km to the first stop.</small>
            ) : null}
          </div>
          <button
            type="button"
            onClick={routeMapped ? onHideRoute : onMapRoute}
            aria-pressed={routeMapped}
          >
            <Route size={14} aria-hidden="true" />
            {routeMapped ? "Hide line" : "Map route"}
          </button>
        </div>
      ) : null}

      {route.length >= 2 ? (
        <div className="planRoundBridge" data-testid="plan-round-bridge">
          <p className="roundStarterHelper">
            Invite friends to walk this plan as a Round.
          </p>
          <RoundStarter
            compact
            defaultTitle={crawlTitle}
            seedStops={route.map((venue) => ({ id: venue.id, name: venue.name }))}
            onRoundStarted={onRoundStarted}
          />
        </div>
      ) : null}

      {route.length >= 1 ? (
        <button
          type="button"
          className="addStopBtn calendarBtn"
          onClick={addToCalendar}
          data-testid="add-to-calendar"
        >
          <CalendarPlus size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Add to calendar (.ics)
        </button>
      ) : null}

      {route.length >= 2 && onCheckLastTrain ? (
        <button
          type="button"
          className="addStopBtn trainRouteBtn"
          onClick={onCheckLastTrain}
          data-testid="check-last-train"
        >
          <TrainFront size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Check last train at final stop
        </button>
      ) : null}
    </>
  );
}
