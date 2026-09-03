import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  REFERRAL_MILESTONES,
  REFERRAL_SIGNUP_PROOF_TTL_MS,
  nextReferralMilestone,
  parseReferralMilestone,
  referralMarkForCount,
  type ReferralMilestone,
  type ReferralMilestoneEvent,
} from "@/lib/referrals";
import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

const MAX_MEMORY_CODES = 50_000;
const MAX_MEMORY_EDGES = 100_000;

export type ReferralContributionKind =
  | "community_price"
  | "visit_report"
  | "recommendation";

export type ReferralEarnedMilestone = ReferralMilestoneEvent & {
  earnedAt: string;
  qualifiedCount: number;
  /** The line the owner's profile prints for this milestone. */
  mark: string;
};

export type ReferralPrivateStatus = {
  attributedCount: number;
  qualifiedCount: number;
  earned: ReferralEarnedMilestone[];
  /** The highest mark earned so far, or null for somebody with none yet. */
  mark: string | null;
  nextMilestone: ReferralMilestone | null;
};

export type RecordEdgeResult =
  | {
      ok: true;
      status: "recorded" | "existing";
      edgeId: string;
      /** Inviter auth user id for WP7 follow-back. Never returned to browsers. */
      inviterUserId: string;
    }
  | {
      ok: false;
      reason:
        | "self"
        | "circular"
        | "already_attributed"
        | "deleted_identity"
        | "storage";
    };

export type ClaimCodeResult =
  | RecordEdgeResult
  | {
      ok: false;
      reason: "unknown" | "account_not_new";
    };

export type QualifyReferralResult =
  | { ok: true; status: "qualified" | "existing" }
  | { ok: false; reason: "no_edge" | "deleted_identity" | "storage" };

export class ReferralIdentityDeletedError extends Error {
  constructor() {
    super("Referral actions are unavailable for this account.");
    this.name = "ReferralIdentityDeletedError";
  }
}

export type ReferralStore = {
  getOrCreateInviteCode(
    inviterUserId: string,
    now?: number,
  ): Promise<{ code: string }>;
  claimCode(input: {
    code: string;
    inviteeUserId: string;
    inviteeCreatedAt: string;
    authAttemptStartedAt: number;
    now?: number;
  }): Promise<ClaimCodeResult>;
  recordEdge(
    inviterUserId: string,
    inviteeUserId: string,
    attributedAt?: number,
  ): Promise<RecordEdgeResult>;
  /**
   * Recovers the inviter for an already-recorded edge. Durable RPC success
   * shapes before WP7 omit inviter_user_id from claimCode's own result, so
   * this reads the edge back by invitee to fill it in.
   */
  getInviterForInvitee(inviteeUserId: string): Promise<string | null>;
  qualify(input: {
    inviteeUserId: string;
    contributionKind: ReferralContributionKind;
    contributionId: string;
    acceptedAt?: number;
  }): Promise<QualifyReferralResult>;
  privateStatus(inviterUserId: string): Promise<ReferralPrivateStatus>;
  eraseAccount(userId: string): Promise<void>;
};

type MemoryInviteCode = {
  inviterUserId: string;
  rawCode: string;
  createdAt: number;
};

type MemoryEdge = {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  attributedAt: number;
};

type MemoryQualification = {
  edgeId: string;
  contributionKind: ReferralContributionKind;
  contributionId: string;
  acceptedAt: number;
};

const inviteCodeByInviter = new Map<string, MemoryInviteCode>();
const inviterByCodeHash = new Map<string, string>();
const edgeByInvitee = new Map<string, MemoryEdge>();
const edgeById = new Map<string, MemoryEdge>();
const qualificationsByEdge = new Map<string, MemoryQualification>();
const erasedReferralIdentities = new Set<string>();
type MemoryLedgerRow = ReferralEarnedMilestone & {
  triggeringEdgeId: string;
};

