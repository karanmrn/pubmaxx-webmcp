import { beforeEach, describe, expect, it, vi } from "vitest";

// Host RSVP removal lives under /api/plans/[id]/invite-rsvp so the path-scoped
// HttpOnly member cookie can authorize after a hard /invite/[token] open.

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
import { GET as GET_PLAN } from "@/app/api/plans/[id]/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as CREATE_INVITE } from "@/app/api/plans/[id]/invites/route";
import { POST as RSVP } from "@/app/api/invite/[token]/rsvp/route";
import { GET as GET_REACTIONS, POST as TOGGLE_REACTION } from "@/app/api/invite/[token]/reactions/route";
import { DELETE as REMOVE_RSVP } from "@/app/api/plans/[id]/invite-rsvp/route";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { __resetMemoryPlans } from "@/lib/planStore";
import { __resetMemoryRsvps, __resetMemoryReactions } from "@/lib/planInviteRsvpStore";

const PLANS_URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });
const route = [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }];

beforeEach(() => {
  __resetMemoryPlans();
  __resetMemoryRsvps();
  __resetMemoryReactions();
  __resetPlanCollaboration();
});

async function createPlan() {
  const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const response = await CREATE(new Request(PLANS_URL, {
    method: "POST",
    headers: { "idempotency-key": `rsvp-mod-host-${crypto.randomUUID()}` },
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

async function submitRsvp(token: string, displayName: string) {
  const response = await RSVP(
    new Request(`http://localhost/api/invite/${token}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName, status: "going", submitterId: `submitter-${displayName}` }),
    }),
    tokenCtx(token),
  );
  const body = (await response.json()) as { summary: { guests: Array<{ id: string; displayName: string }> } };
  const guest = body.summary.guests.find((candidate) => candidate.displayName === displayName);
  expect(guest).toBeDefined();
  return guest!.id;
}

describe("DELETE /api/plans/[id]/invite-rsvp", () => {
  it("removes a guest RSVP for the host's real capability token", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const rsvpId = await submitRsvp(inviteToken, "Priya");

    const response = await REMOVE_RSVP(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rsvp`, {
        method: "DELETE",
        body: JSON.stringify({ rsvpId, memberToken: host.memberToken }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("authorizes the host via the path-scoped HttpOnly member cookie", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const rsvpId = await submitRsvp(inviteToken, "CookieHost");

    const response = await REMOVE_RSVP(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rsvp`, {
        method: "DELETE",
        headers: {
          cookie: `pubmax_plan_member_${host.plan.plan.id}=${encodeURIComponent(host.memberToken)}`,
        },
        body: JSON.stringify({ rsvpId }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("rejects removal from a guest's own capability token", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const rsvpId = await submitRsvp(inviteToken, "Priya");

    // Open join is closed. Mint a one-use collaboration invite for the guest.
    const inviteResponse = await CREATE_INVITE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invites`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${host.memberToken}`,
          "idempotency-key": "rsvp-mod-guest-invite",
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
        headers: { "idempotency-key": "rsvp-mod-guest-join" },
        body: JSON.stringify({ name: "Guest", inviteToken: collabInvite.token }),
      }),
      ctx(host.plan.plan.id),
    );
    expect(joined.status).toBe(200);
    const guest = (await joined.json()) as { memberToken: string };

    const response = await REMOVE_RSVP(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rsvp`, {
        method: "DELETE",
        body: JSON.stringify({ rsvpId, memberToken: guest.memberToken }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Only the host can remove an RSVP." });
  });

  it("rejects removal with no capability token at all", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const rsvpId = await submitRsvp(inviteToken, "Priya");

    const response = await REMOVE_RSVP(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rsvp`, {
        method: "DELETE",
        body: JSON.stringify({ rsvpId }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(403);
  });
});

describe("POST /api/invite/[token]/rsvp", () => {
  it("rejects a missing submitter id", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const response = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Sam", status: "going" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(response.status).toBe(400);
  });

  it("404s an unknown invite token", async () => {
    const response = await RSVP(
      new Request("http://localhost/api/invite/0123456789abcdef0123456789abcdef/rsvp", {
        method: "POST",
        body: JSON.stringify({ displayName: "Sam", status: "going", submitterId: "device-a" }),
      }),
      tokenCtx("0123456789abcdef0123456789abcdef"),
    );
    expect(response.status).toBe(404);
  });
});

describe("invite reactions hydrate + toggle", () => {
  it("GET returns mine for the asking device after a toggle", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);

    const toggle = await TOGGLE_REACTION(
      new Request(`http://localhost/api/invite/${inviteToken}/reactions`, {
        method: "POST",
        body: JSON.stringify({ reaction: "cheers", submitterId: "device-hydrate" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(toggle.status).toBe(200);

    const hydrate = await GET_REACTIONS(
      new Request(`http://localhost/api/invite/${inviteToken}/reactions?submitterId=device-hydrate`),
      tokenCtx(inviteToken),
    );
    expect(hydrate.status).toBe(200);
    const body = (await hydrate.json()) as { summary: { mine: string[]; counts: Record<string, number> } };
    expect(body.summary.mine).toContain("cheers");
    expect(body.summary.counts.cheers).toBe(1);
  });
});
