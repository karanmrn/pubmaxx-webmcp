import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Memory-backed seam (no Supabase); rate limiter and server-env guards
// neutralised the same way the sibling plan-collaboration route tests do, so the
// in-memory store/limiter paths run deterministically.
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
import { GET as TALLY, POST as VOTE } from "@/app/api/plans/[id]/vibe-votes/route";
import { __resetPlanCollaboration, planCollaborationStore, type PlanVibeVote } from "@/lib/planCollaborationStore";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { tallyVibeVotes, vibeTallyLine } from "@/lib/vibeTally";
import type { VibeChipId } from "@/lib/vibeChips";

const stops = [
  { venueId: "venue-a", venueName: "A", position: 0 },
  { venueId: "venue-b", venueName: "B", position: 1 },
  { venueId: "venue-c", venueName: "C", position: 2 },
];

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
});

async function crew(size = 2) {
  const created = await memoryPlanStore.create({ title: "Crew night", startTime: "2026-07-19T19:00:00.000Z", creatorName: "Host", stops });
  if (!created.ok) throw new Error("plan setup failed");
  const tokens: string[] = [created.memberToken];
  for (let i = 1; i < size; i++) {
    const joined = await memoryPlanStore.join(created.plan.plan.id, `Guest ${i}`, { collaborationAuthorized: true });
    if (!joined.ok) throw new Error("guest setup failed");
    tokens.push(joined.memberToken);
  }
  return { id: created.plan.plan.id, tokens };
}

describe("vibe vote storage (plan-collaboration seam)", () => {
  it("rejects a vote that is not one of the seven owner-locked chip ids", async () => {
    const { id, tokens } = await crew();
    const store = planCollaborationStore();
    expect(await store.recordVibeVote(id, tokens[0], "turnt" as VibeChipId, "vibe-invalid-1")).toMatchObject({ ok: false, error: "invalid" });
    expect(await store.recordVibeVote(id, tokens[0], "" as VibeChipId, "vibe-invalid-2")).toMatchObject({ ok: false, error: "invalid" });
    expect(await store.vibeTally(id)).toMatchObject({ ok: true, tally: { total: 0, top: null } });
  });

  it("upserts one vote per member — a revote replaces, never accumulates", async () => {
    const { id, tokens } = await crew();
    const store = planCollaborationStore();
    expect(await store.recordVibeVote(id, tokens[0], "bender", "vibe-host-1")).toMatchObject({ ok: true, vote: { vibe: "bender", memberId: expect.any(String) } });
    const revote = await store.recordVibeVote(id, tokens[0], "quiet", "vibe-host-2");
    expect(revote).toMatchObject({ ok: true, vote: { vibe: "quiet" } });

    const tally = await store.vibeTally(id);
    if (!tally.ok) throw new Error("tally read failed");
    expect(tally.tally.total).toBe(1);
    expect(tally.tally.counts).toEqual([{ vibe: "quiet", count: 1 }]);
  });

  it("is idempotent under a replayed request key", async () => {
    const { id, tokens } = await crew();
    const store = planCollaborationStore();
    const first = await store.recordVibeVote(id, tokens[0], "bender", "vibe-replay-key");
    const replay = await store.recordVibeVote(id, tokens[0], "quiet", "vibe-replay-key");
    // Same key returns the first result verbatim — the "quiet" value is ignored.
    expect(replay).toEqual(first);
    const tally = await store.vibeTally(id);
    expect(tally).toMatchObject({ ok: true, tally: { counts: [{ vibe: "bender", count: 1 }] } });
  });

  it("aggregates counts and names the single top vibe across the crew", async () => {
    const { id, tokens } = await crew(4);
    const store = planCollaborationStore();
    expect(await store.recordVibeVote(id, tokens[0], "bender", "agg-vote-0")).toMatchObject({ ok: true });
    expect(await store.recordVibeVote(id, tokens[1], "bender", "agg-vote-1")).toMatchObject({ ok: true });
    expect(await store.recordVibeVote(id, tokens[2], "bender", "agg-vote-2")).toMatchObject({ ok: true });
    expect(await store.recordVibeVote(id, tokens[3], "quiet", "agg-vote-3")).toMatchObject({ ok: true });

    const tally = await store.vibeTally(id);
    if (!tally.ok) throw new Error("tally read failed");
    expect(tally.tally.total).toBe(4);
    expect(tally.tally.top).toBe("bender");
    expect(tally.tally.counts).toEqual([{ vibe: "bender", count: 3 }, { vibe: "quiet", count: 1 }]);
  });

  it("admits only the host or a collaboration-authorized guest", async () => {
    const created = await memoryPlanStore.create({ title: "Auth night", startTime: "2026-07-19T19:00:00.000Z", creatorName: "Host", stops });
    if (!created.ok) throw new Error("plan setup failed");
    const legacy = await memoryPlanStore.join(created.plan.plan.id, "Legacy", { collaborationAuthorized: false });
    if (!legacy.ok) throw new Error("legacy join failed");
    const store = planCollaborationStore();
    // A read-only public-link guest cannot vote.
    expect(await store.recordVibeVote(created.plan.plan.id, legacy.memberToken, "bender", "auth-legacy")).toMatchObject({ ok: false, error: "forbidden" });
    // A token that belongs to no member cannot vote.
    expect(await store.recordVibeVote(created.plan.plan.id, "not-a-member-token", "bender", "auth-stranger")).toMatchObject({ ok: false, error: "forbidden" });
    // The host can.
    expect(await store.recordVibeVote(created.plan.plan.id, created.memberToken, "bender", "auth-host")).toMatchObject({ ok: true });
  });
});

