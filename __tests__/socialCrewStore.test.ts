import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PlanState } from "@/lib/plan";
import {
  SocialCrewStoreError,
  createSocialCrewStore,
  type SocialCrewRpcName,
  type SocialCrewStoreDependencies,
} from "@/lib/socialCrewStore";
import type { SocialPostActor } from "@/lib/socialPostStore";
import type { RawSocialCrew } from "@/lib/socialCrewProjection.server";

const ALICE_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const ALICE_PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const ALICE_MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const ALICE_PLAN_MEMBER_ID = "40000000-0000-4000-8000-000000000001";
const BOB_ACCOUNT_ID = "10000000-0000-4000-8000-000000000002";
const BOB_PROFILE_ID = "20000000-0000-4000-8000-000000000002";
const BOB_MEMBER_ID = "30000000-0000-4000-8000-000000000002";
const BOB_PLAN_MEMBER_ID = "40000000-0000-4000-8000-000000000002";
const CREW_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_CREW_ID = "50000000-0000-4000-8000-000000000002";
const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const INVITATION_ID = "70000000-0000-4000-8000-000000000001";
const REQUEST_ID = "80000000-0000-4000-8000-000000000001";
const KEY_A = "store-test-key-0001";
const KEY_B = "store-test-key-0002";

const alice: SocialPostActor = {
  accountId: ALICE_ACCOUNT_ID,
  profileId: ALICE_PROFILE_ID,
  handle: "alice",
};

const bob: SocialPostActor = {
  accountId: BOB_ACCOUNT_ID,
  profileId: BOB_PROFILE_ID,
  handle: "bob-new",
};

const planState: PlanState = {
  plan: {
    id: PLAN_ID,
    title: "Friday in Camden",
    startTime: "2026-08-07T18:30:00.000Z",
    createdAt: "2026-08-05T12:00:00.000Z",
    routeRevision: 4,
    status: "ready",
  },
  stops: [
    { venueId: "venue-a", venueName: "The First", position: 0 },
    { venueId: "venue-b", venueName: "The Second", position: 1 },
  ],
  crew: [
    {
      id: "legacy-plan-member",
      name: "Old guest",
      status: "in",
      joinedAt: "2026-08-05T12:00:00.000Z",
      updatedAt: "2026-08-05T12:00:00.000Z",
    },
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
  actions: [
    {
      id: "action-a",
      type: "arrived",
      stopPosition: 0,
      ending: null,
      createdAt: "2026-08-07T19:00:00.000Z",
    },
  ],
  ending: null,
};

function rawCrew(overrides: Partial<RawSocialCrew> = {}): RawSocialCrew {
  return {
    crewId: CREW_ID,
    planId: PLAN_ID,
    ownerAccountId: ALICE_ACCOUNT_ID,
    ownerProfileId: ALICE_PROFILE_ID,
    visibility: "friends",
    authorityRevision: 1,
    joinRequestState: "none",
    members: [
      {
        memberId: ALICE_MEMBER_ID,
        accountId: ALICE_ACCOUNT_ID,
        profileId: ALICE_PROFILE_ID,
        planMemberId: ALICE_PLAN_MEMBER_ID,
        handle: "alice",
        role: "owner",
        state: "active",
        joinedAt: "2026-08-05T12:00:00.000Z",
      },
      {
        memberId: BOB_MEMBER_ID,
        accountId: BOB_ACCOUNT_ID,
        profileId: BOB_PROFILE_ID,
        planMemberId: BOB_PLAN_MEMBER_ID,
        handle: "bob-new",
        role: "member",
        state: "active",
        joinedAt: "2026-08-05T12:05:00.000Z",
      },
    ],
    ...overrides,
  };
}

type RpcCall = { name: SocialCrewRpcName; input: Record<string, unknown> };

function dependencies(options: {
  rpc?: SocialCrewStoreDependencies["rpc"];
  snapshot?: SocialCrewStoreDependencies["snapshot"];
} = {}): SocialCrewStoreDependencies & { calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  return {
    calls,
    async rpc(name, input) {
      calls.push({ name, input });
      if (options.rpc) return options.rpc(name, input);
      return { ok: true, code: "updated", member_id: BOB_MEMBER_ID };
    },
    async snapshot(name, input) {
      if (options.snapshot) return options.snapshot(name, input);
      return {
        kind: "member",
        ownerRelationship: input.p_viewer_profile_id === ALICE_PROFILE_ID
          ? "self"
          : "mutual",
        crew: rawCrew(),
        plan: planState,
      };
    },
    signingKey: () => Buffer.from("social-crew-store-test-signing-key-0001"),
  };
}

async function expectStoreError(
  promise: Promise<unknown>,
  code: SocialCrewStoreError["code"],
  status: SocialCrewStoreError["status"],
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected SocialCrewStoreError.");
  } catch (error) {
    expect(error).toBeInstanceOf(SocialCrewStoreError);
    expect(error).toMatchObject({ code, status });
  }
}

