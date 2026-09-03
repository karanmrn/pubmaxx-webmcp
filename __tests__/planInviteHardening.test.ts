import { beforeEach, describe, expect, it, vi } from "vitest";

const isLimitedMock = vi.hoisted(() => vi.fn(async () => false));

// F9 (token rotate/revoke) + F10 (guest-list caps) — invite hardening bundle.
// Mirrors __tests__/planInviteRsvpModerationRoute.test.ts's harness shape.

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});

import { POST as CREATE } from "@/app/api/plans/route";
import { GET as GET_PLAN } from "@/app/api/plans/[id]/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as CREATE_INVITE } from "@/app/api/plans/[id]/invites/route";
import { POST as ROTATE } from "@/app/api/plans/[id]/invite-rotate/route";
import { POST as RSVP } from "@/app/api/invite/[token]/rsvp/route";
import { DELETE as REMOVE_RSVP, POST as UPDATE_RSVP } from "@/app/api/plans/[id]/invite-rsvp/route";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { __resetMemoryPlans, planMemberIdentity, planStore } from "@/lib/planStore";
import * as planStoreModule from "@/lib/planStore";
import { __resetMemoryRsvps } from "@/lib/planInviteRsvpStore";
import { GUEST_LIST_DISPLAY_CAP, RSVP_PLAN_CEILING } from "@/lib/planInvite";
import { rsvpStore } from "@/lib/planInviteRsvpStore";
import { hashActor } from "@/lib/supabase";

const PLANS_URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });
const route = [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }];

beforeEach(() => {
  isLimitedMock.mockReset();
  isLimitedMock.mockResolvedValue(false);
  __resetMemoryPlans();
  __resetMemoryRsvps();
  __resetPlanCollaboration();
});

async function createPlan() {
  const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const response = await CREATE(new Request(PLANS_URL, {
    method: "POST",
    headers: { "idempotency-key": `invite-hardening-${crypto.randomUUID()}` },
    body: JSON.stringify({ startTime, creatorName: "Host", stops: route }),
  }));
  return (await response.json()) as { plan: { plan: { id: string } }; memberToken: string; role: string };
}

async function ownInviteToken(planId: string, memberToken: string): Promise<string> {
  const response = await GET_PLAN(
    new Request(`${PLANS_URL}/${planId}`, { headers: { authorization: `Bearer ${memberToken}` } }),
    ctx(planId),
  );
  const body = (await response.json()) as { inviteToken?: string | null };
  expect(body.inviteToken).toBeTruthy();
  return body.inviteToken as string;
}

describe("POST /api/plans/[id]/invite-rotate", () => {
  it("rotates the token for the host, invalidating the old link", async () => {
    const host = await createPlan();
    const oldToken = await ownInviteToken(host.plan.plan.id, host.memberToken);

    const response = await ROTATE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rotate`, {
        method: "POST",
        body: JSON.stringify({ memberToken: host.memberToken }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; inviteToken: string };
    expect(body.ok).toBe(true);
    expect(body.inviteToken).toMatch(/^[0-9a-f]{32}$/);
    expect(body.inviteToken).not.toBe(oldToken);

    // Old token 404s once RSVP'd against — the classic invite resolve path.
    const rsvpOnOld = await RSVP(
      new Request(`http://localhost/api/invite/${oldToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Late", status: "going", submitterId: "device-late" }),
      }),
      tokenCtx(oldToken),
    );
    expect(rsvpOnOld.status).toBe(404);

    // New token resolves fine.
    const rsvpOnNew = await RSVP(
      new Request(`http://localhost/api/invite/${body.inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "OnTime", status: "going", submitterId: "device-ontime" }),
      }),
      tokenCtx(body.inviteToken),
    );
    expect(rsvpOnNew.status).toBe(200);
  });

  it("rejects rotation from a guest's own capability token", async () => {
    const host = await createPlan();
    const inviteResponse = await CREATE_INVITE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invites`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${host.memberToken}`,
          "idempotency-key": "invite-hardening-guest-invite",
        },
        body: JSON.stringify({ expiresInMinutes: 30 }),
      }),
      ctx(host.plan.plan.id),
    );
    expect(inviteResponse.status).toBe(201);
    const collabInvite = (await inviteResponse.json()) as { token: string };
    const joined = await JOIN(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/join`, {
        method: "POST",
        headers: { "idempotency-key": "invite-hardening-guest-join" },
        body: JSON.stringify({ name: "Guest", inviteToken: collabInvite.token }),
      }),
      ctx(host.plan.plan.id),
    );
    expect(joined.status).toBe(200);
    const guest = (await joined.json()) as { memberToken: string };

    const response = await ROTATE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rotate`, {
        method: "POST",
        body: JSON.stringify({ memberToken: guest.memberToken }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Only the host can make a new link." });
  });

  it("rejects rotation with no capability token at all", async () => {
    const host = await createPlan();

    const response = await ROTATE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rotate`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(403);
  });
});

