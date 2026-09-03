import { describe, expect, it } from "vitest";

import { formatJourneyModes, formatJourneySummary } from "@/lib/formatJourney";

describe("formatJourneyModes", () => {
  it("joins modes with arrows and prefixes duration", () => {
    expect(
      formatJourneyModes({
        durationMinutes: 15.4,
        legs: [{ mode: "walking" }, { mode: "bus" }, { mode: "Walk" }],
      }),
    ).toBe("15 min · walk → bus → walk");
  });

  it("omits duration when missing", () => {
    expect(formatJourneyModes({ legs: [{ mode: "tube" }] })).toBe("tube");
  });

  it("falls back when legs are empty", () => {
    expect(formatJourneyModes({ durationMinutes: 8, legs: [] })).toBe("8 min · route");
  });
});

describe("formatJourneySummary", () => {
  it("aliases formatJourneyModes", () => {
    const journey = {
      durationMinutes: 12,
      legs: [{ mode: "walking" }, { mode: "tube" }],
    };
    expect(formatJourneySummary(journey)).toBe(formatJourneyModes(journey));
  });
});
