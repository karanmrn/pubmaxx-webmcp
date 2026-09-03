import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  PLAN_DRAFT_KEY,
  PLAN_DRAFT_TTL_MS,
  PLAN_DRAFT_V2_KEY,
  parsePlanDraftEnvelope,
  readPlanDraftEnvelope,
  writePlanDraftEnvelope,
  type ParsedPlanDraft,
  type StoredPlanDraft,
} from "@/lib/planDraft";
import { arbitratePlanDrafts } from "@/lib/planDraftArbitration";
import {
  PLAN_INTAKE_MAX_RAW_BYTES,
  PLAN_INTAKE_STORAGE_KEY,
  createPlanIntakeDraft,
  parsePlanIntakeDraftWithMetadata,
  readPlanIntakeDraftWithMetadata,
  writePlanIntakeDraft,
  type ParsedPlanIntakeDraft,
} from "@/lib/planIntake";
import {
  PLAN_ROUTE_DRAFT_KEY,
  PLAN_ROUTE_DRAFT_TTL_MS,
  PLAN_ROUTE_DRAFT_V2_KEY,
  parsePlanRouteDraftEnvelope,
  parsePlanRouteDraftV2,
  readPlanRouteDraftEnvelope,
  writePlanRouteDraftEnvelope,
  type ParsedPlanRouteDraft,
} from "@/lib/planRouteDraft";
import { createPlanningIntent } from "@/lib/planningIntent";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function memoryStorage(options: { throwOnSet?: number } = {}): Storage {
  const values = new Map<string, string>();
  let writes = 0;
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      writes += 1;
      if (options.throwOnSet === writes) throw new Error("blocked");
      values.set(key, String(value));
    },
  };
}

function storedPlan(overrides: Partial<StoredPlanDraft> = {}): StoredPlanDraft {
  return {
    title: "Friday Plan",
    creatorName: "K",
    startTime: "2026-07-24T18:00:00.000Z",
    conciergeQuery: "Quiet pints",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A" }],
    ...overrides,
  };
}

function v2Plan(savedAt: number, overrides: Partial<StoredPlanDraft> = {}): ParsedPlanDraft {
  const storage = memoryStorage();
  expect(writePlanDraftEnvelope(storedPlan(overrides), "manual", storage, savedAt).v2).toBe(true);
  const parsed = readPlanDraftEnvelope(storage, savedAt);
  expect(parsed).not.toBeNull();
  return parsed as ParsedPlanDraft;
}

function intake(savedAt: number, start = "2026-07-24T19:00:00.000Z"): ParsedPlanIntakeDraft {
  const storage = memoryStorage();
  const blank = createPlanIntakeDraft();
  writePlanIntakeDraft({
    ...blank,
    currentStep: "group-size",
    settledSteps: ["area", "time-window"],
    answers: {
      ...blank.answers,
      area: "soho",
      timeWindow: "evening",
      exactStartIso: start,
    },
  }, storage, savedAt);
  const parsed = readPlanIntakeDraftWithMetadata(storage, savedAt);
  expect(parsed).not.toBeNull();
  return parsed as ParsedPlanIntakeDraft;
}

function routeValue(overrides: Partial<ParsedPlanRouteDraft["value"]> = {}): ParsedPlanRouteDraft["value"] {
  return {
    anchorVenueId: "venue-a",
    anchorSource: "near",
    outcome: "route",
    stops: [
      { key: 1, venueId: "venue-a", venueName: "Venue A", alternatives: [] },
      { key: 2, venueId: "venue-b", venueName: "Venue B", alternatives: [] },
      { key: 3, venueId: "venue-c", venueName: "Venue C", alternatives: [] },
    ],
    alternatives: [],
    nightContext: null,
    routeTotals: null,
    transportBasis: null,
    planningConfidence: null,
    warnings: [],
    groundingProof: fakeProof(NOW + 60 * 60 * 1000),
    operationKey: "operation-1",
    routeRevision: 1,
    routeStale: false,
    ...overrides,
  };
}

