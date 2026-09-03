// The card and the greeting describe the same part of the same day.
//
// DEFECT (UI audit, 2026-09-01, production, 390x844): /today greeted
// "Good morning" while the Drink weather card under it read "Crisp autumn
// evening. Amber ale weather." The greeting has always derived the London day
// band; the verdict had the word "evening" written into its sentences.
//
// The band now has ONE owner (lib/daySlot.ts) that both read. The evening
// wording is still the default, so /tonight, which is only ever read in the
// evening, is untouched.

import { describe, expect, it } from "vitest";

import { daySlot } from "@/lib/daySlot";
import { DRINK_WEATHER_RULES, evaluateDrinkWeather } from "@/lib/drinkWeather";
import { buildDayGreeting } from "@/lib/dayGreeting";

const CRISP_AUTUMN = { tempC: 11, precipitationProbabilityPct: 20, month: 10 };

describe("one owner for the day band", () => {
  it("is the same function the greeting reads", () => {
    expect(daySlot(new Date("2026-10-06T08:00:00.000Z"))).toBe("morning");
    expect(daySlot(new Date("2026-10-06T13:00:00.000Z"))).toBe("afternoon");
    expect(daySlot(new Date("2026-10-06T19:00:00.000Z"))).toBe("evening");
    expect(daySlot(new Date("2026-10-06T23:00:00.000Z"))).toBe("night");
  });
});

describe("the verdict names the band it is read in", () => {
  it("does not say evening to somebody being greeted good morning", () => {
    const verdict = evaluateDrinkWeather({ ...CRISP_AUTUMN, dayPart: "morning" });
    expect(verdict?.line).toBe("Crisp autumn morning. Amber ale weather.");
    expect(verdict?.line).not.toMatch(/evening/i);
  });

  it("keeps the evening wording as the default", () => {
    // /tonight passes no band and must read exactly what it always read.
    expect(evaluateDrinkWeather(CRISP_AUTUMN)?.line).toBe(
      "Crisp autumn evening. Amber ale weather.",
    );
    expect(evaluateDrinkWeather({ ...CRISP_AUTUMN, dayPart: "evening" })?.line).toBe(
      "Crisp autumn evening. Amber ale weather.",
    );
  });

  it("never contradicts the greeting on any band, for any rule", () => {
    const bands = ["morning", "afternoon", "evening", "night"] as const;
    const OTHER_BAND = {
      morning: /evening|afternoon|tonight|night/i,
      afternoon: /evening|morning|tonight|night/i,
      evening: /morning|afternoon/i,
      night: /morning|afternoon/i,
    } as const;

    const failures: string[] = [];
    for (const rule of DRINK_WEATHER_RULES) {
      for (const band of bands) {
        const line = rule.dayPartLine?.[band] ?? rule.line;
        if (OTHER_BAND[band].test(line)) failures.push(`${rule.ruleId} @ ${band}: ${line}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("carries a band variant only where the sentence names a time", () => {
    for (const rule of DRINK_WEATHER_RULES) {
      const namesATime = /evening|morning|afternoon|tonight|night|day/i.test(rule.line);
      if (!namesATime) {
        expect(rule.dayPartLine, `${rule.ruleId} is time-neutral`).toBeUndefined();
      }
    }
  });
});

describe("the card and the greeting agree on one morning", () => {
  it("greets the morning and describes the morning", () => {
    const now = new Date("2026-10-06T08:00:00.000Z");
    const greeting = buildDayGreeting({
      now,
      weather: null,
      dateLabel: "Tuesday 6 October",
      name: null,
    });
    const verdict = evaluateDrinkWeather({ ...CRISP_AUTUMN, dayPart: daySlot(now) });

    expect(greeting.salutation).toContain("Good morning");
    expect(verdict?.line).toContain("morning");
  });
});
