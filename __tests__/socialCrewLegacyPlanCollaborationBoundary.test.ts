import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-05T18:00:00.000Z";
const fixture = vi.hoisted(() => ({ mode: "bound" as "bound" | "conversion-race" }));

function query(table: string) {
  const rows = table === "plan_invites"
    ? [{ id: INVITE_ID, plan_id: PLAN_ID, expires_at: "2026-08-06T18:00:00.000Z", revoked_at: null, redeemed_at: null }]
    : table === "plan_vibe_votes"
      ? [{ plan_id: PLAN_ID, member_id: MEMBER_ID, vibe: "quiet", created_at: NOW }]
      : [];
  const result = () => ({ data: rows[0] ?? null, error: null });
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    is() { return builder; },
    order() { return builder; },
    update() { return builder; },
    insert() { return builder; },
    single: async () => result(),
    maybeSingle: async () => result(),
    then(resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({
      from: (table: string) => query(table),
      rpc: async () => fixture.mode === "conversion-race"
        ? { data: { code: "not_found" }, error: null }
        : { data: null, error: null },
    }),
  };
});

vi.mock("@/lib/planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planStore")>();
  return {
    ...actual,
    planMemberIdentityResult: async () => fixture.mode === "bound"
      ? { ok: false, error: "not_found" }
      : { ok: true, identity: { memberId: MEMBER_ID, role: "host", collaborationAuthorized: true } },
    planStateResult: async () => fixture.mode === "bound"
      ? { ok: true, plan: null }
      : { ok: true, plan: { plan: { id: PLAN_ID } } },
    planStore: () => ({ get: async () => null }),
  };
});

import { planCollaborationStore } from "@/lib/planCollaborationStore";

const stops = [
  { venueId: "venue-a", venueName: "A", position: 0 },
  { venueId: "venue-b", venueName: "B", position: 1 },
  { venueId: "venue-c", venueName: "C", position: 2 },
];

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  fixture.mode = "bound";
});

describe("legacy Plan collaboration boundary for Social Crews", () => {
  it("returns not found from every capability-bound collaboration path", async () => {
    const store = planCollaborationStore();
    const results = await Promise.all([
      store.createInvite(PLAN_ID, "old-token", { expiresInMinutes: 30, idempotencyKey: "create-invite-key" }),
      store.revokeInvite(PLAN_ID, "old-token", INVITE_ID, "revoke-invite-key"),
      store.addConstraint(PLAN_ID, "old-token", {
        kind: "budget", value: "Under twenty pounds", priority: "required", idempotencyKey: "constraint-key",
      }),
      store.resolveConstraint(PLAN_ID, "old-token", MEMBER_ID, {
        evidence: { proposalId: PROPOSAL_ID, routeRevision: 1, sources: [] }, idempotencyKey: "resolve-key",
      }),
      store.createProposal(PLAN_ID, "old-token", {
        reason: "Move closer", expectedRouteRevision: 1, stops, resolvedConstraintIds: [], idempotencyKey: "proposal-key",
      }),
      store.vote(PLAN_ID, "old-token", PROPOSAL_ID, "approve", "proposal-vote-key"),
      store.recordVibeVote(PLAN_ID, "old-token", "quiet", "vibe-vote-key"),
      store.decideProposal(PLAN_ID, "old-token", PROPOSAL_ID, "rejected", "decision-key", async () => true),
      store.list(PLAN_ID, "old-token"),
    ]);

    expect(results).toEqual(results.map(() => ({ ok: false, error: "not_found" })));
  });

  it("makes tokenless invitation and vibe reads absent", async () => {
    const store = planCollaborationStore();
    await expect(store.consumeInvite(PLAN_ID, "old-invite-token", new Date(NOW)))
      .resolves.toEqual({ ok: false, error: "not_found" });
    await expect(store.vibeTally(PLAN_ID))
      .resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("maps a conversion-race atomic result to not found", async () => {
    fixture.mode = "conversion-race";
    await expect(planCollaborationStore().addConstraint(PLAN_ID, "old-token", {
      kind: "budget",
      value: "Under twenty pounds",
      priority: "required",
      idempotencyKey: "constraint-race-key",
    })).resolves.toEqual({ ok: false, error: "not_found" });
  });
});