function routeDraft(savedAt: number, overrides: Partial<ParsedPlanRouteDraft["value"]> = {}): ParsedPlanRouteDraft {
  const storage = memoryStorage();
  expect(writePlanRouteDraftEnvelope(routeValue(overrides), "plan-generated", storage, savedAt).v2).toBe(true);
  const parsed = readPlanRouteDraftEnvelope(storage, savedAt);
  expect(parsed).not.toBeNull();
  return parsed as ParsedPlanRouteDraft;
}

function intent() {
  const value = createPlanningIntent({
    source: "near",
    cityId: "london",
    acceptedVenueId: "venue-intent",
    acceptedArea: { kind: "night-patch", id: "shoreditch" },
    startsAt: "2026-07-24T20:00:00.000Z",
    displayEvidence: { kind: "directory", observedAt: null },
  }, NOW);
  expect(value).not.toBeNull();
  return value;
}

function fakeProof(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, expiresAt }), "utf8").toString("base64url");
  return `${payload}.not-a-trusted-signature`;
}

describe("V2 Plan draft migration", () => {
  it("dual-writes V1 and V2, then prefers the valid V2 envelope", () => {
    const storage = memoryStorage();
    const result = writePlanDraftEnvelope(storedPlan(), "template", storage, NOW);
    expect(result).toMatchObject({ v1: true, v2: true });
    expect(storage.getItem(PLAN_DRAFT_KEY)).not.toBeNull();
    expect(storage.getItem(PLAN_DRAFT_V2_KEY)).not.toBeNull();
    expect(readPlanDraftEnvelope(storage, NOW)).toMatchObject({
      storageVersion: 2,
      savedAt: "2026-07-24T12:00:00.000Z",
      origin: "template",
      legacy: false,
    });
  });

  it("falls back to populated legacy work without inventing savedAt", () => {
    const legacy = JSON.stringify(storedPlan());
    expect(parsePlanDraftEnvelope(null, legacy, NOW)).toMatchObject({
      storageVersion: 1,
      savedAt: null,
      expiresAt: null,
      legacy: true,
    });
  });

  it("rejects expired, oversized, and unknown-key V2 envelopes", () => {
    const storage = memoryStorage();
    writePlanDraftEnvelope(storedPlan(), "manual", storage, NOW);
    const raw = storage.getItem(PLAN_DRAFT_V2_KEY);
    expect(parsePlanDraftEnvelope(raw, null, NOW + PLAN_DRAFT_TTL_MS)).toBeNull();
    expect(parsePlanDraftEnvelope(JSON.stringify({
      ...JSON.parse(raw ?? "{}"),
      unexpected: true,
    }), null, NOW)).toBeNull();
    expect(parsePlanDraftEnvelope("x".repeat(20 * 1024 + 1), null, NOW)).toBeNull();
  });

  it("attempts both migration writes without throwing when storage fails", () => {
    const result = writePlanDraftEnvelope(storedPlan(), "manual", memoryStorage({ throwOnSet: 1 }), NOW);
    expect(result).toMatchObject({ v1: false, v2: true });
  });
});