describe("vibe tally line (share-card copy)", () => {
  const line = (votes: VibeChipId[]) => vibeTallyLine(tallyVibeVotes(votes.map((vibe) => ({ vibe }))));

  it("renders nothing for a plan with no votes", () => {
    expect(vibeTallyLine(tallyVibeVotes([]))).toBeNull();
  });

  it("jabs the lone dissenter only when exactly one vote is out of step", () => {
    expect(line(["bender", "bender", "bender", "quiet"])).toBe("3 of the lot voted Big one tonight, 1 person voted Quiet pint");
  });

  it("drops the jab when more than one voter dissents", () => {
    expect(line(["bender", "bender", "bender", "quiet", "lit"])).toBe("3 of the lot voted Big one tonight");
  });

  it("states a tie without singling anyone out", () => {
    const split = line(["bender", "bender", "quiet", "quiet"]);
    expect(split).toContain("The lot's split");
    expect(split).not.toContain("coward");
  });
});

describe("vibe vote HTTP contract", () => {
  const URL = "http://localhost/api/plans";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function createPlan() {
    const response = await CREATE(new Request(URL, { method: "POST", headers: { "idempotency-key": `vibe-host-${crypto.randomUUID()}` }, body: JSON.stringify({ startTime: "2026-07-19T19:00:00.000Z", creatorName: "Host", stops: [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }] }) }));
    return await response.json() as { plan: { plan: { id: string } }; memberToken: string };
  }

  it("records a vote in the flat envelope and reads it back in the tally", async () => {
    const host = await createPlan();
    const id = host.plan.plan.id;
    const vote = await VOTE(new Request(`${URL}/${id}/vibe-votes`, { method: "POST", headers: { authorization: `Bearer ${host.memberToken}`, "idempotency-key": "vibe-http-1" }, body: JSON.stringify({ vibe: "bender" }) }), ctx(id));
    expect(vote.status).toBe(201);
    expect(await vote.json()).toMatchObject({ ok: true, vote: { vibe: "bender" } });

    const tally = await TALLY(new Request(`${URL}/${id}/vibe-votes`), ctx(id));
    expect(tally.status).toBe(200);
    expect(await tally.json()).toMatchObject({ ok: true, tally: { total: 1, top: "bender", counts: [{ vibe: "bender", count: 1 }] } });
  });

  it("400s an unrecognised chip id before the store is touched", async () => {
    const host = await createPlan();
    const id = host.plan.plan.id;
    const response = await VOTE(new Request(`${URL}/${id}/vibe-votes`, { method: "POST", headers: { authorization: `Bearer ${host.memberToken}`, "idempotency-key": "vibe-bad-1" }, body: JSON.stringify({ vibe: "rooftop" }) }), ctx(id));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "PLAN_VIBE_INVALID", retryable: false });
  });

  it("403s a member token that is not authorized to collaborate", async () => {
    const host = await createPlan();
    const id = host.plan.plan.id;
    const response = await VOTE(new Request(`${URL}/${id}/vibe-votes`, { method: "POST", headers: { authorization: "Bearer stranger-token", "idempotency-key": "vibe-forbidden-1" }, body: JSON.stringify({ vibe: "bender" }) }), ctx(id));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PLAN_COLLAB_FORBIDDEN" });
  });

  it("404s a malformed plan id on both verbs", async () => {
    expect((await VOTE(new Request(`${URL}/not-a-plan/vibe-votes`, { method: "POST", body: JSON.stringify({ vibe: "bender" }) }), ctx("not-a-plan"))).status).toBe(404);
    expect((await TALLY(new Request(`${URL}/not-a-plan/vibe-votes`), ctx("not-a-plan"))).status).toBe(404);
  });
});

describe("configured vibe-vote migration", () => {
  it("ships the atomic upsert RPC, RLS, and the one-vote-per-member constraint", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260719130000_0044_plan_vibe_votes.sql"), "utf8");
    expect(sql).toContain("record_plan_vibe_vote_atomic");
    expect(sql).toContain("create table if not exists public.plan_vibe_votes");
    expect(sql).toContain("unique(plan_id, member_id)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("vibe in ('bender','lit','quiet','cheeky','match','quiz','date')");
    expect(sql).toContain("on conflict (plan_id, member_id) do update");
    // Additive only — the migration must not drop or truncate live data.
    expect(sql).not.toMatch(/\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
  });
});

// Type-only touch so the exported vote shape stays covered by this suite.
const _shape: PlanVibeVote = { planId: "p", memberId: "m", vibe: "bender", createdAt: "2026-07-19T00:00:00.000Z" };
void _shape;
