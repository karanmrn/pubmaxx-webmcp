import { describe, expect, it } from "vitest";

import {
  anchorConflictMessage,
  composerCreatePayload,
  composerRouteMutation,
  createdPlanMetadataPatch,
  createdPlanNeedsReadyTransition,
  editedPlanStop,
  errorMessageFromBody,
  applyPlanStopCount,
  generatedPlanAnchorFromResponse,
  isMatchingAnchorOnlyPlan,
  isGroundedGeneratedRoute,
  nightAreaCoverageSummary,
  nightAreaCoverageMeta,
  nightAreaMapHref,
  nightAreaOptionLabel,
  nightAreaSelectorGroups,
  nightContextChanged,
  parsePlanRouteDraft,
  planAcceptanceTelemetry,
  planCreationConsumesPlanningIntent,
  planComposerVenueIndexPath,
  planDraftSavedTelemetry,
  planGenerationFailureStatus,
  PLAN_INTAKE_CONFLICT_NO_ROUTE,
  PLAN_INTAKE_CONFLICT_READER,
  PLAN_INTAKE_CONFLICT_SERVER,
  planLockValidationError,
  routeStopsFromGenerated,
  serverPlanCreationAttribution,
  swapDraftStop,
} from "@/components/plan/PlanComposer";
import { getNightArea } from "@/lib/nightAreas";
import { createPlanIntakeDraft } from "@/lib/planIntake";
import type { NightContext } from "@/lib/nightPlanning";
import {
  readPlanDraftEnvelope,
  writePlanDraftEnvelope,
} from "@/lib/planDraft";
import {
  releaseAcceptedPlanContext,
  resolveComposerHydration,
} from "@/lib/planComposerHandoff";
import {
  createPlanningIntent,
  PLANNING_INTENT_STORAGE_KEY,
  readPlanningIntent,
} from "@/lib/planningIntent";

describe("PlanComposer PlanningIntent settlement", () => {
  const intent = { acceptedVenueId: "venue-accepted" };

  it("settles only when created Stop 1 consumed the accepted Venue", () => {
    expect(planCreationConsumesPlanningIntent(intent, [
      { venueId: "venue-accepted" },
      { venueId: "venue-next" },
    ])).toBe(true);
    expect(planCreationConsumesPlanningIntent(intent, [
      { venueId: "venue-existing" },
      { venueId: "venue-accepted" },
    ])).toBe(false);
    expect(planCreationConsumesPlanningIntent(null, [
      { venueId: "venue-accepted" },
    ])).toBe(false);
  });
});

describe("PlanComposer accepted city authority", () => {
  it("sends the accepted city when creating the Plan", () => {
    expect(composerCreatePayload({
      title: "Manchester night",
      creatorName: "Karan",
      startTime: "2026-07-24T20:00:00.000Z",
      cityId: "manchester",
      stops: [{ venueId: "manchester-pub", venueName: "The Manchester Pub" }],
      groundingProof: "signed-proof",
      planAnchor: { venueId: "manchester-pub", source: "near", outcome: "anchor-only" },
      context: {
        nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends", groupSize: null,
        stopCount: 3, budget: "value", budgetLimitPence: null, zeroProof: false,
        wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
      },
    })).toMatchObject({
      cityId: "manchester",
      stops: [{ venueId: "manchester-pub", venueName: "The Manchester Pub" }],
      anchor: { venueId: "manchester-pub", source: "near", outcome: "anchor-only" },
      context: expect.objectContaining({ nightArea: "piccadilly-soho" }),
    });
  });

  it("resolves accepted Venue names from the accepted city's index", () => {
    expect(planComposerVenueIndexPath("manchester")).toBe(
      "/data/cities/manchester/venues_slim.json",
    );
  });

  it("keeps the accepted city and drops the anchor after a held pub is released", () => {
    expect(composerCreatePayload({
      title: "Manchester night",
      creatorName: "Karan",
      startTime: "2026-07-24T20:00:00.000Z",
      cityId: "manchester",
      stops: [{ venueId: "manchester-pub", venueName: "The Manchester Pub" }],
      groundingProof: null,
      planAnchor: null,
    })).toEqual({
      title: "Manchester night",
      creatorName: "Karan",
      startTime: "2026-07-24T20:00:00.000Z",
      cityId: "manchester",
      stops: [{ venueId: "manchester-pub", venueName: "The Manchester Pub" }],
    });
  });
});

