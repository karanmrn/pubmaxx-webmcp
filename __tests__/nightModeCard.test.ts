import { describe, expect, it } from "vitest";

import {
  completePlanPayload,
  completionTelemetryFromBody,
  confirmedEndingForPlan,
  endingOptionsForSignals,
  foodEndingSelection,
  getHomeEndingSelection,
  keepGoingEndingSelection,
  rankKeepGoingExtensions,
  recommendedEndingForPlan,
  routeRevisionFromPlan,
} from "@/components/night/NightModeCard";
import {
  keepGoingDistanceDescription,
  nextStopWalkDescription,
} from "@/lib/nightPresentation";
import type { PlanState } from "@/lib/plan";

function plan(overrides: Partial<NonNullable<PlanState["context"]>> = {}): PlanState {
  return {
    plan: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Tonight",
      startTime: "2026-07-13T19:00:00.000Z",
      createdAt: "2026-07-13T12:00:00.000Z",
      routeRevision: 1,
      status: "active",
    },
    stops: [],
    crew: [],
    context: {
      nightArea: "clapham",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      budget: "standard",
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
      ...overrides,
      budgetLimitPence: overrides.budgetLimitPence ?? null,
      zeroProof: overrides.zeroProof ?? false,
      wetherspoonsPreferred: overrides.wetherspoonsPreferred ?? false,
    },
  };
}

describe("recommendedEndingForPlan", () => {
  it("recommends food only when the plan asked for food and reviewed options exist", () => {
    expect(recommendedEndingForPlan(plan({ foodNeeds: ["kebab"] }), 2)).toBe("food");
    expect(recommendedEndingForPlan(plan({ foodNeeds: ["kebab"] }), 0)).toBe("get_home");
  });

  it("prioritises explicit get-home intent over generic evening defaults", () => {
    expect(recommendedEndingForPlan(plan({ daypart: "get_home", foodNeeds: [] }), 2)).toBe("get_home");
  });

  it("uses get-home as the safe default when there is no stronger signal", () => {
    expect(recommendedEndingForPlan(plan(), 2)).toBe("get_home");
    expect(recommendedEndingForPlan(null, 2)).toBe("get_home");
  });
});

describe("endingOptionsForSignals", () => {
  it("turns live-night signals into plain review copy without selecting an ending", () => {
    const options = endingOptionsForSignals({
      lateFoodCount: 2,
      stationName: "Clapham Common",
      leaveByIso: "2026-07-16T23:40:00.000Z",
      extensionCount: 2,
    });

    expect(options[0].description).toContain("2 reviewed nearby options");
    expect(options[1].description).toContain("Clapham Common");
    expect(options[2].description).toContain("2 nearby spots");
  });

  it("calls the safety-adjusted deadline a live leave-by time", () => {
    const options = endingOptionsForSignals({
      lateFoodCount: 0,
      stationName: "Clapham Common",
      leaveByIso: "2026-07-16T23:40:00.000Z",
      extensionCount: 0,
    });

    expect(options[1].description).toBe("Live leave-by time for Clapham Common.");
  });

  it("labels Night Mode distance estimates as straight-line", () => {
    expect(keepGoingDistanceDescription(0.4)).toBe("0.4 km straight-line");
    expect(nextStopWalkDescription(8)).toBe(
      "about 8 min on foot, straight-line estimate",
    );
  });
});

describe("rankKeepGoingExtensions", () => {
  it("ranks only backward-compatible pub venues for pint extensions", () => {
    const current = {
      id: "current-pub",
      name: "Current Pub",
      lat: 51.513,
      lng: -0.13,
      cheapestPrice: 6,
    };
    const extensions = rankKeepGoingExtensions(
      [
        current,
        {
          id: "nearby-bar",
          name: "Nearby Bar",
          lat: 51.5131,
          lng: -0.13,
          cheapestPrice: 14,
          kind: "bar",
        },
        {
          id: "nearby-food",
          name: "Nearby Food",
          lat: 51.5132,
          lng: -0.13,
          cheapestPrice: 9,
          kind: "food",
        },
        {
          id: "explicit-pub",
          name: "Explicit Pub",
          lat: 51.514,
          lng: -0.13,
          cheapestPrice: 5.5,
          kind: "pub",
        },
        {
          id: "legacy-pub",
          name: "Legacy Pub",
          lat: 51.515,
          lng: -0.13,
          cheapestPrice: 5,
        },
      ],
      current,
      new Set([current.id]),
    );

    expect(extensions.map((venue) => venue.id)).toEqual([
      "explicit-pub",
      "legacy-pub",
    ]);
  });
});

