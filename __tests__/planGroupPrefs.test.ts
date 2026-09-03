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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DELETE as CLEAR, GET as LIST, POST as SAVE } from "@/app/api/plans/[id]/group-prefs/route";
import { __resetPlanGroupPrefs, planGroupPrefsStore } from "@/lib/planGroupPrefsStore";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";

const stops = [
  { venueId: "venue-a", venueName: "A", position: 0 },
  { venueId: "venue-b", venueName: "B", position: 1 },
  { venueId: "venue-c", venueName: "C", position: 2 },
];

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanGroupPrefs();
});

async function crew(size = 2) {
  const created = await memoryPlanStore.create({
    title: "Crew night",
    startTime: "2026-08-06T19:00:00.000Z",
    creatorName: "Host",
    stops,
  });
  if (!created.ok) throw new Error("plan setup failed");
  const tokens: string[] = [created.memberToken];
  for (let i = 1; i < size; i += 1) {
    const joined = await memoryPlanStore.join(created.plan.plan.id, `Guest ${i}`, { collaborationAuthorized: true });
    if (!joined.ok) throw new Error("guest setup failed");
    tokens.push(joined.memberToken);
  }
  return { id: created.plan.plan.id, tokens };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const sample = {
  budgetBand: "under6" as const,
  atmosphereChip: "cosy" as const,
  zeroProof: true,
  accessibilityRequired: true,
  weatherShelterRequired: false,
};

describe("plan group prefs store", () => {
  it("lets each plan member save prefs and returns merged hard constraints", async () => {
    const { id, tokens } = await crew(2);
    const store = planGroupPrefsStore();
    const host = await store.save(id, tokens[0], sample, "host-pref-key-1");
    expect(host).toMatchObject({
      ok: true,
      overlap: {
        mateCount: 1,
        hardConstraints: {
          budgetBand: "under6",
          zeroProofRequired: true,
          accessibilityRequired: true,
          weatherShelterRequired: false,
        },
        mustHaveLabels: expect.arrayContaining([
          "Budget: under GBP 6 pints",
          "Zero-proof options needed",
          "Step-free access needed",
        ]),
      },
    });

    const guest = await store.save(
      id,
      tokens[1],
      {
        budgetBand: "standard",
        atmosphereChip: "cosy",
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: true,
      },
      "guest-pref-key-1",
    );
    expect(guest).toMatchObject({ ok: true });
    if (!guest.ok) throw new Error("guest save failed");
    expect(guest.overlap.mateCount).toBe(2);
    expect(guest.overlap.hardConstraints).toEqual({
      budgetBand: "under6",
      budgetLabel: "under GBP 6 pints",
      zeroProofRequired: true,
      accessibilityRequired: true,
      weatherShelterRequired: true,
      sharedAtmosphereChips: ["cosy"],
    });
    expect(guest.overlap.mustHaveLabels).toEqual([
      "Budget: under GBP 6 pints",
      "Zero-proof options needed",
      "Step-free access needed",
      "Covered shelter needed",
    ]);
  });

  it("keeps must-have hard constraints when a looser mate joins", async () => {
    const { id, tokens } = await crew(2);
    const store = planGroupPrefsStore();
    await store.save(id, tokens[0], sample, "strict-host");
    const looser = await store.save(
      id,
      tokens[1],
      {
        budgetBand: "flexible",
        atmosphereChip: "lively",
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
      },
      "loose-guest",
    );
    expect(looser).toMatchObject({
      ok: true,
      overlap: {
        hardConstraints: {
          budgetBand: "under6",
          zeroProofRequired: true,
          accessibilityRequired: true,
        },
      },
    });
  });

  it("rejects cross-plan reads and writes (no leakage)", async () => {
    const planA = await crew(1);
    const planB = await crew(1);
    const store = planGroupPrefsStore();
    expect(await store.save(planA.id, planA.tokens[0], sample, "a-save-key-1")).toMatchObject({ ok: true });

    // Token for plan A cannot read or write plan B.
    expect(await store.list(planB.id, planA.tokens[0])).toMatchObject({ ok: false, error: "forbidden" });
    expect(await store.save(planB.id, planA.tokens[0], sample, "leak-write-1")).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await store.clear(planB.id, planA.tokens[0])).toMatchObject({ ok: false, error: "forbidden" });

    // Prefs saved on A never appear on B's own list.
    const ownB = await store.list(planB.id, planB.tokens[0]);
    expect(ownB).toMatchObject({ ok: true, prefs: [] });
    if (!ownB.ok) throw new Error("list B failed");
    expect(ownB.overlap.mateCount).toBe(0);

    const ownA = await store.list(planA.id, planA.tokens[0]);
    expect(ownA).toMatchObject({ ok: true });
    if (!ownA.ok) throw new Error("list A failed");
    expect(ownA.prefs).toHaveLength(1);
    expect(ownA.prefs[0]?.mateId).toBeTruthy();
  });

  it("is idempotent under a replayed request key", async () => {
    const { id, tokens } = await crew(1);
    const store = planGroupPrefsStore();
    const first = await store.save(id, tokens[0], sample, "replay-key-aaaa");
    const replay = await store.save(
      id,
      tokens[0],
      {
        budgetBand: "flexible",
        atmosphereChip: "music",
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
      },
      "replay-key-aaaa",
    );
    expect(replay).toEqual(first);
  });

  it("clears the idempotency ledger so a reused key can write again", async () => {
    const { id, tokens } = await crew(1);
    const store = planGroupPrefsStore();
    expect(await store.save(id, tokens[0], sample, "clear-then-reuse")).toMatchObject({ ok: true });
    expect(await store.clear(id, tokens[0])).toMatchObject({ ok: true, overlap: { mateCount: 0 } });
    const listed = await store.list(id, tokens[0]);
    expect(listed).toMatchObject({ ok: true, prefs: [] });
    const again = await store.save(
      id,
      tokens[0],
      {
        budgetBand: "flexible",
        atmosphereChip: "music",
        zeroProof: false,
        accessibilityRequired: false,
        weatherShelterRequired: false,
      },
      "clear-then-reuse",
    );
    expect(again).toMatchObject({
      ok: true,
      pref: { budgetBand: "flexible", atmosphereChips: ["music"] },
      overlap: { mateCount: 1 },
    });
  });

  it("admits only the host or a collaboration-authorized guest", async () => {
    const created = await memoryPlanStore.create({
      title: "Auth night",
      startTime: "2026-08-06T19:00:00.000Z",
      creatorName: "Host",
      stops,
    });
    if (!created.ok) throw new Error("plan setup failed");
    const legacy = await memoryPlanStore.join(created.plan.plan.id, "Legacy", { collaborationAuthorized: false });
    if (!legacy.ok) throw new Error("legacy join failed");
    const store = planGroupPrefsStore();
    expect(await store.save(created.plan.plan.id, legacy.memberToken, sample, "auth-legacy")).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await store.save(created.plan.plan.id, "not-a-member-token", sample, "auth-stranger")).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await store.save(created.plan.plan.id, created.memberToken, sample, "auth-host")).toMatchObject({ ok: true });
  });
});

