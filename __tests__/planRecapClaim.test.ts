import { describe, expect, it } from "vitest";

import {
  confirmedPlanRecapClaim,
  cleanPlanRecapClaimItems,
  planRecapClaimMergeState,
} from "@/lib/planRecapClaim";
import { pendingPlanRecapFromCompletion, type PendingPlanRecap } from "@/lib/planRecap";
import type { PlanCompletionDTO } from "@/lib/plan";

const PLAN_ID = "6ab5ca40-836b-4970-9477-d1779fdd31ab";

const completion: PlanCompletionDTO = {
  id: "11111111-2222-4333-8444-555555555555",
  planId: PLAN_ID,
  ending: "get_home",
  endingSelection: null,
  terminalVenueId: "venue-b",
  finalPintDropId: null,
  routeRevision: 1,
  routeSnapshot: [
    { venueId: "venue-a", venueName: "First Pub", position: 0 },
    { venueId: "venue-b", venueName: "Second Pub", position: 1 },
  ],
  qualifyingArrival: {
    actionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    stopPosition: 0,
    arrivedAt: "2026-07-16T21:30:00.000Z",
  },
  completedAt: "2026-07-16T23:00:00.000Z",
};

function draft(overrides: Partial<PendingPlanRecap> = {}): PendingPlanRecap {
  return {
    ...pendingPlanRecapFromCompletion(completion, "Thursday orbit"),
    ...overrides,
  };
}

describe("planRecapClaim merge detection", () => {
  it("offers bring only for device drafts not already on the account", () => {
    const device = [draft(), draft({
      completionId: "22222222-2222-4333-8444-555555555555",
      title: "Second night",
    })];
    expect(planRecapClaimMergeState(device, [completion.id])).toMatchObject({
      kind: "device-only",
      recaps: [{ completionId: "22222222-2222-4333-8444-555555555555" }],
    });
    expect(planRecapClaimMergeState(device, device.map((row) => row.completionId))).toEqual({
      kind: "none",
    });
  });

  it("never writes the account on keep-device and writes on bring-device", () => {
    const state = planRecapClaimMergeState([draft()], []);
    if (state.kind !== "device-only") throw new Error("expected device-only");
    expect(confirmedPlanRecapClaim(state, "keep-device")).toEqual({
      writesAccount: false,
      recaps: state.recaps,
    });
    expect(confirmedPlanRecapClaim(state, "bring-device")).toEqual({
      writesAccount: true,
      recaps: state.recaps,
    });
  });

  it("validates claim items without accepting empty or oversized batches", () => {
    const recap = draft();
    expect(cleanPlanRecapClaimItems([{ recap, memberToken: "token" }])).toEqual([
      { recap, memberToken: "token" },
    ]);
    expect(cleanPlanRecapClaimItems([])).toBeNull();
    expect(cleanPlanRecapClaimItems([{ recap, memberToken: "" }])).toBeNull();
    expect(cleanPlanRecapClaimItems([{ recap: { ...recap, title: "" }, memberToken: "token" }])).toBeNull();
  });
});
