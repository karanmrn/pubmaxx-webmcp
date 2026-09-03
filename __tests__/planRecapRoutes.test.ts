import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) => request.headers.get("x-test-user"),
}));

import { POST as SAVE_RECAP } from "@/app/api/plans/[id]/recap/route";
import { __resetNightMemoryStore, listNightMemories, listNightMoments } from "@/lib/nightMemoryStore";
import { pendingPlanRecapFromCompletion } from "@/lib/planRecap";
import { __resetPendingPlanRecapStore } from "@/lib/pendingPlanRecapStore";
import { __resetMemoryPlans, planStore } from "@/lib/planStore";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("completed Plan recap promotion", () => {
  beforeEach(() => {
    __resetMemoryPlans();
    __resetNightMemoryStore();
    __resetPendingPlanRecapStore();
  });

  async function completedPlan() {
    const created = await planStore().create({
      title: "Thursday orbit",
      creatorName: "Host",
      startTime: "2026-07-16T19:00:00.000Z",
      stops: [
        { venueId: "venue-a", venueName: "First Pub" },
        { venueId: "venue-b", venueName: "Second Pub" },
        { venueId: "venue-c", venueName: "Third Pub" },
      ],
    });
    if (!created.ok) throw new Error("fixture failed");
    const arrival = await planStore().addAction(created.plan.plan.id, created.memberToken, {
      type: "arrived",
      stopPosition: 0,
      idempotencyKey: "recap-fixture-arrival",
    });
    if (!arrival.ok) throw new Error("arrival fixture failed");
    const completed = await planStore().complete(created.plan.plan.id, created.memberToken, {
      expectedRouteRevision: 1,
      ending: "get_home",
      endingSelection: {
        kind: "get_home",
        optionId: "transport:nearest-station",
        evidenceSnapshot: { label: "Nearest station", confidence: "unknown" },
      },
    });
    if (!completed.ok) throw new Error("completion fixture failed");
    return { ...created, completion: completed.completion };
  }

  it("keeps signed-out recaps local and rejects invalid member capabilities", async () => {
    const fixture = await completedPlan();
    const recap = pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit");
    const signedOut = await SAVE_RECAP(new Request(`http://localhost/api/plans/${fixture.plan.plan.id}/recap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberToken: fixture.memberToken, recap }),
    }), ctx(fixture.plan.plan.id));
    expect(signedOut.status).toBe(401);

    const forbidden = await SAVE_RECAP(new Request(`http://localhost/api/plans/${fixture.plan.plan.id}/recap`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ memberToken: "forged", recap }),
    }), ctx(fixture.plan.plan.id));
    expect(forbidden.status).toBe(403);
  });

  it("creates one idempotent private Memory with canonical route Moments", async () => {
    const fixture = await completedPlan();
    const original = pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit");
    const recap = { ...original, stops: original.stops.map((stop) => ({ ...stop, caption: `Caption ${stop.position + 1}` })) };
    const request = () => new Request(`http://localhost/api/plans/${fixture.plan.plan.id}/recap`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ memberToken: fixture.memberToken, recap }),
    });
    expect((await SAVE_RECAP(request(), ctx(fixture.plan.plan.id))).status).toBe(201);
    expect((await SAVE_RECAP(request(), ctx(fixture.plan.plan.id))).status).toBe(201);
    const memories = await listNightMemories("user-1");
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ planCompletionId: fixture.completion.id, visibility: "private" });
    expect(await listNightMoments("user-1", memories[0]!.id)).toHaveLength(3);
  });

  it("rejects a client-tampered route snapshot", async () => {
    const fixture = await completedPlan();
    const recap = pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit");
    recap.stops[0] = { ...recap.stops[0]!, venueId: "different-venue" };
    const response = await SAVE_RECAP(new Request(`http://localhost/api/plans/${fixture.plan.plan.id}/recap`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ memberToken: fixture.memberToken, recap }),
    }), ctx(fixture.plan.plan.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "RECAP_CONFLICT", retryable: false });
  });
});
