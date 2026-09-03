// Durable handle-free RSVP + reactions on a plan's public invite page. TWO
// tables (plan_invite_rsvps, plan_invite_reactions), each with a
// process-memory and a Supabase implementation, same seam pattern as
// lib/reactionsStore.ts.
//
// A guest is identified only by `submitter_hash` — the salted hash of their
// anonymous device id (lib/anonId.ts + lib/supabase.ts hashActor), never a
// raw id. `unique(plan_id, submitter_hash)` on the RSVP table means a
// resubmit UPDATES the same row (a guest can change Going to Maybe without
// stacking rows); reactions keep the reactionsStore shape of one row per
// (plan, device, reaction) so a device can't double-count one reaction.
//
// Both tables FK-reference plans(id); an invite token that resolved but
// whose plan has since been removed raises a foreign-key violation on write,
// surfaced as UnknownPlanError so the route can 404 rather than 500.
//
// SERVER-ONLY: imports @/lib/supabase (admin client). Do NOT import from a
// "use client" component — import lib/planInvite.ts / lib/reactions.ts
// instead for the browser-safe constants and DTO shapes.

import { admin, isForeignKeyViolation, isUniqueViolation, selectStore } from "@/lib/storeBackend";
import { cleanCrewName } from "@/lib/crew";
import { GUEST_LIST_DISPLAY_CAP, isRsvpStatus, RSVP_PLAN_CEILING, type PlanInviteGuest, type PlanInviteRsvpSummary, type RsvpStatus } from "@/lib/planInvite";
import {
  hashPlanMemberToken,
  joinMemoryPlanInviteRsvpMember,
  planIdempotencyDigest,
  planIdempotentUuid,
  planRequestDigest,
  removeMemoryPlanInviteRsvpMember,
  type PlanMemberIdentity,
} from "@/lib/planStore";
import { isReactionKey, type ReactionKey, type ReactionSummary } from "@/lib/reactions";

/** The plan id backing an invite token no longer exists (or never did). */
export class UnknownPlanError extends Error {
  constructor(planId: string) {
    super(`Unknown plan: ${planId}`);
    this.name = "UnknownPlanError";
  }
}

/** F10: a plan already holds RSVP_PLAN_CEILING guests; a new guest is refused. */
export class RsvpCapExceededError extends Error {
  constructor(planId: string) {
    super(`RSVP cap reached for plan: ${planId}`);
    this.name = "RsvpCapExceededError";
  }
}

/** Going requires one canonical Plan member and cannot exceed its crew cap. */
export class PlanCrewFullError extends Error {
  constructor(planId: string) {
    super(`Plan crew is full: ${planId}`);
    this.name = "PlanCrewFullError";
  }
}

/** A member capability may change only the RSVP already linked to that member. */
export class PlanInviteMembershipMismatchError extends Error {
  constructor(planId: string) {
    super(`RSVP membership does not match for plan: ${planId}`);
    this.name = "PlanInviteMembershipMismatchError";
  }
}

/** Host is already the canonical first member and cannot hold an RSVP row. */
export class PlanHostCannotRsvpError extends Error {
  constructor(planId: string) {
    super(`Host cannot RSVP for plan: ${planId}`);
    this.name = "PlanHostCannotRsvpError";
  }
}

const RSVP_TABLE = "plan_invite_rsvps";
const REACTION_TABLE = "plan_invite_reactions";

// ── RSVP ─────────────────────────────────────────────────────────────────

type RsvpRow = { id: string; display_name: string; status: string; created_at: string };