describe("PlanComposer accepted Stop 1 naming", () => {
  const accepted = {
    key: 1,
    venueId: "venue-accepted",
    venueName: "",
    alternatives: [],
  };

  it("keeps accepted authority while the fallback name is typed", () => {
    expect(editedPlanStop({
      stop: accepted,
      venueName: "The pub beside the station",
      venues: [],
      heldVenueId: "venue-accepted",
    })).toEqual({
      stop: { ...accepted, venueName: "The pub beside the station" },
      preservesAcceptedAuthority: true,
    });
  });

  it("identifies a different indexed pub as an authority-changing edit", () => {
    expect(editedPlanStop({
      stop: accepted,
      venueName: "Different Arms",
      venues: [{ id: "venue-different", name: "Different Arms" }],
      heldVenueId: "venue-accepted",
    })).toMatchObject({
      stop: { venueId: "venue-different" },
      preservesAcceptedAuthority: false,
    });
  });
});

describe("PlanComposer route mutation authority", () => {
  const current = [
    { key: 1, venueId: "accepted", venueName: "Accepted", alternatives: [] },
    { key: 2, venueId: "second", venueName: "Second", alternatives: [] },
    { key: 3, venueId: "third", venueName: "Third", alternatives: [] },
  ];
  const authority = {
    groundingProof: "signed-proof",
    createOperationKey: "operation-key",
    planAnchor: { venueId: "accepted", source: "near", outcome: "route" } as const,
    routeStale: false,
  };

  it.each([
    ["edits Stop 2", current.map((stop, index) => index === 1 ? { ...stop, venueId: "replacement", venueName: "Replacement" } : stop)],
    ["removes Stop 3", current.slice(0, 2)],
    ["adds a Stop", [...current, { key: 4, venueId: "fourth", venueName: "Fourth", alternatives: [] }]],
  ])("invalidates exact-route proof when it %s", (_label, nextStops) => {
    expect(composerRouteMutation({
      currentStops: current,
      nextStops,
      heldVenueId: "accepted",
      ...authority,
    })).toMatchObject({
      accepted: true,
      stops: nextStops,
      groundingProof: null,
      createOperationKey: null,
      planAnchor: authority.planAnchor,
      routeStale: true,
    });
  });

  it("refuses a mutation that removes accepted Stop 1", () => {
    expect(composerRouteMutation({
      currentStops: current,
      nextStops: current.slice(1),
      heldVenueId: "accepted",
      ...authority,
    })).toMatchObject({
      accepted: false,
      stops: current,
      groundingProof: "signed-proof",
      planAnchor: authority.planAnchor,
      routeStale: false,
    });
  });

  it("keeps authority when only accepted Stop 1 display text changes", () => {
    const nextStops = [{ ...current[0]!, venueName: "Resolved name" }, ...current.slice(1)];
    expect(composerRouteMutation({
      currentStops: current,
      nextStops,
      heldVenueId: "accepted",
      ...authority,
    })).toMatchObject({
      accepted: true,
      stops: nextStops,
      groundingProof: "signed-proof",
      createOperationKey: "operation-key",
      routeStale: false,
    });
  });
});