const ledgerByInviter = new Map<string, MemoryLedgerRow[]>();

function opaqueToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cleanId(value: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function emptyStatus(): ReferralPrivateStatus {
  return {
    attributedCount: 0,
    qualifiedCount: 0,
    earned: [],
    mark: null,
    nextMilestone: 1,
  };
}

/**
 * The ONE projection of a stored milestone row into what a caller may see. It
 * is what keeps the durable row's own vocabulary off the wire: until migration
 * 0101 is applied, `read_private_referral_status` still returns the retired
 * `feature` and `grantStatus` keys, and a row handed through unprojected would
 * put a feature name back in front of a reader. A row that names no milestone
 * we recognise is dropped rather than guessed at.
 */
function earnedFromRow(raw: unknown): ReferralEarnedMilestone | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const milestone = parseReferralMilestone(row.milestone);
  if (milestone === null) return null;
  const qualifiedCount = Number(row.qualifiedCount ?? 0);
  return {
    event: "milestone_earned",
    milestone,
    permanent: true,
    earnedAt: typeof row.earnedAt === "string" ? row.earnedAt : "",
    qualifiedCount: Number.isFinite(qualifiedCount) ? qualifiedCount : 0,
    mark: referralMarkForCount(milestone) ?? "",
  };
}

function earnedRowsFor(
  inviterUserId: string,
  qualifiedCount: number,
  triggeringEdgeId: string,
  now: number,
): MemoryLedgerRow[] {
  const current = ledgerByInviter.get(inviterUserId) ?? [];
  const recorded = new Set(current.map((entry) => entry.milestone));
  const additions: MemoryLedgerRow[] = [];
  for (const milestone of REFERRAL_MILESTONES) {
    if (qualifiedCount < milestone || recorded.has(milestone)) continue;
    additions.push({
      event: "milestone_earned",
      milestone,
      permanent: true,
      earnedAt: new Date(now).toISOString(),
      qualifiedCount,
      mark: referralMarkForCount(milestone) ?? "",
      triggeringEdgeId,
    });
  }
  if (additions.length > 0) {
    ledgerByInviter.set(inviterUserId, [...current, ...additions]);
  }
  return additions;
}

