import { describe, expect, it } from "vitest";

import {
  assessOpeningSchedule,
  type PlanOpeningSchedule,
} from "@/lib/planRouteEvidence";

const NOW = new Date("2026-07-20T12:00:00.000Z").getTime();
const SOURCE = {
  label: "Canonical opening hours",
  url: "https://example.com/opening-hours",
  observedAt: "2026-07-11T12:00:00.000Z",
};

function schedule(ranges: PlanOpeningSchedule["ranges"]): PlanOpeningSchedule {
  return { ranges, source: SOURCE, venueListedOpen: true };
}

describe("opening schedule interval coverage", () => {
  it("does not bridge a gap between separate opening ranges", () => {
    const assessment = assessOpeningSchedule(schedule([
      { weekday: "Monday", startsAt: "17:00", endsAt: "18:00" },
      { weekday: "Monday", startsAt: "18:30", endsAt: "20:00" },
    ]), {
      startsAt: "2026-07-20T16:30:00.000Z",
      endsAt: "2026-07-20T18:00:00.000Z",
    }, NOW);

    expect(assessment.state).toBe("listed_closed");
  });

  it("accepts a visit covered by one continuous range", () => {
    const assessment = assessOpeningSchedule(schedule([
      { weekday: "Monday", startsAt: "17:00", endsAt: "20:00" },
    ]), {
      startsAt: "2026-07-20T16:30:00.000Z",
      endsAt: "2026-07-20T18:00:00.000Z",
    }, NOW);

    expect(assessment.state).toBe("listed_open");
  });

  it("accepts one overnight range across the weekly boundary", () => {
    const assessment = assessOpeningSchedule(schedule([
      { weekday: "Sunday", startsAt: "23:00", endsAt: "02:00" },
    ]), {
      startsAt: "2026-07-19T22:30:00.000Z",
      endsAt: "2026-07-20T00:30:00.000Z",
    }, NOW);

    expect(assessment.state).toBe("listed_open");
  });

  it("keeps London wall-clock coverage across the autumn DST change", () => {
    const openingSchedule = schedule([
      { weekday: "Sunday", startsAt: "00:30", endsAt: "02:30" },
    ]);
    openingSchedule.source = { ...SOURCE, observedAt: "2026-10-20T12:00:00.000Z" };
    const assessment = assessOpeningSchedule(openingSchedule, {
      startsAt: "2026-10-24T23:45:00.000Z",
      endsAt: "2026-10-25T02:15:00.000Z",
    }, new Date("2026-10-25T12:00:00.000Z").getTime());

    expect(assessment.state).toBe("listed_open");
  });
});