describe("PlanComposer created Plan readiness", () => {
  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Tonight",
    startTime: "2026-08-15T19:00:00.000Z",
    createdAt: "2026-08-15T12:00:00.000Z",
    status: "draft" as const,
    anchorVenueId: "accepted",
    anchorSource: "near" as const,
  };

  it("keeps an anchor-only one-Stop Plan in draft", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: { ...plan, outcome: "anchor-only", routeReadyAt: null },
      stops: [{ venueId: "accepted", venueName: "Accepted", position: 0 }],
      crew: [],
    })).toBe(false);
  });

  it("marks a grounded anchored route with its readiness timestamp", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: { ...plan, outcome: "route", routeReadyAt: "2026-08-15T12:00:00.000Z" },
      stops: [
        { venueId: "accepted", venueName: "Accepted", position: 0 },
        { venueId: "second", venueName: "Second", position: 1 },
        { venueId: "third", venueName: "Third", position: 2 },
      ],
      crew: [],
    })).toBe(true);
  });

  it("marks an unanchored three-Stop lock-in, which carries no anchor metadata", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: {
        id: plan.id,
        title: plan.title,
        startTime: plan.startTime,
        createdAt: plan.createdAt,
        status: "draft",
        anchorVenueId: null,
        anchorSource: null,
        outcome: null,
        routeReadyAt: null,
      },
      stops: [
        { venueId: "first", venueName: "First", position: 0 },
        { venueId: "second", venueName: "Second", position: 1 },
        { venueId: "third", venueName: "Third", position: 2 },
      ],
      crew: [],
    })).toBe(true);
  });

  it("asks for no transition when the created Plan already left draft", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: { ...plan, status: "ready", outcome: null, routeReadyAt: null },
      stops: [
        { venueId: "first", venueName: "First", position: 0 },
        { venueId: "second", venueName: "Second", position: 1 },
        { venueId: "third", venueName: "Third", position: 2 },
      ],
      crew: [],
    })).toBe(false);
  });
});

describe("PlanComposer created Plan metadata write", () => {
  const context: NightContext = {
    nightArea: "piccadilly-soho",
    daypart: "evening",
    partyType: "friends",
    groupSize: 3,
    stopCount: 3,
    budget: "value",
    budgetLimitPence: null,
    zeroProof: false,
    wetherspoonsPreferred: false,
    atmosphere: [],
    foodNeeds: [],
    accessibility: [],
    transportConstraints: [],
  };
  const routeStops = [
    { venueId: "first", venueName: "First", position: 0 },
    { venueId: "second", venueName: "Second", position: 1 },
    { venueId: "third", venueName: "Third", position: 2 },
  ];
  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Tonight",
    startTime: "2026-08-15T19:00:00.000Z",
    createdAt: "2026-08-15T12:00:00.000Z",
    status: "draft" as const,
    outcome: null,
    routeReadyAt: null,
  };

  it("writes the Night Context a create came back without, beside the ready transition", () => {
    expect(createdPlanMetadataPatch(
      { plan, stops: routeStops, crew: [], context: null },
      context,
    )).toEqual({ status: "ready", context });
  });

  it("writes the Night Context even when the Plan needs no ready transition", () => {
    expect(createdPlanMetadataPatch(
      {
        plan: { ...plan, outcome: "anchor-only" },
        stops: [{ venueId: "accepted", venueName: "Accepted", position: 0 }],
        crew: [],
        context: null,
      },
      context,
    )).toEqual({ context });
  });

  it("asks for nothing when the create stored the context and the Plan holds a route", () => {
    expect(createdPlanMetadataPatch(
      { plan: { ...plan, status: "ready" }, stops: routeStops, crew: [], context },
      context,
    )).toBeNull();
  });

  it("asks for nothing when there is no context to write and no transition owed", () => {
    expect(createdPlanMetadataPatch(
      {
        plan: { ...plan, outcome: "anchor-only" },
        stops: [{ venueId: "accepted", venueName: "Accepted", position: 0 }],
        crew: [],
        context: null,
      },
      null,
    )).toBeNull();
  });
});

describe("PlanComposer anchor-only telemetry", () => {
  it("rebuilds plan_draft_saved only from grounded server attribution and matching anchor metadata", () => {
    const anchor = { venueId: "venue-accepted", source: "near", outcome: "anchor-only" } as const;

    expect(planDraftSavedTelemetry(
      { created: true, grounded: true },
      anchor,
      [{ venueId: "venue-accepted" }],
    )).toEqual({
      stops: 1,
      grounded: true,
      anchored: true,
      routeReady: false,
      source: "near",
    });
    expect(planDraftSavedTelemetry(
      { created: true, grounded: false },
      anchor,
      [{ venueId: "venue-accepted" }],
    )).toBeNull();
    expect(planDraftSavedTelemetry(
      { created: true, grounded: true },
      anchor,
      [{ venueId: "venue-other" }],
    )).toBeNull();
  });
});

