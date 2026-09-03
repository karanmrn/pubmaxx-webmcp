import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  mapGeneratedRouteDraftValue,
  transferMapRouteToDraft,
  type MapGeneratedRouteResponse,
} from "@/lib/mapRouteTransfer";
import {
  PLAN_ROUTE_DRAFT_V2_KEY,
  readPlanRouteDraftEnvelope,
} from "@/lib/planRouteDraft";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function memoryStorage(options: { alwaysThrow?: boolean } = {}): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      if (options.alwaysThrow) throw new Error("blocked");
      values.set(key, String(value));
    },
  };
}

function fakeProof(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, expiresAt }), "utf8").toString("base64url");
  return `${payload}.not-a-trusted-signature`;
}

function generateResponse(overrides: Partial<MapGeneratedRouteResponse> = {}): MapGeneratedRouteResponse {
  return {
    groundingProof: fakeProof(NOW + 2 * 60 * 60 * 1000),
    operationKey: "operation-1",
    stops: [
      { venueId: "venue-a", venueName: "Venue A", alternatives: [{ venueId: "venue-x", venueName: "Venue X" }] },
      { venueId: "venue-b", venueName: "Venue B", alternatives: [] },
      { venueId: "venue-c", venueName: "Venue C", alternatives: [] },
    ],
    inferredContext: {
      nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4,
      budget: "standard", budgetLimitPence: null, zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
    },
    routeTotals: { stopCount: 3, straightLineWalkingKm: 1.2, estimatedWalkingMinutes: 20, distanceBasis: "straight-line" },
    planningConfidence: { level: "medium", score: 0.5, routeReady: false, missingEvidence: [], warnings: ["check opening"], provenance: [] },
    ...overrides,
  };
}

describe("mapGeneratedRouteDraftValue / transferMapRouteToDraft", () => {
  it("transfers the exact Route, order, alternatives, and proof as a map-generated draft", () => {
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(generateResponse(), storage, NOW)).toBe(true);

    const parsed = readPlanRouteDraftEnvelope(storage, NOW);
    expect(parsed?.origin).toBe("map-generated");
    expect(parsed?.value.outcome).toBe("unanchored");
    expect(parsed?.value.stops.map((stop) => stop.venueId)).toEqual(["venue-a", "venue-b", "venue-c"]);
    expect(parsed?.value.stops[0].alternatives).toEqual([{ venueId: "venue-x", venueName: "Venue X" }]);
    expect(parsed?.value.groundingProof).toEqual(expect.any(String));
    expect(parsed?.value.operationKey).toBe("operation-1");
    expect(parsed?.value.transportBasis).toBe("straight-line");
    expect(parsed?.value.warnings).toEqual(["check opening"]);
    expect(parsed?.value.routeTotals).toMatchObject({ stopCount: 3, distanceBasis: "straight-line" });
    expect(parsed?.value.planningConfidence).toMatchObject({ level: "medium" });
    expect(parsed?.value.nightContext).toMatchObject({ daypart: "evening", partyType: "friends" });
    expect(parsed?.value.anchorVenueId).toBeNull();
  });

  it("carries an anchored Route with the anchor kept at Stop 1", () => {
    const storage = memoryStorage();
    transferMapRouteToDraft(generateResponse({
      outcome: "route", anchored: true, anchorVenueId: "venue-a", anchorSource: "near",
    }), storage, NOW);
    const parsed = readPlanRouteDraftEnvelope(storage, NOW);
    expect(parsed?.value.outcome).toBe("route");
    expect(parsed?.value.anchorVenueId).toBe("venue-a");
    expect(parsed?.value.anchorSource).toBe("near");
    expect(parsed?.value.stops[0].venueId).toBe("venue-a");
  });

  it("writes nothing for a malformed or empty Route (caller falls back)", () => {
    const storage = memoryStorage();
    expect(mapGeneratedRouteDraftValue({ stops: undefined })).toBeNull();
    expect(mapGeneratedRouteDraftValue(null)).toBeNull();
    expect(mapGeneratedRouteDraftValue({ stops: [{ venueName: "no id" }] })).toBeNull();
    expect(transferMapRouteToDraft({ stops: [] }, storage, NOW)).toBe(false);
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
  });

  it("recovers an ungrounded Route when the proof is missing", () => {
    const storage = memoryStorage();
    expect(transferMapRouteToDraft(generateResponse({ groundingProof: undefined }), storage, NOW)).toBe(true);
    expect(readPlanRouteDraftEnvelope(storage, NOW)?.value.groundingProof).toBeNull();
  });

  it("stays non-destructive when storage throws", () => {
    const storage = memoryStorage({ alwaysThrow: true });
    expect(() => transferMapRouteToDraft(generateResponse(), storage, NOW)).not.toThrow();
    expect(transferMapRouteToDraft(generateResponse(), storage, NOW)).toBe(false);
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
  });

  it("is idempotent across a duplicate navigation", () => {
    const storage = memoryStorage();
    transferMapRouteToDraft(generateResponse(), storage, NOW);
    const first = readPlanRouteDraftEnvelope(storage, NOW);
    transferMapRouteToDraft(generateResponse(), storage, NOW);
    const second = readPlanRouteDraftEnvelope(storage, NOW);
    expect(second?.value.stops.map((stop) => stop.venueId)).toEqual(first?.value.stops.map((stop) => stop.venueId));
    expect(second?.value.operationKey).toBe(first?.value.operationKey);
  });
});
