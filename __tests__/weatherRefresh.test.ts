import { describe, expect, it } from "vitest";

// @ts-expect-error Dependency-free Node refresh helper has no declaration file.
import { conditionForCode, weatherBranchName } from "@/scripts/refresh_weather_snapshots.mjs";

describe("scheduled weather refresh", () => {
  it("maps route-relevant WMO conditions without calling the provider", () => {
    expect(conditionForCode(0)).toBe("Clear");
    expect(conditionForCode(61)).toBe("Rain");
    expect(conditionForCode(95)).toBe("Thunderstorm");
  });

  it("uses collision-safe review branch names", () => {
    expect(weatherBranchName(new Date("2026-07-16T14:15:00.000Z"), "123", "2")).toBe("weather-cache/20260716-123-2");
  });
});