describe("PlanComposer Night Area coverage states", () => {
  const groups = nightAreaSelectorGroups(new Date("2026-07-13T12:00:00.000Z"));

  it("keeps route-ready areas available in the context selector", () => {
    const ready = groups.find((group) => group.label === "Crawl-ready");

    expect(ready).toMatchObject({ disabled: false });
    expect(ready?.areas.map((area) => area.slug)).toEqual([
      "clapham",
      "victoria",
      "piccadilly-soho",
      "canary-wharf",
    ]);
    expect(nightAreaOptionLabel(ready!.areas[0], false)).toBe("Clapham");
  });

  it("keeps unchecked areas available with an honest label", () => {
    const notReady = groups.find((group) => group.label === "Not crawl-ready yet");
    const barnes = notReady?.areas.find((area) => area.slug === "barnes");

    expect(notReady).toMatchObject({ disabled: false });
    expect(barnes).toBeDefined();
    expect(nightAreaOptionLabel(barnes!, false)).toBe("Barnes - not crawl-ready yet");
  });

  it("turns the structured route gate response into useful error copy", () => {
    expect(errorMessageFromBody({
      error: {
        code: "NIGHT_AREA_ROUTE_NOT_READY",
        message: "We're still checking this area before planning a crawl.",
      },
      nightArea: { id: "barnes" },
    }, "fallback")).toBe(
      "Barnes is not ready for route planning yet. We're still checking this area before planning a crawl. Choose another area to continue.",
    );
  });

  it("keeps legacy district route-gate payloads readable during the Night Area transition", () => {
    expect(errorMessageFromBody({
      error: {
        code: "DISTRICT_ROUTE_NOT_READY",
        message: "We're still checking this area before planning a crawl.",
      },
      district: { id: "chiswick" },
    }, "fallback")).toBe(
      "Chiswick is not ready for route planning yet. We're still checking this area before planning a crawl. Choose another area to continue.",
    );
  });

  it("shows the review window instead of presenting coverage as timeless", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    expect(nightAreaCoverageMeta(getNightArea("clapham"), now)).toBe(
      "Last checked 13 Jul 2026 · review through 1 Jan 2027.",
    );
    expect(nightAreaCoverageMeta(getNightArea("shoreditch"), now)).toBe(
      "Not checked yet.",
    );
    expect(nightAreaCoverageMeta(getNightArea("richmond"), now)).toBe(
      "Last checked 1 Jan 2026 · review expired 1 Jun 2026.",
    );
  });

  it("keeps every capture state explicit and names the evidence gap", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    expect(nightAreaCoverageSummary(getNightArea("clapham"), now)).toMatchObject({
      label: "Route-ready",
      tone: "ready",
    });
    expect(nightAreaCoverageSummary(getNightArea("shoreditch"), now)).toMatchObject({
      label: "Not all checked",
      detail: "Some checks complete. Missing opening hours and route feasibility + 2 more.",
      tone: "capture",
    });
    expect(nightAreaCoverageSummary(getNightArea("barnes"), now)).toMatchObject({
      label: "Not all checked",
      detail: "Checked with gaps. Missing opening hours and the route home.",
      tone: "review",
    });
    expect(nightAreaCoverageSummary(getNightArea("dalston"), now)).toMatchObject({
      label: "Rough guess",
      detail: "We haven't checked this area yet. The route stays yours to change.",
      tone: "discovery",
    });
  });

  it("keeps map exploration available for route-ready and queued areas", () => {
    expect(nightAreaMapHref(getNightArea("barnes"))).toBe("/map?q=Barnes");
    expect(nightAreaMapHref(getNightArea("bermondsey-london-bridge"))).toBe(
      "/map?q=Bermondsey%20%26%20London%20Bridge",
    );
  });
});