describe("V2 Route draft migration", () => {
  it("dual-writes compatible Route drafts and preserves replay metadata", () => {
    const storage = memoryStorage();
    expect(writePlanRouteDraftEnvelope(routeValue(), "map-generated", storage, NOW)).toMatchObject({
      v1: true,
      v2: true,
    });
    expect(storage.getItem(PLAN_ROUTE_DRAFT_KEY)).not.toBeNull();
    expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).not.toBeNull();
    expect(readPlanRouteDraftEnvelope(storage, NOW)).toMatchObject({
      storageVersion: 2,
      origin: "map-generated",
      legacy: false,
      value: { operationKey: "operation-1", routeRevision: 1 },
    });
  });

  it("recovers a legacy Route without assigning it an age", () => {
    const raw = JSON.stringify({
      stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A", alternatives: [] }],
      nightContext: null,
      routeRevision: 2,
      routeStale: false,
      groundingProof: null,
      createOperationKey: "legacy-operation",
    });
    expect(parsePlanRouteDraftEnvelope(null, raw, NOW)).toMatchObject({
      storageVersion: 1,
      savedAt: null,
      legacy: true,
      value: { operationKey: "legacy-operation", routeRevision: 2 },
    });
  });

  it("keeps an unexpired proof only as display context and marks expired proof stale", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue({
      groundingProof: fakeProof(NOW + 1_000),
    }), "plan-generated", storage, NOW);
    const raw = storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
    expect(parsePlanRouteDraftV2(raw, NOW)).toMatchObject({
      value: { routeStale: false, groundingProof: expect.any(String) },
    });
    expect(parsePlanRouteDraftV2(raw, NOW + 1_001)).toMatchObject({
      value: { routeStale: true, groundingProof: null },
    });
  });

  it("rejects inconsistent outcome, anchor, and Stop counts", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "plan-generated", storage, NOW);
    const envelope = JSON.parse(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY) ?? "{}") as Record<string, unknown>;
    envelope.stops = [routeValue().stops[0]];
    expect(parsePlanRouteDraftV2(JSON.stringify(envelope), NOW)).toBeNull();

    const wrongAnchor = {
      ...envelope,
      stops: routeValue().stops,
      anchorVenueId: "venue-other",
    };
    expect(parsePlanRouteDraftV2(JSON.stringify(wrongAnchor), NOW)).toBeNull();
  });

  it("rejects expired envelopes and survives partial storage failure", () => {
    const storage = memoryStorage();
    writePlanRouteDraftEnvelope(routeValue(), "manual", storage, NOW);
    expect(parsePlanRouteDraftV2(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY), NOW + PLAN_ROUTE_DRAFT_TTL_MS)).toBeNull();
    expect(writePlanRouteDraftEnvelope(routeValue(), "manual", memoryStorage({ throwOnSet: 2 }), NOW))
      .toMatchObject({ v1: true, v2: false, envelope: null });
  });
});

describe("Plan intake metadata access", () => {
  it("preserves canonical savedAt for cross-draft precedence", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(createPlanIntakeDraft(), storage, NOW);
    expect(readPlanIntakeDraftWithMetadata(storage, NOW)).toMatchObject({
      storageVersion: 1,
      savedAt: "2026-07-24T12:00:00.000Z",
      legacy: false,
    });
    expect(parsePlanIntakeDraftWithMetadata(storage.getItem(PLAN_INTAKE_STORAGE_KEY), NOW)?.draft)
      .toEqual(createPlanIntakeDraft());
  });

  it("enforces the 12 KB bound in UTF-8 bytes", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(createPlanIntakeDraft(), storage, NOW);
    const envelope = JSON.parse(storage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    envelope.padding = "é".repeat(Math.floor(PLAN_INTAKE_MAX_RAW_BYTES / 2));
    const raw = JSON.stringify(envelope);
    expect(raw.length).toBeLessThan(PLAN_INTAKE_MAX_RAW_BYTES);
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(PLAN_INTAKE_MAX_RAW_BYTES);
    expect(parsePlanIntakeDraftWithMetadata(raw, NOW)).toBeNull();
  });
});