describe("SocialCrewStore durable writes", () => {
  it("returns dependency unavailable when durable RPC access fails, without retaining a memory write", async () => {
    let attempts = 0;
    const deps = dependencies({
      rpc: async () => {
        attempts += 1;
        throw new Error("Supabase not configured.");
      },
    });
    const store = createSocialCrewStore(deps);
    const input = {
      planId: PLAN_ID,
      hostCapability: "host-capability",
      visibility: "private" as const,
      idempotencyKey: KEY_A,
    };

    await expectStoreError(store.create(alice, input), "UNAVAILABLE", 503);
    await expectStoreError(store.create(alice, input), "UNAVAILABLE", 503);
    expect(attempts).toBe(2);
  });

  it("derives create ownership from verified actor account and hashes the host capability", async () => {
    const deps = dependencies({
      rpc: async () => ({
        ok: true,
        code: "created",
        crew_id: CREW_ID,
        member_id: ALICE_MEMBER_ID,
        owner_account_id: "forged-account-must-not-return",
      }),
    });
    const store = createSocialCrewStore(deps);

    const result = await store.create(alice, {
      planId: PLAN_ID,
      hostCapability: "one-time-host-capability",
      visibility: "private",
      idempotencyKey: KEY_A,
      ...({ actorAccountId: BOB_ACCOUNT_ID, ownerAccountId: BOB_ACCOUNT_ID } as object),
    });

    expect(result).toEqual({
      code: "created",
      replayed: false,
      crewId: CREW_ID,
      memberId: ALICE_MEMBER_ID,
    });
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]).toMatchObject({
      name: "create_social_crew_atomic",
      input: {
        p_actor_account_id: ALICE_ACCOUNT_ID,
        p_plan_id: PLAN_ID,
        p_visibility: "private",
        p_idempotency_key: KEY_A,
      },
    });
    expect(deps.calls[0]?.input.p_host_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(deps.calls[0]?.input.p_host_token_hash).not.toBe("one-time-host-capability");
    expect(deps.calls[0]?.input).not.toHaveProperty("p_owner_account_id");
  });

  it("maps a malformed host capability to invalid without calling storage", async () => {
    const deps = dependencies();
    const store = createSocialCrewStore(deps);

    await expectStoreError(Promise.resolve().then(() => store.create(alice, {
      planId: PLAN_ID,
      hostCapability: null as unknown as string,
      visibility: "private",
      idempotencyKey: KEY_A,
    })), "INVALID", 400);
    expect(deps.calls).toHaveLength(0);
  });

  it("accepts only scoped member IDs for role writes and never accepts account authority fields", async () => {
    const deps = dependencies();
    const store = createSocialCrewStore(deps);

    const result = await store.setRole(alice, {
      crewId: CREW_ID,
      memberId: BOB_MEMBER_ID,
      role: "cohost",
      idempotencyKey: KEY_A,
      ...({ targetAccountId: BOB_ACCOUNT_ID, actorRole: "owner" } as object),
    });

    expect(result).toMatchObject({ code: "updated", memberId: BOB_MEMBER_ID });
    expect(deps.calls[0]).toMatchObject({
      name: "set_social_crew_role_atomic",
      input: {
        p_actor_account_id: ALICE_ACCOUNT_ID,
        p_crew_id: CREW_ID,
        p_target_member_id: BOB_MEMBER_ID,
        p_role: "cohost",
      },
    });
    expect(deps.calls[0]?.input).not.toHaveProperty("p_target_account_id");
    expect(deps.calls[0]?.input).not.toHaveProperty("p_actor_role");
  });

  it("derives the same digest for a same-key same-payload replay", async () => {
    const receipts = new Map<string, string>();
    const deps = dependencies({
      rpc: async (_name, input) => {
        const key = String(input.p_idempotency_key);
        const digest = String(input.p_payload_digest);
        const previous = receipts.get(key);
        if (previous && previous !== digest) return { ok: false, code: "idempotency_conflict" };
        receipts.set(key, digest);
        return previous
          ? { ok: true, code: "replayed", invitation_id: INVITATION_ID }
          : { ok: true, code: "invited", invitation_id: INVITATION_ID };
      },
    });
    const store = createSocialCrewStore(deps);
    const input = {
      crewId: CREW_ID,
      targetProfileId: BOB_PROFILE_ID,
      idempotencyKey: KEY_A,
    };

    await expect(store.invite(alice, input)).resolves.toMatchObject({ code: "invited", replayed: false });
    await expect(store.invite(alice, input)).resolves.toEqual({
      code: "replayed",
      replayed: true,
      invitationId: INVITATION_ID,
    });
    expect(deps.calls[0]?.input.p_payload_digest).toBe(deps.calls[1]?.input.p_payload_digest);
  });

  it("maps same-key changed-payload receipts to conflict", async () => {
    const receipts = new Map<string, string>();
    const deps = dependencies({
      rpc: async (_name, input) => {
        const key = String(input.p_idempotency_key);
        const digest = String(input.p_payload_digest);
        const previous = receipts.get(key);
        if (previous && previous !== digest) return { ok: false, code: "idempotency_conflict" };
        receipts.set(key, digest);
        return { ok: true, code: "invited", invitation_id: INVITATION_ID };
      },
    });
    const store = createSocialCrewStore(deps);

    await store.invite(alice, {
      crewId: CREW_ID,
      targetProfileId: BOB_PROFILE_ID,
      idempotencyKey: KEY_A,
    });
    await expectStoreError(store.invite(alice, {
      crewId: CREW_ID,
      targetProfileId: "20000000-0000-4000-8000-000000000003",
      idempotencyKey: KEY_A,
    }), "CONFLICT", 409);
  });

  it("treats a different idempotency key as an independent request", async () => {
    const seenKeys: string[] = [];
    const deps = dependencies({
      rpc: async (_name, input) => {
        seenKeys.push(String(input.p_idempotency_key));
        return { ok: true, code: "requested", request_id: REQUEST_ID };
      },
    });
    const store = createSocialCrewStore(deps);

    await store.requestJoin(bob, { crewId: CREW_ID, action: "request", idempotencyKey: KEY_A });
    await store.requestJoin(bob, { crewId: CREW_ID, action: "request", idempotencyKey: KEY_B });

    expect(seenKeys).toEqual([KEY_A, KEY_B]);
    expect(deps.calls[0]?.input.p_payload_digest).toBe(deps.calls[1]?.input.p_payload_digest);
  });

  it.each(["short", "x".repeat(129)])("rejects an out-of-range idempotency key before RPC: %s", async (idempotencyKey) => {
    const deps = dependencies();
    const store = createSocialCrewStore(deps);

    await expectStoreError(store.leave(bob, { crewId: CREW_ID, idempotencyKey }), "INVALID", 400);
    expect(deps.calls).toHaveLength(0);
  });

  it("maps protected denial to not found", async () => {
    const store = createSocialCrewStore(dependencies({
      rpc: async () => ({ ok: false, code: "not_found" }),
    }));

    await expectStoreError(store.removeMember(bob, {
      crewId: CREW_ID,
      memberId: ALICE_MEMBER_ID,
      idempotencyKey: KEY_A,
    }), "NOT_FOUND", 404);
  });

  it("maps an RPC dependency error to unavailable", async () => {
    const store = createSocialCrewStore(dependencies({
      rpc: async () => ({ data: null, error: { message: "schema cache unavailable" } }),
    }));

    await expectStoreError(store.invite(alice, {
      crewId: CREW_ID,
      targetProfileId: BOB_PROFILE_ID,
      idempotencyKey: KEY_A,
    }), "UNAVAILABLE", 503);
  });

  it("fails closed when a durable RPC returns an unknown success code", async () => {
    const store = createSocialCrewStore(dependencies({
      rpc: async () => ({ ok: true, code: "unexpected_success" }),
    }));

    await expectStoreError(store.leave(bob, {
      crewId: CREW_ID,
      idempotencyKey: KEY_A,
    }), "UNAVAILABLE", 503);
  });

  it.each([
    {
      label: "create rejects another operation's known code",
      response: { ok: true, code: "invited", invitation_id: INVITATION_ID },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.create(alice, {
        planId: PLAN_ID,
        hostCapability: "host-capability",
        visibility: "private",
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "create requires both scoped result IDs",
      response: { ok: true, code: "created", crew_id: CREW_ID },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.create(alice, {
        planId: PLAN_ID,
        hostCapability: "host-capability",
        visibility: "private",
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "invite requires invitation ID",
      response: { ok: true, code: "invited" },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.invite(alice, {
        crewId: CREW_ID,
        targetProfileId: BOB_PROFILE_ID,
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "accepted invitation requires member ID",
      response: { ok: true, code: "accepted" },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.acceptInvitation(bob, {
        crewId: CREW_ID,
        invitationId: INVITATION_ID,
        action: "accept",
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "Join Request requires request ID",
      response: { ok: true, code: "requested" },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.requestJoin(bob, {
        crewId: CREW_ID,
        action: "request",
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "accepted Join Request decision requires member ID",
      response: { ok: true, code: "accepted", member_id: "not-a-uuid" },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.decideJoin(alice, {
        crewId: CREW_ID,
        requestId: REQUEST_ID,
        decision: "accept",
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "role update requires member ID",
      response: { ok: true, code: "updated" },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.setRole(alice, {
        crewId: CREW_ID,
        memberId: BOB_MEMBER_ID,
        role: "cohost",
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "leave rejects another member operation's known code",
      response: { ok: true, code: "removed", member_id: BOB_MEMBER_ID },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.leave(bob, {
        crewId: CREW_ID,
        idempotencyKey: KEY_A,
      }),
    },
    {
      label: "visibility update requires integer revision",
      response: { ok: true, code: "updated", authority_revision: "2" },
      run: (store: ReturnType<typeof createSocialCrewStore>) => store.updateVisibility(alice, {
        crewId: CREW_ID,
        visibility: "private",
        expectedAuthorityRevision: 1,
        idempotencyKey: KEY_A,
      }),
    },
  ])("fails closed when $label", async ({ response, run }) => {
    const store = createSocialCrewStore(dependencies({ rpc: async () => response }));

    await expectStoreError(run(store), "UNAVAILABLE", 503);
  });

  it("lets a non-owner leave without a friendship precheck", async () => {
    const snapshot = vi.fn();
    const deps = dependencies({
      rpc: async () => ({ ok: true, code: "left", member_id: BOB_MEMBER_ID }),
      snapshot,
    });
    const store = createSocialCrewStore(deps);

    await expect(store.leave(bob, {
      crewId: CREW_ID,
      idempotencyKey: KEY_A,
    })).resolves.toEqual({
      code: "left",
      replayed: false,
      memberId: BOB_MEMBER_ID,
    });
    expect(snapshot).not.toHaveBeenCalled();
    expect(deps.calls[0]?.input.p_actor_account_id).toBe(BOB_ACCOUNT_ID);
  });

  it("keeps Plan-member provenance private and relies on acceptance reactivation", async () => {
    const deps = dependencies({
      rpc: async (name) => name === "leave_social_crew_atomic"
        ? { ok: true, code: "left", member_id: BOB_MEMBER_ID, plan_member_id: BOB_PLAN_MEMBER_ID }
        : { ok: true, code: "accepted", member_id: BOB_MEMBER_ID, plan_member_id: BOB_PLAN_MEMBER_ID },
    });
    const store = createSocialCrewStore(deps);

    const left = await store.leave(bob, { crewId: CREW_ID, idempotencyKey: KEY_A });
    const reactivated = await store.acceptInvitation(bob, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      action: "accept",
      idempotencyKey: KEY_B,
    });

    expect(left).toEqual({ code: "left", replayed: false, memberId: BOB_MEMBER_ID });
    expect(reactivated).toEqual({ code: "accepted", replayed: false, memberId: BOB_MEMBER_ID });
    expect(deps.calls[1]?.input).not.toHaveProperty("p_plan_member_id");
    expect(reactivated).not.toHaveProperty("planMemberId");
  });

  it("revokes an invitation through the service-only atomic RPC", async () => {
    const deps = dependencies({
      rpc: async () => ({ ok: true, code: "revoked", invitation_id: INVITATION_ID }),
    });
    const store = createSocialCrewStore(deps);

    await expect(store.revokeInvitation(alice, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      idempotencyKey: KEY_A,
    })).resolves.toEqual({
      code: "revoked",
      replayed: false,
      invitationId: INVITATION_ID,
    });
    expect(deps.calls[0]).toEqual({
      name: "revoke_social_crew_invitation_atomic",
      input: {
        p_actor_account_id: ALICE_ACCOUNT_ID,
        p_crew_id: CREW_ID,
        p_invitation_id: INVITATION_ID,
        p_idempotency_key: KEY_A,
        p_payload_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  it("maps parent Crew IDs into nested child RPCs", async () => {
    const responses: Partial<Record<SocialCrewRpcName, Record<string, unknown>>> = {
      accept_social_crew_invitation_atomic: {
        ok: true,
        code: "declined",
      },
      revoke_social_crew_invitation_atomic: {
        ok: true,
        code: "revoked",
        invitation_id: INVITATION_ID,
      },
      decide_social_crew_join_request_atomic: {
        ok: true,
        code: "declined",
      },
    };
    const deps = dependencies({
      rpc: async (name) => responses[name] ?? { ok: false, code: "invalid" },
    });
    const store = createSocialCrewStore(deps);

    await store.acceptInvitation(bob, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      action: "decline",
      idempotencyKey: KEY_A,
    });
    await store.revokeInvitation(alice, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      idempotencyKey: KEY_B,
    });
    await store.decideJoin(alice, {
      crewId: CREW_ID,
      requestId: REQUEST_ID,
      decision: "decline",
      idempotencyKey: "store-test-key-0003",
    });

    expect(deps.calls.map(({ name, input }) => ({
      name,
      crewId: input.p_crew_id,
    }))).toEqual([
      { name: "accept_social_crew_invitation_atomic", crewId: CREW_ID },
      { name: "revoke_social_crew_invitation_atomic", crewId: CREW_ID },
      { name: "decide_social_crew_join_request_atomic", crewId: CREW_ID },
    ]);
  });

  it("binds nested child idempotency to parent Crew scope", async () => {
    let storedDigest = "";
    const deps = dependencies({
      rpc: async (_name, input) => {
        const digest = String(input.p_payload_digest);
        if (!storedDigest) {
          storedDigest = digest;
          return { ok: true, code: "accepted", member_id: BOB_MEMBER_ID };
        }
        return digest === storedDigest
          ? { ok: true, code: "replayed", member_id: BOB_MEMBER_ID }
          : { ok: false, code: "not_found" };
      },
    });
    const store = createSocialCrewStore(deps);

    await store.acceptInvitation(bob, {
      crewId: CREW_ID,
      invitationId: INVITATION_ID,
      action: "accept",
      idempotencyKey: KEY_A,
    });
    await expectStoreError(store.acceptInvitation(bob, {
      crewId: OTHER_CREW_ID,
      invitationId: INVITATION_ID,
      action: "accept",
      idempotencyKey: KEY_A,
    }), "NOT_FOUND", 404);

    expect(deps.calls.map(({ input }) => input.p_crew_id)).toEqual([
      CREW_ID,
      OTHER_CREW_ID,
    ]);
    expect(deps.calls[0]?.input.p_payload_digest).not.toBe(
      deps.calls[1]?.input.p_payload_digest,
    );
  });

  it("passes owner visibility revision and maps stale revision to conflict", async () => {
    const deps = dependencies({
      rpc: async (_name, input) => input.p_expected_authority_revision === 1
        ? { ok: true, code: "updated", authority_revision: 2 }
        : { ok: false, code: "conflict" },
    });
    const store = createSocialCrewStore(deps);

    await expect(store.updateVisibility(alice, {
      crewId: CREW_ID,
      visibility: "private",
      expectedAuthorityRevision: 1,
      idempotencyKey: KEY_A,
    })).resolves.toEqual({
      code: "updated",
      replayed: false,
      authorityRevision: 2,
    });
    await expectStoreError(store.updateVisibility(alice, {
      crewId: CREW_ID,
      visibility: "friends",
      expectedAuthorityRevision: 0,
      idempotencyKey: KEY_B,
    }), "CONFLICT", 409);
    expect(deps.calls[0]?.input.p_actor_account_id).toBe(ALICE_ACCOUNT_ID);
  });

  it("maps owner-only visibility denial to the same not-found error", async () => {
    const store = createSocialCrewStore(dependencies({
      rpc: async () => ({ ok: false, code: "not_found" }),
    }));

    await expectStoreError(store.updateVisibility(bob, {
      crewId: CREW_ID,
      visibility: "private",
      expectedAuthorityRevision: 1,
      idempotencyKey: KEY_A,
    }), "NOT_FOUND", 404);
  });
});

describe("SocialCrewStore protected projection", () => {
  it("projects an atomic member snapshot and sends current actor binding", async () => {
    const snapshot = vi.fn(async () => ({
      kind: "member",
      ownerRelationship: "mutual",
      crew: rawCrew(),
      plan: planState,
    }));
    const store = createSocialCrewStore(dependencies({ snapshot }));

    const result = await store.read(CREW_ID, bob);

    expect(result).toEqual({
      kind: "member",
      crewId: CREW_ID,
      title: "Friday in Camden",
      visibility: "friends",
      phase: "planning",
      nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000Z",
      authorityRevision: 1,
      viewer: { memberId: BOB_MEMBER_ID, role: "member" },
      owner: { memberId: ALICE_MEMBER_ID, handle: "alice" },
      members: [
        {
          memberId: ALICE_MEMBER_ID,
          handle: "alice",
          role: "owner",
          joinedAt: "2026-08-05T12:00:00.000Z",
        },
        {
          memberId: BOB_MEMBER_ID,
          handle: "bob-new",
          role: "member",
          joinedAt: "2026-08-05T12:05:00.000Z",
        },
      ],
      plan: {
        plan: planState.plan,
        stops: planState.stops,
        context: planState.context,
        actions: planState.actions,
        ending: null,
      },
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith("read_social_crew_snapshot", {
      p_viewer_account_id: BOB_ACCOUNT_ID,
      p_viewer_profile_id: BOB_PROFILE_ID,
      p_crew_id: CREW_ID,
    });
    expect(JSON.stringify(result)).not.toContain("legacy-plan-member");
    expect(JSON.stringify(result)).not.toContain(BOB_PLAN_MEMBER_ID);
    expect(JSON.stringify(result)).not.toContain(BOB_ACCOUNT_ID);
  });

  it("projects discriminated preview without Crew or Plan data", async () => {
    const store = createSocialCrewStore(dependencies({
      snapshot: async () => ({
        kind: "preview",
        preview: {
          title: "Friday in Camden",
          status: "ready",
          nightArea: null,
          startsAt: "2026-08-07T18:30:00.000000Z",
          joinRequestState: "pending",
        },
      }),
    }));

    await expect(store.read(CREW_ID, bob)).resolves.toEqual({
      kind: "preview",
      title: "Friday in Camden",
      phase: "planning",
      nightArea: null,
      startsAt: "2026-08-07T18:30:00.000Z",
      joinRequestState: "pending",
    });
  });

  it("fails closed for absent, malformed, and failed atomic snapshots", async () => {
    await expectStoreError(
      createSocialCrewStore(dependencies({ snapshot: async () => null }))
        .read(CREW_ID, bob),
      "NOT_FOUND",
      404,
    );
    await expectStoreError(
      createSocialCrewStore(dependencies({
        snapshot: async () => ({ kind: "preview", preview: {} }),
      })).read(CREW_ID, bob),
      "UNAVAILABLE",
      503,
    );
    await expectStoreError(
      createSocialCrewStore(dependencies({
        snapshot: async () => {
          throw new Error("database down");
        },
      })).read(CREW_ID, bob),
      "UNAVAILABLE",
      503,
    );
  });
});