describe("PlanComposer route preview seam", () => {
  it("keeps first-generation failures free of stale-route wording", () => {
    expect(planGenerationFailureStatus("Could not sort this one.", false)).toBe(
      "Could not sort this one.",
    );
  });

  it("names the retained route when a refresh fails", () => {
    expect(planGenerationFailureStatus("Could not sort this one.", true)).toBe(
      "The previous route is still here. Could not sort this one.",
    );
  });

  it("maps the intake-conflict 422 from the flat publicApiError body", () => {
    expect(errorMessageFromBody({
      error: PLAN_INTAKE_CONFLICT_SERVER,
      code: "PLAN_INTAKE_MALFORMED",
      retryable: false,
    }, "fallback")).toBe(PLAN_INTAKE_CONFLICT_READER);
    expect(planGenerationFailureStatus(PLAN_INTAKE_CONFLICT_SERVER, true)).toBe(
      PLAN_INTAKE_CONFLICT_READER,
    );
    expect(planGenerationFailureStatus(PLAN_INTAKE_CONFLICT_READER, true)).toBe(
      PLAN_INTAKE_CONFLICT_READER,
    );
    expect(planGenerationFailureStatus(PLAN_INTAKE_CONFLICT_SERVER, false)).toBe(
      PLAN_INTAKE_CONFLICT_NO_ROUTE,
    );
    expect(planGenerationFailureStatus(PLAN_INTAKE_CONFLICT_READER, false)).toBe(
      PLAN_INTAKE_CONFLICT_NO_ROUTE,
    );
  });

  it("never prints the generator's own conflict sentence to a reader", () => {
    for (const hasPreviousRoute of [true, false]) {
      for (const message of [PLAN_INTAKE_CONFLICT_SERVER, PLAN_INTAKE_CONFLICT_READER]) {
        expect(planGenerationFailureStatus(message, hasPreviousRoute))
          .not.toBe(PLAN_INTAKE_CONFLICT_SERVER);
      }
    }
    expect(PLAN_INTAKE_CONFLICT_NO_ROUTE).not.toContain("intake");
  });

  it("uses house error copy when Lock it in is missing only a name", () => {
    expect(planLockValidationError({
      title: "Thursday crawl",
      creatorName: " ",
      startTime: "2026-07-20T18:00",
      completeStopCount: 2,
      visibleStopCount: 2,
    })).toEqual({ message: "Add your name.", focus: "name" });
  });

  it("keeps the broader Lock it in validation copy for mixed missing fields", () => {
    expect(planLockValidationError({
      title: "Thursday crawl",
      creatorName: " ",
      startTime: "",
      completeStopCount: 0,
      visibleStopCount: 0,
    })).toEqual({
      message: "Add your name, a start time, and choose at least one venue from the list.",
      focus: "name",
    });
  });

  it("blocks blank visible stops before the final action", () => {
    expect(planLockValidationError({
      title: "Thursday crawl",
      creatorName: "Karan",
      startTime: "2026-07-20T18:00",
      completeStopCount: 1,
      visibleStopCount: 2,
    })).toEqual({
      message: "Choose a venue for every visible stop.",
      focus: null,
    });
  });

  it("blocks a generated one-Stop Plan unless its anchor-only outcome names Stop 1", () => {
    const generatedOneStop = {
      title: "Thursday crawl",
      creatorName: "Karan",
      startTime: "2026-07-20T18:00",
      completeStopCount: 1,
      visibleStopCount: 1,
      groundingProof: "signed-proof",
      singleStopVenueId: "venue-a",
    };

    expect(planLockValidationError(generatedOneStop)).toEqual({
      message: "Sort this pub again before locking it in.",
      focus: null,
    });
    expect(planLockValidationError({
      ...generatedOneStop,
      planAnchor: { venueId: "venue-a", source: "near", outcome: "route" as const },
    })).toEqual({
      message: "Sort this pub again before locking it in.",
      focus: null,
    });
    expect(planLockValidationError({
      ...generatedOneStop,
      planAnchor: { venueId: "venue-b", source: "near", outcome: "anchor-only" as const },
    })).toEqual({
      message: "Sort this pub again before locking it in.",
      focus: null,
    });
    expect(planLockValidationError({
      ...generatedOneStop,
      planAnchor: { venueId: "venue-a", source: "near", outcome: "anchor-only" as const },
    })).toBeNull();
    expect(isMatchingAnchorOnlyPlan({
      groundingProof: "signed-proof",
      completeStopCount: 1,
      singleStopVenueId: "venue-a",
      planAnchor: { venueId: "venue-a", source: "near", outcome: "anchor-only" },
    })).toBe(true);
  });

  it("never restores client-writable grounding attribution from local storage", () => {
    const restored = parsePlanRouteDraft(JSON.stringify({
      stops: [
        { key: 1, venueId: "a", venueName: "A", alternatives: [] },
        { key: 2, venueId: "b", venueName: "B", alternatives: [] },
        { key: 3, venueId: "c", venueName: "C", alternatives: [] },
      ],
      routeGrounded: true,
    }));

    expect(restored).not.toHaveProperty("routeGrounded");
  });

  it("emits acceptance only for a server-attributed first creation", () => {
    expect(planAcceptanceTelemetry({ created: true, grounded: true }, 3)).toEqual({ stops: 3, grounded: true });
    expect(planAcceptanceTelemetry({ created: false, grounded: true }, 3)).toEqual({ stops: 3, grounded: true });
    expect(planAcceptanceTelemetry({ created: true, grounded: "true" }, 3)).toBeNull();
    expect(serverPlanCreationAttribution({ created: false, grounded: false })).toEqual({ created: false, grounded: false });
  });

  it("uses the generator's explicit grounding assertion instead of route revision metadata", () => {
    const stops = routeStopsFromGenerated([
      { venueId: "a", venueName: "A" },
      { venueId: "b", venueName: "B" },
      { venueId: "c", venueName: "C" },
    ]);

    expect(isGroundedGeneratedRoute({ grounded: true, groundingProof: "signed-proof" }, stops)).toBe(true);
    expect(isGroundedGeneratedRoute({
      grounded: true,
      groundingProof: "signed-proof",
      anchored: true,
      anchorVenueId: "a",
      anchorSource: "near",
      outcome: "anchor-only",
    }, stops.slice(0, 1))).toBe(true);
    expect(isGroundedGeneratedRoute({ routeRevision: 7 }, stops)).toBe(false);
    expect(isGroundedGeneratedRoute({ grounded: true, groundingProof: "signed-proof" }, stops.slice(0, 2))).toBe(false);
  });

  it("reads only exact server-returned anchor metadata", () => {
    expect(generatedPlanAnchorFromResponse({
      anchored: true,
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "route",
    })).toEqual({ venueId: "venue-a", source: "near", outcome: "route" });
    expect(generatedPlanAnchorFromResponse({
      anchored: true,
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "wrong",
    })).toBeNull();
    expect(generatedPlanAnchorFromResponse({
      anchored: false,
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "route",
    })).toBeNull();
  });

  it("keeps generated stops and attaches the top-level alternative pool", () => {
    const stops = routeStopsFromGenerated([
      { venueId: "a", venueName: "A" },
      { venueId: "b", venueName: "B" },
      { venueId: "c", venueName: "C" },
      { venueId: "d", venueName: "D" },
    ], [
      { venueId: "a", venueName: "duplicate current" },
      { venueId: "x", venueName: "X" },
      { venueId: "x", venueName: "X again" },
    ]);

    expect(stops).toHaveLength(4);
    expect(stops[0]?.alternatives).toEqual([{ venueId: "x", venueName: "X" }]);
  });

  it("cycles a grounded swap while retaining the previous venue as an alternative", () => {
    const next = swapDraftStop({
      key: 1,
      venueId: "a",
      venueName: "A",
      alternatives: [{ venueId: "x", venueName: "X" }, { venueId: "y", venueName: "Y" }],
    });

    expect(next).toMatchObject({ venueId: "x", venueName: "X" });
    expect(next.alternatives).toEqual([
      { venueId: "y", venueName: "Y" },
      { venueId: "a", venueName: "A" },
    ]);
  });

  it("skips alternatives already used by another route stop", () => {
    const current = {
      key: 1,
      venueId: "a",
      venueName: "A",
      alternatives: [{ venueId: "b", venueName: "B" }, { venueId: "x", venueName: "X" }],
    };

    expect(swapDraftStop(current, new Set(["b"]))).toMatchObject({ venueId: "x", venueName: "X" });
    expect(swapDraftStop(current, new Set(["b", "x"]))).toBe(current);
  });

  it("marks only real context changes as route-staling edits", () => {
    const context = {
      nightArea: "clapham" as const,
      daypart: "evening" as const,
      partyType: "friends" as const,
      groupSize: 4,
      budget: "standard" as const,
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    };

    expect(nightContextChanged(context, { ...context })).toBe(false);
    expect(nightContextChanged(context, { ...context, budget: "value" })).toBe(true);
    expect(nightContextChanged(context, { ...context, stopCount: 3 })).toBe(false);
    expect(nightContextChanged(context, { ...context, stopCount: 4 })).toBe(true);

    const synced = applyPlanStopCount(
      createPlanIntakeDraft(),
      { ...context, stopCount: 3 },
      4,
    );
    expect(synced.draft.answers.stopCount).toBe(4);
    expect(synced.context?.stopCount).toBe(4);
  });
});