export const memoryReferralStore: ReferralStore = {
  async getOrCreateInviteCode(inviterUserId, now = Date.now()) {
    const inviter = cleanId(inviterUserId);
    if (erasedReferralIdentities.has(inviter)) {
      throw new ReferralIdentityDeletedError();
    }
    const existing = inviteCodeByInviter.get(inviter);
    if (existing) return { code: existing.rawCode };
    const rawCode = opaqueToken(18);
    const record = { inviterUserId: inviter, rawCode, createdAt: now };
    inviteCodeByInviter.set(inviter, record);
    if (inviteCodeByInviter.size > MAX_MEMORY_CODES) {
      const oldestInviter = inviteCodeByInviter.keys().next().value as
        | string
        | undefined;
      const oldest = oldestInviter
        ? inviteCodeByInviter.get(oldestInviter)
        : null;
      if (oldestInviter) inviteCodeByInviter.delete(oldestInviter);
      if (oldest) inviterByCodeHash.delete(tokenHash(oldest.rawCode));
    }
    inviterByCodeHash.set(tokenHash(rawCode), inviter);
    return { code: rawCode };
  },

  async claimCode({
    code,
    inviteeUserId,
    inviteeCreatedAt,
    authAttemptStartedAt,
    now = Date.now(),
  }) {
    if (erasedReferralIdentities.has(cleanId(inviteeUserId))) {
      return { ok: false, reason: "deleted_identity" };
    }
    const createdAt = Date.parse(inviteeCreatedAt);
    if (
      !Number.isFinite(createdAt) ||
      createdAt > now ||
      !Number.isSafeInteger(authAttemptStartedAt) ||
      authAttemptStartedAt > now ||
      authAttemptStartedAt <= now - REFERRAL_SIGNUP_PROOF_TTL_MS ||
      createdAt < authAttemptStartedAt
    ) {
      return { ok: false, reason: "account_not_new" };
    }
    const inviterUserId = inviterByCodeHash.get(tokenHash(code));
    if (!inviterUserId || erasedReferralIdentities.has(inviterUserId)) {
      return { ok: false, reason: "unknown" };
    }
    return memoryReferralStore.recordEdge(
      inviterUserId,
      inviteeUserId,
      now,
    );
  },

  async recordEdge(inviterUserId, inviteeUserId, attributedAt = Date.now()) {
    const inviter = cleanId(inviterUserId);
    const invitee = cleanId(inviteeUserId);
    if (!inviter || !invitee) return { ok: false, reason: "storage" };
    if (
      erasedReferralIdentities.has(inviter) ||
      erasedReferralIdentities.has(invitee)
    ) {
      return { ok: false, reason: "deleted_identity" };
    }
    if (inviter === invitee) return { ok: false, reason: "self" };
    const existing = edgeByInvitee.get(invitee);
    if (existing) {
      return existing.inviterUserId === inviter
        ? {
            ok: true,
            status: "existing",
            edgeId: existing.id,
            inviterUserId: inviter,
          }
        : { ok: false, reason: "already_attributed" };
    }
    const reverse = edgeByInvitee.get(inviter);
    if (reverse?.inviterUserId === invitee) {
      return { ok: false, reason: "circular" };
    }
    if (edgeByInvitee.size >= MAX_MEMORY_EDGES) {
      return { ok: false, reason: "storage" };
    }
    const edge: MemoryEdge = {
      id: `ref-${opaqueToken(12)}`,
      inviterUserId: inviter,
      inviteeUserId: invitee,
      attributedAt,
    };
    edgeByInvitee.set(invitee, edge);
    edgeById.set(edge.id, edge);
    return {
      ok: true,
      status: "recorded",
      edgeId: edge.id,
      inviterUserId: inviter,
    };
  },

  async getInviterForInvitee(inviteeUserId) {
    const edge = edgeByInvitee.get(cleanId(inviteeUserId));
    return edge?.inviterUserId ?? null;
  },

  async qualify({
    inviteeUserId,
    contributionKind,
    contributionId,
    acceptedAt = Date.now(),
  }) {
    const invitee = cleanId(inviteeUserId);
    if (erasedReferralIdentities.has(invitee)) {
      return { ok: false, reason: "deleted_identity" };
    }
    const edge = edgeByInvitee.get(invitee);
    if (!edge) return { ok: false, reason: "no_edge" };
    if (erasedReferralIdentities.has(edge.inviterUserId)) {
      return { ok: false, reason: "deleted_identity" };
    }
    if (qualificationsByEdge.has(edge.id)) {
      return { ok: true, status: "existing" };
    }
    qualificationsByEdge.set(edge.id, {
      edgeId: edge.id,
      contributionKind,
      contributionId,
      acceptedAt,
    });
    let qualifiedCount = 0;
    for (const qualifiedEdgeId of qualificationsByEdge.keys()) {
      const candidate = edgeById.get(qualifiedEdgeId);
      if (candidate?.inviterUserId === edge.inviterUserId) qualifiedCount += 1;
    }
    earnedRowsFor(edge.inviterUserId, qualifiedCount, edge.id, acceptedAt);
    return { ok: true, status: "qualified" };
  },

  async privateStatus(inviterUserId) {
    const inviter = cleanId(inviterUserId);
    if (!inviter || erasedReferralIdentities.has(inviter)) return emptyStatus();
    const edges = [...edgeByInvitee.values()].filter(
      (edge) => edge.inviterUserId === inviter,
    );
    const qualifiedCount = edges.filter((edge) =>
      qualificationsByEdge.has(edge.id)
    ).length;
    const earned = (ledgerByInviter.get(inviter) ?? [])
      .map(earnedFromRow)
      .filter((row): row is ReferralEarnedMilestone => row !== null);
    return {
      attributedCount: edges.length,
      qualifiedCount,
      earned,
      mark: referralMarkForCount(qualifiedCount),
      nextMilestone: nextReferralMilestone(qualifiedCount),
    };
  },

  async eraseAccount(userId) {
    const user = cleanId(userId);
    if (!user) return;
    erasedReferralIdentities.add(user);

    const removedEdgeIds = new Set<string>();
    for (const edge of edgeById.values()) {
      if (edge.inviterUserId === user || edge.inviteeUserId === user) {
        removedEdgeIds.add(edge.id);
      }
    }
    for (const edgeId of removedEdgeIds) {
      const edge = edgeById.get(edgeId);
      if (edge) edgeByInvitee.delete(edge.inviteeUserId);
      edgeById.delete(edgeId);
      qualificationsByEdge.delete(edgeId);
    }

    for (const [inviter, rows] of ledgerByInviter) {
      if (inviter === user) {
        ledgerByInviter.delete(inviter);
        continue;
      }
      const retained = rows.filter(
        (row) => !removedEdgeIds.has(row.triggeringEdgeId),
      );
      if (retained.length > 0) ledgerByInviter.set(inviter, retained);
      else ledgerByInviter.delete(inviter);
    }

    const inviteCode = inviteCodeByInviter.get(user);
    if (inviteCode) {
      inviterByCodeHash.delete(tokenHash(inviteCode.rawCode));
      inviteCodeByInviter.delete(user);
    }
  },
};

