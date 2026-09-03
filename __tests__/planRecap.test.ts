import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discardPendingPlanRecap,
  ensurePendingPlanRecap,
  isPendingPlanRecapResolved,
  listPendingPlanRecaps,
  pendingPlanRecapFromCompletion,
  readPendingPlanRecap,
  resolvePendingPlanRecap,
  validatePendingPlanRecap,
  writePendingPlanRecap,
} from "@/lib/planRecap";
import type { PlanCompletionDTO } from "@/lib/plan";
import {
  confirmedPlanRecapClaim,
  planRecapClaimMergeState,
} from "@/lib/planRecapClaim";

const PLAN_ID = "6ab5ca40-836b-4970-9477-d1779fdd31ab";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const completion: PlanCompletionDTO = {
  id: "11111111-2222-4333-8444-555555555555",
  planId: PLAN_ID,
  ending: "get_home",
  endingSelection: {
    kind: "get_home",
    optionId: "transport:victoria",
    evidenceSnapshot: {
      label: "Victoria",
      confidence: "medium",
      source: "TfL journey and last-service signal",
    },
  },
  terminalVenueId: "venue-b",
  finalPintDropId: null,
  routeRevision: 2,
  routeSnapshot: [
    { venueId: "venue-b", venueName: "Second Pub", position: 1 },
    { venueId: "venue-a", venueName: "First Pub", position: 0 },
    { venueId: "venue-c", venueName: "Third Pub", position: 2 },
  ],
  qualifyingArrival: {
    actionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    stopPosition: 0,
    arrivedAt: "2026-07-16T21:30:00.000Z",
  },
  completedAt: "2026-07-16T23:00:00.000Z",
};

describe("PendingPlanRecap storage", () => {
  beforeEach(() => {
    const listeners = new Map<string, Set<EventListener>>();
    (globalThis as { window?: unknown }).window = {
      localStorage: memoryStorage(),
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
      addEventListener: (name: string, listener: EventListener) => {
        const set = listeners.get(name) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(name, set);
      },
      removeEventListener: (name: string, listener: EventListener) => listeners.get(name)?.delete(listener),
    };
  });

  afterEach(() => delete (globalThis as { window?: unknown }).window);

  it("creates, validates, persists, and explicitly discards a route-only recap", () => {
    const recap = pendingPlanRecapFromCompletion(completion, "Thursday orbit", "2026-07-16T23:01:00.000Z");
    expect(recap.stops.map((stop) => stop.venueName)).toEqual(["First Pub", "Second Pub", "Third Pub"]);
    writePendingPlanRecap({ ...recap, stops: recap.stops.map((stop) => stop.position === 1 ? { ...stop, caption: "Approved private caption" } : stop) });
    expect(readPendingPlanRecap(PLAN_ID)).toMatchObject({
      version: 1,
      title: "Thursday orbit",
      endingSelection: expect.objectContaining({ optionId: "transport:victoria" }),
      stops: [expect.anything(), expect.objectContaining({ caption: "Approved private caption" }), expect.anything()],
    });
    const raw = window.localStorage.getItem(`pubmaxx.pending-plan-recap.v1:${PLAN_ID}`) ?? "";
    expect(raw).not.toContain("latitude");
    expect(raw).not.toContain("memberToken");
    discardPendingPlanRecap(PLAN_ID);
    expect(readPendingPlanRecap(PLAN_ID)).toBeNull();
  });

  it("fails closed on newer versions, coordinates, malformed ordering, and oversized captions", () => {
    const recap = pendingPlanRecapFromCompletion(completion, "Thursday orbit");
    expect(validatePendingPlanRecap({ ...recap, version: 2 })).toBeNull();
    expect(validatePendingPlanRecap({ ...recap, stops: recap.stops.map((stop) => ({ ...stop, caption: "x".repeat(501) })) })).toBeNull();
    expect(validatePendingPlanRecap({ ...recap, stops: recap.stops.map((stop) => ({ ...stop, position: 2 })) })).toBeNull();
  });

  it("does not recreate a completion after explicit discard or successful promotion", () => {
    const discarded = ensurePendingPlanRecap(completion, "Thursday orbit");
    expect(discarded).not.toBeNull();
    resolvePendingPlanRecap(discarded!, "discarded");
    expect(isPendingPlanRecapResolved(PLAN_ID, completion.id)).toBe(true);
    expect(ensurePendingPlanRecap(completion, "Thursday orbit")).toBeNull();

    const next = { ...completion, id: "99999999-2222-4333-8444-555555555555" };
    const saved = ensurePendingPlanRecap(next, "Next recap");
    resolvePendingPlanRecap(saved!, "saved");
    expect(ensurePendingPlanRecap(next, "Next recap")).toBeNull();
  });

  it("lists device drafts for account claim merge without leaking public fields", () => {
    const recap = pendingPlanRecapFromCompletion(completion, "Thursday orbit");
    writePendingPlanRecap(recap);
    const listed = listPendingPlanRecaps();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.completionId).toBe(completion.id);
    const merge = planRecapClaimMergeState(listed, []);
    expect(merge.kind).toBe("device-only");
    if (merge.kind !== "device-only") throw new Error("expected device-only");
    expect(confirmedPlanRecapClaim(merge, "bring-device").writesAccount).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("memberToken");
    expect(JSON.stringify(listed)).not.toContain("latitude");
  });
});
