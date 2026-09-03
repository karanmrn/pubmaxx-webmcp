import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SocialCrewPageDTO } from "@/lib/socialCrew";
import type { SocialPostActor } from "@/lib/socialPostStore";

const ALICE_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const ALICE_PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const ALICE_MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const BOB_PROFILE_ID = "20000000-0000-4000-8000-000000000002";
const BOB_MEMBER_ID = "30000000-0000-4000-8000-000000000002";
const CREW_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_CREW_ID = "50000000-0000-4000-8000-000000000002";
const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const INVITATION_ID = "70000000-0000-4000-8000-000000000001";
const REQUEST_ID = "80000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "crew-route-key-0001";
const HOST_CAPABILITY = "legacy-host-capability";

const actor: SocialPostActor = {
  accountId: ALICE_ACCOUNT_ID,
  profileId: ALICE_PROFILE_ID,
  handle: "alice",
};

const crew: SocialCrewPageDTO = {
  kind: "member",
  crewId: CREW_ID,
  title: "Friday in Camden",
  visibility: "friends",
  phase: "planning",
  nightArea: "camden",
  startsAt: "2026-08-07T18:30:00.000Z",
  authorityRevision: 1,
  viewer: { memberId: ALICE_MEMBER_ID, role: "owner" },
  owner: { memberId: ALICE_MEMBER_ID, handle: "alice" },
  members: [
    {
      memberId: ALICE_MEMBER_ID,
      handle: "alice",
      role: "owner",
      joinedAt: "2026-08-05T12:00:00.000Z",
    },
  ],
  plan: {
    plan: {
      id: PLAN_ID,
      title: "Friday in Camden",
      startTime: "2026-08-07T18:30:00.000Z",
      createdAt: "2026-08-05T12:00:00.000Z",
      routeRevision: 1,
      status: "ready",
    },
    stops: [
      { venueId: "venue-a", venueName: "The First", position: 0 },
      { venueId: "venue-b", venueName: "The Second", position: 1 },
    ],
    context: {
      nightArea: "camden",
      daypart: "evening",
      partyType: "friends",
      groupSize: 2,
      budget: "standard",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    },
    actions: [],
    ending: null,
  },
};

const state = vi.hoisted(() => ({
  access: null as unknown,
  limited: false,
}));

const store = vi.hoisted(() => ({
  read: vi.fn(),
  create: vi.fn(),
  invite: vi.fn(),
  acceptInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  requestJoin: vi.fn(),
  decideJoin: vi.fn(),
  setRole: vi.fn(),
  transferOwner: vi.fn(),
  removeMember: vi.fn(),
  leave: vi.fn(),
  updateVisibility: vi.fn(),
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: vi.fn(async () => state.access),
}));

vi.mock("@/lib/socialCrewStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialCrewStore")>()),
  createSocialCrewStore: () => store,
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => state.limited),
}));

vi.mock("@/lib/supabase", () => ({
  hashActor: (value: string) => `hashed-${value}`,
}));

import { isLimited } from "@/lib/pintDrops";
import { SocialCrewStoreError } from "@/lib/socialCrewStore";
import { GET as readCrew, PATCH as changeCrew } from "@/app/api/social/crews/[crewId]/route";
import {
  PATCH as decideInvitation,
  DELETE as revokeInvitation,
} from "@/app/api/social/crews/[crewId]/invitations/[invitationId]/route";
import { POST as inviteMember } from "@/app/api/social/crews/[crewId]/invitations/route";
import { PATCH as decideJoinRequest } from "@/app/api/social/crews/[crewId]/join-requests/[requestId]/route";
import {
  POST as requestJoin,
  DELETE as cancelJoinRequest,
} from "@/app/api/social/crews/[crewId]/join-requests/route";
import { POST as leaveCrew } from "@/app/api/social/crews/[crewId]/leave/route";
import {
  PATCH as changeMember,
  DELETE as removeMember,
} from "@/app/api/social/crews/[crewId]/members/[memberId]/route";
import { POST as createCrew } from "@/app/api/social/crews/route";

function context<Params extends Record<string, string>>(
  params: Params,
): { params: Promise<Params> } {
  return { params: Promise.resolve(params) };
}