const { guard, resetWarnings } = createFailSoftGuard({
  tag: "referrals",
  tables: [
    "referral_erasure_blocks",
    "referral_invite_codes",
    "referral_edges",
    "referral_qualification_events",
    // Both names on purpose: 0101 renames the ledger, and this list only
    // matches the table name inside a missing-schema error. Naming one name
    // would send a real schema miss down the wrong branch either side of the
    // migration landing.
    "referral_milestone_ledger",
    "pro_feature_unlock_ledger",
  ],
  migrationHint: "apply migrations 0060 and 0101",
});

function missingReferralStorageFallback<T>(
  fallback: () => Promise<T>,
): Promise<T> {
  return onMissingDurableWrite({
    storeTag: "referrals",
    migrationHint: "apply migrations 0060 and 0101",
    fallback,
  });
}

function objectRow(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return (data[0] ?? {}) as Record<string, unknown>;
  return data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
}

function recordEdgeResult(data: unknown): RecordEdgeResult {
  const row = objectRow(data);
  if (row.ok === true) {
    const inviterUserId = String(
      row.inviter_user_id ?? row.inviterUserId ?? "",
    );
    return {
      ok: true,
      status: row.status === "existing" ? "existing" : "recorded",
      edgeId: String(row.edge_id ?? ""),
      inviterUserId,
    };
  }
  const reason = row.reason;
  if (
    reason === "self" ||
    reason === "circular" ||
    reason === "already_attributed" ||
    reason === "deleted_identity"
  ) {
    return { ok: false, reason };
  }
  return { ok: false, reason: "storage" };
}

