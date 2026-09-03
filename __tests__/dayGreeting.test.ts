import { describe, expect, it } from "vitest";

import {
  buildDayGreeting,
  daySlot,
  PICKS_DEGRADED_LINE,
  PICKS_EMPTY_LINE,
  picksCardStatus,
  picksListLine,
  TUBE_WHEN_LABEL,
} from "@/lib/dayGreeting";
import type { WeatherBrief } from "@/lib/todayBrief";

const DATE_LABEL = "Saturday 25 Jul";

function brief(overrides: Partial<WeatherBrief> = {}): WeatherBrief {
  return {
    dateLabel: DATE_LABEL,
    tempLabel: "24°C",
    conditionLabel: "clear",
    verdictLine: "Beer garden weather. Lager or cider.",
    ruleId: "summer-garden",
    drinkSuggestion: "a cold lager or cider",
    venueLens: "beer-garden",
    stale: false,
    checkedLabel: "Checked 6 minutes ago",
    source: { publisher: "Open-Meteo", url: "https://open-meteo.com/" },
    ...overrides,
  };
}

describe("daySlot", () => {
  it("bands the London wall clock, not UTC", () => {
    // 05:30 UTC in July is 06:30 BST -> morning, not the 05:30 UTC band edge.
    expect(daySlot(new Date("2026-07-25T05:30:00.000Z"))).toBe("morning");
    expect(daySlot(new Date("2026-07-25T12:00:00.000Z"))).toBe("afternoon");
    expect(daySlot(new Date("2026-07-25T18:00:00.000Z"))).toBe("evening");
    expect(daySlot(new Date("2026-07-25T23:30:00.000Z"))).toBe("night");
  });

  it("bands winter (GMT) correctly too", () => {
    // 16:30 UTC in January is 16:30 GMT -> still afternoon.
    expect(daySlot(new Date("2026-01-10T16:30:00.000Z"))).toBe("afternoon");
    expect(daySlot(new Date("2026-01-10T17:30:00.000Z"))).toBe("evening");
    expect(daySlot(new Date("2026-01-10T04:00:00.000Z"))).toBe("night");
  });
});

describe("buildDayGreeting", () => {
  it("crosses the time of day with the verdict's venue lens", () => {
    const greeting = buildDayGreeting({
      now: new Date("2026-07-25T18:00:00.000Z"),
      weather: brief(),
      dateLabel: DATE_LABEL,
    });
    expect(greeting.slot).toBe("evening");
    expect(greeting.salutation).toBe("Good evening");
    expect(greeting.headline).toBe("Golden evening for a beer garden.");
    expect(greeting.support).toBe("Saturday 25 Jul, 24°C and clear in London.");
    expect(greeting.weatherAware).toBe(true);
  });

  it("moves with the lens, not just the clock", () => {
    const now = new Date("2026-07-25T18:00:00.000Z");
    expect(
      buildDayGreeting({
        now,
        weather: brief({ venueLens: "fireplace", ruleId: "cold" }),
        dateLabel: DATE_LABEL,
      })
        .headline,
    ).toBe("An evening for a fire and a dark pint.");
    expect(
      buildDayGreeting({ now, weather: brief({ venueLens: "riverside" }), dateLabel: DATE_LABEL })
        .headline,
    ).toBe("A calm evening by the water.");
    expect(
      buildDayGreeting({ now, weather: brief({ venueLens: "any" }), dateLabel: DATE_LABEL })
        .headline,
    ).toBe("A settled evening for a pint.");
  });

  it("describes the rule behind the displayed reading, not only its shared lens", () => {
    const now = new Date("2026-07-25T23:30:00.000Z");
    const warmRain = brief({
      tempLabel: "24°C",
      conditionLabel: "cloudy",
      venueLens: "fireplace",
      ruleId: "hard-rain",
    });
    const cold = brief({
      tempLabel: "7°C",
      conditionLabel: "cloudy",
      venueLens: "fireplace",
      ruleId: "cold",
    });

    const warmGreeting = buildDayGreeting({
      now,
      weather: warmRain,
      dateLabel: DATE_LABEL,
    });
    const coldGreeting = buildDayGreeting({
      now,
      weather: cold,
      dateLabel: DATE_LABEL,
    });

    expect(warmGreeting.support).toContain("24°C");
    expect(warmGreeting.headline).toContain("Rain");
    expect(warmGreeting.headline).not.toContain("Cold");
    expect(coldGreeting.support).toContain("7°C");
    expect(coldGreeting.headline).toContain("Cold");
  });

  it("moves with the clock, not just the lens", () => {
    const headlines = [
      "2026-07-25T08:00:00.000Z",
      "2026-07-25T13:00:00.000Z",
      "2026-07-25T18:00:00.000Z",
      "2026-07-25T23:30:00.000Z",
    ].map(
      (iso) =>
        buildDayGreeting({ now: new Date(iso), weather: brief(), dateLabel: DATE_LABEL }).headline,
    );
    expect(new Set(headlines).size).toBe(4);
  });

  it("degrades to a weather-free line when there is no snapshot", () => {
    const greeting = buildDayGreeting({
      now: new Date("2026-07-25T18:00:00.000Z"),
      weather: null,
      dateLabel: DATE_LABEL,
    });
    expect(greeting.weatherAware).toBe(false);
    expect(greeting.headline).toBe("Your night out, sorted.");
    expect(greeting.support).toBe(
      "Saturday 25 Jul. Tonight's best, how you'll get home, and one to remember.",
    );
  });

  it("stops asserting current conditions once the observation is stale", () => {
    const greeting = buildDayGreeting({
      now: new Date("2026-07-25T18:00:00.000Z"),
      weather: brief({ stale: true }),
      dateLabel: DATE_LABEL,
    });
    expect(greeting.support).toBe("Saturday 25 Jul. Last read of the sky: 24°C and clear.");
    expect(greeting.support).not.toContain("in London");
  });

  it("adds the viewer's handle when the device has one", () => {
    const now = new Date("2026-07-25T08:00:00.000Z");
    expect(
      buildDayGreeting({ now, weather: brief(), dateLabel: DATE_LABEL, name: "karan" }).salutation,
    ).toBe("Good morning, karan");
    expect(
      buildDayGreeting({ now, weather: brief(), dateLabel: DATE_LABEL, name: "  " }).salutation,
    ).toBe("Good morning");
    expect(
      buildDayGreeting({ now, weather: brief(), dateLabel: DATE_LABEL, name: null }).salutation,
    ).toBe("Good morning");
  });

  it("drops a handle long enough to wreck the header rhythm", () => {
    expect(
      buildDayGreeting({
        now: new Date("2026-07-25T08:00:00.000Z"),
        weather: brief(),
        dateLabel: DATE_LABEL,
        name: "a-handle-far-too-long-for-one-line",
      }).salutation,
    ).toBe("Good morning");
  });

  it("writes no em dashes or en dashes into any string it produces", () => {
    const lenses = ["beer-garden", "fireplace", "riverside", "any"] as const;
    const times = [
      "2026-07-25T08:00:00.000Z",
      "2026-07-25T13:00:00.000Z",
      "2026-07-25T18:00:00.000Z",
      "2026-07-25T23:30:00.000Z",
    ];
    for (const iso of times) {
      for (const venueLens of lenses) {
        const ruleId = venueLens === "fireplace" ? "cold" : "summer-garden";
        for (const weather of [
          brief({ venueLens, ruleId }),
          brief({ venueLens, ruleId, stale: true }),
          null,
        ]) {
          const greeting = buildDayGreeting({
            now: new Date(iso),
            weather,
            dateLabel: DATE_LABEL,
            name: "karan",
          });
          const copy = `${greeting.salutation} ${greeting.headline} ${greeting.support}`;
          expect(copy).not.toMatch(/[–—]/);
        }
      }
    }
  });
});