describe("PlanComposer anchor-conflict reporting", () => {
  // The route optimizer answers HTTP 200 with an empty Stops list when the
  // accepted pub itself is what refused, so the empty-route branch would have
  // printed "No venues matched that ask" over the one sentence that names the
  // real reason. Every conflict code travels this way.
  it("prints the server sentence for an anchor conflict answered 200", () => {
    expect(anchorConflictMessage({
      grounded: false,
      outcome: "anchor-conflict",
      stops: [],
      reason: "ANCHOR_OPENING_CONFLICT",
      message: "That pub is not open for your chosen time. Adjust the time or accept another pub.",
    })).toBe("That pub is not open for your chosen time. Adjust the time or accept another pub.");
  });

  it("falls back to one honest sentence when the conflict carries no message", () => {
    expect(anchorConflictMessage({ outcome: "anchor-conflict", stops: [] }))
      .toBe("We could not build a route from that pub right now. Try a different pub.");
    expect(anchorConflictMessage({ outcome: "anchor-conflict", message: "   " }))
      .toBe("We could not build a route from that pub right now. Try a different pub.");
  });

  it("stays out of the way of every other generation outcome", () => {
    expect(anchorConflictMessage({ outcome: "anchor-only", message: "Kept." })).toBeNull();
    expect(anchorConflictMessage({ stops: [], message: "Nothing matched." })).toBeNull();
    expect(anchorConflictMessage(null)).toBeNull();
    expect(anchorConflictMessage("anchor-conflict")).toBeNull();
  });
});

