import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  status: "absent" as "absent" | "invalid" | "unavailable" | "verified",
  userId: "11111111-1111-4111-8111-111111111111",
}));
const database = vi.hoisted(() => ({
  configured: false,
  rpc: vi.fn(),
}));
const isLimitedMock = vi.hoisted(() => vi.fn(async (...args: [
  localKey: string,
  durableKey: string,
  limit?: number,
  windowMs?: number,
  opts?: { failClosed?: boolean },
]) => {
  void args;
  return false;
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => database.configured,
    requireSupabaseAdmin: () => ({ rpc: database.rpc }),
  };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => auth.status === "verified" ? auth.userId : null,
  verifyCallerAuth: async () => auth.status === "verified"
    ? {
        status: "verified" as const,
        identity: { id: auth.userId, email: "captain@example.com", createdAt: null },
      }
    : { status: auth.status },
}));

import { POST as CREATE } from "@/app/api/plans/route";
import { POST as REDEEM_INVITE } from "@/app/api/plans/[id]/invites/redeem/route";
import * as sessionRoute from "@/app/api/plans/[id]/session/route";
import {
  __resetPlanCollaboration,
  planCollaborationStore,
} from "@/lib/planCollaborationStore";
import {
  __listMemoryPlanMemberUserIds,
  __resetMemoryPlans,
  __setMemoryPlanOwnerUserId,
  memoryPlanStore,
} from "@/lib/planStore";
import { claimPlanMembership, linkPlanMemberUser } from "@/lib/planCrewIdentity";
import type { PlanState } from "@/lib/plan";

const PLAN_URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createGuestPlan() {
  auth.status = "absent";
  const response = await CREATE(new Request(PLAN_URL, {
    method: "POST",
    headers: { "idempotency-key": `guest-claim-${crypto.randomUUID()}` },
    body: JSON.stringify({
      title: "Guest plan to claim",
      // A calendar-pinned start silently expires the plan (and every invite)
      // the day the date goes past; keep the fixture in the future.
      startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      creatorName: "Karan",
      stops: [
        { venueId: "venue-xjf3n0" },
        { venueId: "venue-16pnwmm" },
      ],
    }),
  }));
  expect(response.status).toBe(201);
  const body = await response.json() as { plan: PlanState; memberToken: string };
  return {
    id: body.plan.plan.id,
    memberToken: body.memberToken,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}

async function claim(planId: string, cookie: string): Promise<Response> {
  const handler = (sessionRoute as typeof sessionRoute & {
    PUT?: (request: Request, context: ReturnType<typeof ctx>) => Promise<Response>;
  }).PUT;
  if (!handler) {
    return new Response(JSON.stringify({ code: "PLAN_ACCOUNT_CLAIM_MISSING" }), {
      status: 501,
      headers: { "content-type": "application/json" },
    });
  }
  return handler(new Request(`${PLAN_URL}/${planId}/session`, {
    method: "PUT",
    headers: {
      authorization: "Bearer verified-auth-session",
      cookie,
    },
  }), ctx(planId));
}

async function recover(planId: string, key = "recover-plan-membership"): Promise<Response> {
  const handler = (sessionRoute as typeof sessionRoute & {
    PATCH?: (request: Request, context: ReturnType<typeof ctx>) => Promise<Response>;
  }).PATCH;
  if (!handler) {
    return new Response(JSON.stringify({ code: "PLAN_ACCOUNT_RECOVERY_MISSING" }), {
      status: 501,
      headers: { "content-type": "application/json" },
    });
  }
  return handler(new Request(`${PLAN_URL}/${planId}/session`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer verified-auth-session",
      "idempotency-key": key,
    },
  }), ctx(planId));
}

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
  auth.status = "absent";
  auth.userId = "11111111-1111-4111-8111-111111111111";
  database.configured = false;
  database.rpc.mockReset();
  isLimitedMock.mockReset().mockResolvedValue(false);
});

