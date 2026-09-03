import { describe, expect, it } from "vitest";

import {
  contributionStreak,
  londonDayKey,
  streakLabel,
  summariseContributions,
  tallyByBorough,
} from "@/lib/pintContributions";

// A fixed "now" anchored at noon UTC = 13:00 Europe/London (BST) on 2026-07-17,
// so the day never straddles a timezone boundary in these fixtures.
const NOW = new Date("2026-07-17T12:00:00Z");

function londonNoon(day: string): string {
  // Noon UTC always renders as the same London calendar day (BST or GMT).
  return `${day}T12:00:00Z`;
}

describe("londonDayKey", () => {
  it("buckets on the Europe/London calendar day, not UTC", () => {
    // 23:30 UTC on 6 July is already 00:30 on 7 July in London (BST).
    expect(londonDayKey("2026-07-06T23:30:00Z")).toBe("2026-07-07");
    expect(londonDayKey("2026-07-07T00:30:00Z")).toBe("2026-07-07");
  });

  it("returns '' for an unparseable input", () => {
    expect(londonDayKey("not-a-date")).toBe("");
  });
});

describe("contributionStreak", () => {
  it("is all zeroes with no drops (never fabricates a streak)", () => {
    expect(contributionStreak([], NOW)).toEqual({
      current: 0,
      longest: 0,
      activeDays: 0,
      lastDay: "",
    });
  });

  it("counts consecutive London days ending today", () => {
    const streak = contributionStreak(
      ["2026-07-17", "2026-07-16", "2026-07-15"].map(londonNoon),
      NOW,
    );
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.activeDays).toBe(3);
    expect(streak.lastDay).toBe("2026-07-17");
  });

  it("keeps a live streak when the last drop was yesterday", () => {
    const streak = contributionStreak(
      ["2026-07-16", "2026-07-15"].map(londonNoon),
      NOW,
    );
    expect(streak.current).toBe(2);
  });

  it("reads current=0 once the streak has lapsed but keeps the longest record", () => {
    const streak = contributionStreak(
      ["2026-07-15", "2026-07-14", "2026-07-13"].map(londonNoon),
      NOW,
    );
    expect(streak.current).toBe(0); // last active day (15th) is 2 days before now
    expect(streak.longest).toBe(3);
    expect(streak.activeDays).toBe(3);
  });

  it("collapses multiple drops on one day to a single active day", () => {
    const streak = contributionStreak(
      [
        "2026-07-17T09:00:00Z",
        "2026-07-17T18:00:00Z",
        "2026-07-16T12:00:00Z",
      ],
      NOW,
    );
    expect(streak.current).toBe(2);
    expect(streak.activeDays).toBe(2);
  });

  it("resets the run across a gap and reports the best run as longest", () => {
    const streak = contributionStreak(
      // A 4-day run in June, then a 2-day run ending today.
      [
        "2026-06-01",
        "2026-06-02",
        "2026-06-03",
        "2026-06-04",
        "2026-07-16",
        "2026-07-17",
      ].map(londonNoon),
      NOW,
    );
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(4);
  });
});

describe("tallyByBorough", () => {
  it("counts by borough, most-mapped first, ties alphabetical", () => {
    const tally = tallyByBorough([
      { borough: "Hackney" },
      { borough: "Hackney" },
      { borough: "Camden" },
      { borough: "Islington" },
      { borough: "Camden" },
    ]);
    expect(tally).toEqual([
      { borough: "Camden", count: 2 },
      { borough: "Hackney", count: 2 },
      { borough: "Islington", count: 1 },
    ]);
  });

  it("folds blank/unknown boroughs under 'London' so totals reconcile", () => {
    const tally = tallyByBorough([{ borough: "" }, { borough: null }, {}]);
    expect(tally).toEqual([{ borough: "London", count: 3 }]);
  });
});

describe("summariseContributions", () => {
  it("counts pints from PRICED drops only, but keeps the streak on any drop", () => {
    const summary = summariseContributions(
      "ale",
      [
        { createdAt: londonNoon("2026-07-17"), borough: "Hackney", priceGbp: 4.5 },
        { createdAt: londonNoon("2026-07-16"), borough: "Hackney", priceGbp: 5 },
        // A note-only anecdote keeps the streak alive but is NOT a "mapped pint".
        { createdAt: londonNoon("2026-07-15"), borough: "Camden", priceGbp: null },
      ],
      NOW,
    );
    expect(summary.pintsMapped).toBe(2);
    expect(summary.total).toBe(3);
    expect(summary.streak.current).toBe(3);
    expect(summary.byBorough).toEqual([{ borough: "Hackney", count: 2 }]);
  });
});

describe("streakLabel", () => {
  it("prompts to start when there is no active streak", () => {
    expect(streakLabel({ current: 0, longest: 3, activeDays: 3, lastDay: "" })).toMatch(
      /drop a price to start/i,
    );
  });

  it("pluralises the day count and stays on the mapping framing", () => {
    expect(streakLabel({ current: 1, longest: 1, activeDays: 1, lastDay: "" })).toBe(
      "1-day mapping streak",
    );
    expect(streakLabel({ current: 4, longest: 4, activeDays: 4, lastDay: "" })).toBe(
      "4-days mapping streak",
    );
  });
});