describe("plan group prefs HTTP route", () => {
  it("saves, lists merged hard constraints, and clears for a member", async () => {
    const { id, tokens } = await crew(2);
    const save = await SAVE(
      new Request(`http://localhost/api/plans/${id}/group-prefs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens[0]}`,
          "content-type": "application/json",
          "idempotency-key": "http-save-key-1",
        },
        body: JSON.stringify(sample),
      }),
      ctx(id),
    );
    expect(save.status).toBe(201);
    const saved = await save.json();
    expect(saved.overlap.hardConstraints.zeroProofRequired).toBe(true);

    await SAVE(
      new Request(`http://localhost/api/plans/${id}/group-prefs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens[1]}`,
          "content-type": "application/json",
          "idempotency-key": "http-save-key-2",
        },
        body: JSON.stringify({
          budgetBand: "standard",
          atmosphereChip: "cosy",
          zeroProof: false,
          accessibilityRequired: false,
          weatherShelterRequired: true,
        }),
      }),
      ctx(id),
    );

    const list = await LIST(
      new Request(`http://localhost/api/plans/${id}/group-prefs`, {
        headers: { authorization: `Bearer ${tokens[0]}` },
      }),
      ctx(id),
    );
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.prefs).toHaveLength(2);
    expect(body.overlap.hardConstraints).toMatchObject({
      budgetBand: "under6",
      zeroProofRequired: true,
      accessibilityRequired: true,
      weatherShelterRequired: true,
    });

    const cleared = await CLEAR(
      new Request(`http://localhost/api/plans/${id}/group-prefs`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${tokens[0]}` },
      }),
      ctx(id),
    );
    expect(cleared.status).toBe(200);
    const after = await cleared.json();
    expect(after.overlap.mateCount).toBe(1);
  });

  it("refuses cross-plan capability on the HTTP seam", async () => {
    const planA = await crew(1);
    const planB = await crew(1);
    await SAVE(
      new Request(`http://localhost/api/plans/${planA.id}/group-prefs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${planA.tokens[0]}`,
          "content-type": "application/json",
          "idempotency-key": "http-a-key",
        },
        body: JSON.stringify(sample),
      }),
      ctx(planA.id),
    );

    const leakList = await LIST(
      new Request(`http://localhost/api/plans/${planB.id}/group-prefs`, {
        headers: { authorization: `Bearer ${planA.tokens[0]}` },
      }),
      ctx(planB.id),
    );
    expect(leakList.status).toBe(403);

    const leakSave = await SAVE(
      new Request(`http://localhost/api/plans/${planB.id}/group-prefs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${planA.tokens[0]}`,
          "content-type": "application/json",
          "idempotency-key": "http-leak-key",
        },
        body: JSON.stringify(sample),
      }),
      ctx(planB.id),
    );
    expect(leakSave.status).toBe(403);

    const cleanB = await LIST(
      new Request(`http://localhost/api/plans/${planB.id}/group-prefs`, {
        headers: { authorization: `Bearer ${planB.tokens[0]}` },
      }),
      ctx(planB.id),
    );
    expect(cleanB.status).toBe(200);
    expect(await cleanB.json()).toMatchObject({ prefs: [] });
  });
});

