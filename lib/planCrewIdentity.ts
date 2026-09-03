import "server-only";

// Internal plan-crew ↔ auth user linkage for friend-graph formation (WP7).
//
// plan_crew_members.user_id and plans.owner_user_id already exist (migration
// 0024) but classic join/create never stamped them. Public PlanState still
// never exposes user ids - this module is the only write/read seam for them.

import { isPlanId } from "@/lib/plan";
import {
  __linkMemoryPlanMemberUser,
  __listMemoryPlanMemberUserIds,
  __setMemoryPlanOwnerUserId,
  claimMemoryPlanMembership,
  hashPlanMemberToken,
  planMemberIdentityResult,
  planIdempotencyDigest,
  planRequestDigest,
  recoverMemoryPlanMembership,
  type PlanMemberIdentity,
  type PlanMembershipClaimOutcome,
} from "@/lib/planStore";
import { isMissingDatabaseFunction } from "@/lib/planStore";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const MEMBERS = "plan_crew_members";
const PLANS = "plans";
const PLAN_ACCOUNT_RECOVERY_OPERATION = "plan-account-session-recovery";

function planAccountRecoveryKey(planId: string, userId: string): string {
  return planIdempotencyDigest(
    `${PLAN_ACCOUNT_RECOVERY_OPERATION}:key`,
    `${planId}:${userId}`,
  );
}

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Legacy member-row stamp for a current-schema database where the claim
 * FUNCTION is unavailable (0106 precedent). Stamps only the member row, never
 * the plan owner, because the owner half of the atomic claim has no safe
 * two-step equivalent.
 */
async function legacyClaimPlanMembership(
  planId: string,
  memberId: string,
  uid: string,
): Promise<PlanMembershipClaimResult> {
  const { data, error } = await requireSupabaseAdmin()
    .from(MEMBERS)
    .update({ user_id: uid })
    .eq("plan_id", planId)
    .eq("id", memberId)
    .is("user_id", null)
    .is("membership_revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return "conflict";
    }
    throw new Error(error.message);
  }
  if (data) return "claimed";
  const existing = await requireSupabaseAdmin()
    .from(MEMBERS)
    .select("user_id")
    .eq("plan_id", planId)
    .eq("id", memberId)
    .is("membership_revoked_at", null)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) return "not_found";
  return existing.data.user_id === uid ? "already_claimed" : "conflict";
}

export type PlanMembershipClaimResult =
  | PlanMembershipClaimOutcome
  | "error";

export type PlanMembershipRecoveryResult =
  | { ok: true; identity: PlanMemberIdentity }
  | { ok: false; error: "not_found" | "conflict" | "error" };

export function planAccountRecoveryToken(planId: string, userId: string): string {
  return planIdempotencyDigest(
    `${PLAN_ACCOUNT_RECOVERY_OPERATION}:token`,
    planAccountRecoveryKey(planId, userId),
  );
}

/** Bind an existing Plan member capability to one auth account in one write. */
export async function claimPlanMembership(
  planId: string,
  memberId: string,
  userId: string,
): Promise<PlanMembershipClaimResult> {
  if (!isPlanId(planId) || !isPlanId(memberId)) return "not_found";
  const uid = cleanUserId(userId);
  if (!uid) return "not_found";
  if (!isSupabaseConfigured()) {
    return claimMemoryPlanMembership(planId, memberId, uid);
  }
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "claim_plan_membership",
      {
        p_plan_id: planId,
        p_member_id: memberId,
        p_user_id: uid,
      },
    );
    if (error && isMissingDatabaseFunction(error)) {
      // The current Plan schema may be present while the claim FUNCTION is
      // unavailable (0106 precedent). Only a missing FUNCTION may take this
      // path: a genuine write failure must stay a refusal.
      console.warn("[plans] membership claim RPC missing; using legacy member stamp");
      return await legacyClaimPlanMembership(planId, memberId, uid);
    }
    if (error) throw new Error(error.message);
    return data === "claimed" ||
      data === "already_claimed" ||
      data === "conflict" ||
      data === "not_found"
      ? data
      : "error";
  } catch (error) {
    console.error(
      "[plans] membership claim failed:",
      error instanceof Error ? error.message : error,
    );
    return "error";
  }
}

