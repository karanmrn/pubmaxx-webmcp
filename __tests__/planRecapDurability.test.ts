import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) => request.headers.get("x-test-user"),
}));

import {
  GET as LIST_PENDING,
  PUT as UPSERT_PENDING,
  POST as CLAIM_PENDING,
} from "@/app/api/me/pending-plan-recaps/route";
import { POST as SAVE_RECAP } from "@/app/api/plans/[id]/recap/route";
import { __resetNightMemoryStore, listNightMemories, listNightMoments } from "@/lib/nightMemoryStore";
import { pendingPlanRecapFromCompletion } from "@/lib/planRecap";
import { preferFresherPendingPlanRecap } from "@/lib/planRecapSync.client";
import {
  __resetPendingPlanRecapStore,
  pendingPlanRecapStore,
} from "@/lib/pendingPlanRecapStore";
import { __resetMemoryPlans, planStore } from "@/lib/planStore";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Plan recap durability: complete → refresh → claim → Memory", () => {
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
      idempotencyKey: "recap-durability-arrival",
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

  it("parks a draft under owner scope across refresh, then claim creates one private Memory", async () => {
    const fixture = await completedPlan();
    const recap = {
      ...pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit"),
      stops: pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit").stops.map((stop) => ({
        ...stop,
        caption: stop.position === 0 ? "First pint of the night" : "",
      })),
    };

    // Complete path: signed-in writer parks the device draft on the account.
    const upserted = await UPSERT_PENDING(new Request("http://localhost/api/me/pending-plan-recaps", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ recap }),
    }));
    expect(upserted.status).toBe(200);
    expect(await upserted.json()).toMatchObject({
      private: true,
      draft: { completionId: fixture.completion.id, title: "Thursday orbit" },
    });

    // Refresh: owner-scoped draft is still there; no Memory yet.
    const refreshed = await LIST_PENDING(new Request("http://localhost/api/me/pending-plan-recaps", {
      headers: { "x-test-user": "user-1" },
    }));
    expect(refreshed.status).toBe(200);
    const listed = await refreshed.json() as {
      drafts: Array<{ completionId: string }>;
      memoryCompletionIds: string[];
    };
    expect(listed.drafts).toHaveLength(1);
    expect(listed.memoryCompletionIds).toEqual([]);
    expect(JSON.stringify(listed)).not.toContain("memberToken");
    expect(JSON.stringify(listed)).not.toContain("latitude");
    expect(JSON.stringify(listed)).not.toContain("visibility\":\"public");

    // Explicit keep-device leaves Memories empty.
    const kept = await CLAIM_PENDING(new Request("http://localhost/api/me/pending-plan-recaps", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ action: "claim", choice: "keep-device" }),
    }));
    expect(kept.status).toBe(200);
    expect(await listNightMemories("user-1")).toHaveLength(0);

    // Claim bring-device promotes to one private Memory (idempotent on repeat).
    const claimBody = {
      action: "claim",
      choice: "bring-device",
      items: [{ recap, memberToken: fixture.memberToken }],
    };
    const claimed = await CLAIM_PENDING(new Request("http://localhost/api/me/pending-plan-recaps", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify(claimBody),
    }));
    expect(claimed.status).toBe(201);
    const claimPayload = await claimed.json() as {
      claimed: boolean;
      private: boolean;
      memories: Array<{ memory: { planCompletionId: string; visibility: string }; moments: unknown[] }>;
    };
    expect(claimPayload).toMatchObject({ claimed: true, private: true });
    expect(claimPayload.memories).toHaveLength(1);
    expect(claimPayload.memories[0]?.memory).toMatchObject({
      planCompletionId: fixture.completion.id,
      visibility: "private",
    });
    expect(JSON.stringify(claimPayload)).not.toContain("\"public\"");

    const again = await CLAIM_PENDING(new Request("http://localhost/api/me/pending-plan-recaps", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify(claimBody),
    }));
    expect(again.status).toBe(201);

    const memories = await listNightMemories("user-1");
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      planCompletionId: fixture.completion.id,
      visibility: "private",
      title: "Thursday orbit",
    });
    const moments = await listNightMoments("user-1", memories[0]!.id);
    expect(moments).toHaveLength(3);
    expect(moments.some((moment) => moment.caption === "First pint of the night")).toBe(true);
    expect(moments.every((moment) => moment.visibility === "private")).toBe(true);

    // Draft is spent after successful claim.
    expect(await pendingPlanRecapStore().list("user-1")).toHaveLength(0);
  });

  it("save route still creates one Memory per completionId and clears the owner draft", async () => {
    const fixture = await completedPlan();
    const recap = pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit");
    await pendingPlanRecapStore().upsert("user-1", recap);

    const request = () => new Request(`http://localhost/api/plans/${fixture.plan.plan.id}/recap`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ memberToken: fixture.memberToken, recap }),
    });
    expect((await SAVE_RECAP(request(), ctx(fixture.plan.plan.id))).status).toBe(201);
    expect((await SAVE_RECAP(request(), ctx(fixture.plan.plan.id))).status).toBe(201);
    expect(await listNightMemories("user-1")).toHaveLength(1);
    expect(await pendingPlanRecapStore().list("user-1")).toHaveLength(0);
  });

  it("rejects claim without auth and without a valid member capability", async () => {
    const fixture = await completedPlan();
    const recap = pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit");
    const signedOut = await CLAIM_PENDING(new Request("http://localhost/api/me/pending-plan-recaps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "claim",
        choice: "bring-device",
        items: [{ recap, memberToken: fixture.memberToken }],
      }),
    }));
    expect(signedOut.status).toBe(401);

    const forged = await CLAIM_PENDING(new Request("http://localhost/api/me/pending-plan-recaps", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({
        action: "claim",
        choice: "bring-device",
        items: [{ recap, memberToken: "forged-token" }],
      }),
    }));
    expect(forged.status).toBe(403);
    expect(await listNightMemories("user-1")).toHaveLength(0);
  });

  it("does not park a conflicted save under owner scope", async () => {
    const fixture = await completedPlan();
    const recap = {
      ...pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit"),
      stops: pendingPlanRecapFromCompletion(fixture.completion, "Thursday orbit").stops.map((stop, index) => ({
        ...stop,
        venueId: `tampered-${index}`,
      })),
    };
    const response = await SAVE_RECAP(
      new Request(`http://localhost/api/plans/${fixture.plan.plan.id}/recap`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": "user-1" },
        body: JSON.stringify({ memberToken: fixture.memberToken, recap }),
      }),
      ctx(fixture.plan.plan.id),
    );
    expect(response.status).toBe(409);
    expect(await pendingPlanRecapStore().list("user-1")).toHaveLength(0);
  });

  it("prefers the fresher of local and owner drafts", async () => {
    const fixture = await completedPlan();
    const older = pendingPlanRecapFromCompletion(
      fixture.completion,
      "Older",
      "2026-07-16T23:01:00.000Z",
    );
    const newer = { ...older, title: "Newer", savedAt: "2026-07-16T23:05:00.000Z" };
    expect(preferFresherPendingPlanRecap(older, newer)?.title).toBe("Newer");
    expect(preferFresherPendingPlanRecap(newer, older)?.title).toBe("Newer");
    expect(preferFresherPendingPlanRecap(newer, null)?.title).toBe("Newer");
  });
});
