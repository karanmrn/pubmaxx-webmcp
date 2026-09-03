import { describe, expect, it } from "vitest";

import {
  NIGHTS_KEPT_STORAGE_KEY,
  nightsKeptLabel,
  nightsKeptStreak,
  parseNightsKept,
  recordNightKept,
} from "@/lib/nightsKept";

function memoryStorage(seed?: string): Storage {
  const map = new Map<string, string>();
  if (seed) map.set(NIGHTS_KEPT_STORAGE_KEY, seed);
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe("nightsKept", () => {
  it("records distinct London days without inventing a drinker streak event", () => {
    const storage = memoryStorage();
    const now = new Date("2026-08-07T12:00:00Z");
    const first = recordNightKept("plan-a", storage, now);
    expect(first.days).toEqual(["2026-08-07"]);
    const sameDay = recordNightKept("plan-b", storage, now);
    expect(sameDay.days).toEqual(["2026-08-07"]);
    expect(sameDay.lastPlanId).toBe("plan-b");
  });

  it("counts a consecutive run ending today or yesterday", () => {
    const record = parseNightsKept(
      JSON.stringify({
        version: 1,
        days: ["2026-08-05", "2026-08-06", "2026-08-07"],
        lastPlanId: "plan-z",
      }),
    );
    expect(nightsKeptStreak(record, new Date("2026-08-07T18:00:00Z"))).toBe(3);
    expect(nightsKeptLabel(record, new Date("2026-08-07T18:00:00Z"))).toContain("3-day run");
  });

  it("returns zero when the run has already lapsed", () => {
    const record = parseNightsKept(
      JSON.stringify({
        version: 1,
        days: ["2026-08-01", "2026-08-02"],
        lastPlanId: null,
      }),
    );
    expect(nightsKeptStreak(record, new Date("2026-08-07T12:00:00Z"))).toBe(0);
  });
});