/** Rotate capability for the signed-in account's existing Plan membership. */
export async function recoverPlanMembership(
  planId: string,
  userId: string,
  memberToken: string,
  recoveredAt: Date = new Date(),
): Promise<PlanMembershipRecoveryResult> {
  if (!isPlanId(planId)) return { ok: false, error: "not_found" };
  const uid = cleanUserId(userId);
  if (!uid || !memberToken) return { ok: false, error: "not_found" };
  if (!isSupabaseConfigured()) {
    const identity = recoverMemoryPlanMembership(planId, uid, memberToken);
    return identity
      ? { ok: true, identity }
      : { ok: false, error: "not_found" };
  }
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "recover_plan_account_membership_atomic",
      {
        p_plan_id: planId,
        p_user_id: uid,
        p_member_token_hash: hashPlanMemberToken(memberToken),
        p_idempotency_key_hash: planAccountRecoveryKey(planId, uid),
        p_request_hash: planRequestDigest({
          operation: PLAN_ACCOUNT_RECOVERY_OPERATION,
          planId,
          userId: uid,
        }),
        p_recovered_at: recoveredAt.toISOString(),
      },
    );
    if (error && isMissingDatabaseFunction(error)) {
      console.warn("[plans] membership recovery RPC missing; recovery unavailable");
      return { ok: false, error: "not_found" };
    }
    if (error) throw new Error(error.message);
    if (data !== "recovered" && data !== "replayed") {
      return {
        ok: false,
        error: data === "conflict" ? "conflict" : "not_found",
      };
    }
    const result = await planMemberIdentityResult(planId, memberToken);
    return result.ok && result.identity
      ? { ok: true, identity: result.identity }
      : { ok: false, error: result.ok ? "not_found" : "error" };
  } catch (error) {
    console.error(
      "[plans] membership recovery failed:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "error" };
  }
}

/** Stamp an auth user onto a crew member row. Idempotent for the same user. */
export async function linkPlanMemberUser(
  planId: string,
  memberId: string,
  userId: string,
): Promise<boolean> {
  if (!isPlanId(planId) || !isPlanId(memberId)) return false;
  const uid = cleanUserId(userId);
  if (!uid) return false;

  if (!isSupabaseConfigured()) {
    return __linkMemoryPlanMemberUser(planId, memberId, uid);
  }
  try {
    const { data, error } = await requireSupabaseAdmin()
      .from(MEMBERS)
      .update({ user_id: uid })
      .eq("plan_id", planId)
      .eq("id", memberId)
      .is("membership_revoked_at", null)
      .is("user_id", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return true;
    // Already linked to this user counts as success; a different user is refused.
    const existing = await requireSupabaseAdmin()
      .from(MEMBERS)
      .select("user_id")
      .eq("plan_id", planId)
      .eq("id", memberId)
      .is("membership_revoked_at", null)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    return existing.data?.user_id === uid;
  } catch {
    return false;
  }
}

/** Stamp the plan owner when the host creates while signed in. */
export async function linkPlanOwnerUser(
  planId: string,
  userId: string,
): Promise<boolean> {
  if (!isPlanId(planId)) return false;
  const uid = cleanUserId(userId);
  if (!uid) return false;

  if (!isSupabaseConfigured()) {
    return __setMemoryPlanOwnerUserId(planId, uid);
  }
  try {
    const { data, error } = await requireSupabaseAdmin()
      .from(PLANS)
      .update({ owner_user_id: uid })
      .eq("id", planId)
      .is("owner_user_id", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return true;
    const existing = await requireSupabaseAdmin()
      .from(PLANS)
      .select("owner_user_id")
      .eq("id", planId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    return existing.data?.owner_user_id === uid;
  } catch {
    return false;
  }
}

/** Claimed-member candidates already stamped on this plan (internal only). */
export async function listPlanMemberUserIds(
  planId: string,
): Promise<Array<{ memberId: string; userId: string }>> {
  if (!isPlanId(planId)) return [];
  if (!isSupabaseConfigured()) {
    return __listMemoryPlanMemberUserIds(planId);
  }
  try {
    const { data, error } = await requireSupabaseAdmin()
      .from(MEMBERS)
      .select("id,user_id")
      .eq("plan_id", planId)
      .is("membership_revoked_at", null)
      .not("user_id", "is", null);
    if (error) throw new Error(error.message);
    const out: Array<{ memberId: string; userId: string }> = [];
    for (const row of data ?? []) {
      const memberId = typeof row.id === "string" ? row.id : "";
      const userId = typeof row.user_id === "string" ? row.user_id : "";
      if (memberId && userId) out.push({ memberId, userId });
    }
    return out;
  } catch {
    return [];
  }
}
