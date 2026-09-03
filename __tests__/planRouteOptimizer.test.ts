import { describe, expect, it } from "vitest";

import {
  PLAN_STOP_MINUTES,
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";
import type { PlanOpeningSchedule } from "@/lib/planRouteEvidence";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function constraints(
  overrides: Partial<GroundedPlanRouteConstraints> = {},
): GroundedPlanRouteConstraints {
  return {
    exactArea: null,
    accessibilityNeeds: [],
    budgetLimitPence: null,
    budgetTier: null,
    groupSize: null,
    transportConstraints: [],
    routeWindow: null,
    now: NOW,
    ...overrides,
  };
}

function candidate(
  venueId: string,
  options: Partial<GroundedPlanRouteCandidate<string>> = {},
): GroundedPlanRouteCandidate<string> {
  return {
    value: venueId,
    venueId,
    venueName: venueId,
    score: 1,
    lat: 51.5,
    lng: -0.1,
    price: { pence: null, source: null, confidenceState: "unknown" },
    promoted: false,
    avoidedByReviewedSignal: false,
    access: {},
    openingSchedule: null,
    ...options,
  };
}

function freshMondaySchedule(): PlanOpeningSchedule {
  return {
    ranges: [{ weekday: "Monday", startsAt: "16:00", endsAt: "23:00" }],
    source: {
      label: "Venue website",
      url: "https://example.com/opening-hours",
      observedAt: "2026-07-19T12:00:00.000Z",
    },
    venueListedOpen: true,
  };
}

describe("selectGroundedPlanRoute", () => {
  it.each([4, 5, 6])("selects exactly %i distinct grounded stops", (stopCount) => {
    const candidates = Array.from({ length: stopCount + 1 }, (_, index) => candidate(`venue-${index}`));
    const result = selectGroundedPlanRoute(candidates, constraints({ stopCount } as Partial<GroundedPlanRouteConstraints>));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toHaveLength(stopCount);
    expect(new Set(result.stops.map((stop) => stop.venueId)).size).toBe(stopCount);
    expect(result.alternatives).toHaveLength(stopCount);
    expect(result.timing.scheduledRouteMinutes).toBeGreaterThan(PLAN_STOP_MINUTES * stopCount);
  });

  it("deduplicates repeated venue candidates before choosing a route", () => {
    const result = selectGroundedPlanRoute(
      [candidate("a", { score: 10 }), candidate("a", { score: 1 }), candidate("b"), candidate("c")],
      constraints(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops.map((stop) => stop.venueId)).toEqual(["a", "b", "c"]);
  });

  it.each([4, 5, 6])("reports honest scarcity for a requested %i-stop route", (stopCount) => {
    const result = selectGroundedPlanRoute(
      Array.from({ length: stopCount - 1 }, (_, index) => candidate(`venue-${index}`)),
      constraints({ stopCount } as Partial<GroundedPlanRouteConstraints>),
    );

    expect(result).toMatchObject({ ok: false, eligibleCandidateCount: stopCount - 1 });
  });

  it("fails closed when a dated route lacks opening evidence", () => {
    const result = selectGroundedPlanRoute(
      [candidate("a"), candidate("b"), candidate("c"), candidate("d")],
      constraints({
        routeWindow: {
          startsAt: "2026-07-20T16:30:00.000Z",
          endsAt: "2026-07-20T20:30:00.000Z",
        },
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("keeps the recurring-schedule exception warning for evidenced-open dated routes", () => {
    const openingSchedule = freshMondaySchedule();
    const result = selectGroundedPlanRoute(
      [
        candidate("a", { openingSchedule }),
        candidate("b", { openingSchedule }),
        candidate("c", { openingSchedule }),
      ],
      constraints({
        routeWindow: {
          startsAt: "2026-07-20T16:30:00.000Z",
          endsAt: "2026-07-20T20:30:00.000Z",
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({
      code: "opening_hours",
      status: "flagged",
      message: expect.stringContaining("one-off exceptions"),
    }));
    expect(result.stops.every((stop) => stop.constraintFlags.some(
      (flag) => flag.code === "recurring_hours_exception_warning",
    ))).toBe(true);
  });

  it("fails a dense dated pool after one linear opening-evidence pass when fewer than three schedules are current", () => {
    let openingScheduleReads = 0;
    const fresh = freshMondaySchedule();
    const candidates = Array.from({ length: 132 }, (_, index) => {
      const result = candidate(`venue-${String(index).padStart(3, "0")}`);
      const invalidSchedule = (() => {
        if (index < 2) return fresh;
        switch (index % 6) {
          case 0: return null;
          case 1: return { ...fresh, source: { ...fresh.source, observedAt: "not-a-date" } };
          case 2: return { ...fresh, source: { ...fresh.source, observedAt: "2026-07-21T12:00:00.000Z" } };
          case 3: return { ...fresh, source: { ...fresh.source, observedAt: "2026-06-19T11:59:59.999Z" } };
          case 4: return { ...fresh, venueListedOpen: false };
          default: return { ...fresh, source: { ...fresh.source, label: "" } };
        }
      })();
      Object.defineProperty(result, "openingSchedule", {
        enumerable: true,
        get() {
          openingScheduleReads += 1;
          return invalidSchedule;
        },
      });
      return result;
    });

    const result = selectGroundedPlanRoute(candidates, constraints({
      routeWindow: {
        startsAt: "2026-07-20T16:30:00.000Z",
        endsAt: "2026-07-20T20:30:00.000Z",
      },
    }));

    expect(result).toMatchObject({ ok: false, eligibleCandidateCount: 2 });
    expect(openingScheduleReads).toBe(candidates.length);
  });

  it("fails closed for requested transport constraints without matching evidence", () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];

    expect(selectGroundedPlanRoute(
      candidates,
      constraints({ transportConstraints: ["tube"] }),
    ).ok).toBe(false);
    expect(selectGroundedPlanRoute(candidates, constraints()).ok).toBe(true);
  });

  it("preserves score, walking-distance, and lexical route tie-breaks", () => {
    const result = selectGroundedPlanRoute([
      candidate("a", { score: 10, lng: -0.100 }),
      candidate("b", { score: 10, lng: -0.099 }),
      candidate("c", { score: 10, lng: -0.098 }),
      candidate("d", { score: 10, lng: -0.090 }),
      candidate("lower", { score: 9, lng: -0.0985 }),
    ], constraints());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops.map((stop) => stop.venueId)).toEqual(["a", "b", "c"]);
  });

  it("prunes dense candidates after proving the strongest route", () => {
    let openingScheduleReads = 0;
    const candidates = Array.from({ length: 60 }, (_, index) => {
      const result = candidate(`venue-${String(index).padStart(3, "0")}`, {
        score: 1_000 - index,
        lat: 51.5 + (index % 10) * 0.00001,
        lng: -0.1 + Math.floor(index / 10) * 0.00001,
      });
      Object.defineProperty(result, "openingSchedule", {
        enumerable: true,
        get() {
          openingScheduleReads += 1;
          return null;
        },
      });
      return result;
    });

    const result = selectGroundedPlanRoute(candidates, constraints());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.stops.map((stop) => stop.venueId))).toEqual(new Set([
      "venue-000",
      "venue-001",
      "venue-002",
    ]));
    // Six permutations of the strongest triple plus a linear alternatives pass.
    expect(openingScheduleReads).toBeLessThanOrEqual(1_100);
  });
});
