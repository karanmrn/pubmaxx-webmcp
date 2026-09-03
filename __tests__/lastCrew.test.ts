import { afterEach, describe, expect, it } from "vitest";

import {
  buildLastCrewShareText,
  LAST_CREW_STORAGE_KEY,
  lastCrewWindowDays,
  nextNightCommittedProps,
  parseLastCrew,
  readLastCrew,
  rememberLastCrew,
} from "@/lib/lastCrew";
import { sanitizeEvent } from "@/lib/analyticsEvents";

afterEach(() => {
  try {
    localStorage.removeItem(LAST_CREW_STORAGE_KEY);
  } catch {
    // jsdom always has localStorage; ignore if a future env strips it.
  }
});

describe("parseLastCrew", () => {
  it("keeps unique trimmed names and drops empties", () => {
    const crew = parseLastCrew({
      names: [" Karan ", "Amy", "karan", "", "   "],
      savedAt: "2026-07-22T12:00:00.000Z",
      sourcePlanId: "plan-1",
    });
    expect(crew?.names).toEqual(["Karan", "Amy"]);
    expect(crew?.sourcePlanId).toBe("plan-1");
  });

  it("returns null for a solo roster", () => {
    expect(parseLastCrew({ names: ["Only"], savedAt: "2026-07-22T12:00:00.000Z" })).toBeNull();
  });
});

describe("rememberLastCrew", () => {
  it("returns a two-person crew and refuses a solo night", () => {
    expect(rememberLastCrew(["Alone"])).toBeNull();
    const crew = rememberLastCrew(["Karan", "Amy"], "plan-9");
    expect(crew?.names).toEqual(["Karan", "Amy"]);
    expect(crew?.sourcePlanId).toBe("plan-9");
  });
});

describe("readLastCrew", () => {
  it("reuses an unchanged external-store snapshot and replaces it after a storage change", () => {
    let raw = JSON.stringify({
      names: ["Karan", "Amy"],
      savedAt: "2026-08-01T12:00:00.000Z",
    });
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => raw,
      },
    };

    try {
      const first = readLastCrew();
      expect(readLastCrew()).toBe(first);

      raw = JSON.stringify({
        names: ["Karan", "Amy", "Jo"],
        savedAt: "2026-08-02T12:00:00.000Z",
      });
      const changed = readLastCrew();
      expect(changed).not.toBe(first);
      expect(changed?.names).toEqual(["Karan", "Amy", "Jo"]);
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    }
  });
});

describe("buildLastCrewShareText", () => {
  it("names the usual lot and includes the plan URL", () => {
    const text = buildLastCrewShareText({
      names: ["Karan", "Amy"],
      planUrl: "https://pubmaxxing.com/plan/abc",
      title: "Thursday lot",
    });
    expect(text).toContain("Thursday lot");
    expect(text).toContain("Karan, Amy");
    expect(text).toContain("https://pubmaxxing.com/plan/abc");
  });
});

describe("lastCrewWindowDays", () => {
  it("counts whole days since the roster was saved", () => {
    const crew = parseLastCrew({
      names: ["Karan", "Amy"],
      savedAt: "2026-08-01T12:00:00.000Z",
    });
    expect(crew).not.toBeNull();
    expect(lastCrewWindowDays(crew!, new Date("2026-08-08T11:59:00.000Z"))).toBe(6);
    expect(lastCrewWindowDays(crew!, new Date("2026-08-08T12:00:00.000Z"))).toBe(7);
  });

  it("returns zero when savedAt is not parseable", () => {
    const crew = parseLastCrew({ names: ["Karan", "Amy"], savedAt: "not-a-date" });
    expect(crew).not.toBeNull();
    expect(lastCrewWindowDays(crew!)).toBe(0);
  });
});

describe("nextNightCommittedProps", () => {
  it("carries only closed source and windowDays for analytics", () => {
    const crew = parseLastCrew({
      names: ["Karan", "Amy"],
      savedAt: "2026-08-01T12:00:00.000Z",
    });
    const now = new Date("2026-08-08T12:00:00.000Z");

    expect(nextNightCommittedProps("crew-reinvite", crew, now)).toEqual({
      source: "crew-reinvite",
      windowDays: 7,
    });
    expect(nextNightCommittedProps("completed_plan", crew, now)).toEqual({
      source: "completed_plan",
      windowDays: 7,
    });

    expect(sanitizeEvent("next_night_committed", {
      ...nextNightCommittedProps("crew-reinvite", crew, now),
      names: "Karan, Amy",
    })).toEqual({
      name: "next_night_committed",
      props: { source: "crew-reinvite", windowDays: 7 },
    });
  });

  it("omits windowDays when no crew is on file", () => {
    expect(nextNightCommittedProps("completed_plan", null)).toEqual({
      source: "completed_plan",
    });
  });
});