function summarizeRsvpRows(rows: RsvpRow[]): PlanInviteRsvpSummary {
  const guests = rows
    .filter((row): row is RsvpRow & { status: RsvpStatus } => isRsvpStatus(row.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((row): PlanInviteGuest => ({ id: row.id, displayName: row.display_name, status: row.status }));
  // Counts tally every row before the display cap, so "N going" always
  // reflects the true guest list even once the shown names are trimmed.
  const counts = { going: 0, maybe: 0 };
  for (const guest of guests) counts[guest.status] += 1;
  return { counts, guests: guests.slice(0, GUEST_LIST_DISPLAY_CAP) };
}

export type PlanInviteMembershipCapability = {
  memberToken: string;
  role: "host" | "guest";
  collaborationAuthorized: boolean;
};

export type ExistingPlanInviteMembership = {
  memberToken: string;
  identity: PlanMemberIdentity;
};

export type PlanInviteRsvpUpsertResult = {
  summary: PlanInviteRsvpSummary;
  isUpdate: boolean;
  membership: PlanInviteMembershipCapability | null;
};

export type PlanInviteRsvpStore = {
  /**
   * Insert-or-update a guest's RSVP for a plan. `isUpdate` reports whether
   * this device already held an RSVP for the plan (Going/Maybe change) versus
   * a brand-new guest, sourced from the existence check the write already
   * makes rather than a second query.
   */
  upsert(planId: string, submitterHash: string, displayName: string, status: RsvpStatus, existingMembership?: ExistingPlanInviteMembership): Promise<PlanInviteRsvpUpsertResult>;
  /** Current RSVP summary for a plan's invite page. */
  summarize(planId: string): Promise<PlanInviteRsvpSummary>;
  /** Host-only removal of one guest's RSVP row. No-op if already gone. */
  remove(planId: string, rsvpId: string): Promise<void>;
};

export const supabaseRsvpStore: PlanInviteRsvpStore = {
  async upsert(planId, submitterHash, displayName, status, existingMembership) {
    if (existingMembership?.identity.role === "host") throw new PlanHostCannotRsvpError(planId);
    const membershipKey = `invite-rsvp:${submitterHash}`;
    const memberToken = planIdempotencyDigest(`plan-join-token:${planId}`, membershipKey);
    const memberId = planIdempotentUuid(`plan-join-member:${planId}`, membershipKey);
    const { data, error } = await admin().rpc(
      "upsert_plan_invite_rsvp_membership_atomic",
      {
        p_plan_id: planId,
        p_submitter_hash: submitterHash,
        p_display_name: displayName,
        p_status: status,
        p_member_id: memberId,
        p_existing_member_id: existingMembership?.identity.memberId ?? null,
        p_member_name: cleanCrewName(displayName),
        p_member_token_hash: hashPlanMemberToken(memberToken),
        p_member_join_key_hash: planIdempotencyDigest(`plan-join-key:${planId}`, membershipKey),
        p_member_request_hash: planRequestDigest({ inviteRsvpSubmitterHash: submitterHash }),
        p_joined_at: new Date().toISOString(),
        p_rsvp_ceiling: RSVP_PLAN_CEILING,
      },
    );
    if (error) {
      if (isForeignKeyViolation(error)) throw new UnknownPlanError(planId);
      throw new Error(error.message);
    }
    const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const outcome = result.outcome;
    if (outcome === "not_found") throw new UnknownPlanError(planId);
    if (outcome === "rsvp_full") throw new RsvpCapExceededError(planId);
    if (outcome === "crew_full") throw new PlanCrewFullError(planId);
    if (outcome === "forbidden") throw new PlanInviteMembershipMismatchError(planId);
    if (outcome !== "saved") throw new Error("Invite RSVP membership write failed");
    const summary = await supabaseRsvpStore.summarize(planId);
    return {
      summary,
      isUpdate: result.is_update === true,
      membership: status === "going"
        ? existingMembership
          ? {
              memberToken: existingMembership.memberToken,
              role: existingMembership.identity.role,
              collaborationAuthorized: existingMembership.identity.collaborationAuthorized,
            }
          : { memberToken, role: "guest", collaborationAuthorized: false }
        : null,
    };
  },
  async summarize(planId) {
    const { data, error } = await admin()
      .from(RSVP_TABLE)
      .select("id, display_name, status, created_at")
      .eq("plan_id", planId);
    if (error) throw new Error(error.message);
    return summarizeRsvpRows((data ?? []) as RsvpRow[]);
  },
  async remove(planId, rsvpId) {
    const { data, error } = await admin().rpc(
      "remove_plan_invite_rsvp_membership_atomic",
      { p_plan_id: planId, p_rsvp_id: rsvpId },
    );
    if (error) throw new Error(error.message);
    if (data !== "removed" && data !== "missing") {
      throw new Error("Invite RSVP membership removal failed");
    }
  },
};

// globalThis-anchored, same as lib/planStore.ts's __pubmaxPlanMemory: a Next.js
// production build can bundle this module into separate server chunks per
// route/page, each getting its own top-level state unless it is anchored here.
type InviteRsvpMemoryState = {
  rsvps: Map<string, Map<string, { id: string; displayName: string; status: RsvpStatus; createdAt: string; memberId?: string }>>;
};
const inviteRsvpMemoryGlobal = globalThis as typeof globalThis & {
  __pubmaxPlanInviteRsvpMemory?: InviteRsvpMemoryState;
};
const inviteRsvpMemory = inviteRsvpMemoryGlobal.__pubmaxPlanInviteRsvpMemory ??= {
  rsvps: new Map(),
};
inviteRsvpMemory.rsvps ??= new Map();
const memoryRsvps = inviteRsvpMemory.rsvps;

export const memoryRsvpStore: PlanInviteRsvpStore = {
  async upsert(planId, submitterHash, displayName, status, existingMembership) {
    if (existingMembership?.identity.role === "host") throw new PlanHostCannotRsvpError(planId);
    const byPlan = memoryRsvps.get(planId) ?? new Map();
    const existing = byPlan.get(submitterHash);
    if (existingMembership && (!existing || existing.memberId !== existingMembership.identity.memberId)) {
      throw new PlanInviteMembershipMismatchError(planId);
    }
    if (!existing && byPlan.size >= RSVP_PLAN_CEILING) throw new RsvpCapExceededError(planId);
    const membershipKey = `invite-rsvp:${submitterHash}`;
    const joinedMembership = status === "going" && !existingMembership
      ? await joinMemoryPlanInviteRsvpMember(planId, displayName, membershipKey)
      : null;
    if (joinedMembership && !joinedMembership.ok) {
      if (joinedMembership.error === "not_found") throw new UnknownPlanError(planId);
      if (joinedMembership.error === "full") throw new PlanCrewFullError(planId);
      throw new Error(`Could not create RSVP membership: ${joinedMembership.error}`);
    }
    if (status === "maybe" && existing?.memberId) {
      if (!removeMemoryPlanInviteRsvpMember(planId, existing.memberId)) {
        throw new Error("Refused to remove the host membership from an RSVP");
      }
    }
    byPlan.set(submitterHash, {
      id: existing?.id ?? crypto.randomUUID(),
      displayName,
      status,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      memberId: existingMembership?.identity.memberId ?? (joinedMembership?.ok ? joinedMembership.memberId : undefined),
    });
    memoryRsvps.set(planId, byPlan);
    const summary = await memoryRsvpStore.summarize(planId);
    return {
      summary,
      isUpdate: Boolean(existing),
      membership: status === "going"
        ? existingMembership
          ? {
              memberToken: existingMembership.memberToken,
              role: existingMembership.identity.role,
              collaborationAuthorized: existingMembership.identity.collaborationAuthorized,
            }
          : {
              memberToken: joinedMembership!.memberToken,
              role: "guest",
              collaborationAuthorized: false,
            }
        : null,
    };
  },
  async summarize(planId) {
    const byPlan = memoryRsvps.get(planId);
    const rows: RsvpRow[] = byPlan
      ? [...byPlan.values()].map((row) => ({ id: row.id, display_name: row.displayName, status: row.status, created_at: row.createdAt }))
      : [];
    return summarizeRsvpRows(rows);
  },
  async remove(planId, rsvpId) {
    const byPlan = memoryRsvps.get(planId);
    if (!byPlan) return;
    for (const [hash, row] of byPlan) {
      if (row.id !== rsvpId) continue;
      if (row.memberId && !removeMemoryPlanInviteRsvpMember(planId, row.memberId)) {
        throw new Error("Refused to remove the host membership from an RSVP");
      }
      byPlan.delete(hash);
    }
  },
};

export function rsvpStore(): PlanInviteRsvpStore {
  return selectStore(memoryRsvpStore, supabaseRsvpStore);
}

export function __resetMemoryRsvps(): void {
  memoryRsvps.clear();
}

// ── Reactions ────────────────────────────────────────────────────────────
// Reuses the pub-native reaction allowlist (lib/reactions.ts) rather than a
// second closed emoji taxonomy — one canonical set, everywhere it's needed.

type ReactionRow = { reaction: string; submitter_hash: string };

function summarizeReactionRows(rows: ReactionRow[], submitterHash: string): ReactionSummary {
  const counts: Partial<Record<ReactionKey, number>> = {};
  const mine = new Set<ReactionKey>();
  for (const row of rows) {
    if (!isReactionKey(row.reaction)) continue;
    counts[row.reaction] = (counts[row.reaction] ?? 0) + 1;
    if (row.submitter_hash === submitterHash) mine.add(row.reaction);
  }
  return { counts, mine: [...mine] };
}

export type PlanInviteReactionStore = {
  toggle(planId: string, submitterHash: string, reaction: ReactionKey): Promise<ReactionSummary>;
  summarize(planId: string, submitterHash: string): Promise<ReactionSummary>;
};

export const supabaseReactionStore: PlanInviteReactionStore = {
  async toggle(planId, submitterHash, reaction) {
    const { data: existing, error: readError } = await admin()
      .from(REACTION_TABLE)
      .select("id")
      .eq("plan_id", planId)
      .eq("submitter_hash", submitterHash)
      .eq("reaction", reaction)
      .limit(1);
    if (readError) throw new Error(readError.message);

    if ((existing ?? []).length > 0) {
      const { error } = await admin()
        .from(REACTION_TABLE)
        .delete()
        .eq("plan_id", planId)
        .eq("submitter_hash", submitterHash)
        .eq("reaction", reaction);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin()
        .from(REACTION_TABLE)
        .insert({ plan_id: planId, submitter_hash: submitterHash, reaction });
      if (error) {
        if (isForeignKeyViolation(error)) throw new UnknownPlanError(planId);
        if (!isUniqueViolation(error)) throw new Error(error.message);
      }
    }
    return supabaseReactionStore.summarize(planId, submitterHash);
  },
  async summarize(planId, submitterHash) {
    const { data, error } = await admin()
      .from(REACTION_TABLE)
      .select("reaction, submitter_hash")
      .eq("plan_id", planId);
    if (error) throw new Error(error.message);
    return summarizeReactionRows((data ?? []) as ReactionRow[], submitterHash);
  },
};

// Same globalThis anchor as memoryRsvps above, its own key so a plan store
// bug can't silently share (or collide with) this store's memory shape.
type InviteReactionMemoryState = {
  rows: Set<string>;
};
const inviteReactionMemoryGlobal = globalThis as typeof globalThis & {
  __pubmaxPlanInviteReactionMemory?: InviteReactionMemoryState;
};
const inviteReactionMemory = inviteReactionMemoryGlobal.__pubmaxPlanInviteReactionMemory ??= {
  rows: new Set(),
};
inviteReactionMemory.rows ??= new Set();
const memoryReactionRows = inviteReactionMemory.rows;

function reactionRowKey(planId: string, submitterHash: string, reaction: string): string {
  return `${planId}|${submitterHash}|${reaction}`;
}

export const memoryReactionStore: PlanInviteReactionStore = {
  async toggle(planId, submitterHash, reaction) {
    const key = reactionRowKey(planId, submitterHash, reaction);
    if (memoryReactionRows.has(key)) memoryReactionRows.delete(key);
    else memoryReactionRows.add(key);
    return memoryReactionStore.summarize(planId, submitterHash);
  },
  async summarize(planId, submitterHash) {
    const rows: ReactionRow[] = [];
    const prefix = `${planId}|`;
    for (const key of memoryReactionRows) {
      if (!key.startsWith(prefix)) continue;
      const [, hash, reaction] = key.split("|");
      rows.push({ reaction, submitter_hash: hash });
    }
    return summarizeReactionRows(rows, submitterHash);
  },
};

export function reactionStore(): PlanInviteReactionStore {
  return selectStore(memoryReactionStore, supabaseReactionStore);
}

export function __resetMemoryReactions(): void {
  memoryReactionRows.clear();
}