describe("time-band card copy", () => {
  const SLOTS = ["morning", "afternoon", "evening", "night"] as const;

  it("gives the Tube eyebrow a tail for every band", () => {
    for (const slot of SLOTS) {
      expect(TUBE_WHEN_LABEL[slot]).toBeTruthy();
    }
    // The bug this replaced: a card headed "The Tube this morning" at half past
    // midnight. Only the morning band may ever say so.
    for (const slot of SLOTS) {
      if (slot !== "morning") expect(TUBE_WHEN_LABEL[slot]).not.toContain("morning");
    }
  });

  it("scopes Today's empty picks to tonight's list in reader-facing words", () => {
    expect(PICKS_EMPTY_LINE).toEqual({
      morning: "Nothing on tonight's list yet.",
      afternoon: "Nothing on tonight's list yet.",
      evening: "Nothing on tonight's list yet.",
      night: "Nothing on tonight's list yet.",
    });

    for (const slot of SLOTS) {
      expect(PICKS_EMPTY_LINE[slot]).not.toMatch(
        /\b(?:snapshot|check|feed|inventory)\b/i,
      );
    }
    expect(PICKS_EMPTY_LINE.night).not.toBe(
      "Nothing left confirmed tonight.",
    );
  });

  it("says nothing left only when the read answered empty", () => {
    for (const slot of SLOTS) {
      expect(picksListLine("ready", slot)).toBe(PICKS_EMPTY_LINE[slot]);
      expect(picksListLine("degraded", slot)).toBe(PICKS_DEGRADED_LINE);
    }
    expect(PICKS_DEGRADED_LINE).not.toMatch(/nothing left/i);
    expect(PICKS_DEGRADED_LINE).not.toMatch(/[–—]/);
    expect(picksCardStatus("ready", 2)).toBe("ready");
    expect(picksCardStatus("degraded", 1)).toBe("ready");
    expect(picksCardStatus("ready", 0, 3)).toBe("ready");
    expect(picksCardStatus("ready", 0)).toBe("empty");
    expect(picksCardStatus("degraded", 0)).toBe("degraded");
  });

  it("writes no em dashes or en dashes in any band", () => {
    for (const slot of SLOTS) {
      expect(TUBE_WHEN_LABEL[slot]).not.toMatch(/[–—]/);
      expect(PICKS_EMPTY_LINE[slot]).not.toMatch(/[–—]/);
    }
  });
});
