import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/planRouteEvidence.server", () => ({
  planPriceEvidenceForVenues: async (venues: Array<{ id: string }>) => new Map(
    venues.map((venue) => [
      venue.id,
      { pence: null, source: null, confidenceState: "unknown" as const },
    ]),
  ),
  planOpeningSchedulesForVenues: async (venues: Array<{ id: string }>) => new Map(
    venues.map((venue) => [venue.id, null]),
  ),
  planAccessEvidenceForVenue: (venue: { name: string }) =>
    venue.name === "The Ice Wharf - JD Wetherspoon"
      ? {
          stepFree: {
            confirmed: true,
            source: {
              label: "J D Wetherspoon: The Ice Wharf",
              url: "https://www.jdwetherspoon.com/pubs/the-ice-wharf-camden/",
              observedAt: null,
            },
          },
        }
      : {},
}));

import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { parsePlanGenerationIntake } from "@/lib/planGenerationIntake";
import {
  selectPlanGenerationCandidates,
  type ScoredPlanCandidate,
} from "@/lib/planGenerationSelection.server";
import {
  MAX_PLAN_GENERATION_BODY_BYTES,
  parsePlanGenerationRequest,
} from "@/lib/planGenerationRequest";
import type { PlanIntakeHandoff } from "@/lib/planIntake";
import {
  assessOpeningSchedule,
  buildPriceEvidence,
  type EvidenceSource,
  type PlanOpeningSchedule,
  type PlanPriceEvidence,
} from "@/lib/planRouteEvidence";
import {
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const SOURCE: EvidenceSource = {
  label: "Canonical evidence",
  url: "https://example.com/evidence",
  observedAt: "2026-07-11T12:00:00.000Z",
};

function intake(overrides: Partial<PlanIntakeHandoff> = {}): PlanIntakeHandoff {
  return {
    version: 1,
    area: { kind: "night-patch", id: "clapham" },
    timeWindow: {
      id: "after-work",
      start: "17:30",
      end: "20:30",
      exactStartIso: "2026-07-20T16:30:00.000Z",
    },
    groupSize: 4,
    budget: { tier: "standard", limitPence: null },
    accessibilityNeeds: [],
    skipped: [],
    ...overrides,
  };
}

function price(pence = 500, state: PlanPriceEvidence["confidenceState"] = "fresh"): PlanPriceEvidence {
  return { pence, source: SOURCE, confidenceState: state };
}

function candidate(
  id: string,
  overrides: Partial<GroundedPlanRouteCandidate<string>> = {},
): GroundedPlanRouteCandidate<string> {
  const ordinal = Number(id.replace(/\D/g, "")) || 0;
  return {
    value: id,
    venueId: id,
    venueName: `Venue ${id}`,
    score: 100 - ordinal,
    lat: 51.462 + ordinal * 0.001,
    lng: -0.138 + ordinal * 0.001,
    price: price(),
    promoted: false,
    avoidedByReviewedSignal: false,
    access: {},
    openingSchedule: null,
    ...overrides,
  };
}

function scoredCandidate(
  id: string,
  venue: Partial<ScoredPlanCandidate["venue"]> = {},
): ScoredPlanCandidate {
  const ordinal = Number(id.replace(/\D/g, "")) || 0;
  return {
    venue: {
      id,
      name: `Venue ${id}`,
      area: "Camden",
      lat: 51.54 + ordinal * 0.001,
      lng: -0.143 + ordinal * 0.001,
      cheapestPrice: null,
      amenities: {
        beerGarden: false,
        cocktails: false,
        food: false,
        liveSports: false,
        liveMusic: false,
      },
      nearWater: false,
      hasStory: false,
      canonical: true,
      ...venue,
    },
    score: 100 - ordinal,
    signalClaims: [],
  };
}

function constraints(overrides: Partial<GroundedPlanRouteConstraints> = {}): GroundedPlanRouteConstraints {
  return {
    exactArea: "clapham",
    accessibilityNeeds: [],
    budgetLimitPence: null,
    budgetTier: "standard",
    groupSize: 4,
    transportConstraints: [],
    routeWindow: null,
    now: NOW.getTime(),
    ...overrides,
  };
}

function openSchedule(ranges: PlanOpeningSchedule["ranges"]): PlanOpeningSchedule {
  return { venueListedOpen: true, ranges, source: SOURCE };
}

describe("strict Plan generation request boundary", () => {
  it.each(["soho", "shoreditch", "camden", "london-bridge", "brixton", "clapham", "islington"])(
    "maps %s without treating readiness metadata as an availability gate",
    (patch) => {
      const parsed = parsePlanGenerationIntake(intake({
        area: { kind: "night-patch", id: patch as NonNullable<PlanIntakeHandoff["area"]>["id"] },
      }), NOW);
      expect(parsed).toMatchObject({ ok: true, value: { unsupportedPatch: null } });
    },
  );

  it("keeps Hackney honestly unmapped instead of coercing it to Shoreditch", () => {
    expect(parsePlanGenerationIntake(intake({
      area: { kind: "night-patch", id: "hackney" },
      timeWindow: null,
      skipped: ["time-window"],
    }), NOW)).toMatchObject({ ok: true, value: { exactNightArea: null, unsupportedPatch: "hackney" } });
  });

  it.each([
    ["null", null],
    ["unknown top-level key", { ...intake(), extra: true }],
    ["nested prototype key", JSON.parse(`{"version":1,"area":{"kind":"night-patch","id":"clapham","__proto__":{}},"timeWindow":null,"groupSize":4,"budget":null,"accessibilityNeeds":[],"skipped":["time-window","budget"]}`)],
    ["fractional group", { ...intake(), groupSize: 2.5 }],
    ["fractional pence", { ...intake(), budget: { tier: "value", limitPence: 1200.5 } }],
    ["negative pence", { ...intake(), budget: { tier: "value", limitPence: -1 } }],
    ["infinite pence", { ...intake(), budget: { tier: "value", limitPence: Number.POSITIVE_INFINITY } }],
    ["conflicting skipped answer", { ...intake(), skipped: ["budget"] }],
		["missing answer not marked skipped", { ...intake(), groupSize: null }],
  ])("rejects %s", (_label, value) => {
    expect(parsePlanGenerationIntake(value, NOW)).toMatchObject({ ok: false, code: "PLAN_INTAKE_MALFORMED" });
  });

  it("rejects far-future intake but accepts a canonical DST-transition instant", () => {
    expect(parsePlanGenerationIntake(intake({
      timeWindow: { ...intake().timeWindow!, exactStartIso: "2026-08-20T16:30:00.000Z" },
    }), NOW)).toMatchObject({ ok: false, code: "INTAKE_START_OUT_OF_RANGE" });
    const dst = parsePlanGenerationIntake(intake({
      timeWindow: { ...intake().timeWindow!, exactStartIso: "2026-10-25T17:30:00.000Z" },
    }), new Date("2026-10-24T12:00:00.000Z"));
    expect(dst).toMatchObject({ ok: true, value: { routeWindow: { endsAt: "2026-10-25T20:30:00.000Z" } } });
  });

  it("rejects null, oversized and unknown-key request bodies before semantic work", async () => {
    const nullResult = await parsePlanGenerationRequest(new Request("http://test", { method: "POST", body: "null" }), NOW);
    expect(nullResult).toMatchObject({ ok: false, code: "MALFORMED_REQUEST" });
    const oversized = await parsePlanGenerationRequest(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ query: "x".repeat(MAX_PLAN_GENERATION_BODY_BYTES) }),
    }), NOW);
    expect(oversized).toMatchObject({ ok: false, code: "REQUEST_TOO_LARGE", status: 413 });
    const unknown = await parsePlanGenerationRequest(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ query: "Clapham", constructor: {} }),
    }), NOW);
    expect(unknown).toMatchObject({ ok: false, code: "MALFORMED_REQUEST" });
  });
});

