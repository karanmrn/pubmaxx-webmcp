import { describe, expect, it } from "vitest";

import { buildPlanEndingRecommendations } from "@/lib/planEndings";
import { getLateFoodForArea } from "@/lib/lateFood";

describe("buildPlanEndingRecommendations", () => {
  it("returns explicit Food, Get home, and Keep going choices without executing one", () => {
    const recommendations = buildPlanEndingRecommendations({
      daypart: "late_night",
      foodRequested: true,
      transportAnchor: "Piccadilly Circus",
      lateFood: getLateFoodForArea("piccadilly-soho", [], { now: Date.parse("2026-07-16T23:00:00.000Z") }),
      extensions: [
        { venueId: "venue-4", venueName: "Fourth Pub", distanceKm: 0.4, estimatedPintPricePence: 650 },
        { venueId: "venue-5", venueName: "Fifth Pub", distanceKm: 0.7, estimatedPintPricePence: null },
      ],
    });

    expect(recommendations.map((item) => item.kind)).toEqual(["food", "get_home", "keep_going"]);
    expect(recommendations.filter((item) => item.preselected)).toHaveLength(1);
    expect(recommendations.every((item) => item.requiresConfirmation)).toBe(true);
    expect(recommendations[0]?.options).toHaveLength(1);
    expect(recommendations[0]?.options[0]).toMatchObject({ closingConfidence: "unknown" });
    expect(recommendations[1]?.options[0]).toMatchObject({ label: "Piccadilly Circus" });
    expect(recommendations[2]?.options).toHaveLength(2);
  });

  it("does not claim food or extension evidence that is unavailable", () => {
    const recommendations = buildPlanEndingRecommendations({
      daypart: "evening",
      foodRequested: false,
      transportAnchor: "Barnes",
      lateFood: [],
      extensions: [],
    });

    expect(recommendations[0]?.options).toEqual([]);
    expect(recommendations[0]?.warnings).toContain("No late food worth pointing you to round here yet.");
    expect(recommendations[2]?.options).toEqual([]);
    expect(recommendations[2]?.reason).toBe("This route has no extra pub to suggest.");
    expect(recommendations[2]?.warnings).toEqual(["No extra pub was returned with this route."]);
  });

  it("caps food endings at three", () => {
    const terminal = getLateFoodForArea("piccadilly-soho", [], {
      now: Date.parse("2026-07-16T23:00:00.000Z"),
    })[0]!;
    const recommendations = buildPlanEndingRecommendations({
      daypart: "late_night",
      foodRequested: true,
      transportAnchor: "Piccadilly Circus",
      lateFood: Array.from({ length: 5 }, (_, index) => ({
        ...terminal,
        id: `food-${index}`,
      })),
      extensions: [],
    });

    expect(recommendations[0]?.options.map((option) => option.id)).toEqual([
      "food-0",
      "food-1",
      "food-2",
    ]);
  });
});
