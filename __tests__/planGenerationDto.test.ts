import { describe, expect, it } from "vitest";

import { buildPlanGenerationStops } from "@/lib/planGenerationDto";

const AREA = {
  name: "Test Area",
  lastReviewedAt: "2026-08-20T12:00:00.000Z",
};

function candidate(
  id: string,
  lng: number,
  options: {
    cheapestPrice?: number | null;
    distance?: number;
    reasons?: string[];
  } = {},
) {
  return {
    venue: {
      id,
      name: `Venue ${id}`,
      lat: 51.5,
      lng,
      cheapestPrice: options.cheapestPrice ?? 5,
    },
    distance: options.distance ?? 0.25,
    reasons: options.reasons ?? [],
    tonightEvents: [],
    signalClaims: [],
  };
}

function grounded<T>(value: T, pence: number) {
  return {
    value,
    price: {
      pence,
      source: {
        label: "Published menu",
        url: "https://example.com/menu",
        observedAt: "2026-08-19T12:00:00.000Z",
      },
      confidenceState: "fresh" as const,
    },
    access: {},
    opening: {
      state: "listed_open" as const,
      source: {
        label: "Published hours",
        url: "https://example.com/hours",
        observedAt: "2026-08-18T12:00:00.000Z",
      },
      warning: null,
    },
    visitWindow: {
      startsAt: "2026-08-27T18:00:00.000Z",
      endsAt: "2026-08-27T18:50:00.000Z",
    },
    constraintFlags: [{
      code: "recurring_hours_exception_warning" as const,
      message: "Check one-off changes.",
    }],
  };
}

describe("plan generation response projection", () => {
  it("projects grounded evidence, provenance, and the selected grounded alternatives", () => {
    const selected = {
      ...candidate("selected", -0.1, {
        distance: 0.65,
        reasons: ["matches budget", "has live music", "third reason"],
      }),
      tonightEvents: [{
        title: "Thursday quiz",
        observedAt: "2026-08-21T12:00:00.000Z",
        source: { label: "Venue calendar" },
      }],
      signalClaims: [{
        publisher: "Venue operator",
        claim: "Garden open",
        observedAt: "2026-08-22T12:00:00.000Z",
      }],
    };
    const selectedGrounded = grounded(selected, 525);
    const groundedAlternativeValue = candidate("grounded-alt", -0.099);
    const groundedAlternative = grounded(groundedAlternativeValue, 475);
    const unusedFallback = candidate("unused-fallback", -0.1005);

    const stops = buildPlanGenerationStops({
      chosen: [selected],
      candidates: [selected, unusedFallback],
      groundedStops: [selectedGrounded],
      groundedAlternatives: [[groundedAlternative]],
      walkingEstimate: {
        legs: [],
        walkingMinutesFromPrevious: [null],
      },
      area: AREA,
      planningWeather: {
        condition: "Light rain",
        observedAt: "2026-08-23T12:00:00.000Z",
        source: { publisher: "Met Office" },
      },
    });

    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      venueId: "selected",
      venueName: "Venue selected",
      position: 0,
      walkingMinutesFromPrevious: null,
      distanceKm: 0.65,
      estimatedPintPricePence: 525,
      priceEvidence: selectedGrounded.price,
      accessEvidence: selectedGrounded.access,
      evidence: ["matches budget", "has live music", "third reason"],
      constraintFlags: selectedGrounded.constraintFlags,
      operationalEvidence: {
        openingAtVisit: "listed_open",
        openingSource: selectedGrounded.opening.source,
        visitWindow: selectedGrounded.visitWindow,
        transportBasis: "direct-distance at 4.8 km/h plus 5 minutes uncertainty per leg",
      },
      reason: "0.7 km from the area centre, matches budget, has live music.",
      alternatives: [{
        venueId: "grounded-alt",
        venueName: "Venue grounded-alt",
        estimatedPintPricePence: 475,
        priceEvidence: groundedAlternative.price,
        accessEvidence: groundedAlternative.access,
        constraintFlags: groundedAlternative.constraintFlags,
        operationalEvidence: {
          openingAtVisit: "listed_open",
          openingSource: groundedAlternative.opening.source,
          visitWindow: groundedAlternative.visitWindow,
          transportBasis: "direct-distance at 4.8 km/h plus 5 minutes uncertainty per leg",
        },
      }],
    });
    expect(stops[0].alternatives.map((alternative) => alternative.venueId))
      .not.toContain("unused-fallback");
    expect(stops[0].provenance).toEqual([
      { kind: "venue_dataset", label: "PUBMAXX venue record for Venue selected" },
      { kind: "night_area_review", label: "Test Area route review", asOf: AREA.lastReviewedAt },
      { kind: "night_signal", label: "Venue calendar: Thursday quiz", asOf: "2026-08-21T12:00:00.000Z" },
      { kind: "night_signal", label: "Venue operator: Garden open", asOf: "2026-08-22T12:00:00.000Z" },
      { kind: "night_signal", label: "Published hours", asOf: "2026-08-18T12:00:00.000Z" },
      { kind: "night_signal", label: "Met Office: Light rain", asOf: "2026-08-23T12:00:00.000Z" },
    ]);
  });

  it("sorts fallback alternatives by distance, excludes chosen venues, and caps them at two", () => {
    const selected = candidate("selected", -0.1, { cheapestPrice: 5.55 });
    const otherChosen = candidate("other-chosen", -0.11);
    const nearest = candidate("nearest", -0.099);
    const middle = candidate("middle", -0.098);
    const farthest = candidate("farthest", -0.097);

    const stops = buildPlanGenerationStops({
      chosen: [selected, otherChosen],
      candidates: [farthest, otherChosen, middle, selected, nearest],
      groundedStops: null,
      groundedAlternatives: null,
      walkingEstimate: {
        legs: [],
        walkingMinutesFromPrevious: [null, 9],
      },
      area: AREA,
      planningWeather: null,
    });

    expect(stops[0]).toMatchObject({
      estimatedPintPricePence: 555,
      priceEvidence: null,
      accessEvidence: null,
      constraintFlags: [],
      operationalEvidence: {
        openingAtVisit: null,
        openingSource: null,
        visitWindow: null,
        transportBasis: "compact-straight-line",
      },
      reason: "Close to the heart of the area.",
    });
    expect(stops[0].alternatives.map((alternative) => alternative.venueId))
      .toEqual(["nearest", "middle"]);
    expect(stops[0].alternatives).toHaveLength(2);
    expect(stops[0].alternatives.map((alternative) => alternative.venueId))
      .not.toContain("other-chosen");
  });

  it("uses routed transport wording only for an ORS leg feeding that stop", () => {
    const first = candidate("first", -0.1);
    const second = candidate("second", -0.099);

    const stops = buildPlanGenerationStops({
      chosen: [first, second],
      candidates: [first, second],
      groundedStops: [grounded(first, 500), grounded(second, 500)],
      groundedAlternatives: [[], []],
      walkingEstimate: {
        legs: [{ toIndex: 1, source: "ors" }],
        walkingMinutesFromPrevious: [null, 4],
      },
      area: AREA,
      planningWeather: null,
    });

    expect(stops.map((stop) => stop.operationalEvidence.transportBasis)).toEqual([
      "direct-distance at 4.8 km/h plus 5 minutes uncertainty per leg",
      "openrouteservice foot-walking route duration",
    ]);
    expect(stops.map((stop) => stop.walkingMinutesFromPrevious)).toEqual([null, 4]);
  });
});