describe("confirmedEndingForPlan", () => {
  it("renders no ending result until an ending is confirmed", () => {
    expect(confirmedEndingForPlan(plan(), null)).toBeNull();
  });

  it("prefers the persisted plan ending over local fallback state", () => {
    expect(confirmedEndingForPlan({ ...plan(), ending: "get_home" }, "food")).toBe("get_home");
  });

  it("does not render a local ending before the canonical completion response", () => {
    expect(confirmedEndingForPlan(plan(), "food")).toBeNull();
  });
});

describe("canonical route revision completion", () => {
  it("retries completion telemetry from a replayed canonical response", () => {
    expect(completionTelemetryFromBody({
      created: false,
      completion: { ending: "get_home" },
      eventTokens: { planCompleted: "completion-token", meaningfulCoreAction: "meaningful-token" },
    })).toEqual({
      ending: "get_home",
      planCompletedToken: "completion-token",
      meaningfulCoreActionToken: "meaningful-token",
    });
  });

  it("reads the active revision and sends the current canonical pub as terminal", () => {
    const current = { ...plan(), routeRevision: 7 } as PlanState & { routeRevision: number };
    expect(routeRevisionFromPlan(current)).toBe(7);
    expect(completePlanPayload("food", "canonical-current-pub", 7)).toEqual({
      ending: "food",
      terminalVenueId: "canonical-current-pub",
      expectedRouteRevision: 7,
    });
  });

  it("preserves the selected option separately from the current canonical pub", () => {
    const selected = foodEndingSelection({
      id: "late-food-evidence-balans-soho-no-60",
      name: "Balans No.60",
      area: "piccadilly-soho",
      category: "restaurant",
      dietary: [],
      address: "60-62 Old Compton Street, London W1D 4UG",
      coordinates: { lat: 51.5127668, lng: -0.1325587 },
      hours: {
        service: "Published service hours; verify tonight.",
        verifyOnNight: true,
        weekly: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, [{ open: "09:00", close: "22:30", closesNextDay: false }]])) as never,
      },
      walkingDetour: { minutes: 4, distanceKm: 0.3, basis: "straight-line-from-final-stop", note: "Near the final stop." },
      provenance: {
        kind: "official_operator",
        source: "Balans Restaurants",
        sourceUrl: "https://balans.co.uk/locations/soho-no-60/",
        observedAt: "2026-07-16T21:13:30.000Z",
        reviewedAt: "2026-07-16T21:13:30.000Z",
        expiresAt: "2026-08-16T21:13:30.000Z",
      },
      anchor: {
        label: "Cheeseburger",
        price: 20,
        sourceUrl: "https://balans.co.uk/wp-content/uploads/2025/07/No.60-Overnight-1.pdf",
        observedAt: "2026-07-16",
      },
      confidence: "high",
      openAtRequestedTime: true,
    });
    expect(completePlanPayload("food", "canonical-current-pub", 7, selected)).toEqual({
      ending: "food",
      terminalVenueId: "canonical-current-pub",
      expectedRouteRevision: 7,
      endingSelection: selected,
    });
    expect(selected.externalPlaceId).toBe("late-food-evidence-balans-soho-no-60");
  });

  it("builds typed transport and extension selections without mutating the plan", () => {
    expect(getHomeEndingSelection("Clapham Common", null)).toMatchObject({
      kind: "get_home",
      optionId: "transport:clapham-common",
      evidenceSnapshot: { confidence: "unknown" },
    });
    expect(keepGoingEndingSelection({ id: "venue-extra", name: "The Extra", lat: 0, lng: 0, cheapestPrice: 6, distanceKm: 0.4 })).toMatchObject({
      kind: "keep_going",
      optionId: "venue-extra",
      venueId: "venue-extra",
    });
  });
});
