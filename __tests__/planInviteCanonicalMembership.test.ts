import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const storeHarness = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/storeBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storeBackend")>();
  return {
    ...actual,
    admin: () => ({ rpc: storeHarness.rpc, from: storeHarness.from }),
  };
});

import {
  PlanCrewFullError,
  supabaseRsvpStore,
} from "@/lib/planInviteRsvpStore";

const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000002";
const SUBMITTER_HASH = "a".repeat(64);

function queryWithRows(rows: Array<Record<string, unknown>>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    upsert: vi.fn(async () => ({ error: null })),
    then: (
      resolve: (value: { data: Array<Record<string, unknown>>; error: null; count: number }) => unknown,
    ) => Promise.resolve({ data: rows, error: null, count: 0 }).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("canonical invite RSVP membership store", () => {
  beforeEach(() => {
    storeHarness.rpc.mockReset();
    storeHarness.from.mockReset();
    storeHarness.from.mockImplementation(() => queryWithRows([
      {
        id: "30000000-0000-4000-8000-000000000003",
        display_name: "Priya",
        status: "going",
        created_at: "2026-08-30T12:00:00.000Z",
      },
    ]));
  });

  it("uses one atomic RPC and returns the guest capability for Going", async () => {
    storeHarness.rpc.mockResolvedValue({
      data: { outcome: "saved", is_update: false, member_id: MEMBER_ID },
      error: null,
    });

    const result = await supabaseRsvpStore.upsert(
      PLAN_ID,
      SUBMITTER_HASH,
      "Priya",
      "going",
    );

    expect(storeHarness.rpc).toHaveBeenCalledTimes(1);
    expect(storeHarness.rpc).toHaveBeenCalledWith(
      "upsert_plan_invite_rsvp_membership_atomic",
      expect.objectContaining({
        p_plan_id: PLAN_ID,
        p_submitter_hash: SUBMITTER_HASH,
        p_display_name: "Priya",
        p_status: "going",
        p_member_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        p_existing_member_id: null,
      }),
    );
    expect(result).toMatchObject({
      isUpdate: false,
      membership: {
        role: "guest",
        collaborationAuthorized: false,
      },
    });
    expect(result.membership?.memberToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes an existing canonical guest membership through the atomic write", async () => {
    storeHarness.rpc.mockResolvedValue({
      data: { outcome: "saved", is_update: false, member_id: MEMBER_ID },
      error: null,
    });

    const result = await supabaseRsvpStore.upsert(
      PLAN_ID,
      SUBMITTER_HASH,
      "Priya",
      "going",
      {
        memberToken: "b".repeat(64),
        identity: {
          memberId: MEMBER_ID,
          role: "guest",
          collaborationAuthorized: false,
        },
      },
    );

    expect(storeHarness.rpc).toHaveBeenCalledWith(
      "upsert_plan_invite_rsvp_membership_atomic",
      expect.objectContaining({ p_existing_member_id: MEMBER_ID }),
    );
    expect(result.membership).toEqual({
      memberToken: "b".repeat(64),
      role: "guest",
      collaborationAuthorized: false,
    });
  });

  it("maps an atomic crew-full result without writing a split RSVP", async () => {
    storeHarness.rpc.mockResolvedValue({
      data: { outcome: "crew_full", is_update: false, member_id: null },
      error: null,
    });

    await expect(
      supabaseRsvpStore.upsert(PLAN_ID, SUBMITTER_HASH, "Priya", "going"),
    ).rejects.toBeInstanceOf(PlanCrewFullError);
    expect(storeHarness.from).not.toHaveBeenCalled();
  });

  it("removes an RSVP and its linked non-host membership in one RPC", async () => {
    storeHarness.rpc.mockResolvedValue({ data: "removed", error: null });

    await supabaseRsvpStore.remove(
      PLAN_ID,
      "30000000-0000-4000-8000-000000000003",
    );

    expect(storeHarness.rpc).toHaveBeenCalledWith(
      "remove_plan_invite_rsvp_membership_atomic",
      {
        p_plan_id: PLAN_ID,
        p_rsvp_id: "30000000-0000-4000-8000-000000000003",
      },
    );
    expect(storeHarness.from).not.toHaveBeenCalled();
  });
});

describe("canonical invite RSVP membership migration", () => {
  it("links each RSVP to at most one member and keeps the RPC service-role only", () => {
    const migrationPath = join(
      process.cwd(),
      "supabase/migrations/20260830170000_0124_plan_invite_canonical_membership.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/add column if not exists member_id uuid references public\.plan_crew_members\(id\) on delete cascade/i);
    expect(sql).toMatch(/create unique index[^;]+plan_invite_rsvps[^;]+member_id/i);
    expect(sql).toContain("upsert_plan_invite_rsvp_membership_atomic");
    expect(sql).toContain("remove_plan_invite_rsvp_membership_atomic");
    expect(sql).toContain("create or replace function public._0075_join_plan_idempotent_atomic");
    expect(sql).toContain("create or replace function public._0075_redeem_plan_invite_idempotent_atomic");
    expect(sql).not.toContain("create or replace function public.join_plan_idempotent_atomic");
    expect(sql).not.toContain("create or replace function public.redeem_plan_invite_idempotent_atomic");
    expect(sql).toContain("'plan:join:' || p_plan_id::text");
    expect(sql).toContain("return jsonb_build_object('outcome', 'crew_full'");
    expect(sql).toContain("p_existing_member_id uuid");
    expect(sql).toContain("'outcome', 'forbidden'");
    expect(sql).toMatch(/add column if not exists membership_revoked_at timestamptz/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.plan_crew_members/i);
    expect(sql).toMatch(/update public\.plan_crew_members[\s\S]+membership_revoked_at = p_joined_at[\s\S]+token_hash = encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/i);
    expect(sql).toMatch(/set name = p_member_name,[\s\S]+status = 'in',[\s\S]+membership_revoked_at = null/i);
    expect(sql).toMatch(/count\(\*\)\s+from public\.plan_crew_members\s+where plan_id = p_plan_id and membership_revoked_at is null/i);
    expect(sql.match(/select social_owner_account_id into v_social_owner_account_id/g)).toHaveLength(2);
    expect(sql.match(/if not found or v_social_owner_account_id is not null then/g)).toHaveLength(2);
    expect(sql).toMatch(/v_member\.membership_revoked_at is not null[\s\S]+count\(\*\)[\s\S]+membership_revoked_at is null[\s\S]+crew_full/i);
    expect(sql).toMatch(/create or replace function public\.rls_is_plan_participant[\s\S]+m\.membership_revoked_at is null/i);
    expect(sql).toMatch(/revoke all on function public\.upsert_plan_invite_rsvp_membership_atomic[\s\S]+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.upsert_plan_invite_rsvp_membership_atomic[\s\S]+to service_role/i);
  });

  it("keeps revoked audit rows out of Plan state and account-derived crew edges", () => {
    const planStore = readFileSync(join(process.cwd(), "lib/planStore.ts"), "utf8");
    const crewIdentity = readFileSync(join(process.cwd(), "lib/planCrewIdentity.ts"), "utf8");

    expect(planStore).toMatch(/from\(MEMBERS\)[^;]*?\.is\("membership_revoked_at", null\)[^;]*?\.order\("joined_at"\)/);
    expect(planStore).toMatch(/select\("id,token_hash,joined_at,can_collaborate"\)[^;]*?\.is\("membership_revoked_at", null\)/);
    expect(crewIdentity).toMatch(/\.from\(MEMBERS\)[^;]*?\.update\(\{ user_id: uid \}\)[^;]*?\.is\("membership_revoked_at", null\)/);
    expect(crewIdentity).toMatch(/\.select\("id,user_id"\)[^;]*?\.is\("membership_revoked_at", null\)/);
  });

  it("ships a rollback for the canonical membership link", () => {
    const rollbackPath = join(
      process.cwd(),
      "supabase/migrations/rollback/20260830170000_0124_plan_invite_canonical_membership_rollback.sql",
    );
    expect(existsSync(rollbackPath)).toBe(true);
    if (!existsSync(rollbackPath)) return;
    const rollback = readFileSync(rollbackPath, "utf8");

    expect(rollback).not.toMatch(/delete\s+from\s+public\.plan_crew_members/i);
    expect(rollback).not.toMatch(
      /revoke\s+all\s+on\s+function\s+public\.(?:upsert|remove)_plan_invite_rsvp_membership_atomic/i,
    );
    expect(rollback).toMatch(
      /information_schema\.columns[^;]+column_name = 'membership_revoked_at'[\s\S]+execute 'select exists \(select 1 from public\.plan_crew_members where membership_revoked_at is not null\)'/i,
    );
    expect(rollback).toMatch(/membership_revoked_at is not null[\s\S]+raise exception/i);
    expect(rollback).toContain("create or replace function public._0075_join_plan_idempotent_atomic");
    expect(rollback).toContain("create or replace function public._0075_redeem_plan_invite_idempotent_atomic");
    expect(rollback).toMatch(/create or replace function public\.rls_is_plan_participant[\s\S]+m\.user_id = \(select auth\.uid\(\)\)[\s\S]+\);/i);
  });
});