describe("pure Plan draft arbitration", () => {
  it("uses explicit URL surface and defaults only after clean arbitration", () => {
    expect(arbitratePlanDrafts({
      url: { surface: "map", selectedVenueId: null, replaceAnchor: false },
      defaults: {
        area: { kind: "night-patch", id: "camden" },
        startsAt: "2026-07-24T18:30:00.000Z",
        acceptedVenueId: "default-venue",
        title: "Untitled Plan",
      },
    })).toMatchObject({
      surface: { value: "map", source: "explicit-url" },
      acceptedVenueId: { value: "default-venue", source: "default" },
      area: { value: { kind: "night-patch", id: "camden" }, source: "default" },
      title: { value: "Untitled Plan", source: "default" },
      routePreview: null,
      conflicts: [],
      hydration: { status: "complete", defaultsMayWrite: true },
    });
  });

  it("uses newest valid V2 savedAt where Plan and intake time overlap", () => {
    const newerPlan = arbitratePlanDrafts({
      planDraft: v2Plan(NOW + 2_000),
      intakeDraft: intake(NOW + 1_000),
    });
    expect(newerPlan.startsAt).toEqual({
      value: "2026-07-24T18:00:00.000Z",
      source: "plan-v2",
    });
    expect(newerPlan.conflicts).toContainEqual(expect.objectContaining({ code: "draft-overlap" }));

    const newerIntake = arbitratePlanDrafts({
      planDraft: v2Plan(NOW + 1_000),
      intakeDraft: intake(NOW + 2_000),
    });
    expect(newerIntake.startsAt).toEqual({
      value: "2026-07-24T19:00:00.000Z",
      source: "intake-v1",
    });
  });

  it("keeps populated legacy Plan work ahead of a newer PlanningIntent", () => {
    const legacyPlan = parsePlanDraftEnvelope(null, JSON.stringify(storedPlan()), NOW);
    const result = arbitratePlanDrafts({
      planDraft: legacyPlan,
      planningIntent: intent(),
    });
    expect(result.acceptedVenueId).toEqual({ value: "venue-a", source: "plan-legacy" });
    expect(result.startsAt).toEqual({
      value: "2026-07-24T18:00:00.000Z",
      source: "plan-legacy",
    });
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      code: "intent-preserved-existing",
      recoveryAction: "review-existing-plan",
    }));
  });

  it("lets intent fill missing fields only, then remembered area, then defaults", () => {
    const fromIntent = arbitratePlanDrafts({
      planningIntent: intent(),
      rememberedArea: { kind: "patch", id: "camden" },
    });
    expect(fromIntent.acceptedVenueId).toEqual({
      value: "venue-intent",
      source: "planning-intent",
    });
    expect(fromIntent.area).toEqual({
      value: { kind: "night-patch", id: "shoreditch" },
      source: "planning-intent",
    });

    const withoutIntent = arbitratePlanDrafts({
      rememberedArea: { kind: "patch", id: "camden" },
      defaults: { acceptedVenueId: "default-venue" },
    });
    expect(withoutIntent.acceptedVenueId).toEqual({ value: "default-venue", source: "default" });
    expect(withoutIntent.area).toEqual({
      value: { kind: "night-patch", id: "camden" },
      source: "remembered-area",
    });
  });

  it("uses a valid non-empty Route draft for preview and marks replay stale", () => {
    const result = arbitratePlanDrafts({
      routeDraft: routeDraft(NOW),
      lastAppliedOperationKey: "operation-1",
    });
    expect(result.routePreview).toMatchObject({ value: { routeStale: true } });
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      code: "operation-replay",
      recoveryAction: "regenerate-route",
    }));
  });

  it("inspects B without replacing anchor A until Make it Stop 1 is explicit", () => {
    const plan = v2Plan(NOW);
    const inspected = arbitratePlanDrafts({
      planDraft: plan,
      url: { surface: "map", selectedVenueId: "venue-b", replaceAnchor: false },
    });
    expect(inspected.inspectionVenueId.value).toBe("venue-b");
    expect(inspected.acceptedVenueId.value).toBe("venue-a");
    expect(inspected.conflicts).toContainEqual(expect.objectContaining({
      code: "inspection-not-anchor",
      recoveryAction: "make-it-stop-1",
    }));

    const replaced = arbitratePlanDrafts({
      planDraft: plan,
      url: { surface: "map", selectedVenueId: "venue-b", replaceAnchor: true },
    });
    expect(replaced.acceptedVenueId).toEqual({ value: "venue-b", source: "explicit-url" });
    expect(replaced.conflicts).toContainEqual(expect.objectContaining({ code: "anchor-replaced" }));
  });

  it("is deterministic across duplicate-tab hydration and performs no writes", () => {
    const input = {
      planDraft: v2Plan(NOW),
      intakeDraft: intake(NOW + 1),
      routeDraft: routeDraft(NOW),
      planningIntent: intent(),
    };
    const first = arbitratePlanDrafts(input);
    const second = arbitratePlanDrafts(structuredClone(input));
    expect(second).toEqual(first);
  });
});
