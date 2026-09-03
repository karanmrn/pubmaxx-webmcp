import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as CREATE } from "@/app/api/plans/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as CREATE_INVITE } from "@/app/api/plans/[id]/invites/route";
import { POST as ACTION } from "@/app/api/plans/[id]/actions/route";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { mintPlanGroundingProof } from "@/lib/planGrounding.server";
import type { PlanState } from "@/lib/plan";

const URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const VITEST_PLAN_SIGNING_SECRET = process.env.PLAN_IDEMPOTENCY_SECRET;
const payload = {
  title: "Retry-safe Friday",
  startTime: "2026-07-16T19:00:00.000Z",
  creatorName: "Host",
  // Deliberately forged: the endpoint must derive attribution from canonical
  // venue resolution instead of reflecting this client field.
  grounded: true,
  stops: [{ venueId: "venue-xjf3n0" }, { venueId: "venue-16pnwmm" }],
};

async function create(key: string, body: Record<string, unknown> = payload) {
  const response = await CREATE(new Request(URL, {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() as { plan: PlanState; memberToken: string; code?: string; created?: boolean; grounded?: boolean; eventTokens?: Record<string, string> } };
}

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
});
afterEach(() => {
  delete process.env.PLAN_IDEMPOTENCY_SECRET;
  delete process.env.RATE_LIMIT_SALT;
});