describe("what the composer holds as Stop 1", () => {
  const NOW = Date.parse("2026-07-24T12:00:00.000Z");

  function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, String(value)); },
    };
  }

  const stops = [
    { key: 1, venueId: "venue-first", venueName: "First Arms", alternatives: [] },
    { key: 2, venueId: "venue-second", venueName: "Second Arms", alternatives: [] },
  ];
  const authority = {
    groundingProof: null,
    createOperationKey: null,
    planAnchor: null,
    routeStale: false,
  };

  function describeFirstDraft(storage: Storage) {
    writePlanDraftEnvelope({
      title: "Tonight, sorted",
      creatorName: "K",
      startTime: "2026-07-24T18:00:00.000Z",
      conciergeQuery: "Quiet pints in Soho",
      stops: stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName })),
    }, "manual", storage, NOW);
    return readPlanDraftEnvelope(storage, NOW);
  }

  function removeStop1(heldVenueId: string | null) {
    return composerRouteMutation({
      currentStops: stops,
      nextStops: stops.slice(1),
      heldVenueId,
      ...authority,
    });
  }

  it("lets a recovered describe-first draft edit its own Stop 1", () => {
    // The regression this pins: a Plan the person merely routed came back with
    // Stop 1 locked, refusing every swap, remove and rename with a sentence
    // about an acceptance that never happened.
    const planDraftStorage = memoryStorage();
    const hydration = resolveComposerHydration({
      planDraft: describeFirstDraft(planDraftStorage),
      routeDraft: null,
      intakeDraft: null,
      planningIntent: null,
      rememberedArea: null,
    });

    expect(hydration.heldVenueId).toBeNull();
    expect(removeStop1(hydration.heldVenueId)).toMatchObject({
      accepted: true,
      stops: stops.slice(1),
    });
    expect(editedPlanStop({
      stop: stops[0]!,
      venueName: "Different Arms",
      venues: [{ id: "venue-different", name: "Different Arms" }],
      heldVenueId: hydration.heldVenueId,
    })).toMatchObject({
      stop: { venueId: "venue-different", venueName: "Different Arms" },
      preservesAcceptedAuthority: false,
    });
  });

  it("holds an accepted Stop 1 until the person releases it", () => {
    const intentStorage = memoryStorage();
    const planDraftStorage = memoryStorage();
    const routeDraftStorage = memoryStorage();
    intentStorage.setItem(PLANNING_INTENT_STORAGE_KEY, JSON.stringify(createPlanningIntent({
      source: "near",
      cityId: "london",
      acceptedVenueId: "venue-first",
      acceptedArea: { kind: "night-patch", id: "soho" },
      startsAt: "2026-07-24T20:00:00.000Z",
      displayEvidence: { kind: "directory", observedAt: null },
    }, NOW)));

    function hydrate() {
      return resolveComposerHydration({
        planDraft: readPlanDraftEnvelope(planDraftStorage, NOW),
        routeDraft: null,
        intakeDraft: null,
        planningIntent: readPlanningIntent({ storage: intentStorage, now: NOW }),
        rememberedArea: null,
      });
    }

    const held = hydrate();
    expect(held.heldVenueId).toBe("venue-first");
    expect(held.showAcceptedSummary).toBe(true);
    expect(removeStop1(held.heldVenueId)).toMatchObject({ accepted: false, stops });

    releaseAcceptedPlanContext({
      intent: intentStorage,
      planDraft: planDraftStorage,
      routeDraft: routeDraftStorage,
      now: NOW,
    });

    const released = hydrate();
    expect(released.heldVenueId).toBeNull();
    expect(released.showAcceptedSummary).toBe(false);
    expect(removeStop1(released.heldVenueId)).toMatchObject({
      accepted: true,
      stops: stops.slice(1),
    });
  });

  it("lets Stop 1 go when a recovered route anchor outlives the acceptance", () => {
    // The regression this pins: the route draft carries no acceptance TTL, so a
    // generated anchor came back hours later and locked Stop 1 for somebody
    // whose acceptance had expired - with no panel on screen to explain it and
    // no release control to undo it.
    const recovered = parsePlanRouteDraft(JSON.stringify({
      stops: stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName, alternatives: [] })),
      nightContext: null,
      routeRevision: 1,
      routeStale: false,
      groundingProof: "signed-proof",
      createOperationKey: "operation-key",
      planAnchor: { venueId: "venue-first", source: "near", outcome: "route" },
    }));
    expect(recovered?.planAnchor?.venueId).toBe("venue-first");

    const lapsed = resolveComposerHydration({
      planDraft: null,
      routeDraft: null,
      intakeDraft: null,
      planningIntent: null,
      rememberedArea: null,
    });
    expect(lapsed.heldVenueId).toBeNull();
    expect(lapsed.showAcceptedSummary).toBe(false);

    const anchored = {
      groundingProof: recovered?.groundingProof ?? null,
      createOperationKey: recovered?.createOperationKey ?? null,
      planAnchor: recovered?.planAnchor ?? null,
      routeStale: false,
    };

    expect(composerRouteMutation({
      currentStops: stops,
      nextStops: stops.slice(1),
      heldVenueId: lapsed.heldVenueId,
      ...anchored,
    })).toMatchObject({ accepted: true, stops: stops.slice(1) });

    const swapped = [{ ...stops[0]!, venueId: "venue-other", venueName: "Other Arms" }, stops[1]!];
    expect(composerRouteMutation({
      currentStops: stops,
      nextStops: swapped,
      heldVenueId: lapsed.heldVenueId,
      ...anchored,
    })).toMatchObject({
      accepted: true,
      stops: swapped,
      // An edited route may not keep the proof it was generated with, so the
      // anchor still does its own job: this route cannot be locked until it is
      // sorted again.
      groundingProof: null,
      createOperationKey: null,
      routeStale: true,
      planAnchor: anchored.planAnchor,
    });

    expect(editedPlanStop({
      stop: stops[0]!,
      venueName: "Other Arms",
      venues: [{ id: "venue-other", name: "Other Arms" }],
      heldVenueId: lapsed.heldVenueId,
    })).toMatchObject({
      stop: { venueId: "venue-other" },
      preservesAcceptedAuthority: false,
    });
  });
});