describe("guest Plan account claim", () => {
  it("restores a claimed membership after its browser capability is lost", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";
    expect((await claim(guest.id, guest.cookie)).status).toBe(200);
    expect((await memoryPlanStore.updatePresence(
      guest.id,
      guest.memberToken,
      "running_late",
    )).ok).toBe(true);

    const response = await recover(guest.id);

    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({
      active: true,
      role: "host",
      collaborationAuthorized: true,
    });
    const recoveredCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(recoveredCookie).toContain(`pubmax_plan_member_${guest.id}=`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(
      (await sessionRoute.GET(
        new Request(`${PLAN_URL}/${guest.id}/session`, {
          headers: { cookie: guest.cookie },
        }),
        ctx(guest.id),
      )).json(),
    ).resolves.toEqual({ active: false });
    expect(
      (await sessionRoute.GET(
        new Request(`${PLAN_URL}/${guest.id}/session`, {
          headers: { cookie: recoveredCookie },
        }),
        ctx(guest.id),
      )).json(),
    ).resolves.toMatchObject({ active: true, role: "host" });
    expect((await memoryPlanStore.get(guest.id))?.crew[0]?.status).toBe("running_late");

    const replay = await recover(guest.id, "recover-plan-membership-from-another-tab");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("set-cookie")?.split(";")[0]).toBe(recoveredCookie);
  });

  it("scopes recovery budget per Plan and keeps a global IP ceiling", async () => {
    const first = await createGuestPlan();
    const second = await createGuestPlan();
    auth.status = "verified";
    expect((await claim(first.id, first.cookie)).status).toBe(200);
    expect((await claim(second.id, second.cookie)).status).toBe(200);
    isLimitedMock.mockClear();

    expect((await recover(first.id, "recovery-budget-first")).status).toBe(200);
    expect((await recover(second.id, "recovery-budget-second")).status).toBe(200);

    expect(isLimitedMock).toHaveBeenCalledTimes(4);
    expect(isLimitedMock.mock.calls[0]?.[0]).toBe(isLimitedMock.mock.calls[0]?.[1]);
    expect(isLimitedMock.mock.calls[0]?.[2]).toBe(200);
    expect(isLimitedMock.mock.calls[2]?.[0]).toBe(isLimitedMock.mock.calls[0]?.[0]);
    expect(isLimitedMock.mock.calls[1]?.[0]).not.toBe(isLimitedMock.mock.calls[3]?.[0]);
    expect(isLimitedMock.mock.calls[1]?.[2]).toBe(20);
    expect(isLimitedMock.mock.calls[3]?.[2]).toBe(20);
  });

  it("does not recover another account or a signed-out visitor", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";
    expect((await claim(guest.id, guest.cookie)).status).toBe(200);

    auth.userId = "22222222-2222-4222-8222-222222222222";
    const wrongAccount = await recover(guest.id, "wrong-account-recovery");
    expect(wrongAccount.status).toBe(404);
    expect(wrongAccount.headers.get("set-cookie")).toBeNull();

    auth.status = "absent";
    const signedOut = await recover(guest.id, "signed-out-recovery");
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("set-cookie")).toBeNull();
  });

  it("keeps a private invite pending until the recovered guest redeems it", async () => {
    const plan = await createGuestPlan();
    const collaboration = planCollaborationStore();
    const invite = await collaboration.createInvite(plan.id, plan.memberToken, {
      expiresInMinutes: 30,
      idempotencyKey: "lost-guest-private-invite",
    });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;
    auth.status = "verified";
    const guest = await memoryPlanStore.join(plan.id, "Priya", {
      collaborationAuthorized: false,
      idempotencyKey: "lost-guest-account-seat",
      userId: auth.userId,
    });
    expect(guest.ok).toBe(true);

    const recovered = await recover(plan.id, "lost-guest-recovery");
    expect(recovered.status).toBe(200);
    const recoveredCookie = recovered.headers.get("set-cookie")?.split(";")[0] ?? "";
    const before = await collaboration.list(plan.id, plan.memberToken);
    expect(before.ok && before.invites[0]?.redeemedAt).toBeNull();

    const invalid = await REDEEM_INVITE(
      new Request(`${PLAN_URL}/${plan.id}/invites/redeem`, {
        method: "POST",
        headers: { cookie: recoveredCookie, "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: "invalid-invite" }),
      }),
      ctx(plan.id),
    );
    expect(invalid.status).toBe(404);
    const afterFailure = await collaboration.list(plan.id, plan.memberToken);
    expect(afterFailure.ok && afterFailure.invites[0]?.redeemedAt).toBeNull();

    const redeemed = await REDEEM_INVITE(
      new Request(`${PLAN_URL}/${plan.id}/invites/redeem`, {
        method: "POST",
        headers: { cookie: recoveredCookie, "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: invite.token }),
      }),
      ctx(plan.id),
    );
    expect(redeemed.status).toBe(200);
    expect(await redeemed.json()).toMatchObject({ collaborationAuthorized: true });
    const after = await collaboration.list(plan.id, plan.memberToken);
    expect(after.ok && after.invites[0]?.redeemedAt).not.toBeNull();
  });

  it("atomically binds the guest host membership and Plan owner to the signed-in account", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";

    const response = await claim(guest.id, guest.cookie);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: true, role: "host" });
    expect(__listMemoryPlanMemberUserIds(guest.id)).toEqual([
      expect.objectContaining({ userId: auth.userId }),
    ]);
    expect(
      __setMemoryPlanOwnerUserId(
        guest.id,
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe(false);
  });

  it("is idempotent for the same signed-in account", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";

    expect((await claim(guest.id, guest.cookie)).status).toBe(200);
    const replay = await claim(guest.id, guest.cookie);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ claimed: false, role: "host" });
    expect(__listMemoryPlanMemberUserIds(guest.id)).toHaveLength(1);
  });

  it("refuses a different account without changing the existing claim", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";
    expect((await claim(guest.id, guest.cookie)).status).toBe(200);

    auth.userId = "22222222-2222-4222-8222-222222222222";
    const conflict = await claim(guest.id, guest.cookie);

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "PLAN_ACCOUNT_CLAIM_CONFLICT" });
    expect(__listMemoryPlanMemberUserIds(guest.id)).toEqual([
      expect.not.objectContaining({ userId: auth.userId }),
    ]);
  });

  it("requires both a verified account and the existing Plan member session", async () => {
    const guest = await createGuestPlan();

    const signedOut = await claim(guest.id, guest.cookie);
    expect(signedOut.status).toBe(401);

    auth.status = "verified";
    const withoutMemberSession = await claim(guest.id, "");
    expect(withoutMemberSession.status).toBe(403);
    expect(__listMemoryPlanMemberUserIds(guest.id)).toEqual([]);
  });

  it("refuses to link one account to two memberships in the same Plan", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";
    expect((await claim(guest.id, guest.cookie)).status).toBe(200);

    const joined = await memoryPlanStore.join(guest.id, "Same account", {
      collaborationAuthorized: true,
      idempotencyKey: "same-account-second-membership",
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const secondMember = joined.plan.crew.at(-1);
    expect(secondMember).toBeDefined();

    expect(
      await linkPlanMemberUser(guest.id, secondMember!.id, auth.userId),
    ).toBe(false);
    expect(__listMemoryPlanMemberUserIds(guest.id)).toHaveLength(1);
  });

  it("logs a durable claim failure before returning the retryable outcome", async () => {
    database.configured = true;
    database.rpc.mockResolvedValue({ data: null, error: { message: "claim RPC missing" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(claimPlanMembership(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    )).resolves.toBe("error");
    expect(error).toHaveBeenCalledWith(
      "[plans] membership claim failed:",
      "claim RPC missing",
    );
    error.mockRestore();
  });
});
