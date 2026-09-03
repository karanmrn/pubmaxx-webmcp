import { describe, expect, it } from "vitest";

import { summariseGetHome } from "@/lib/tonightGetHome";
import type { LastTrainResult } from "@/lib/tfl";

const BASE: LastTrainResult = {
  station: { id: "940GZZLUOXC", name: "Oxford Circus", distanceM: 240 },
  trains: [
    {
      lineId: "victoria",
      lineName: "Victoria",
      colour: "#0098D4",
      clock: "00:05",
      pastMidnight: true,
    },
    {
      lineId: "bakerloo",
      lineName: "Bakerloo",
      colour: "#B36305",
      clock: "23:41",
      pastMidnight: false,
    },
  ],
  generatedAt: "2026-07-17T22:30:00.000Z",
  decision: {
    decision: "order_one_more",
    leaveByIso: "2026-07-17T23:40:00.000Z",
    stationName: "Oxford Circus",
    lineNames: ["Victoria"],
    disruptionSummary: null,
    walkMinutesEstimate: 4,
    bufferMinutes: 5,
    destinationLabel: null,
    live: true,
  },
};

describe("summariseGetHome", () => {
  it("summarises good service with the latest last train across lines", () => {
    const now = new Date("2026-07-17T20:00:00.000Z");
    const summary = summariseGetHome(BASE, now);
    expect(summary).toEqual({
      statusLine: "Victoria line good service.",
      trainLine: "Last train from Oxford Circus 00:05.",
    });
  });

  it("prefers a past-midnight departure over a later-looking evening clock", () => {
    const result: LastTrainResult = {
      ...BASE,
      trains: [
        {
          lineId: "victoria",
          lineName: "Victoria",
          colour: "#0098D4",
          clock: "23:58",
          pastMidnight: false,
        },
        {
          lineId: "central",
          lineName: "Central",
          colour: "#E32017",
          clock: "00:12",
          pastMidnight: true,
        },
      ],
    };
    const summary = summariseGetHome(
      result,
      new Date("2026-07-17T20:00:00.000Z"),
    );
    expect(summary?.trainLine).toBe("Last train from Oxford Circus 00:12.");
  });

  it("adds the leave-by countdown when the leave-by moment is close", () => {
    const now = new Date("2026-07-17T23:20:00.000Z"); // 20 min before leaveByIso
    const summary = summariseGetHome(BASE, now);
    expect(summary?.trainLine).toBe(
      "Last train from Oxford Circus 00:05. Leave in 20 min.",
    );
  });

  it("shows a truncated disruption note instead of good service", () => {
    const longNote =
      "Victoria line: severe delays between Brixton and Victoria while we fix a signal failure at Stockwell, tickets accepted on local buses.";
    const result: LastTrainResult = {
      ...BASE,
      decision: { ...BASE.decision!, disruptionSummary: longNote },
    };
    const summary = summariseGetHome(
      result,
      new Date("2026-07-17T20:00:00.000Z"),
    );
    expect(summary?.statusLine.length).toBeLessThanOrEqual(91);
    expect(summary?.statusLine.endsWith("…")).toBe(true);
  });

  it("returns null for the route's graceful-failure shape", () => {
    expect(
      summariseGetHome({
        station: { id: "", name: "", distanceM: 0 },
        trains: [],
        generatedAt: "2026-07-17T22:30:00.000Z",
      }),
    ).toBeNull();
    expect(
      summariseGetHome({
        error: "TfL unavailable",
      } as unknown as LastTrainResult),
    ).toBeNull();
  });

  it("falls back to the latest-running line name when no decision is present", () => {
    const result: LastTrainResult = { ...BASE, decision: undefined };
    const summary = summariseGetHome(
      result,
      new Date("2026-07-17T20:00:00.000Z"),
    );
    expect(summary?.statusLine).toBe("Victoria line good service.");
  });
});