describe("POST /api/invite/[token]/rsvp guest-list ceiling", () => {
  it("applies the IP rate limit before the public invite lookup", async () => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValueOnce(true);

    const response = await RSVP(
      new Request("http://localhost/api/invite/not-a-real-invite/rsvp", {
        method: "POST",
        body: JSON.stringify({
          displayName: "Priya",
          status: "going",
          submitterId: "device-public-rate-limited",
        }),
      }),
      tokenCtx("not-a-real-invite"),
    );

    expect(response.status).toBe(429);
    expect(isLimitedMock).toHaveBeenCalledTimes(1);
  });

  it("turns a Going RSVP into one replay-safe canonical guest membership", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const request = () => new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName: "Priya", status: "going", submitterId: "device-canonical-going" }),
    });

    const first = await RSVP(request(), tokenCtx(inviteToken));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      memberToken?: string;
      role?: string;
      collaborationAuthorized?: boolean;
      isUpdate?: boolean;
    };
    expect(firstBody).toMatchObject({
      role: "guest",
      collaborationAuthorized: false,
      isUpdate: false,
    });
    expect(firstBody.memberToken).toMatch(/^[0-9a-f]{64}$/);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect(first.headers.get("set-cookie")).toContain(`Path=/api/plans/${planId}`);

    const replay = await RSVP(request(), tokenCtx(inviteToken));
    expect(replay.status).toBe(200);
    const replayBody = await replay.json() as { memberToken?: string; isUpdate?: boolean };
    expect(replayBody).toMatchObject({ memberToken: firstBody.memberToken, isUpdate: true });

    const memberState = await planStore().get(planId);
    expect(memberState?.crew.map((member) => member.name)).toEqual(["Host", "Priya"]);
  });

  it("updates the same keyless Going membership when the guest changes name", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const submit = (displayName: string) => RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({
          displayName,
          status: "going",
          submitterId: "device-canonical-rename",
        }),
      }),
      tokenCtx(inviteToken),
    );

    const first = await submit("Priya");
    const firstBody = await first.json() as { memberToken?: string };
    const firstIdentity = await planMemberIdentity(planId, firstBody.memberToken);
    const renamed = await submit("Priya Patel");
    const renamedBody = await renamed.json() as { memberToken?: string };
    const renamedIdentity = await planMemberIdentity(planId, renamedBody.memberToken);

    expect(first.status).toBe(200);
    expect(renamed.status).toBe(200);
    expect(renamedBody.memberToken).toBe(firstBody.memberToken);
    expect(renamedIdentity?.memberId).toBe(firstIdentity?.memberId);
    expect((await planStore().get(planId))?.crew.map((member) => member.name)).toEqual([
      "Host",
      "Priya Patel",
    ]);
  });

  it("does not turn an ordinary join replay conflict into an RSVP rename", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const submitterId = "device-ordinary-join-collision";
    const joined = await planStore().join(planId, "Collaborator", {
      collaborationAuthorized: true,
      idempotencyKey: `invite-rsvp:${hashActor(submitterId)}`,
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const response = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Priya", status: "going", submitterId }),
      }),
      tokenCtx(inviteToken),
    );

    expect(response.status).toBe(503);
    expect((await planStore().get(planId))?.crew.map((member) => member.name)).toEqual([
      "Host",
      "Collaborator",
    ]);
    expect(await planMemberIdentity(planId, joined.memberToken)).toMatchObject({
      role: "guest",
      collaborationAuthorized: true,
    });
  });

  it("does not claim an ordinary same-name replay before an RSVP rename", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const submitterId = "device-ordinary-same-name";
    const idempotencyKey = `invite-rsvp:${hashActor(submitterId)}`;
    const joined = await planStore().join(planId, "Priya", {
      collaborationAuthorized: false,
      idempotencyKey,
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const submit = (displayName: string) => RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName, status: "going", submitterId }),
      }),
      tokenCtx(inviteToken),
    );

    expect((await submit("Priya")).status).toBe(503);
    expect((await submit("Priya Patel")).status).toBe(503);
    expect((await planStore().get(planId))?.crew.map((member) => member.name)).toEqual([
      "Host",
      "Priya",
    ]);
    expect(await planMemberIdentity(planId, joined.memberToken)).toMatchObject({
      role: "guest",
      collaborationAuthorized: false,
    });
  });

  it("preserves an unavailable invite lookup as a retryable 503", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const lookup = vi.spyOn(planStoreModule, "resolvePlanIdByInviteToken")
      .mockResolvedValueOnce({ ok: false, error: "error" });

    const response = await UPDATE_RSVP(
      new Request(`${PLANS_URL}/${planId}/invite-rsvp`, {
        method: "POST",
        body: JSON.stringify({
          inviteToken: "temporarily-unavailable",
          displayName: "Priya",
          status: "going",
          submitterId: "device-unavailable-invite",
          memberToken: host.memberToken,
        }),
      }),
      ctx(planId),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    lookup.mockRestore();
  });

  it("applies the IP rate limit before invite and member lookups", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValueOnce(true);

    const response = await UPDATE_RSVP(
      new Request(`${PLANS_URL}/${planId}/invite-rsvp`, {
        method: "POST",
        body: JSON.stringify({
          inviteToken: "not-a-real-invite",
          displayName: "Priya",
          status: "going",
          submitterId: "device-rate-limited",
          memberToken: host.memberToken,
        }),
      }),
      ctx(planId),
    );

    expect(response.status).toBe(429);
    expect(isLimitedMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a host RSVP without creating a duplicate membership", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);

    const going = await UPDATE_RSVP(
      new Request(`${PLANS_URL}/${planId}/invite-rsvp`, {
        method: "POST",
        body: JSON.stringify({
          inviteToken,
          displayName: "Host",
          status: "going",
          submitterId: "host-rsvp-device",
          memberToken: host.memberToken,
        }),
      }),
      ctx(planId),
    );

    expect(going.status).toBe(409);
    expect(await going.json()).toMatchObject({ code: "PLAN_HOST_CANNOT_RSVP" });
    expect((await planStore().get(planId))?.crew.map((member) => member.name)).toEqual(["Host"]);
    expect(await rsvpStore().summarize(planId)).toMatchObject({ counts: { going: 0, maybe: 0 } });
  });

  it("lets a guest capability update only its own linked RSVP", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const joined = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Priya", status: "going", submitterId: "linked-device" }),
      }),
      tokenCtx(inviteToken),
    );
    const joinedBody = await joined.json() as { memberToken: string };
    const cookie = joined.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const refused = await UPDATE_RSVP(
      new Request(`${PLANS_URL}/${planId}/invite-rsvp`, {
        method: "POST",
        headers: { cookie: cookie! },
        body: JSON.stringify({
          inviteToken,
          displayName: "Other",
          status: "maybe",
          submitterId: "different-device",
        }),
      }),
      ctx(planId),
    );
    expect(refused.status).toBe(403);
    expect(await planMemberIdentity(planId, joinedBody.memberToken)).toMatchObject({ role: "guest" });
    expect(await rsvpStore().summarize(planId)).toMatchObject({ counts: { going: 1, maybe: 0 } });

    const updated = await UPDATE_RSVP(
      new Request(`${PLANS_URL}/${planId}/invite-rsvp`, {
        method: "POST",
        headers: { cookie: cookie! },
        body: JSON.stringify({
          inviteToken,
          displayName: "Priya",
          status: "maybe",
          submitterId: "linked-device",
        }),
      }),
      ctx(planId),
    );
    expect(updated.status).toBe(200);
    expect(await planMemberIdentity(planId, joinedBody.memberToken)).toBeNull();
    expect(await rsvpStore().summarize(planId)).toMatchObject({ counts: { going: 0, maybe: 1 } });
  });

  it("keeps the public RSVP name while canonical crew identity uses its 40-character limit", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const displayName = "P".repeat(60);

    const response = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName, status: "going", submitterId: "device-long-going-name" }),
      }),
      tokenCtx(inviteToken),
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as { summary: { guests: Array<{ displayName: string }> } })
      .toMatchObject({ summary: { guests: [{ displayName }] } });
    expect((await planStore().get(planId))?.crew[1]?.name).toBe("P".repeat(40));
  });

  it("keeps a Maybe RSVP outside membership and revokes membership when Going changes to Maybe", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const rsvp = async (status: "going" | "maybe") => RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Priya", status, submitterId: "device-going-maybe" }),
      }),
      tokenCtx(inviteToken),
    );

    const going = await rsvp("going");
    expect(going.status).toBe(200);
    const goingBody = await going.json() as { memberToken: string };
    expect(await planMemberIdentity(planId, goingBody.memberToken)).toMatchObject({ role: "guest" });

    const maybe = await rsvp("maybe");
    expect(maybe.status).toBe(200);
    expect(await maybe.json()).not.toHaveProperty("memberToken");
    expect(await planMemberIdentity(planId, goingBody.memberToken)).toBeNull();
    expect((await planStore().get(planId))?.crew.map((member) => member.name)).toEqual(["Host"]);
  });

  it("refuses Going atomically when canonical crew is full while Maybe still lands", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    for (let i = 0; i < 19; i++) {
      const response = await RSVP(
        new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
          method: "POST",
          body: JSON.stringify({ displayName: `Crew ${i}`, status: "going", submitterId: `crew-device-${i}` }),
        }),
        tokenCtx(inviteToken),
      );
      expect(response.status).toBe(200);
    }

    const rejected = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Full Guest", status: "going", submitterId: "crew-device-full" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "PLAN_CREW_FULL" });
    expect(await rsvpStore().summarize(planId)).toMatchObject({ counts: { going: 19, maybe: 0 } });

    const maybe = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Full Guest", status: "maybe", submitterId: "crew-device-full" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(maybe.status).toBe(200);
    expect(await rsvpStore().summarize(planId)).toMatchObject({ counts: { going: 19, maybe: 1 } });

    const stillRejected = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Full Guest", status: "going", submitterId: "crew-device-full" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(stillRejected.status).toBe(409);
    expect(await rsvpStore().summarize(planId)).toMatchObject({ counts: { going: 19, maybe: 1 } });
  });

  it("host removal revokes the linked membership and a fresh Going RSVP can rejoin safely", async () => {
    const host = await createPlan();
    const planId = host.plan.plan.id;
    const inviteToken = await ownInviteToken(planId, host.memberToken);
    const request = () => new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName: "Priya", status: "going", submitterId: "device-remove-rejoin" }),
    });
    const joined = await RSVP(request(), tokenCtx(inviteToken));
    const joinedBody = await joined.json() as {
      memberToken: string;
      summary: { guests: Array<{ id: string; displayName: string }> };
    };
    const rsvpId = joinedBody.summary.guests.find((guest) => guest.displayName === "Priya")?.id;
    expect(rsvpId).toBeTruthy();

    const removed = await REMOVE_RSVP(
      new Request(`${PLANS_URL}/${planId}/invite-rsvp`, {
        method: "DELETE",
        body: JSON.stringify({ rsvpId, memberToken: host.memberToken }),
      }),
      ctx(planId),
    );
    expect(removed.status).toBe(200);
    expect(await planMemberIdentity(planId, joinedBody.memberToken)).toBeNull();
    expect((await planStore().get(planId))?.crew.map((member) => member.name)).toEqual(["Host"]);

    const rejoined = await RSVP(request(), tokenCtx(inviteToken));
    expect(rejoined.status).toBe(200);
    const rejoinedBody = await rejoined.json() as { memberToken: string; isUpdate: boolean };
    expect(rejoinedBody).toMatchObject({ memberToken: joinedBody.memberToken, isUpdate: false });
    expect((await planStore().get(planId))?.crew.map((member) => member.name)).toEqual(["Host", "Priya"]);
  });

  it("refuses a brand-new guest once the plan is at the RSVP ceiling, but still allows an existing guest to update", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);

    for (let i = 0; i < RSVP_PLAN_CEILING; i++) {
      const res = await RSVP(
        new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
          method: "POST",
          body: JSON.stringify({ displayName: `Guest ${i}`, status: "maybe", submitterId: `device-${i}` }),
        }),
        tokenCtx(inviteToken),
      );
      expect(res.status).toBe(200);
    }

    const overflow = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Overflow", status: "maybe", submitterId: "device-overflow" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toMatchObject({ error: "This guest list is full." });

    const existingUpdates = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Guest Zero", status: "maybe", submitterId: "device-0" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(existingUpdates.status).toBe(200);
  }, 20_000);
});

describe("guest-list display truncation", () => {
  it("caps the displayed guest list while counts stay honest", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);

    const total = GUEST_LIST_DISPLAY_CAP + 7;
    for (let i = 0; i < total; i++) {
      await RSVP(
        new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
          method: "POST",
          body: JSON.stringify({ displayName: `Guest ${i}`, status: "maybe", submitterId: `device-trunc-${i}` }),
        }),
        tokenCtx(inviteToken),
      );
    }

    const summary = await rsvpStore().summarize(host.plan.plan.id);
    expect(summary.guests.length).toBe(GUEST_LIST_DISPLAY_CAP);
    expect(summary.counts.maybe).toBe(total);
    expect(summary.counts.going + summary.counts.maybe - summary.guests.length).toBe(total - GUEST_LIST_DISPLAY_CAP);
  }, 20_000);
});
