import { describe, expect, it } from "vitest";

import {
  currentLastTrainState,
  lastRideDecisionCopy,
  lastRideLabelForVenue,
  lastTrainRequestKey,
  provenanceCopyForDepartures,
  provenanceCopyForResult,
  type LastTrainCardState,
} from "@/components/map/LastTrainCard";
import type { LastTrainResult, NextDepartures } from "@/lib/tfl";

function departure(overrides: Partial<NextDepartures>): NextDepartures {
  return {
    lineId: "northern",
    lineName: "Northern",
    colour: "#000000",
    times: ["23:42"],
    live: false,
    ...overrides,
  };
}

function lastTrainResult(stationName: string): LastTrainResult {
  return {
    station: { id: stationName.toLowerCase(), name: stationName, distanceM: 120 },
    trains: [
      {
        lineId: "northern",
        lineName: "Northern",
        colour: "#000000",
        clock: "00:12",
        pastMidnight: true,
      },
    ],
    generatedAt: "2026-07-08T20:00:00.000Z",
    departures: [departure({ live: true })],
    decision: {
      decision: "order_one_more",
      leaveByIso: "2026-07-08T23:57:00.000Z",
      stationName,
      lineNames: ["Northern"],
      disruptionSummary: null,
      walkMinutesEstimate: 3,
      bufferMinutes: 5,
      destinationLabel: "High Barnet",
      live: true,
    },
    nearestPubs: [],
  };
}

describe("LastTrainCard provenance copy", () => {
  it("does not describe the Last Pint decision as live when only timetable data is rendered", () => {
    expect(provenanceCopyForDepartures([departure({ live: false })])).toBe(
      "Scheduled times from TfL - not a live feed.",
    );
  });

  it("scopes the live claim to next departures because the last-train decision is timetable-based", () => {
    expect(provenanceCopyForDepartures([departure({ live: true })])).toBe(
      "Live departures from TfL; last train uses the timetable.",
    );
  });

  it("prefers provider provenance for Metrolink static answers", () => {
    expect(
      provenanceCopyForResult({
        provenance: "Typical Metrolink last service (static)",
        departures: [departure({ live: false })],
      }),
    ).toBe("Typical Metrolink last service (static)");
  });
});

describe("LastTrainCard venue-kind copy", () => {
  it("keeps London pub branding and verdicts for pubs", () => {
    expect(lastRideLabelForVenue("Last Pint", "pub")).toBe("Last Pint");
    expect(lastRideDecisionCopy("half_pint_only", "train", undefined, "pub")).toBe(
      "Half pint only",
    );
  });

  it("uses neutral transport copy for late-food venues", () => {
    expect(lastRideLabelForVenue("Last Pint", "food")).toBe("Last train");
    expect(lastRideDecisionCopy("order_one_more", "train", undefined, "food")).toBe(
      "Time in hand",
    );
    expect(lastRideDecisionCopy("half_pint_only", "train", undefined, "food")).toBe(
      "Brief stop only",
    );
    expect(lastRideDecisionCopy("settle_up_now", "train", undefined, "food")).toBe(
      "Head off now",
    );
  });
});

describe("LastTrainCard venue switching", () => {
  it("hides a ready result from the previous venue while the new venue is loading", () => {
    const oldRequest = lastTrainRequestKey({
      lat: 51.515,
      lng: -0.142,
      venueName: "The Old Pub",
    });
    const nextRequest = lastTrainRequestKey({
      lat: 51.503,
      lng: -0.075,
      venueName: "The Next Pub",
    });
    const previousReadyState: LastTrainCardState = {
      status: "ready",
      requestKey: oldRequest,
      data: lastTrainResult("Oxford Circus"),
    };

    expect(currentLastTrainState(previousReadyState, nextRequest)).toEqual({ status: "loading" });
  });

  it("keeps the current venue result visible", () => {
    const requestKey = lastTrainRequestKey({
      lat: 51.515,
      lng: -0.142,
      venueName: "The Current Pub",
    });
    const readyState: LastTrainCardState = {
      status: "ready",
      requestKey,
      data: lastTrainResult("Oxford Circus"),
    };

    expect(currentLastTrainState(readyState, requestKey)).toBe(readyState);
  });

  it("hides a stale empty result from the previous venue", () => {
    const oldRequest = lastTrainRequestKey({
      lat: 51.515,
      lng: -0.142,
      venueName: "The Old Pub",
    });
    const nextRequest = lastTrainRequestKey({
      lat: 51.503,
      lng: -0.075,
      venueName: "The Next Pub",
    });

    expect(currentLastTrainState({ status: "empty", requestKey: oldRequest }, nextRequest)).toEqual({
      status: "loading",
    });
  });

  it("keeps the same request key when only the session destination changes", () => {
    // Destination is client-only display state — changing it must not refetch TfL.
    const base = lastTrainRequestKey({
      lat: 51.515,
      lng: -0.142,
      venueName: "The Current Pub",
    });
    const again = lastTrainRequestKey({
      lat: 51.515,
      lng: -0.142,
      venueName: "The Current Pub",
    });
    expect(again).toBe(base);
    const readyState: LastTrainCardState = {
      status: "ready",
      requestKey: base,
      data: lastTrainResult("Oxford Circus"),
    };
    expect(currentLastTrainState(readyState, again)).toBe(readyState);
  });
});
