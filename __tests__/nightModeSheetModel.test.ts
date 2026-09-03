import { describe, expect, it } from "vitest";

import {
  deriveNightModeSheetRouteModel,
  type NightModeSheetRouteModel,
  type VenueCoord,
} from "@/components/night/nightModeSheetModel";
import type { CrewMemberDTO } from "@/lib/crew";
import type { PlanGetInReportDTO, PlanGetInStopDTO } from "@/lib/planGetIn";
import type { PlanState, PlanStopDTO } from "@/lib/plan";

const NOW = "2026-08-30T20:00:00.000Z";

const stops: PlanStopDTO[] = [
  { venueId: "venue-a", venueName: "The First", position: 0 },
  { venueId: "venue-b", venueName: "The Middle", position: 1 },
  { venueId: "venue-c", venueName: "The Last", position: 2 },
];

const crew: CrewMemberDTO[] = [
  { id: "crew-in", name: "Indoors", status: "in", joinedAt: NOW, updatedAt: NOW },
  {
    id: "crew-way",
    name: "On the way",
    status: "on_the_way",
    joinedAt: NOW,
    updatedAt: NOW,
  },
  { id: "crew-here", name: "Here", status: "here", joinedAt: NOW, updatedAt: NOW },
  {
    id: "crew-late",
    name: "Late",
    status: "running_late",
    joinedAt: NOW,
    updatedAt: NOW,
  },
];

const plan: PlanState = {
  plan: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Model night",
    startTime: NOW,
    createdAt: NOW,
    routeRevision: 1,
    status: "active",
  },
  stops,
  crew,
};

const middleSignal: PlanGetInStopDTO = {
  position: 1,
  venueId: "venue-b",
  venueName: "The Middle",
  busyness: {
    level: "busy",
    label: "Busy",
    source: "typical-pattern",
    isEstimate: true,
    isOpen: "unknown",
    explanation: "Typical Saturday night estimate.",
  },
  getIn: {
    fit: "uncertain",
    label: "Could be tight",
    reason: "Group fit is uncertain.",
  },
  booking: {
    available: false,
    label: "Booking link unavailable",
    href: null,
  },
};

const report: PlanGetInReportDTO = {
  groupSize: crew.length,
  generatedAt: NOW,
  stops: [middleSignal],
};

const coords: VenueCoord[] = [
  {
    id: "venue-a",
    name: "The First",
    lat: 51.499,
    lng: -0.1,
    cheapestPrice: 5,
    kind: "pub",
  },
  {
    id: "venue-b",
    name: "The Middle",
    lat: 51.5,
    lng: -0.1,
    cheapestPrice: 6,
    kind: "pub",
  },
  {
    id: "venue-c",
    name: "The Last",
    lat: 51.501,
    lng: -0.1,
    cheapestPrice: 7,
    kind: "pub",
  },
  {
    id: "venue-extra",
    name: "One More",
    lat: 51.502,
    lng: -0.1,
    cheapestPrice: 6.5,
    kind: "pub",
  },
  {
    id: "venue-bar",
    name: "Not a Pint Extension",
    lat: 51.502,
    lng: -0.1,
    cheapestPrice: 12,
    kind: "bar",
  },
];

describe("deriveNightModeSheetRouteModel", () => {
  it("derives current route section from canonical plan and feed state", () => {
    const model: NightModeSheetRouteModel = deriveNightModeSheetRouteModel({
      plan,
      report,
      stopIndex: 1,
      coords,
      lastTrain: {
        venueId: "venue-b",
        data: {
          station: { name: "Clapham Common" },
          decision: { leaveByIso: "2026-08-30T22:45:00.000Z" },
        },
      },
    });

    expect({
      cursor: model.cursor,
      currentStop: model.currentStop?.venueId ?? null,
      nextStop: model.nextStop?.venueId ?? null,
      currentSignal: model.currentSignal?.venueId ?? null,
      currentCoord: model.currentCoord?.id ?? null,
      nextStopWalkMinutes: model.nextStopWalkMinutes,
      keepGoingExtensions: model.keepGoingExtensions.map((venue) => venue.id),
      currentTrainStation: model.currentTrain?.station?.name ?? null,
      arrived: model.arrived.map((member) => member.id),
    }).toEqual({
      cursor: 1,
      currentStop: "venue-b",
      nextStop: "venue-c",
      currentSignal: "venue-b",
      currentCoord: "venue-b",
      nextStopWalkMinutes: 2,
      keepGoingExtensions: ["venue-extra"],
      currentTrainStation: "Clapham Common",
      arrived: ["crew-way", "crew-here"],
    });
  });

  it("rejects last-train state from a previous Crawl Stop", () => {
    const model = deriveNightModeSheetRouteModel({
      plan,
      report,
      stopIndex: 1,
      coords,
      lastTrain: {
        venueId: "venue-a",
        data: { station: { name: "Stale station" } },
      },
    });

    expect(model.currentStop?.venueId).toBe("venue-b");
    expect(model.currentTrain).toBeNull();
  });

  it("clamps an out-of-range index to the final Crawl Stop", () => {
    const model = deriveNightModeSheetRouteModel({
      plan,
      report,
      stopIndex: 99,
      coords,
      lastTrain: null,
    });

    expect(model.cursor).toBe(2);
    expect(model.currentStop?.venueId).toBe("venue-c");
    expect(model.nextStop).toBeNull();
  });
});
