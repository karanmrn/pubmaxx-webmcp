import { describe, expect, it, vi } from "vitest";

import {
  latestJourneyForDay,
  mergeTimetableSchedules,
  nextFromSchedulesAfter,
  summarizeLineStatuses,
} from "@/lib/lastTrain.server";

describe("last-train server seams", () => {
  it("selects latest matching journey and keeps after-midnight service latest", () => {
    const latest = latestJourneyForDay(
      [
        { name: "Monday - Friday", lastJourney: { hour: "23", minute: "58" } },
        { name: "Monday - Friday", lastJourney: { hour: "24", minute: "17" } },
        { name: "Saturday", lastJourney: { hour: "25", minute: "10" } },
      ],
      "mon-thu",
    );

    expect(latest).toEqual({ hour: "24", minute: "17" });
  });

  it("merges all schedules from timetable disambiguation options", async () => {
    const resolve = vi.fn(async (uri: string) => ({
      timetable: {
        routes: [{ schedules: [{ name: uri, lastJourney: { hour: 23, minute: 30 } }] }],
      },
    }));

    const schedules = await mergeTimetableSchedules(
      {
        disambiguation: {
          disambiguationOptions: [{ uri: "/north" }, {}, { uri: "/south" }],
        },
      },
      resolve,
    );

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(schedules.map((schedule) => schedule.name)).toEqual(["/north", "/south"]);
  });

  it("starts timetable disambiguation reads in parallel", async () => {
    let releaseNorth!: () => void;
    let northReleased = false;
    const northGate = new Promise<void>((resolve) => {
      releaseNorth = resolve;
    });
    const starts: string[] = [];
    const resolve = vi.fn(async (uri: string) => {
      starts.push(`${uri}:${northReleased ? "after" : "before"}`);
      if (uri === "/north") await northGate;
      return {
        timetable: {
          routes: [{ schedules: [{ name: uri, lastJourney: { hour: 23, minute: 30 } }] }],
        },
      };
    });

    const pending = mergeTimetableSchedules(
      {
        disambiguation: {
          disambiguationOptions: [{ uri: "/north" }, { uri: "/south" }],
        },
      },
      resolve,
    );
    await Promise.resolve();
    northReleased = true;
    releaseNorth();

    await expect(pending).resolves.toHaveLength(2);
    expect(starts).toEqual(["/north:before", "/south:before"]);
  });

  it("orders upcoming timetable departures and falls back to earlier service", () => {
    const schedules = [
      { name: "Monday - Friday", lastJourney: { hour: 23, minute: 45 } },
      { name: "Monday - Friday", lastJourney: { hour: 24, minute: 15 } },
      { name: "Monday - Friday", lastJourney: { hour: 22, minute: 30 } },
    ];

    expect(nextFromSchedulesAfter(schedules, "mon-thu", 23 * 60)).toEqual([
      { clock: "23:45" },
      { clock: "00:15" },
    ]);
    expect(nextFromSchedulesAfter(schedules, "mon-thu", 26 * 60)).toEqual([
      { clock: "22:30" },
      { clock: "23:45" },
      { clock: "00:15" },
    ]);
  });

  it("aggregates disrupted lines and ignores good service", () => {
    const result = summarizeLineStatuses([
      {
        id: "victoria",
        name: "Victoria",
        lineStatuses: [{ statusSeverityDescription: "Good Service" }],
      },
      {
        id: "central",
        name: "Central",
        lineStatuses: [{ statusSeverityDescription: "Severe Delays" }],
      },
      {
        id: "district",
        name: "District",
        lineStatuses: [{ statusSeverityDescription: "Part Closure" }],
      },
    ]);

    expect(result.summary).toBe("Central: Severe Delays · District: Part Closure");
    expect([...result.affectedLineIds]).toEqual(["central", "district"]);
  });
});