describe("ordered grounded route optimization", () => {
  it("evaluates opening only after permutation and puts a time-limited venue first", () => {
    const firstOnly = openSchedule([{ weekday: "Monday", startsAt: "17:00", endsAt: "18:25" }]);
    const allEvening = openSchedule([{ weekday: "Monday", startsAt: "16:00", endsAt: "23:00" }]);
    const selection = selectGroundedPlanRoute([
      candidate("a", { openingSchedule: firstOnly }),
      candidate("b", { openingSchedule: allEvening }),
      candidate("c", { openingSchedule: allEvening }),
    ], constraints({ routeWindow: { startsAt: "2026-07-20T16:30:00.000Z", endsAt: "2026-07-20T19:30:00.000Z" } }));
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.stops[0].venueId).toBe("a");
  });

  it("ties by score, then route distance, then lexicographic route key", () => {
    const selection = selectGroundedPlanRoute([
      candidate("a", { score: 10, lat: 51.5, lng: -0.13 }),
      candidate("b", { score: 10, lat: 51.501, lng: -0.13 }),
      candidate("c", { score: 10, lat: 51.502, lng: -0.13 }),
      candidate("far", { score: 10, lat: 51.51, lng: -0.13 }),
    ], constraints());
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.stops.map((stop) => stop.venueId)).toEqual(["a", "b", "c"]);
  });

  it("derives visit windows from each leg's walking estimate and uncertainty", () => {
    const allEvening = openSchedule([{ weekday: "Monday", startsAt: "16:00", endsAt: "23:00" }]);
    const selection = selectGroundedPlanRoute([
      candidate("a", { lat: 51.5, lng: -0.13, openingSchedule: allEvening }),
      candidate("b", { lat: 51.504, lng: -0.13, openingSchedule: allEvening }),
      candidate("c", { lat: 51.508, lng: -0.13, openingSchedule: allEvening }),
    ], constraints({ routeWindow: { startsAt: "2026-07-20T16:30:00.000Z", endsAt: "2026-07-20T20:30:00.000Z" } }));
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.timing.walkingMinutes).toBeGreaterThan(0);
    expect(selection.timing.transferUncertaintyMinutes).toBe(10);
    expect(selection.stops[1].visitWindow!.startsAt).not.toBe("2026-07-20T17:30:00.000Z");
    expect(selection.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({
      code: "transport_feasibility",
      message: expect.stringContaining("4.8 km/h"),
    }));
  });
});