export const supabaseReferralStore: ReferralStore = {
  async getOrCreateInviteCode(inviterUserId, now = Date.now()) {
    return guard({
      context: "invite-code",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.getOrCreateInviteCode(inviterUserId, now)
        ),
      run: async () => {
        const rawCode = opaqueToken(18);
        const { data, error } = await requireSupabaseAdmin().rpc(
          "get_or_create_referral_invite_code",
          {
            p_inviter_user_id: inviterUserId,
            p_code_hash: tokenHash(rawCode),
            p_code_token: rawCode,
            p_created_at: new Date(now).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        if (row.reason === "deleted_identity") {
          throw new ReferralIdentityDeletedError();
        }
        const code = typeof row.code === "string" ? row.code : "";
        if (!code) throw new Error("Referral invite code was not returned.");
        return { code };
      },
    });
  },

  async claimCode(input) {
    return guard({
      context: "claim-code",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.claimCode(input)
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "claim_referral_code",
          {
            p_code_hash: tokenHash(input.code),
            p_invitee_user_id: input.inviteeUserId,
            p_auth_attempt_started_at: new Date(
              input.authAttemptStartedAt,
            ).toISOString(),
            p_now: new Date(input.now ?? Date.now()).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        if (row.ok === true) return recordEdgeResult(row);
        const reason = row.reason;
        if (reason === "unknown" || reason === "account_not_new") {
          return { ok: false, reason };
        }
        return recordEdgeResult(row);
      },
    });
  },

  async recordEdge(inviterUserId, inviteeUserId, attributedAt = Date.now()) {
    return guard({
      context: "record-edge",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.recordEdge(
            inviterUserId,
            inviteeUserId,
            attributedAt,
          )
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "record_referral_edge",
          {
            p_inviter_user_id: inviterUserId,
            p_invitee_user_id: inviteeUserId,
            p_attributed_at: new Date(attributedAt).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        return recordEdgeResult(data);
      },
    });
  },

  async getInviterForInvitee(inviteeUserId) {
    return guard({
      context: "inviter-for-invitee",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.getInviterForInvitee(inviteeUserId)
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("referral_edges")
          .select("inviter_user_id")
          .eq("invitee_user_id", inviteeUserId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return typeof data?.inviter_user_id === "string"
          ? data.inviter_user_id
          : null;
      },
    });
  },

  async qualify(input) {
    return guard({
      context: "qualify",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.qualify(input)
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "qualify_referral_from_contribution",
          {
            p_invitee_user_id: input.inviteeUserId,
            p_contribution_kind: input.contributionKind,
            p_contribution_id: input.contributionId,
            p_accepted_at: new Date(input.acceptedAt ?? Date.now()).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        if (row.ok === true) {
          return {
            ok: true,
            status: row.status === "existing" ? "existing" : "qualified",
          };
        }
        return {
          ok: false,
          reason:
            row.reason === "no_edge" || row.reason === "deleted_identity"
              ? row.reason
              : "storage",
        };
      },
    });
  },

  async privateStatus(inviterUserId) {
    return guard({
      context: "private-status",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.privateStatus(inviterUserId)
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "read_private_referral_status",
          { p_inviter_user_id: inviterUserId },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        const earnedRaw = Array.isArray(row.earned) ? row.earned : [];
        const earned = earnedRaw
          .map(earnedFromRow)
          .filter((item): item is ReferralEarnedMilestone => item !== null);
        const qualifiedCount = Number(row.qualified_count ?? 0);
        return {
          attributedCount: Number(row.attributed_count ?? 0),
          qualifiedCount,
          earned,
          mark: referralMarkForCount(qualifiedCount),
          nextMilestone: nextReferralMilestone(qualifiedCount),
        };
      },
    });
  },

  async eraseAccount(userId) {
    return guard({
      context: "erase-account",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.eraseAccount(userId)
        ),
      run: async () => {
        const { error } = await requireSupabaseAdmin().rpc(
          "erase_referral_account",
          { p_user_id: userId },
        );
        if (error) throw new Error(error.message);
      },
    });
  },
};

export function referralStore(): ReferralStore {
  return selectStore(memoryReferralStore, supabaseReferralStore);
}

export function __resetMemoryReferrals(): void {
  inviteCodeByInviter.clear();
  inviterByCodeHash.clear();
  edgeByInvitee.clear();
  edgeById.clear();
  qualificationsByEdge.clear();
  ledgerByInviter.clear();
  erasedReferralIdentities.clear();
  resetWarnings();
}
