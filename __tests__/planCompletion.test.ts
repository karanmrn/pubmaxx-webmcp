import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Plan completion has both durable and keyless backends. Pin this unit test to
// the keyless seam so Vercel credentials cannot turn it into a live database
// integration test during `npm run ci`.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
  };
});

// Route modules assert durable production configuration at import time. This
// suite deliberately exercises the keyless memory backend, so keep the runtime
// deployment guard outside the unit-test seam even when Vercel runs Vitest with
// VERCEL_ENV=production during a production build.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { POST as CREATE } from "@/app/api/plans/route";
import { GET as GET_PLAN } from "@/app/api/plans/[id]/route";
import { POST as ACTION } from "@/app/api/plans/[id]/actions/route";
import { GET as GET_COMPLETION, POST as COMPLETE } from "@/app/api/plans/[id]/complete/route";
import { __resetMemoryPlans, planStore } from "@/lib/planStore";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const VITEST_PLAN_SIGNING_SECRET = process.env.PLAN_IDEMPOTENCY_SECRET;

async function createPlan() {
  const response = await CREATE(new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "idempotency-key": "plan-completion-create" },
    body: JSON.stringify({
      startTime: "2026-07-15T18:00:00.000Z",
      creatorName: "Terra",
      stops: [
        { venueId: "venue-7tarkc" },
        { venueId: "venue-122cuu1" },
        { venueId: "venue-s2ppfm" },
      ],
    }),
  }));
  expect(response.status).toBe(201);
  const created = await response.json() as { plan: { plan: { id: string; routeRevision: number } }; memberToken: string };
  const updated = await planStore().update(created.plan.plan.id, created.memberToken, {
    context: {
      nightArea: "piccadilly-soho",
      daypart: "late_night",
      partyType: "friends",
      groupSize: 2,
      budget: "value",
      budgetLimitPence: null,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
      zeroProof: false,
      wetherspoonsPreferred: false,
    },
  });
  expect(updated.ok).toBe(true);
  return created;
}

beforeEach(() => {
  __resetMemoryPlans();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-16T23:00:00.000Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.PLAN_IDEMPOTENCY_SECRET;
  delete process.env.RATE_LIMIT_SALT;
});