function request(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function mutationRequest(url: string, method: string, body?: unknown): Request {
  return request(url, method, body, { "idempotency-key": IDEMPOTENCY_KEY });
}

function expectPrivate(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

beforeEach(() => {
  vi.clearAllMocks();
  state.access = { ok: true, actor };
  state.limited = false;
  store.read.mockResolvedValue(crew);
  store.create.mockResolvedValue({
    code: "created",
    replayed: false,
    crewId: CREW_ID,
    memberId: ALICE_MEMBER_ID,
  });
  store.invite.mockResolvedValue({
    code: "invited",
    replayed: false,
    invitationId: INVITATION_ID,
  });
  store.acceptInvitation.mockResolvedValue({ code: "accepted", replayed: false, memberId: BOB_MEMBER_ID });
  store.revokeInvitation.mockResolvedValue({ code: "revoked", replayed: false, invitationId: INVITATION_ID });
  store.requestJoin.mockResolvedValue({ code: "requested", replayed: false, requestId: REQUEST_ID });
  store.decideJoin.mockResolvedValue({ code: "accepted", replayed: false, memberId: BOB_MEMBER_ID });
  store.setRole.mockResolvedValue({ code: "updated", replayed: false, memberId: BOB_MEMBER_ID });
  store.transferOwner.mockResolvedValue({ code: "transferred", replayed: false, memberId: BOB_MEMBER_ID });
  store.removeMember.mockResolvedValue({ code: "removed", replayed: false, memberId: BOB_MEMBER_ID });
  store.leave.mockResolvedValue({ code: "left", replayed: false, memberId: ALICE_MEMBER_ID });
  store.updateVisibility.mockResolvedValue({ code: "updated", replayed: false, authorityRevision: 2 });
});

describe("Social Crew route authority and HTTP policy", () => {
  it.each([
    ["Crew creation", (request: Request) => createCrew(request)],
    ["Crew read", readCrew],
    ["Crew visibility", changeCrew],
    ["invitation creation", inviteMember],
    ["invitation decision", decideInvitation],
    ["invitation revocation", revokeInvitation],
    ["Join Request creation", requestJoin],
    ["Join Request cancellation", cancelJoinRequest],
    ["Join Request decision", decideJoinRequest],
    ["member change", changeMember],
    ["member removal", removeMember],
    ["leave", leaveCrew],
  ] as const)("resolves actor before request data for %s", async (_label, invoke) => {
    state.access = {
      ok: false,
      status: 401,
      code: "SOCIAL_SIGN_IN_REQUIRED",
      error: "Sign in to use Social.",
    };
    let parameterReads = 0;
    const routeContext = Object.defineProperty({}, "params", {
      get() {
        parameterReads += 1;
        throw new Error("Route parameters were read before actor authority.");
      },
    }) as never;
    const deniedRequest = new Request("http://localhost/api/social/crews/not-read", {
      method: "POST",
      body: "{not-json",
    });

    const response = await invoke(deniedRequest, routeContext);

    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(parameterReads).toBe(0);
    expect(deniedRequest.bodyUsed).toBe(false);
    for (const operation of Object.values(store)) expect(operation).not.toHaveBeenCalled();
  });

  it.each([
    [
      { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." },
      401,
      { code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social.", retryable: false },
    ],
    [
      { ok: false, status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", error: "Adult verification is needed for Social." },
      403,
      { code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", error: "Adult verification is needed for Social.", retryable: false },
    ],
    [
      { ok: false, status: 503, code: "SOCIAL_ACCESS_UNAVAILABLE", error: "Social access checks are unavailable right now.", retryable: true },
      503,
      { code: "SOCIAL_ACCESS_UNAVAILABLE", error: "Social access checks are unavailable right now.", retryable: true },
    ],
  ] as const)("resolves verified Social authority before parsing request bodies %#", async (access, status, output) => {
    state.access = access;
    const response = await createCrew(new Request("http://localhost/api/social/crews", {
      method: "POST",
      body: "{not-json",
    }));

    expect(response.status).toBe(status);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual(output);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("reads a complete safe Crew DTO only after verified actor resolution", async () => {
    const response = await readCrew(
      new Request(`http://localhost/api/social/crews/${CREW_ID}`),
      context({ crewId: CREW_ID }),
    );

    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual(crew);
    expect(store.read).toHaveBeenCalledWith(CREW_ID, actor);
  });

  it("maps stable store failures without leaking protected authority", async () => {
    const cases = [
      [new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."), 422, {
        code: "INVALID_SOCIAL_CREW_REQUEST",
        error: "Social Crew request is not valid.",
        retryable: false,
      }],
      [new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found."), 404, {
        code: "SOCIAL_CREW_NOT_FOUND",
        error: "Social Crew not found.",
        retryable: false,
      }],
      [new SocialCrewStoreError("CONFLICT", 409, "Social Crew changed before this request."), 409, {
        code: "SOCIAL_CREW_CONFLICT",
        error: "Social Crew changed before this request.",
        retryable: false,
      }],
      [new SocialCrewStoreError("UNAVAILABLE", 503, "Social Crew is unavailable right now."), 503, {
        code: "SOCIAL_CREW_UNAVAILABLE",
        error: "Social Crew is unavailable right now.",
        retryable: true,
      }],
    ] as const;

    for (const [error, status, output] of cases) {
      store.read.mockRejectedValueOnce(error);
      const response = await readCrew(
        new Request(`http://localhost/api/social/crews/${CREW_ID}`),
        context({ crewId: CREW_ID }),
      );
      expect(response.status).toBe(status);
      expectPrivate(response);
      await expect(response.json()).resolves.toEqual(output);
    }
  });

  it("maps unexpected store failures to retryable dependency unavailability", async () => {
    store.read.mockRejectedValueOnce(new Error("database secret must not leak"));
    const response = await readCrew(
      new Request(`http://localhost/api/social/crews/${CREW_ID}`),
      context({ crewId: CREW_ID }),
    );

    expect(response.status).toBe(503);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      code: "SOCIAL_CREW_UNAVAILABLE",
      error: "Social Crew is unavailable right now.",
      retryable: true,
    });
  });

  it("requires one bounded JSON object and one header-only idempotency key", async () => {
    const malformed = await createCrew(new Request("http://localhost/api/social/crews", {
      method: "POST",
      headers: {
        authorization: `Bearer ${HOST_CAPABILITY}`,
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      body: "{not-json",
    }));
    expect(malformed.status).toBe(422);
    expectPrivate(malformed);

    const missingKey = await createCrew(request(
      "http://localhost/api/social/crews",
      "POST",
      { planId: PLAN_ID, visibility: "private" },
      { authorization: `Bearer ${HOST_CAPABILITY}` },
    ));
    expect(missingKey.status).toBe(422);

    const bodyFallback = await createCrew(request(
      "http://localhost/api/social/crews",
      "POST",
      { planId: PLAN_ID, visibility: "private", idempotencyKey: IDEMPOTENCY_KEY },
      { authorization: `Bearer ${HOST_CAPABILITY}` },
    ));
    expect(bodyFallback.status).toBe(422);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies after actor verification", async () => {
    const response = await createCrew(new Request("http://localhost/api/social/crews", {
      method: "POST",
      headers: {
        authorization: `Bearer ${HOST_CAPABILITY}`,
        "content-length": "9000",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      body: "{}",
    }));

    expect(response.status).toBe(422);
    expectPrivate(response);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("rate-limits mutations by verified profile without reading request data", async () => {
    state.limited = true;
    const response = await createCrew(new Request("http://localhost/api/social/crews", {
      method: "POST",
      body: "{not-json",
    }));

    expect(response.status).toBe(429);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      code: "SOCIAL_CREW_RATE_LIMITED",
      error: "Too many Social Crew changes. Slow down.",
      retryable: true,
    });
    expect(vi.mocked(isLimited)).toHaveBeenCalledWith(
      `social-crew:hashed-${ALICE_PROFILE_ID}`,
      `social-crew:hashed-${ALICE_PROFILE_ID}`,
      30,
      60_000,
    );
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe("Social Crew membership routes", () => {
  it("creates one Crew with verified ownership and header-only legacy host capability", async () => {
    const response = await createCrew(request(
      "http://localhost/api/social/crews",
      "POST",
      { planId: PLAN_ID, visibility: "private" },
      {
        authorization: `Bearer ${HOST_CAPABILITY}`,
        "idempotency-key": IDEMPOTENCY_KEY,
      },
    ));

    expect(response.status).toBe(201);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      code: "created",
      replayed: false,
      crewId: CREW_ID,
      memberId: ALICE_MEMBER_ID,
    });
    expect(store.create).toHaveBeenCalledWith(actor, {
      planId: PLAN_ID,
      hostCapability: HOST_CAPABILITY,
      visibility: "private",
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it.each([
    [{ planId: PLAN_ID, visibility: "private", ownerAccountId: ALICE_ACCOUNT_ID }],
    [{ planId: PLAN_ID, visibility: "private", actor }],
    [{ planId: PLAN_ID, visibility: "private", role: "owner" }],
    [{ planId: PLAN_ID, visibility: "private", hostCapability: HOST_CAPABILITY }],
  ])("rejects forged creation authority fields %#", async (body) => {
    const response = await createCrew(request(
      "http://localhost/api/social/crews",
      "POST",
      body,
      {
        authorization: `Bearer ${HOST_CAPABILITY}`,
        "idempotency-key": IDEMPOTENCY_KEY,
      },
    ));

    expect(response.status).toBe(422);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("requires a bearer host capability only during Crew creation", async () => {
    const missing = await createCrew(mutationRequest(
      "http://localhost/api/social/crews",
      "POST",
      { planId: PLAN_ID, visibility: "private" },
    ));
    expect(missing.status).toBe(422);

    const invitation = await inviteMember(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/invitations`,
      "POST",
      { targetProfileId: BOB_PROFILE_ID },
    ), context({ crewId: CREW_ID }));
    expect(invitation.status).toBe(201);
    expect(store.invite).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      targetProfileId: BOB_PROFILE_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(store.invite.mock.calls[0]?.[1]).not.toHaveProperty("hostCapability");
  });

  it("invites only a target profile and rejects forged account authority", async () => {
    const forged = await inviteMember(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/invitations`,
      "POST",
      { targetProfileId: BOB_PROFILE_ID, targetAccountId: "forged" },
    ), context({ crewId: CREW_ID }));
    expect(forged.status).toBe(422);
    expect(store.invite).not.toHaveBeenCalled();
  });

  it("accepts or declines an invitation and revokes through DELETE", async () => {
    const accepted = await decideInvitation(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/invitations/${INVITATION_ID}`,
      "PATCH",
      { action: "accept" },
    ), context({ crewId: CREW_ID, invitationId: INVITATION_ID }));
    expect(accepted.status).toBe(200);
    expect(store.acceptInvitation).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      action: "accept",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    await decideInvitation(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/invitations/${INVITATION_ID}`,
      "PATCH",
      { action: "decline" },
    ), context({ crewId: CREW_ID, invitationId: INVITATION_ID }));
    expect(store.acceptInvitation).toHaveBeenLastCalledWith(actor, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      action: "decline",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const revoked = await revokeInvitation(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/invitations/${INVITATION_ID}`,
      "DELETE",
    ), context({ crewId: CREW_ID, invitationId: INVITATION_ID }));
    expect(revoked.status).toBe(200);
    expect(store.revokeInvitation).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("requests or cancels own membership and decides a scoped Join Request", async () => {
    const requested = await requestJoin(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/join-requests`,
      "POST",
    ), context({ crewId: CREW_ID }));
    expect(requested.status).toBe(201);
    expect(store.requestJoin).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      action: "request",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const cancelled = await cancelJoinRequest(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/join-requests`,
      "DELETE",
    ), context({ crewId: CREW_ID }));
    expect(cancelled.status).toBe(200);
    expect(store.requestJoin).toHaveBeenLastCalledWith(actor, {
      crewId: CREW_ID,
      action: "cancel",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const decided = await decideJoinRequest(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/join-requests/${REQUEST_ID}`,
      "PATCH",
      { decision: "accept" },
    ), context({ crewId: CREW_ID, requestId: REQUEST_ID }));
    expect(decided.status).toBe(200);
    expect(store.decideJoin).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      requestId: REQUEST_ID,
      decision: "accept",
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it.each([
    {
      label: "invitation acceptance",
      invoke: () => decideInvitation(mutationRequest(
        `http://localhost/api/social/crews/${OTHER_CREW_ID}/invitations/${INVITATION_ID}`,
        "PATCH",
        { action: "accept" },
      ), context({ crewId: OTHER_CREW_ID, invitationId: INVITATION_ID })),
      operation: store.acceptInvitation,
      input: {
        crewId: OTHER_CREW_ID,
        invitationId: INVITATION_ID,
        action: "accept",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    },
    {
      label: "invitation decline",
      invoke: () => decideInvitation(mutationRequest(
        `http://localhost/api/social/crews/${OTHER_CREW_ID}/invitations/${INVITATION_ID}`,
        "PATCH",
        { action: "decline" },
      ), context({ crewId: OTHER_CREW_ID, invitationId: INVITATION_ID })),
      operation: store.acceptInvitation,
      input: {
        crewId: OTHER_CREW_ID,
        invitationId: INVITATION_ID,
        action: "decline",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    },
    {
      label: "invitation revocation",
      invoke: () => revokeInvitation(mutationRequest(
        `http://localhost/api/social/crews/${OTHER_CREW_ID}/invitations/${INVITATION_ID}`,
        "DELETE",
      ), context({ crewId: OTHER_CREW_ID, invitationId: INVITATION_ID })),
      operation: store.revokeInvitation,
      input: {
        crewId: OTHER_CREW_ID,
        invitationId: INVITATION_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    },
    {
      label: "Join Request decision",
      invoke: () => decideJoinRequest(mutationRequest(
        `http://localhost/api/social/crews/${OTHER_CREW_ID}/join-requests/${REQUEST_ID}`,
        "PATCH",
        { decision: "decline" },
      ), context({ crewId: OTHER_CREW_ID, requestId: REQUEST_ID })),
      operation: store.decideJoin,
      input: {
        crewId: OTHER_CREW_ID,
        requestId: REQUEST_ID,
        decision: "decline",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    },
  ])("keeps parent Crew scope for mismatched $label", async ({ invoke, operation, input }) => {
    operation.mockRejectedValueOnce(
      new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found."),
    );

    const response = await invoke();

    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(operation).toHaveBeenCalledWith(actor, input);
  });

  it("changes a scoped member role, transfers ownership, and removes the member", async () => {
    const role = await changeMember(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/members/${BOB_MEMBER_ID}`,
      "PATCH",
      { action: "set_role", role: "cohost" },
    ), context({ crewId: CREW_ID, memberId: BOB_MEMBER_ID }));
    expect(role.status).toBe(200);
    expect(store.setRole).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      memberId: BOB_MEMBER_ID,
      role: "cohost",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const transferred = await changeMember(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/members/${BOB_MEMBER_ID}`,
      "PATCH",
      { action: "transfer_owner" },
    ), context({ crewId: CREW_ID, memberId: BOB_MEMBER_ID }));
    expect(transferred.status).toBe(200);
    expect(store.transferOwner).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      memberId: BOB_MEMBER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const removed = await removeMember(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/members/${BOB_MEMBER_ID}`,
      "DELETE",
    ), context({ crewId: CREW_ID, memberId: BOB_MEMBER_ID }));
    expect(removed.status).toBe(200);
    expect(store.removeMember).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      memberId: BOB_MEMBER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("rejects forged role authority instead of treating it as owner proof", async () => {
    const response = await changeMember(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/members/${BOB_MEMBER_ID}`,
      "PATCH",
      { action: "set_role", role: "cohost", actorRole: "owner" },
    ), context({ crewId: CREW_ID, memberId: BOB_MEMBER_ID }));

    expect(response.status).toBe(422);
    expect(store.setRole).not.toHaveBeenCalled();
  });

  it("changes visibility with the current revision and allows a non-owner to leave", async () => {
    const visibility = await changeCrew(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}`,
      "PATCH",
      { visibility: "private", expectedAuthorityRevision: 1 },
    ), context({ crewId: CREW_ID }));
    expect(visibility.status).toBe(200);
    expect(store.updateVisibility).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      visibility: "private",
      expectedAuthorityRevision: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const left = await leaveCrew(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}/leave`,
      "POST",
    ), context({ crewId: CREW_ID }));
    expect(left.status).toBe(200);
    expect(store.leave).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it.each([
    2_147_483_648,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects authority revision %s outside PostgreSQL int4", async (expectedAuthorityRevision) => {
    const response = await changeCrew(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}`,
      "PATCH",
      { visibility: "private", expectedAuthorityRevision },
    ), context({ crewId: CREW_ID }));

    expect(response.status).toBe(422);
    expect(store.updateVisibility).not.toHaveBeenCalled();
  });

  it("accepts the maximum PostgreSQL int4 authority revision", async () => {
    const response = await changeCrew(mutationRequest(
      `http://localhost/api/social/crews/${CREW_ID}`,
      "PATCH",
      { visibility: "private", expectedAuthorityRevision: 2_147_483_647 },
    ), context({ crewId: CREW_ID }));

    expect(response.status).toBe(200);
    expect(store.updateVisibility).toHaveBeenCalledWith(actor, {
      crewId: CREW_ID,
      visibility: "private",
      expectedAuthorityRevision: 2_147_483_647,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });
});