describe("Plan mutation idempotency", () => {
  it("requires a retry key for every material public mutation", async () => {
    const missingCreate = await CREATE(new Request(URL, { method: "POST", body: JSON.stringify(payload) }));
    expect(missingCreate.status).toBe(400);
    expect(await missingCreate.json()).toMatchObject({ code: "PLAN_IDEMPOTENCY_KEY_REQUIRED" });

    const host = await create("create-key-required-check");
    const id = host.body.plan.plan.id;
    const missingJoin = await JOIN(new Request(`${URL}/${id}/join`, { method: "POST", body: JSON.stringify({ name: "Guest" }) }), ctx(id));
    expect(missingJoin.status).toBe(400);
    const missingAction = await ACTION(new Request(`${URL}/${id}/actions`, {
      method: "POST", headers: { authorization: `Bearer ${host.body.memberToken}` }, body: JSON.stringify({ type: "arrived", stopPosition: 0 }),
    }), ctx(id));
    expect(missingAction.status).toBe(400);
  });

  it("recovers the original Plan and host capability after a repeated create", async () => {
    const first = await create("create-recovery-1");
    const replay = await create("create-recovery-1");
    expect(first.response.status).toBe(201);
    expect(replay.response.status).toBe(201);
    expect(replay.body.plan.plan.id).toBe(first.body.plan.plan.id);
    expect(replay.body.memberToken).toBe(first.body.memberToken);
    expect(first.body).toMatchObject({ created: true, grounded: false });
    expect(replay.body).toMatchObject({ created: false, grounded: false });
    expect(first.body).toHaveProperty("eventTokens.planAccepted");
    expect(replay.body).toMatchObject({ eventTokens: first.body.eventTokens });

    const conflict = await create("create-recovery-1", { ...payload, title: "Different intent" });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "PLAN_IDEMPOTENCY_CONFLICT" });
  });

  it("fails before creating a Plan and succeeds cleanly after signing recovers", async () => {
    process.env.PLAN_IDEMPOTENCY_SECRET = "too-short";
    const unavailable = await create("create-signing-retry");

    expect(unavailable.response.status).toBe(503);
    expect(unavailable.response.headers.get("retry-after")).toBe("60");
    expect(unavailable.body).toMatchObject({ code: "PLAN_SIGNING_UNAVAILABLE", retryable: true });

    process.env.PLAN_IDEMPOTENCY_SECRET = VITEST_PLAN_SIGNING_SECRET!;
    const retry = await create("create-signing-retry");
    expect(retry.response.status).toBe(201);
    expect(retry.body).toMatchObject({ created: true, eventTokens: {
      planAccepted: expect.any(String),
      meaningfulCoreAction: expect.any(String),
    } });
  });

  it("attributes grounding only to an intact server-minted candidate proof", async () => {
    const stops = [
      { venueId: "venue-xjf3n0" },
      { venueId: "venue-16pnwmm" },
      { venueId: "venue-1f5ygjb" },
    ];
    const proof = mintPlanGroundingProof(stops.map((stop) => stop.venueId), "grounded-create-proof");
    const accepted = await create("grounded-create-proof", { ...payload, stops, groundingProof: proof });
    const edited = await create("edited-create-proof", {
      ...payload,
      stops: [stops[0], stops[1], { venueId: "venue-3h52h" }],
      groundingProof: mintPlanGroundingProof(stops.map((stop) => stop.venueId), "edited-create-proof"),
    });

    expect(accepted.body).toMatchObject({ created: true, grounded: true });
    expect(edited.body).toMatchObject({ created: true, grounded: false });
  });

  it("keeps create-time grounding stable on replay after proof expiry", async () => {
    const issuedAt = Date.parse("2026-07-20T12:00:00.000Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(issuedAt);
    const stops = [
      { venueId: "venue-xjf3n0" },
      { venueId: "venue-16pnwmm" },
      { venueId: "venue-1f5ygjb" },
    ];
    const key = "grounding-expiry-replay";
    const body = { ...payload, stops, groundingProof: mintPlanGroundingProof(stops.map((stop) => stop.venueId), key, issuedAt) };
    const first = await create(key, body);
    clock.mockReturnValue(issuedAt + 3 * 60 * 60 * 1_000);
    const replay = await create(key, body);
    const alteredReplay = await create(key, { ...payload, stops });

    expect(first.body).toMatchObject({ created: true, grounded: true });
    expect(replay.body).toMatchObject({ created: false, grounded: true, eventTokens: first.body.eventTokens });
    expect(alteredReplay.response.status).toBe(409);
    clock.mockRestore();
  });

  it("does not add a second guest when an ordinary join response is retried", async () => {
    const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const host = await create("create-for-join", { ...payload, startTime });
    const id = host.body.plan.plan.id;
    const inviteResponse = await CREATE_INVITE(new Request(`${URL}/${id}/invites`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${host.body.memberToken}`,
        "idempotency-key": "join-recovery-invite",
      },
      body: JSON.stringify({ expiresInMinutes: 30 }),
    }), ctx(id));
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as { token: string };
    const request = (name: string) => JOIN(new Request(`${URL}/${id}/join`, {
      method: "POST",
      headers: { "idempotency-key": "join-recovery-1" },
      body: JSON.stringify({ name, inviteToken: invite.token }),
    }), ctx(id));
    const first = await request("Guest");
    const firstBody = await first.json() as { memberToken: string; plan: PlanState };
    const replay = await request("Guest");
    const replayBody = await replay.json() as { memberToken: string; plan: PlanState };
    expect(replay.status).toBe(200);
    expect(replayBody.memberToken).toBe(firstBody.memberToken);
    expect(replayBody.plan.crew).toHaveLength(2);
    const conflict = await request("Another guest");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "PLAN_COLLAB_CONFLICT" });
  });

  it("records one atomic live action for repeated delivery", async () => {
    const host = await create("create-for-action");
    const id = host.body.plan.plan.id;
    const request = (type: "arrived" | "skipped") => ACTION(new Request(`${URL}/${id}/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${host.body.memberToken}`, "idempotency-key": "action-recovery-1" },
      body: JSON.stringify({ type, stopPosition: 0 }),
    }), ctx(id));
    expect((await request("arrived")).status).toBe(201);
    const replay = await request("arrived");
    const state = await replay.json() as PlanState;
    expect(replay.status).toBe(201);
    expect(state.actions).toHaveLength(1);
    expect(state.plan.status).toBe("active");
    const conflict = await request("skipped");
    expect(conflict.status).toBe(409);
  });

  it("scopes identical action keys to the acting member", async () => {
    const host = await create("create-for-actor-scope");
    const id = host.body.plan.plan.id;
    const guest = await memoryPlanStore.join(id, "Crew", { collaborationAuthorized: true, idempotencyKey: "actor-scope-join" });
    expect(guest.ok).toBe(true);
    if (!guest.ok) return;
    expect((await memoryPlanStore.addAction(id, host.body.memberToken, { type: "arrived", stopPosition: 0, idempotencyKey: "shared-action-key" })).ok).toBe(true);
    expect((await memoryPlanStore.addAction(id, guest.memberToken, { type: "arrived", stopPosition: 0, idempotencyKey: "shared-action-key" })).ok).toBe(true);
    const state = await memoryPlanStore.get(id);
    expect(state?.actions).toHaveLength(2);
    expect(new Set((state?.actions ?? []).map((action) => action.id)).size).toBe(2);
  });
});

describe("configured plan-write migration", () => {
  it("keeps replay lookup and each logical action inside one service-role transaction", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260716200000_0035_plan_write_idempotency.sql"), "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql.match(/pg_advisory_xact_lock\(hashtextextended\('plan:join:' \|\| p_plan_id::text, 0\)\)/g)).toHaveLength(2);
    expect(sql).toContain("create_plan_idempotent_atomic");
    expect(sql).toContain("join_plan_idempotent_atomic");
    expect(sql).toContain("redeem_plan_invite_idempotent_atomic");
    expect(sql).toMatch(/add_plan_action_idempotent_atomic[\s\S]*insert into public\.plan_actions[\s\S]*update public\.plans set status = 'active'/);
    expect(sql).toMatch(/revoke all on function public\.add_plan_action_idempotent_atomic/);
    expect(sql).toMatch(/grant execute on function public\.add_plan_action_idempotent_atomic[\s\S]*to service_role/);
  });
});