describe("Plan Completion", () => {
  it("pins the durable RPC to the canonical host and an in-route arrival", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260717071841_plan_completion_arrival_ending_selection.sql"), "utf8");
    expect(sql).toContain("order by joined_at, id limit 1");
    expect(sql).toContain("actor_id <> host_id");
    expect(sql).toContain("stop.position = action.stop_position");
    expect(sql).toContain("candidate.created_at <= completion.completed_at");
    expect(sql.match(/action\.created_at <= p_completed_at/g)).toHaveLength(2);
    expect(sql).toContain("on delete no action");
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain("p_ending_selection jsonb");
    expect(sql).toContain("terminal_venue_id, ending_selection");
    expect(sql).toContain("qualifying_arrival_action_id, qualifying_arrival_stop_position");
    expect(sql).toContain("uuid, text, integer, uuid, uuid, text, text, jsonb, timestamptz");
    const shapeConstraint = /add constraint plan_completions_qualifying_arrival_shape check \([\s\S]*?\)\s+not valid;/i.exec(sql);
    expect(shapeConstraint).not.toBeNull();
    const validateIndex = sql.indexOf("validate constraint plan_completions_qualifying_arrival_shape");
    expect(validateIndex).toBeGreaterThan((shapeConstraint?.index ?? -1) + (shapeConstraint?.[0].length ?? 0));
    expect(sql).not.toContain("on delete set null");
    expect(sql).not.toContain("on delete cascade");
  });

  it("completes against the expected canonical route revision exactly once and redacts actor ids", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const endingSelection = {
      kind: "food",
      optionId: "late-food-evidence-piccadilly-soho-balans-no-60",
      externalPlaceId: "late-food-evidence-piccadilly-soho-balans-no-60",
      evidenceSnapshot: {
        label: "Client-provided label is replaced",
        confidence: "low",
      },
    };
    const payload = { expectedRouteRevision: 1, ending: "food", terminalVenueId: "venue-s2ppfm", endingSelection };
    const request = () => new Request(`http://localhost/api/plans/${id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}` },
      body: JSON.stringify(payload),
    });
    const beforeArrival = await COMPLETE(request(), ctx(id));
    expect(beforeArrival.status).toBe(400);
    expect(await beforeArrival.json()).toMatchObject({ code: "PLAN_ARRIVAL_REQUIRED" });

    const invalidArrival = await ACTION(new Request(`http://localhost/api/plans/${id}/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}`, "idempotency-key": "completion-arrival-invalid" },
      body: JSON.stringify({ type: "arrived", stopPosition: 7 }),
    }), ctx(id));
    expect(invalidArrival.status).toBe(400);

    const arrival = await ACTION(new Request(`http://localhost/api/plans/${id}/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}`, "idempotency-key": "completion-arrival-1" },
      body: JSON.stringify({ type: "arrived", stopPosition: 0 }),
    }), ctx(id));
    expect(arrival.status).toBe(201);

    const first = await COMPLETE(request(), ctx(id));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      plan: { plan: { status: "completed", routeRevision: 1 }, ending: "food" },
      created: true,
      completion: { planId: id, routeRevision: 1, endingSelection: {
        kind: "food",
        optionId: "late-food-evidence-piccadilly-soho-balans-no-60",
        evidenceSnapshot: { label: "Balans No.60", source: expect.stringContaining("balans.co.uk") },
      }, qualifyingArrival: { stopPosition: 0 }, routeSnapshot: [
        { venueId: "venue-7tarkc", position: 0 },
        { venueId: "venue-122cuu1", position: 1 },
        { venueId: "venue-s2ppfm", position: 2 },
      ] },
    });
    expect(firstBody.completion).not.toHaveProperty("actorMemberId");
    expect(JSON.stringify(firstBody)).not.toContain(created.memberToken);
    expect(firstBody).toHaveProperty("eventTokens.planCompleted");

    // Replays use the stored, host-confirmed completion. Current food evidence
    // may expire between a successful response and a network retry.
    vi.mocked(Date.now).mockReturnValue(Date.parse("2027-07-16T23:00:00.000Z"));
    const retry = await COMPLETE(request(), ctx(id));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ created: false, completion: firstBody.completion, eventTokens: firstBody.eventTokens });

    const get = await GET_COMPLETION(new Request(`http://localhost/api/plans/${id}/complete`), ctx(id));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ completion: firstBody.completion });
  });

  it("fails before completion and succeeds cleanly after event-token signing recovers", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const arrival = await ACTION(new Request(`http://localhost/api/plans/${id}/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}`, "idempotency-key": "completion-signing-arrival" },
      body: JSON.stringify({ type: "arrived", stopPosition: 0 }),
    }), ctx(id));
    expect(arrival.status).toBe(201);
    const request = () => new Request(`http://localhost/api/plans/${id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}` },
      body: JSON.stringify({
        expectedRouteRevision: 1,
        ending: "get_home",
        endingSelection: {
          kind: "get_home",
          optionId: "transport:nearest-station",
          evidenceSnapshot: { label: "Nearest station", confidence: "unknown" },
        },
      }),
    });

    process.env.PLAN_IDEMPOTENCY_SECRET = "too-short";
    const unavailable = await COMPLETE(request(), ctx(id));
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("retry-after")).toBe("60");
    expect(await unavailable.json()).toMatchObject({ code: "PLAN_SIGNING_UNAVAILABLE", retryable: true });
    const beforeRetry = await GET_COMPLETION(new Request(`http://localhost/api/plans/${id}/complete`), ctx(id));
    expect(await beforeRetry.json()).toEqual({ completion: null });

    process.env.PLAN_IDEMPOTENCY_SECRET = VITEST_PLAN_SIGNING_SECRET!;
    const retry = await COMPLETE(request(), ctx(id));
    expect(retry.status).toBe(201);
    expect(await retry.json()).toMatchObject({
      created: true,
      eventTokens: { planCompleted: expect.any(String), meaningfulCoreAction: expect.any(String) },
    });
  });

  it("rejects an ending snapshot whose kind does not match the confirmed ending", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const response = await COMPLETE(new Request(`http://localhost/api/plans/${id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}` },
      body: JSON.stringify({
        expectedRouteRevision: 1,
        ending: "food",
        terminalVenueId: "venue-s2ppfm",
        endingSelection: {
          kind: "keep_going",
          optionId: "venue-extra",
          evidenceSnapshot: { label: "Extra pub", confidence: "low" },
        },
      }),
    }), ctx(id));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    const completion = await GET_COMPLETION(new Request(`http://localhost/api/plans/${id}/complete`), ctx(id));
    expect(await completion.json()).toEqual({ completion: null });
  });

  it("requires one explicit ending option before completion", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const response = await COMPLETE(new Request(`http://localhost/api/plans/${id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.memberToken}` },
      body: JSON.stringify({ expectedRouteRevision: 1, ending: "get_home" }),
    }), ctx(id));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "PLAN_ENDING_SELECTION_INVALID" });
    const completion = await GET_COMPLETION(new Request(`http://localhost/api/plans/${id}/complete`), ctx(id));
    expect(await completion.json()).toEqual({ completion: null });
  });

  it("rejects a stale route revision without recording a partial ending action or completion", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const response = await COMPLETE(new Request(`http://localhost/api/plans/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        memberToken: created.memberToken,
        expectedRouteRevision: 2,
        ending: "get_home",
        endingSelection: {
          kind: "get_home",
          optionId: "transport:nearest-station",
          evidenceSnapshot: { label: "Nearest station", confidence: "unknown" },
        },
      }),
    }), ctx(id));
    expect(response.status).toBe(409);

    const completion = await GET_COMPLETION(new Request(`http://localhost/api/plans/${id}/complete`), ctx(id));
    expect(await completion.json()).toEqual({ completion: null });
    // The privacy boundary redacts an anonymous GET, so read the underlying
    // state as the plan member (rehydration on) to assert no partial write.
    const previous = process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2;
    process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2 = "1";
    try {
      const plan = await GET_PLAN(
        new Request(`http://localhost/api/plans/${id}`, {
          headers: { authorization: `Bearer ${created.memberToken}` },
        }),
        ctx(id),
      );
      expect(await plan.json()).toMatchObject({ plan: { status: "draft", routeRevision: 1 }, actions: [] });
    } finally {
      if (previous === undefined) delete process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2;
      else process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2 = previous;
    }
  });
});
