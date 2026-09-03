import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { memoryPlanStore, __resetMemoryPlans } from "@/lib/planStore";
import { __resetPlanCollaboration, planCollaborationStore } from "@/lib/planCollaborationStore";

const stops = [
  { venueId: "venue-a", venueName: "A", position: 0 },
  { venueId: "venue-b", venueName: "B", position: 1 },
  { venueId: "venue-c", venueName: "C", position: 2 },
];

async function members(startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()) {
  const created = await memoryPlanStore.create({
    title: "Crew test",
    startTime,
    creatorName: "Host",
    stops,
  });
  if (!created.ok) throw new Error("plan setup failed");
  const joined = await memoryPlanStore.join(created.plan.plan.id, "Guest", { collaborationAuthorized: true });
  if (!joined.ok) throw new Error("guest setup failed");
  return { id: created.plan.plan.id, host: created.memberToken, guest: joined.memberToken, startTime };
}

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
});

describe("plan collaboration capabilities", () => {
  it("returns not found for a capability-bound call on a missing keyless Plan", async () => {
    await expect(planCollaborationStore().addConstraint(
      "11111111-1111-4111-8111-111111111111",
      "missing-member-token",
      {
        kind: "budget",
        value: "Under twenty pounds",
        priority: "required",
        idempotencyKey: "missing-plan-constraint",
      },
    )).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("creates one-time expiring invites only for the host", async () => {
    const { id, host, guest } = await members();
    const store = planCollaborationStore();
    expect(await store.createInvite(id, guest, { expiresInMinutes: 30, idempotencyKey: "guest-invite-1" })).toMatchObject({ ok: false, error: "forbidden" });

    const created = await store.createInvite(id, host, { expiresInMinutes: 30, idempotencyKey: "host-invite-1" });
    expect(created).toMatchObject({ ok: true, invite: { planId: id, role: "guest", revokedAt: null, redeemedAt: null } });
    if (!created.ok) throw new Error("invite setup failed");
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);

    expect(await store.consumeInvite(id, created.token)).toMatchObject({ ok: true, role: "guest" });
    expect(await store.consumeInvite(id, created.token)).toMatchObject({ ok: false, error: "replayed" });
  });

  it("keeps active invites host-visible so they remain revocable after reload", async () => {
    const { id, host, guest } = await members();
    const store = planCollaborationStore();
    const created = await store.createInvite(id, host, { expiresInMinutes: 30, idempotencyKey: "host-visible-invite" });
    if (!created.ok) throw new Error("invite setup failed");
    expect(await store.list(id, host)).toMatchObject({ ok: true, invites: [{ id: created.invite.id }] });
    expect(await store.list(id, guest)).toMatchObject({ ok: true, invites: [] });
  });

  it("rejects expired and revoked invite capabilities", async () => {
    // Fixed calendar so TTL expiry assertions stay deterministic.
    const { id, host } = await members("2026-07-16T19:00:00.000Z");
    const store = planCollaborationStore();
    const now = new Date("2026-07-16T18:00:00.000Z");
    const expired = await store.createInvite(id, host, { expiresInMinutes: 5, idempotencyKey: "host-invite-expire", now });
    if (!expired.ok) throw new Error("invite setup failed");
    expect(await store.consumeInvite(id, expired.token, new Date("2026-07-16T18:06:00.000Z"))).toMatchObject({ ok: false, error: "expired" });

    const revoked = await store.createInvite(id, host, { expiresInMinutes: 30, idempotencyKey: "host-invite-revoke", now });
    if (!revoked.ok) throw new Error("invite setup failed");
    expect(await store.revokeInvite(id, host, revoked.invite.id, "host-revoke-1")).toMatchObject({ ok: true });
    expect(await store.consumeInvite(id, revoked.token, now)).toMatchObject({ ok: false, error: "revoked" });
  });

  it("clamps invite TTL to the plan scheduled end and refuses minting after it", async () => {
    const { id, host } = await members("2026-07-16T19:00:00.000Z");
    const store = planCollaborationStore();
    // Plan starts 19:00; ACTIVE_PLAN_POST_MS ends at 03:00 next day.
    const during = new Date("2026-07-16T22:00:00.000Z");
    const clamped = await store.createInvite(id, host, { expiresInMinutes: 1_440, idempotencyKey: "host-invite-plan-end", now: during });
    expect(clamped).toMatchObject({ ok: true });
    if (!clamped.ok) throw new Error("invite setup failed");
    expect(clamped.invite.expiresAt).toBe("2026-07-17T03:00:00.000Z");

    const afterEnd = new Date("2026-07-17T04:00:00.000Z");
    expect(await store.createInvite(id, host, { expiresInMinutes: 30, idempotencyKey: "host-invite-after-end", now: afterEnd })).toMatchObject({
      ok: false,
      error: "expired",
    });
    expect(await store.consumeInvite(id, clamped.token, afterEnd)).toMatchObject({ ok: false, error: "expired" });
  });

  it("redeems a one-use invite for only one concurrent keyless join", async () => {
    const { id, host } = await members();
    const store = planCollaborationStore();
    const invite = await store.createInvite(id, host, { expiresInMinutes: 30, idempotencyKey: "concurrent-redeem" });
    if (!invite.ok) throw new Error("invite setup failed");
    const results = await Promise.all([
      store.redeemInviteAndJoin(id, invite.token, "First"),
      store.redeemInviteAndJoin(id, invite.token, "Second"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([expect.objectContaining({ error: "replayed" })]);
  });

  it("lets guests propose and vote but keeps unresolved required constraints above host preference", async () => {
    const { id, host, guest } = await members();
    const store = planCollaborationStore();
    const blocked = await store.createProposal(id, guest, {
      reason: "Move the last stop closer to the station",
      expectedRouteRevision: 1,
      stops,
      resolvedConstraintIds: [],
      idempotencyKey: "proposal-blocked",
    });
    if (!blocked.ok) throw new Error("proposal setup failed");
    const constraint = await store.addConstraint(id, guest, {
      kind: "accessibility",
      value: "Step-free entrance required",
      priority: "required",
      idempotencyKey: "constraint-step-free",
    });
    expect(constraint).toMatchObject({ ok: true });
    if (!constraint.ok) throw new Error("constraint setup failed");
    expect(await store.vote(id, guest, blocked.proposal.id, "approve", "vote-approve-1")).toMatchObject({ ok: true });
    expect(await store.decideProposal(id, host, blocked.proposal.id, "accepted", "decision-blocked", async () => true)).toMatchObject({ ok: false, error: "constraints_unresolved" });

    expect(await store.resolveConstraint(id, host, constraint.constraint.id, {
      evidence: {
        proposalId: blocked.proposal.id,
        routeRevision: blocked.proposal.expectedRouteRevision,
        sources: stops.map((stop) => ({ venueId: stop.venueId, sourceUrl: `https://venue.example/${stop.venueId}/access`, publisher: `${stop.venueName} accessibility page`, observedAt: "2026-07-16T18:00:00.000Z", note: "Step-free entrance stated" })),
      },
      idempotencyKey: "resolve-step-free",
      now: new Date("2026-07-16T18:30:00.000Z"),
    })).toMatchObject({ ok: true, constraint: { resolvedAt: "2026-07-16T18:30:00.000Z" } });
    const apply = vi.fn(async () => true);
    expect(await store.decideProposal(id, host, blocked.proposal.id, "accepted", "decision-eligible", apply)).toMatchObject({ ok: true, proposal: { status: "accepted" } });
    expect(await store.decideProposal(id, host, blocked.proposal.id, "accepted", "decision-eligible", apply)).toMatchObject({ ok: true, proposal: { status: "accepted" } });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("never carries hard-constraint evidence onto an unrelated proposal", async () => {
    const { id, host, guest } = await members();
    const store = planCollaborationStore();
    const constraint = await store.addConstraint(id, guest, { kind: "accessibility", value: "Step-free", priority: "required", idempotencyKey: "route-scoped-constraint" });
    const first = await store.createProposal(id, guest, { reason: "First route", expectedRouteRevision: 1, stops, resolvedConstraintIds: [], idempotencyKey: "route-scoped-first" });
    if (!constraint.ok || !first.ok) throw new Error("setup failed");
    await store.resolveConstraint(id, host, constraint.constraint.id, { evidence: { proposalId: first.proposal.id, routeRevision: 1, sources: stops.map((stop) => ({ venueId: stop.venueId, sourceUrl: `https://evidence.example/${stop.venueId}`, publisher: "Venue", observedAt: "2026-07-16T18:00:00.000Z", note: "Checked" })) }, idempotencyKey: "route-scoped-resolution", now: new Date("2026-07-16T18:30:00.000Z") });
    const differentStops = stops.map((stop, index) => index === 2 ? { venueId: "venue-d", venueName: "D", position: 2 } : stop);
    const second = await store.createProposal(id, guest, { reason: "Different route", expectedRouteRevision: 1, stops: differentStops, resolvedConstraintIds: [], idempotencyKey: "route-scoped-second" });
    if (!second.ok) throw new Error("second proposal failed");
    expect(await store.decideProposal(id, host, second.proposal.id, "accepted", "route-scoped-decision", async () => true)).toMatchObject({ ok: false, error: "constraints_unresolved" });
  });
});

describe("configured collaboration migration", () => {
  it("keeps invite redemption, host decisions, and hard constraints atomic", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260716123000_0031_plan_collaboration.sql"), "utf8");
    expect(sql).toContain("redeem_plan_invite_atomic");
    expect(sql).toContain("can_collaborate");
    expect(sql).toContain("order by joined_at, id");
    expect(sql).toContain("v_status in ('completed', 'abandoned')");
    expect(sql).toContain("constraint_row.priority = 'required'");
  });
});