describe("0076 plan member group prefs migration shape", () => {
  it("ships forward SQL and a matching rollback", () => {
    const forward = readFileSync(
      join(process.cwd(), "supabase/migrations/20260806160000_0076_plan_member_group_prefs.sql"),
      "utf8",
    );
    const rollback = readFileSync(
      join(process.cwd(), "supabase/migrations/rollback/20260806160000_0076_plan_member_group_prefs_rollback.sql"),
      "utf8",
    );
    expect(forward).toContain("create table if not exists public.plan_member_group_prefs");
    expect(forward).toContain("create table if not exists public.plan_member_group_pref_requests");
    expect(forward).toContain("record_plan_member_group_pref_atomic");
    expect(forward).toContain("accessibility_required");
    expect(forward).toContain("weather_shelter_required");
    expect(forward).toMatch(/revoke all on public\.plan_member_group_prefs/);
    expect(forward).toMatch(/grant all on public\.plan_member_group_prefs/);
    expect(forward).not.toMatch(/using\s*\(\s*true\s*\)/);
    expect(rollback).toContain("drop table if exists public.plan_member_group_prefs");
    expect(rollback).toContain("drop table if exists public.plan_member_group_pref_requests");
    expect(rollback).toContain("record_plan_member_group_pref_atomic");
  });
});
