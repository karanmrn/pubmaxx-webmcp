import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
import { GET, PATCH } from "@/app/api/plans/[id]/route";
import { POST as ACTION } from "@/app/api/plans/[id]/actions/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as PRESENCE } from "@/app/api/plans/[id]/presence/route";
import { POST as CREATE_INVITE } from "@/app/api/plans/[id]/invites/route";
import { GET as SESSION, POST as EXCHANGE_SESSION } from "@/app/api/plans/[id]/session/route";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import { __resetMemoryPlans } from "@/lib/planStore";
import type { PlanState } from "@/lib/plan";

const URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createPlan() {
  const response = await CREATE(new Request(URL, {
    method: "POST",
    headers: { "idempotency-key": `plan-routes-${crypto.randomUUID()}` },
    body: JSON.stringify({
      title: "Friday near Bank",
      startTime: "2026-07-11T17:30:00.000Z",
      creatorName: "Karan",
      stops: [
        { venueId: "venue-xjf3n0", venueName: "Fabricated client name" },
        { venueId: "venue-16pnwmm", venueName: "Another fabricated name" },
      ],
    }),
  }));
  const body = await response.json() as {
    plan: PlanState;
    memberToken: string;
    role: string;
  };
  return { response, body };
}

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
});

describe("Plan public HTTP contract", () => {
  it("creates an ordered Plan with a start time", async () => {
    const { response, body } = await createPlan();
    expect(response.status).toBe(201);
    expect(body.plan.plan.startTime).toBe("2026-07-11T17:30:00.000Z");
    expect(body.plan.stops.map((stop) => stop.position)).toEqual([0, 1]);
    expect(body.plan.stops.map((stop) => stop.venueId)).toEqual([
      "venue-xjf3n0",
      "venue-16pnwmm",
    ]);
    expect(body.plan.stops.map((stop) => stop.venueName)).not.toContain("Fabricated client name");
    expect(body.memberToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.role).toBe("host");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain(`Path=/api/plans/${body.plan.plan.id}`);
    expect(response.headers.get("set-cookie")).not.toContain("Max-Age");
  });

  it("restores host authority through a path-scoped HttpOnly session", async () => {
    const { response, body } = await createPlan();
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    const restored = await SESSION(new Request(`${URL}/${body.plan.plan.id}/session`, {
      headers: { cookie },
    }), ctx(body.plan.plan.id));
    expect(await restored.json()).toEqual({ active: true, role: "host", collaborationAuthorized: true });

    const updated = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${PLAN_HTTP_ONLY_SESSION}`, cookie },
      body: JSON.stringify({ status: "ready" }),
    }), ctx(body.plan.plan.id));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ plan: { status: "ready" } });
  });

  it("exchanges a verified legacy bearer for the HttpOnly recovery session", async () => {
    const { body } = await createPlan();
    const exchanged = await EXCHANGE_SESSION(new Request(`${URL}/${body.plan.plan.id}/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.memberToken}` },
    }), ctx(body.plan.plan.id));
    expect(exchanged.status).toBe(200);
    expect(await exchanged.json()).toEqual({ active: true, role: "host", collaborationAuthorized: true });
    expect(exchanged.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects venue ids that are not in the server-owned Venue Dataset", async () => {
    const response = await CREATE(new Request(URL, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-invalid-venue" },
      body: JSON.stringify({
        startTime: "2026-07-11T17:30:00.000Z",
        creatorName: "Karan",
        stops: [{ venueId: "invented-pub", venueName: "Definitely Real Arms" }],
      }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose listed venues.",
      code: "PLAN_VENUES_INVALID",
      retryable: false,
    });
  });

  it("returns a privacy-safe preview to a link viewer with no member capability (§4.10)", async () => {
    const { body } = await createPlan();
    const response = await GET(new Request(`${URL}/${body.plan.plan.id}`), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    const preview = await response.json() as Record<string, unknown>;
    // No account, no capability: only the redacted preview — never the Route.
    expect(preview.visibility).toBe("preview");
    expect(preview.hostDisplayName).toBe("Karan");
    expect(preview.stopCount).toBe(2);
    expect(preview.stops).toBeUndefined();
    expect(preview.crew).toBeUndefined();
    // The user-entered title never reaches an uninvited viewer.
    expect(JSON.stringify(preview)).not.toContain("Friday near Bank");
  });

  it("returns full member state to a valid capability once member rehydration is enabled", async () => {
    const previous = process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2;
    process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2 = "1";
    try {
      const { body } = await createPlan();
      const response = await GET(
        new Request(`${URL}/${body.plan.plan.id}`, {
          headers: { authorization: `Bearer ${body.memberToken}` },
        }),
        ctx(body.plan.plan.id),
      );
      expect(response.status).toBe(200);
      const state = await response.json() as PlanState;
      expect(state.plan.title).toBe("Friday near Bank");
      expect(state.crew.map((member) => member.name)).toEqual(["Karan"]);
    } finally {
      if (previous === undefined) delete process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2;
      else process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2 = previous;
    }
  });

  it("rejects join without an invite token", async () => {
    const { body } = await createPlan();
    const response = await JOIN(new Request(`${URL}/${body.plan.plan.id}/join`, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-open-join" },
      body: JSON.stringify({ name: "Luna" }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PLAN_INVITE_REQUIRED" });
  });

  it("joins with the classic multi-use plan invite token from WhatsApp share", async () => {
    const { response: created, body } = await createPlan();
    expect(created.status).toBe(201);
    const memberGet = await GET(
      new Request(`${URL}/${body.plan.plan.id}`, {
        headers: { authorization: `Bearer ${body.memberToken}` },
      }),
      ctx(body.plan.plan.id),
    );
    expect(memberGet.status).toBe(200);
    const projection = await memberGet.json() as { inviteToken?: string | null };
    expect(projection.inviteToken).toMatch(/^[0-9a-f]{32}$/);
    const classicToken = projection.inviteToken as string;

    const joined = await JOIN(new Request(`${URL}/${body.plan.plan.id}/join`, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-classic-join" },
      body: JSON.stringify({ name: "Priya", inviteToken: classicToken }),
    }), ctx(body.plan.plan.id));
    expect(joined.status).toBe(200);
    const guest = await joined.json() as {
      plan: PlanState;
      memberToken: string;
      role: string;
      collaborationAuthorized: boolean;
    };
    expect(guest.plan.crew.map((member) => member.name)).toEqual(["Karan", "Priya"]);
    expect(guest.memberToken).toMatch(/^[a-f0-9]{64}$/);
    expect(guest.role).toBe("guest");
    expect(guest.collaborationAuthorized).toBe(false);

    const wrongPlan = await createPlan();
    const cross = await JOIN(new Request(`${URL}/${wrongPlan.body.plan.plan.id}/join`, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-classic-cross" },
      body: JSON.stringify({ name: "Mallory", inviteToken: classicToken }),
    }), ctx(wrongPlan.body.plan.plan.id));
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ code: "PLAN_INVITE_INVALID" });
  });

  it("joins with a host invite and returns a private presence token", async () => {
    const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const created = await CREATE(new Request(URL, {
      method: "POST",
      headers: { "idempotency-key": `plan-routes-invite-join-${crypto.randomUUID()}` },
      body: JSON.stringify({
        title: "Friday near Bank",
        startTime,
        creatorName: "Karan",
        stops: [
          { venueId: "venue-xjf3n0" },
          { venueId: "venue-16pnwmm" },
        ],
      }),
    }));
    const body = await created.json() as {
      plan: PlanState;
      memberToken: string;
      role: string;
    };
    expect(created.status).toBe(201);
    const inviteResponse = await CREATE_INVITE(new Request(`${URL}/${body.plan.plan.id}/invites`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${body.memberToken}`,
        "idempotency-key": "plan-routes-guest-invite",
      },
      body: JSON.stringify({ expiresInMinutes: 30 }),
    }), ctx(body.plan.plan.id));
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as { token?: string };
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    const response = await JOIN(new Request(`${URL}/${body.plan.plan.id}/join`, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-guest-join" },
      body: JSON.stringify({ name: "Luna", inviteToken: invite.token }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    const joined = await response.json() as { plan: PlanState; memberToken: string; role: string };
    expect(joined.plan.crew.map((member) => member.name)).toEqual(["Karan", "Luna"]);
    expect(joined.memberToken).toMatch(/^[a-f0-9]{64}$/);
    expect(joined.role).toBe("guest");
    expect(JSON.stringify(joined.plan)).not.toContain(joined.memberToken);
  });

  it("allows only the member token to change that member's live presence", async () => {
    const { body } = await createPlan();
    const denied = await PRESENCE(new Request(`${URL}/${body.plan.plan.id}/presence`, {
      method: "POST",
      body: JSON.stringify({ memberToken: "wrong", status: "on_the_way" }),
    }), ctx(body.plan.plan.id));
    expect(denied.status).toBe(403);

    const response = await PRESENCE(new Request(`${URL}/${body.plan.plan.id}/presence`, {
      method: "POST",
      body: JSON.stringify({ memberToken: body.memberToken, status: "here" }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    const state = await response.json() as PlanState;
    expect(state.crew[0]).toMatchObject({ name: "Karan", status: "here" });
  });

  it("lets the creator update Night Context and advance the Planned Night lifecycle", async () => {
    const { body } = await createPlan();
    const response = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      body: JSON.stringify({ memberToken: body.memberToken, status: "ready", context: { nightArea: "clapham", daypart: "after_work", partyType: "friends", groupSize: 4, budget: "value" } }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan: { status: "ready" }, context: { nightArea: "clapham", daypart: "after_work", groupSize: 4 } });
  });

  it("replaces a creator-authorized route with exactly three canonical Venue Dataset stops", async () => {
    const { body } = await createPlan();
    const response = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}` },
      body: JSON.stringify({
        expectedRouteRevision: 1,
        stops: [
          { venueId: "venue-1f5ygjb", venueName: "Client supplied name is ignored" },
          { venueId: "venue-xjf3n0", venueName: "Also ignored" },
          { venueId: "venue-3h52h", venueName: "Ignored too" },
        ],
        context: { nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 3, budget: "value" },
      }),
    }), ctx(body.plan.plan.id));

    expect(response.status).toBe(200);
    const state = await response.json() as PlanState;
    expect(state.plan.routeRevision).toBe(2);
    expect(state.stops).toEqual([
      { venueId: "venue-1f5ygjb", venueName: "The Bohemia", position: 0 },
      { venueId: "venue-xjf3n0", venueName: "Arnos Arms", position: 1 },
      { venueId: "venue-3h52h", venueName: "The Elephant Inn", position: 2 },
    ]);
    expect(state.context).toMatchObject({ nightArea: "clapham", daypart: "evening" });
    expect(JSON.stringify(state)).not.toContain(body.memberToken);
  });

  it("rejects unauthorized, stale, duplicate, and unknown canonical route replacements", async () => {
    const { body } = await createPlan();
    const valid = [
      { venueId: "venue-1f5ygjb" },
      { venueId: "venue-xjf3n0" },
      { venueId: "venue-3h52h" },
    ];
    const unauthorized = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: "wrong", expectedRouteRevision: 1, stops: valid }),
    }), ctx(body.plan.plan.id));
    expect(unauthorized.status).toBe(403);

    const stale = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: body.memberToken, expectedRouteRevision: 2, stops: valid }),
    }), ctx(body.plan.plan.id));
    expect(stale.status).toBe(409);

    const invalid = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: body.memberToken, expectedRouteRevision: 1, stops: [valid[0], valid[0], { venueId: "invented-pub" }] }),
    }), ctx(body.plan.plan.id));
    expect(invalid.status).toBe(400);
  });

  it("does not replace a terminal Planned Night route", async () => {
    const { body } = await createPlan();
    const abandoned = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: body.memberToken, status: "abandoned" }),
    }), ctx(body.plan.plan.id));
    expect(abandoned.status).toBe(200);

    const replacement = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        memberToken: body.memberToken,
        expectedRouteRevision: 1,
        stops: [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }],
      }),
    }), ctx(body.plan.plan.id));
    expect(replacement.status).toBe(400);
  });

  it("records explicit stop actions and completion without drink tracking", async () => {
    const { body } = await createPlan();
    const response = await ACTION(new Request(`${URL}/${body.plan.plan.id}/actions`, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-arrived" },
      body: JSON.stringify({ memberToken: body.memberToken, type: "arrived", stopPosition: 0 }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(201);
    const state = await response.json();
    expect(state.actions).toEqual([expect.objectContaining({ type: "arrived", stopPosition: 0 })]);

    const ending = await ACTION(new Request(`${URL}/${body.plan.plan.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ memberToken: body.memberToken, type: "ending", ending: "get_home" }),
    }), ctx(body.plan.plan.id));
    expect(ending.status).toBe(400);
  });
});
