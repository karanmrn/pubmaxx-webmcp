import { describe, expect, it } from "vitest";

import type { NightArea } from "@/lib/nightAreas";
import { nightAreaCoverageDetail } from "@/lib/nightPresentation";

const incompleteArea: NightArea = {
  slug: "shoreditch",
  cityId: "london",
  name: "Shoreditch",
  aliases: ["Old Street"],
  centre: { lat: 51.524, lng: -0.079 },
  radiusKm: 1.6,
  transportAnchors: ["Old Street"],
  demandWave: 1,
  description: "Route and destination checks are incomplete.",
  daypartGuidance: {
    daytime: "Start near Old Street.",
    after_work: "Start near Old Street.",
    evening: "Keep the route compact.",
    late_night: "Check the route home.",
    get_home: "Use a checked station.",
  },
  recentSignals: [],
  coverageStatus: "captured",
  coverageScore: 38,
  routeReadyReasons: [],
  missingEvidence: ["route_feasibility", "terminal_get_home"],
  gate: {
    version: 1,
    passed: false,
    checks: [],
  },
  lastReviewedAt: null,
  reviewExpiresAt: null,
};

describe("Night Area coverage honesty", () => {
  it("does not call incomplete route and destination evidence price checks", () => {
    const detail = nightAreaCoverageDetail(
      incompleteArea,
      new Date("2026-08-27T12:00:00.000Z"),
    );

    expect(detail).toBe("2 more checks to do here before a crawl.");
    expect(detail).not.toContain("price checks");
  });
});
