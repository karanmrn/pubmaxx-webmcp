import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import {
  createWebMcpBoard,
  createWebMcpMutationArbiter,
  parseWebMcpRouteResponse,
  publishWebMcpRoute,
  retainWebMcpContextEvidence,
  retainWebMcpSearchEvidence,
  swapWebMcpBoardStop,
  writeWebMcpRouteToPlanDraft,
} from "@/lib/webmcp/board";
import { readPlanRouteDraftEnvelope } from "@/lib/planRouteDraft";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const GROUNDING_PROOF = `${Buffer.from(JSON.stringify({ v: 1, expiresAt: NOW + 2 * 60 * 60 * 1000 }), "utf8").toString("base64url")}.test-signature`;

function memoryStorage(options: { throwOnSet?: boolean } = {}): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      if (options.throwOnSet) throw new Error("blocked");
      values.set(key, String(value));
    },
  };
}

function generatedRoute() {
  return {
    grounded: true,
    operationKey: "operation-1",
    groundingProof: GROUNDING_PROOF,
    inferredContext: {
      nightArea: "clapham",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      budget: "standard",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
      stopCount: 3,
    },
    stops: [
      {
        venueId: "venue-a",
        venueName: "Venue A",
        reason: "Starts near the station.",
        alternatives: [{ venueId: "venue-x", venueName: "Venue X" }],
      },
      {
        venueId: "venue-b",
        venueName: "Venue B",
        reason: "Keeps the walk short.",
        alternatives: [
          { venueId: "venue-a", venueName: "Venue A" },
          { venueId: "venue-x", venueName: "Venue X" },
          { venueId: "venue-y", venueName: "Venue Y" },
        ],
      },
      {
        venueId: "venue-c",
        venueName: "Venue C",
        reason: "Finishes near transport.",
        alternatives: [],
      },
    ],
    routeTotals: {
      stopCount: 3,
      straightLineWalkingKm: 1.2,
      estimatedWalkingMinutes: 20,
      distanceBasis: "straight-line",
    },
    planningConfidence: {
      level: "medium",
      score: 0.7,
      routeReady: true,
      missingEvidence: ["live_weather"],
      warnings: ["Check live weather before leaving."],
      provenance: [
        { kind: "venue_dataset", label: "PUBMAXX Venue Dataset" },
        {
          kind: "night_area_review",
          label: "Clapham route review",
          asOf: "2026-09-03T00:00:00.000Z",
        },
      ],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("WebMCP board route contracts", () => {
  it("validates and retains ordered Stops, evidence, authority, and handoff response", () => {
    const response = generatedRoute();
    const parsed = parseWebMcpRouteResponse(response);

    expect(parsed?.stops.map((stop) => stop.venueId)).toEqual([
      "venue-a",
      "venue-b",
      "venue-c",
    ]);
    expect(parsed?.stops[1]).toMatchObject({
      key: 2,
      reason: "Keeps the walk short.",
      alternatives: [
        { venueId: "venue-a", venueName: "Venue A" },
        { venueId: "venue-x", venueName: "Venue X" },
        { venueId: "venue-y", venueName: "Venue Y" },
      ],
    });
    expect(parsed).toMatchObject({
      routeTotals: { stopCount: 3, estimatedWalkingMinutes: 20 },
      planningConfidence: { level: "medium", score: 0.7 },
      warnings: ["Check live weather before leaving."],
      provenance: [
        { kind: "venue_dataset", label: "PUBMAXX Venue Dataset" },
        { kind: "night_area_review", label: "Clapham route review" },
      ],
      groundingProof: GROUNDING_PROOF,
      operationKey: "operation-1",
      routeStale: false,
    });
    expect(parsed?.originalResponse).toEqual(response);
    expect(parsed?.originalResponse).not.toBe(response);
  });

  it("rejects malformed, duplicate, empty, and non-JSON-safe routes", () => {
    expect(parseWebMcpRouteResponse({ ...generatedRoute(), stops: [] })).toBeNull();
    expect(parseWebMcpRouteResponse({
      ...generatedRoute(),
      stops: generatedRoute().stops.map((stop) => ({ ...stop, venueId: "same" })),
    })).toBeNull();
    expect(parseWebMcpRouteResponse({
      ...generatedRoute(),
      routeTotals: { ...generatedRoute().routeTotals, straightLineWalkingKm: Infinity },
    })).toBeNull();
    expect(parseWebMcpRouteResponse({
      ...generatedRoute(),
      extra: undefined,
    })).toBeNull();
    expect(parseWebMcpRouteResponse({ ...generatedRoute(), grounded: false })).toBeNull();
    expect(parseWebMcpRouteResponse({ ...generatedRoute(), groundingProof: null })).toBeNull();
    expect(parseWebMcpRouteResponse({ ...generatedRoute(), operationKey: "" })).toBeNull();
  });

  it("publishes only valid routes and increments revision once", () => {
    const initial = createWebMcpBoard();
    const first = publishWebMcpRoute(initial, generatedRoute());
    const invalid = publishWebMcpRoute(first, { ...generatedRoute(), stops: [] });

    expect(first.revision).toBe(1);
    expect(first.route?.stops).toHaveLength(3);
    expect(invalid).toBe(first);
  });

  it("retains search and London context evidence independently", () => {
    const initial = createWebMcpBoard();
    const searched = retainWebMcpSearchEvidence(initial, {
      status: "ok",
      venues: [{ venueId: "venue-a" }],
    });
    const contextual = retainWebMcpContextEvidence(searched, {
      status: "partial",
      weather: "Rain later",
    });
    const searchedAgain = retainWebMcpSearchEvidence(contextual, {
      status: "empty",
      venues: [],
    });

    expect(searchedAgain.searchEvidence).toEqual({ status: "empty", venues: [] });
    expect(searchedAgain.contextEvidence).toEqual({
      status: "partial",
      weather: "Rain later",
    });
    expect(searchedAgain.revision).toBe(0);
  });

  it("uses first unused alternative and clears old-sequence authority", () => {
    const fresh = publishWebMcpRoute(createWebMcpBoard(), generatedRoute());
    const swapped = swapWebMcpBoardStop(fresh, 2);

    expect(swapped.revision).toBe(2);
    expect(swapped.route?.stops.map((stop) => stop.venueId)).toEqual([
      "venue-a",
      "venue-x",
      "venue-c",
    ]);
    expect(swapped.route?.stops[1]).toEqual({
      key: 2,
      venueId: "venue-x",
      venueName: "Venue X",
      alternatives: [
        { venueId: "venue-y", venueName: "Venue Y" },
        { venueId: "venue-b", venueName: "Venue B" },
      ],
    });
    expect(swapped.route?.stops[0].reason).toBe("Starts near the station.");
    expect(swapped.route).toMatchObject({
      routeTotals: null,
      planningConfidence: null,
      warnings: [],
      provenance: [],
      groundingProof: null,
      operationKey: null,
      routeStale: true,
      originalResponse: null,
    });
  });

  it("preserves board and revision when swap has no unused alternative", () => {
    const response = generatedRoute();
    response.stops[1].alternatives = [
      { venueId: "venue-a", venueName: "Venue A" },
      { venueId: "venue-c", venueName: "Venue C" },
    ];
    const fresh = publishWebMcpRoute(createWebMcpBoard(), response);

    expect(swapWebMcpBoardStop(fresh, 2)).toBe(fresh);
    expect(swapWebMcpBoardStop(fresh, 9)).toBe(fresh);
    expect(fresh.revision).toBe(1);
  });

  it("writes fresh and swapped routes through the canonical Plan draft", () => {
    const fresh = publishWebMcpRoute(createWebMcpBoard(), generatedRoute());
    const freshStorage = memoryStorage();
    expect(writeWebMcpRouteToPlanDraft(fresh.route!, freshStorage, NOW)).toBe(true);
    expect(readPlanRouteDraftEnvelope(freshStorage, NOW)?.value).toMatchObject({
      routeStale: false,
      groundingProof: GROUNDING_PROOF,
      operationKey: "operation-1",
      stops: [
        { venueId: "venue-a" },
        { venueId: "venue-b" },
        { venueId: "venue-c" },
      ],
    });

    const swapped = swapWebMcpBoardStop(fresh, 2);
    const swappedStorage = memoryStorage();
    expect(writeWebMcpRouteToPlanDraft(swapped.route!, swappedStorage, NOW)).toBe(true);
    expect(readPlanRouteDraftEnvelope(swappedStorage, NOW)?.value).toMatchObject({
      routeStale: true,
      routeTotals: null,
      planningConfidence: null,
      groundingProof: null,
      operationKey: null,
      stops: [
        { venueId: "venue-a" },
        { venueId: "venue-x" },
        { venueId: "venue-c" },
      ],
    });
  });

  it("does not navigate around blocked Plan draft storage", () => {
    const fresh = publishWebMcpRoute(createWebMcpBoard(), generatedRoute());
    expect(writeWebMcpRouteToPlanDraft(fresh.route!, memoryStorage({ throwOnSet: true }), NOW)).toBe(false);
    expect(writeWebMcpRouteToPlanDraft(fresh.route!, null, NOW)).toBe(false);
  });
});

describe("WebMCP route mutation arbiter", () => {
  it("serializes mutations and rejects queued work after revision changes", async () => {
    let revision = 0;
    const firstMayFinish = deferred<void>();
    const starts: string[] = [];
    const sideEffects: string[] = [];
    const secondAction = vi.fn(async () => "second");
    const arbiter = createWebMcpMutationArbiter(() => revision);

    const first = arbiter.run(0, async (lease) => {
      starts.push("first");
      await firstMayFinish.promise;
      lease.runSideEffect(() => {
        sideEffects.push("published first");
        revision += 1;
      });
      return "first";
    });
    const second = arbiter.run(0, secondAction);

    await Promise.resolve();
    expect(starts).toEqual(["first"]);
    expect(secondAction).not.toHaveBeenCalled();

    firstMayFinish.resolve();
    await expect(first).resolves.toMatchObject({ status: "completed", value: "first" });
    await expect(second).resolves.toEqual({
      status: "stale",
      retryable: true,
      expectedRevision: 0,
      currentRevision: 1,
    });
    expect(sideEffects).toEqual(["published first"]);
    expect(secondAction).not.toHaveBeenCalled();
  });

  it("prevents side effects when revision changes during pending work", async () => {
    let revision = 2;
    const network = deferred<void>();
    const sideEffect = vi.fn();
    const arbiter = createWebMcpMutationArbiter(() => revision);

    const result = arbiter.run(2, async (lease) => {
      await network.promise;
      expect(lease.runSideEffect(sideEffect)).toEqual({ applied: false });
      return "ignored";
    });

    revision = 3;
    network.resolve();

    await expect(result).resolves.toEqual({
      status: "stale",
      retryable: true,
      expectedRevision: 2,
      currentRevision: 3,
    });
    expect(sideEffect).not.toHaveBeenCalled();
  });

  it("invalidates a deferred effect when a newer mutation starts", async () => {
    let revision = 4;
    const secondMayFinish = deferred<void>();
    let firstLease: { isCurrent: () => boolean } | null = null;
    const arbiter = createWebMcpMutationArbiter(() => revision);

    await arbiter.run(4, (lease) => {
      firstLease = lease;
      return "opened";
    });
    expect(firstLease!.isCurrent()).toBe(true);

    const second = arbiter.run(4, async (lease) => {
      await secondMayFinish.promise;
      lease.runSideEffect(() => { revision += 1; });
      return "new route";
    });
    await vi.waitFor(() => expect(firstLease!.isCurrent()).toBe(false));
    secondMayFinish.resolve();
    await expect(second).resolves.toMatchObject({ status: "completed" });
  });
});