describe("hard evidence fences", () => {
  it("rejects unknown access when free text supplies a skipped intake need", async () => {
    const parsed = parsePlanGenerationIntake(intake({
      area: { kind: "night-patch", id: "camden" },
      timeWindow: null,
      accessibilityNeeds: [],
      skipped: ["time-window", "accessibility"],
    }), NOW);
    if (!parsed.ok) throw new Error("expected intake");
    const context = reconcilePlanContext(
      "Step-free in Camden",
      null,
      parsed.value,
      NOW,
    ).context;

    expect(context.accessibility).toEqual(["step-free"]);
    await expect(selectPlanGenerationCandidates(
      [1, 2, 3, 4].map((number) => scoredCandidate(`unknown-${number}`)),
      context,
      parsed.value,
      NOW.getTime(),
    )).resolves.toMatchObject({
      ok: false,
      selection: { rejected: { accessibility: 4 } },
    });
  });

  it("rejects unknown access when free text has no intake", async () => {
    const context = reconcilePlanContext(
      "Step-free in Camden",
      null,
      null,
      NOW,
    ).context;

    await expect(selectPlanGenerationCandidates(
      [1, 2, 3, 4].map((number) => scoredCandidate(`unknown-${number}`)),
      context,
      null,
      NOW.getTime(),
    )).resolves.toMatchObject({
      ok: false,
      selection: { rejected: { accessibility: 4 } },
    });
  });

  it("rejects unknown price evidence for a context ceiling with no intake", async () => {
    const context = {
      ...reconcilePlanContext("Camden", null, null, NOW).context,
      budgetLimitPence: 1_200,
    };

    await expect(selectPlanGenerationCandidates(
      [1, 2, 3, 4].map((number) => scoredCandidate(`unknown-${number}`)),
      context,
      null,
      NOW.getTime(),
    )).resolves.toMatchObject({
      ok: false,
      selection: { rejected: { budgetEvidence: 4 } },
    });
  });

  it("returns selection failure for unsupported context transport with no intake", async () => {
    const context = {
      ...reconcilePlanContext("Camden", null, null, NOW).context,
      transportConstraints: ["tube"],
    };

    await expect(selectPlanGenerationCandidates(
      [1, 2, 3, 4].map((number) => scoredCandidate(`unknown-${number}`)),
      context,
      null,
      NOW.getTime(),
    )).resolves.toMatchObject({
      ok: false,
      selection: { eligibleCandidateCount: 0 },
    });
  });

  it("keeps a value preference without a numeric ceiling on the soft legacy path", async () => {
    const context = reconcilePlanContext("Cheap in Camden", null, null, NOW).context;

    await expect(selectPlanGenerationCandidates(
      [1, 2, 3, 4].map((number) => scoredCandidate(`unknown-${number}`)),
      context,
      null,
      NOW.getTime(),
    )).resolves.toMatchObject({ ok: true, legacy: true });
  });

  it("ignores unsupported context access values when intake skipped access", async () => {
    const parsed = parsePlanGenerationIntake(intake({
      area: { kind: "night-patch", id: "camden" },
      timeWindow: null,
      accessibilityNeeds: [],
      skipped: ["time-window", "accessibility"],
    }), NOW);
    if (!parsed.ok) throw new Error("expected intake");
    const context = {
      ...reconcilePlanContext("Step-free in Camden", null, parsed.value, NOW).context,
      accessibility: ["step-free", "maybe-step-free"],
    };

    await expect(selectPlanGenerationCandidates(
      [1, 2, 3, 4].map((number) => scoredCandidate(`accessible-${number}`, {
        name: "The Ice Wharf - JD Wetherspoon",
      })),
      context,
      parsed.value,
      NOW.getTime(),
    )).resolves.toMatchObject({ ok: true, accessibilityEnforced: true });
  });

  it("does not equate seated service with reliable seating", () => {
    const selection = selectGroundedPlanRoute([
      candidate("a", { access: { seatedService: { confirmed: true, source: SOURCE } } } as never),
      candidate("b"), candidate("c"), candidate("d"),
    ], constraints({ accessibilityNeeds: ["seating"] }));
    expect(selection).toMatchObject({ ok: false, rejected: { accessibility: 4 } });
  });

  it("time-matches structured low-noise evidence and rejects prose-shaped substitutes", () => {
    const quiet = { ranges: [{ weekday: "Monday", startsAt: "17:00", endsAt: "21:00" }], source: SOURCE };
    const allEvening = openSchedule([{ weekday: "Monday", startsAt: "16:00", endsAt: "23:00" }]);
    const rows = ["a", "b", "c"].map((id) => candidate(id, {
      access: { lowNoise: quiet },
      openingSchedule: allEvening,
    }));
    const matching = selectGroundedPlanRoute(rows, constraints({
      accessibilityNeeds: ["low-noise"],
      routeWindow: { startsAt: "2026-07-20T16:30:00.000Z", endsAt: "2026-07-20T20:30:00.000Z" },
    }));
    expect(matching.ok).toBe(true);
    const prose = selectGroundedPlanRoute([
      candidate("a", { access: { quietHours: "Usually quiet" } as never, openingSchedule: allEvening }),
      candidate("b", { openingSchedule: allEvening }),
      candidate("c", { openingSchedule: allEvening }),
    ], constraints({
      accessibilityNeeds: ["low-noise"],
      routeWindow: { startsAt: "2026-07-20T16:30:00.000Z", endsAt: "2026-07-20T20:30:00.000Z" },
    }));
    expect(prose.ok).toBe(false);
  });

  it.each([
    [Number.NaN, "Price"], [Number.POSITIVE_INFINITY, "Price"], [-1, "Price"], [0, "Price"], [1200.5, "Price"],
    [1200, ""], [1200, "Price", "javascript:alert(1)"],
  ])("turns invalid or unattributed price evidence into unknown", (pence, label, url = SOURCE.url) => {
    expect(buildPriceEvidence({ pence, label, url, observedAt: SOURCE.observedAt, now: NOW.getTime() }))
      .toEqual({ pence: null, source: null, confidenceState: "unknown" });
  });

  it("fails a ceiling closed for stale evidence and fences every alternative", () => {
    const stale = candidate("stale", { score: 1_000, price: price(100, "stale") });
    const rows = [1, 2, 3, 4].map((number) => candidate(`good-${number}`, { price: price(300 + number * 10) }));
    const selection = selectGroundedPlanRoute([stale, ...rows], constraints({ budgetLimitPence: 1_000 }));
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.stops.map((stop) => stop.venueId)).not.toContain("stale");
    expect(selection.alternatives.flat().every((stop) => stop.price.confidenceState !== "stale")).toBe(true);
    for (let position = 0; position < 3; position += 1) {
      for (const alternative of selection.alternatives[position]) {
        const total = selection.stops.reduce((sum, stop, index) =>
          sum + (index === position ? alternative.price.pence! : stop.price.pence!), 0);
        expect(total).toBeLessThanOrEqual(1_000);
      }
    }
  });

  it("treats regular hours as listed schedule, never exact-date confirmation", () => {
    const schedule = openSchedule([{ weekday: "Monday", startsAt: "17:00", endsAt: "23:00" }]);
    const assessed = assessOpeningSchedule(schedule, {
      startsAt: "2026-07-20T16:30:00.000Z",
      endsAt: "2026-07-20T17:20:00.000Z",
    }, NOW.getTime());
    expect(assessed).toMatchObject({ state: "listed_open", warning: expect.stringContaining("holiday") });
    expect(assessOpeningSchedule({ ...schedule, source: { ...SOURCE, observedAt: "2026-01-01T00:00:00.000Z" } }, {
      startsAt: "2026-07-20T16:30:00.000Z",
      endsAt: "2026-07-20T17:20:00.000Z",
    }, NOW.getTime())).toMatchObject({ state: "unknown", warning: expect.stringContaining("stale") });
  });
});

describe("context reconciliation", () => {
  it("removes overridden query reasons and attributes each authoritative field to intake", () => {
    const parsed = parsePlanGenerationIntake(intake(), NOW);
    if (!parsed.ok) throw new Error("expected intake");
    const result = reconcilePlanContext(
      "Shoreditch late night for 12 under £60",
      { nightArea: "shoreditch", groupSize: 10 },
      parsed.value,
      NOW,
    );
    expect(result.context).toMatchObject({ nightArea: "clapham", daypart: "after_work", groupSize: 4 });
    expect(result.fieldSources).toMatchObject({ nightArea: "intake", daypart: "intake", groupSize: "intake" });
    expect(result.reasons.filter((reason) => ["nightArea", "daypart", "groupSize", "budgetLimitPence"].includes(reason.field)))
      .toEqual(expect.not.arrayContaining([expect.objectContaining({ explanation: expect.stringContaining("Matched") })]));
  });
});
