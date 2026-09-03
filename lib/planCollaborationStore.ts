import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { isPlanId, type PlanMemberRole, type PlanState, type PlanStopDTO } from "@/lib/plan";
import { grantMemoryPlanCollaboration, hashPlanMemberToken, isMissingDatabaseFunction, isPlanIdempotencyKey, planAccountHasActiveSeat, planIdempotencyDigest, planIdempotentUuid, planMemberIdentity, planMemberIdentityResult, planRequestDigest, planStateResult, planStore, reconcileMemoryPlanAccountJoin } from "@/lib/planStore";
import { cleanText } from "@/lib/textClean";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { isVibeChipId, type VibeChipId } from "@/lib/vibeChips";
import { EMPTY_VIBE_TALLY, tallyVibeVotes, type VibeTally } from "@/lib/vibeTally";
import { inviteExpiresAtIso, isPastPlanScheduledEnd } from "@/lib/inviteExpiry";
import { isPlanStopCount } from "@/lib/planStopCount";

export type PlanInvite = {
  id: string;
  planId: string;
  role: "guest";
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  redeemedAt: string | null;
};

export type PlanConstraintKind = "accessibility" | "budget" | "zero_proof" | "timing" | "transport" | "other";
export type PlanConstraintVenueEvidence = { venueId: string; sourceUrl: string; publisher: string; observedAt: string; note: string };
export type PlanConstraintEvidence = { proposalId: string; routeRevision: number; sources: PlanConstraintVenueEvidence[] };
export type PlanConstraint = {
  id: string;
  planId: string;
  memberId: string;
  kind: PlanConstraintKind;
  value: string;
  priority: "required" | "preference";
  createdAt: string;
  resolvedAt: string | null;
  resolvedByMemberId: string | null;
  evidence: PlanConstraintEvidence | null;
};

export type PlanVote = {
  id: string;
  planId: string;
  proposalId: string;
  memberId: string;
  value: "approve" | "reject" | "abstain";
  createdAt: string;
};

// One vibe vote per plan member (docs/VIBE_LAYER_SPEC_2026-07-19.md, surface 3):
// the crew's declared night, tallied for the share-card stamp. Revote replaces
// (upsert keyed on plan + member); the vote's own value is one of the seven
// owner-locked chip ids (VibeChipId), validated here, never a free string.
export type PlanVibeVote = {
  planId: string;
  memberId: string;
  vibe: VibeChipId;
  createdAt: string;
};

export type { VibeTally } from "@/lib/vibeTally";

export type PlanRouteProposal = {
  id: string;
  planId: string;
  proposedByMemberId: string;
  expectedRouteRevision: number;
  stops: PlanStopDTO[];
  reason: string;
  resolvedConstraintIds: string[];
  unresolvedConstraintIds: string[];
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  decidedAt: string | null;
};

export type PlanCollaborationError = "invalid" | "not_found" | "forbidden" | "expired" | "revoked" | "replayed" | "conflict" | "account_conflict" | "constraints_unresolved" | "error";
type Failure = { ok: false; error: PlanCollaborationError };
type StoredInvite = PlanInvite & { tokenHash: string };

class LegacyPlanNotFoundError extends Error {}

async function legacyPlanBoundary(planId: string): Promise<Failure | null> {
  const result = await planStateResult(planId);
  if (!result.ok) return { ok: false, error: "error" };
  return result.plan ? null : { ok: false, error: "not_found" };
}

type CollaborationMemory = {
  invites: Map<string, StoredInvite>;
  constraints: Map<string, PlanConstraint>;
  proposals: Map<string, PlanRouteProposal>;
  votes: Map<string, PlanVote>;
  // Keyed `${planId}:${memberId}` so a revote overwrites the member's row.
  vibeVotes: Map<string, PlanVibeVote>;
  idempotency: Map<string, unknown>;
};

const globalMemory = globalThis as typeof globalThis & { __pubmaxPlanCollaboration?: CollaborationMemory };
const memory = globalMemory.__pubmaxPlanCollaboration ??= {
  invites: new Map(),
  constraints: new Map(),
  proposals: new Map(),
  votes: new Map(),
  vibeVotes: new Map(),
  idempotency: new Map(),
};

function inviteHash(token: string): string {
  const salt = process.env.PLAN_INVITE_TOKEN_SALT ?? process.env.ACTOR_HASH_SALT ?? "pubmax-plan-invite";
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

function memberTokenHash(token: string): string {
  const salt = process.env.PLAN_MEMBER_TOKEN_SALT ?? process.env.ACTOR_HASH_SALT ?? "pubmax-plan-member";
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.trim().length <= 120;
}

function idempotencyKey(planId: string, memberId: string, operation: string, key: string): string {
  return `${planId}:${memberId}:${operation}:${key.trim()}`;
}

function publicInvite(invite: StoredInvite): PlanInvite {
  const { tokenHash: _tokenHash, ...value } = invite;
  void _tokenHash;
  return { ...value };
}

function cloneProposal(proposal: PlanRouteProposal): PlanRouteProposal {
  return {
    ...proposal,
    stops: proposal.stops.map((stop) => ({ ...stop })),
    resolvedConstraintIds: [...proposal.resolvedConstraintIds],
    unresolvedConstraintIds: [...proposal.unresolvedConstraintIds],
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function inviteFromRow(row: Record<string, unknown>): PlanInvite {
  return { id: String(row.id), planId: String(row.plan_id), role: "guest", createdAt: String(row.created_at), expiresAt: String(row.expires_at), revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null, redeemedAt: typeof row.redeemed_at === "string" ? row.redeemed_at : null };
}

function atomicRow(data: unknown): { code: string; row: Record<string, unknown> | null } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : "",
    row: value.row && typeof value.row === "object" && !Array.isArray(value.row)
      ? value.row as Record<string, unknown>
      : null,
  };
}

function constraintFromRow(row: Record<string, unknown>): PlanConstraint {
  const evidence = row.resolution_evidence && typeof row.resolution_evidence === "object" ? row.resolution_evidence as Record<string, unknown> : null;
  return {
    id: String(row.id), planId: String(row.plan_id), memberId: String(row.member_id), kind: row.kind as PlanConstraintKind, value: String(row.value), priority: row.priority as PlanConstraint["priority"], createdAt: String(row.created_at),
    resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
    resolvedByMemberId: typeof row.resolved_by_member_id === "string" ? row.resolved_by_member_id : null,
    evidence: evidence ? {
      proposalId: String(evidence.proposalId ?? ""), routeRevision: Number(evidence.routeRevision),
      sources: Array.isArray(evidence.sources) ? evidence.sources.flatMap((source) => {
        if (!source || typeof source !== "object") return [];
        const row = source as Record<string, unknown>;
        return [{ venueId: String(row.venueId ?? ""), sourceUrl: String(row.sourceUrl ?? ""), publisher: String(row.publisher ?? ""), observedAt: String(row.observedAt ?? ""), note: String(row.note ?? "") }];
      }) : [],
    } : null,
  };
}

function evidenceCoversProposal(constraint: PlanConstraint, proposal: PlanRouteProposal): boolean {
  const evidence = constraint.evidence;
  if (!evidence || evidence.proposalId !== proposal.id || evidence.routeRevision !== proposal.expectedRouteRevision) return false;
  const expected = new Set(proposal.stops.map((stop) => stop.venueId));
  return evidence.sources.length === expected.size && evidence.sources.every((source) => expected.has(source.venueId) && /^https?:\/\//i.test(source.sourceUrl) && Boolean(source.publisher));
}

function cleanConstraintEvidence(input: PlanConstraintEvidence, proposal: PlanRouteProposal, now: Date): PlanConstraintEvidence | null {
  if (input.proposalId !== proposal.id || input.routeRevision !== proposal.expectedRouteRevision || !Array.isArray(input.sources)) return null;
  const expected = new Set(proposal.stops.map((stop) => stop.venueId));
  if (input.sources.length !== expected.size || new Set(input.sources.map((source) => source.venueId)).size !== expected.size) return null;
  const sources = input.sources.map((source) => {
    const sourceUrl = cleanText(source.sourceUrl, 500);
    const publisher = cleanText(source.publisher, 120);
    const note = cleanText(source.note, 300);
    const observedAt = new Date(source.observedAt);
    if (!expected.has(source.venueId) || !/^https?:\/\//i.test(sourceUrl) || !publisher || !Number.isFinite(observedAt.getTime()) || observedAt.getTime() > now.getTime() + 60_000) return null;
    return { venueId: source.venueId, sourceUrl, publisher, observedAt: observedAt.toISOString(), note };
  });
  return sources.some((source) => source === null) ? null : { proposalId: proposal.id, routeRevision: proposal.expectedRouteRevision, sources: sources as PlanConstraintVenueEvidence[] };
}

function proposalFromRow(row: Record<string, unknown>): PlanRouteProposal {
  const rawStops = Array.isArray(row.stops) ? row.stops : [];
  return {
    id: String(row.id), planId: String(row.plan_id), proposedByMemberId: String(row.proposed_by_member_id),
    expectedRouteRevision: Number(row.expected_route_revision),
    stops: rawStops.map((stop) => ({ venueId: String((stop as Record<string, unknown>).venueId), venueName: String((stop as Record<string, unknown>).venueName), position: Number((stop as Record<string, unknown>).position) })),
    reason: String(row.reason), resolvedConstraintIds: strings(row.resolved_constraint_ids), unresolvedConstraintIds: strings(row.unresolved_constraint_ids),
    status: row.status as PlanRouteProposal["status"], createdAt: String(row.created_at), decidedAt: typeof row.decided_at === "string" ? row.decided_at : null,
  };
}

function voteFromRow(row: Record<string, unknown>): PlanVote {
  return { id: String(row.id), planId: String(row.plan_id), proposalId: String(row.proposal_id), memberId: String(row.member_id), value: row.value as PlanVote["value"], createdAt: String(row.created_at) };
}

function vibeVoteFromRow(row: Record<string, unknown>): PlanVibeVote {
  return { planId: String(row.plan_id), memberId: String(row.member_id), vibe: row.vibe as VibeChipId, createdAt: String(row.created_at) };
}

function vibeKey(planId: string, memberId: string): string {
  return `${planId}:${memberId}`;
}

async function member(planId: string, token: unknown, role?: PlanMemberRole) {
  const boundary = await legacyPlanBoundary(planId);
  if (boundary) {
    if (boundary.error === "not_found") throw new LegacyPlanNotFoundError();
    throw new Error("plan collaboration Plan lookup failed");
  }
  const result = await planMemberIdentityResult(planId, token);
  if (!result.ok) throw new Error("plan collaboration capability lookup failed");
  const identity = result.identity;
  if (!identity || (role && identity.role !== role)) return null;
  return identity.role === "host" || identity.collaborationAuthorized ? identity : null;
}

function validStops(stops: readonly PlanStopDTO[]): boolean {
  return isPlanStopCount(stops.length) &&
    new Set(stops.map((stop) => stop.venueId)).size === stops.length &&
    stops.every((stop, index) => stop.position === index && Boolean(stop.venueId) && Boolean(stop.venueName));
}

export type PlanCollaborationStore = {
  createInvite(planId: string, token: unknown, input: { expiresInMinutes: number; idempotencyKey: string; now?: Date }): Promise<{ ok: true; invite: PlanInvite; token: string } | Failure>;
  revokeInvite(planId: string, token: unknown, inviteId: string, key: string, now?: Date): Promise<{ ok: true; invite: PlanInvite } | Failure>;
  consumeInvite(planId: string, token: unknown, now?: Date): Promise<{ ok: true; inviteId: string; role: "guest" } | Failure>;
  redeemInviteAndJoin(planId: string, token: unknown, name: string, now?: Date, options?: { idempotencyKey?: string; userId?: string }): Promise<{ ok: true; plan: PlanState | null; memberToken: string; role: "guest"; collaborationAuthorized: true } | Failure | { ok: false; error: "full" }>;
  // inviteId is the invite's own (non-secret) row id, surfaced only so the
  // caller can emit a metrics event linking invite_created -> invite_redeemed
  // for k-factor; null when the redemption is a replay of an already-
  // authorized session and the originating invite can't be identified.
  upgradeMemberInvite(planId: string, memberToken: unknown, inviteToken: unknown, now?: Date): Promise<{ ok: true; collaborationAuthorized: true; inviteId: string | null } | Failure>;
  addConstraint(planId: string, token: unknown, input: { kind: PlanConstraintKind; value: string; priority: PlanConstraint["priority"]; idempotencyKey: string; now?: Date }): Promise<{ ok: true; constraint: PlanConstraint } | Failure>;
  resolveConstraint(planId: string, token: unknown, constraintId: string, input: { evidence: PlanConstraintEvidence; idempotencyKey: string; now?: Date }): Promise<{ ok: true; constraint: PlanConstraint } | Failure>;
  createProposal(planId: string, token: unknown, input: { reason: string; expectedRouteRevision: number; stops: PlanStopDTO[]; resolvedConstraintIds: string[]; idempotencyKey: string; now?: Date }): Promise<{ ok: true; proposal: PlanRouteProposal } | Failure>;
  vote(planId: string, token: unknown, proposalId: string, value: PlanVote["value"], key: string, now?: Date): Promise<{ ok: true; vote: PlanVote } | Failure>;
  // Vibe votes (share-loop tally). recordVibeVote is member-capability bound and
  // upserts (revote replaces); vibeTally is a tokenless aggregate read for the
  // public share card and the read endpoint (counts only, no member identity).
  recordVibeVote(planId: string, token: unknown, vibe: VibeChipId, key: string, now?: Date): Promise<{ ok: true; vote: PlanVibeVote } | Failure>;
  vibeTally(planId: string): Promise<{ ok: true; tally: VibeTally } | Failure>;
  decideProposal(planId: string, token: unknown, proposalId: string, decision: "accepted" | "rejected", key: string, apply: (proposal: PlanRouteProposal) => Promise<boolean>, now?: Date): Promise<{ ok: true; proposal: PlanRouteProposal } | Failure>;
  list(planId: string, token: unknown): Promise<{ ok: true; memberId: string; invites: PlanInvite[]; constraints: PlanConstraint[]; proposals: PlanRouteProposal[]; votes: PlanVote[] } | Failure>;
};

async function resolveInviteExpiresAt(
  planId: string,
  expiresInMinutes: number,
  now: Date,
): Promise<{ ok: true; expiresAt: string } | Failure> {
  const plan = await planStore().get(planId);
  if (!plan) return { ok: false, error: "not_found" };
  const expiresAt = inviteExpiresAtIso({ startTime: plan.plan.startTime, expiresInMinutes, now });
  if (!expiresAt) return { ok: false, error: "expired" };
  return { ok: true, expiresAt };
}

async function rejectIfPlanEnded(planId: string, now: Date): Promise<Failure | null> {
  const plan = await planStore().get(planId);
  if (!plan) return { ok: false, error: "not_found" };
  if (isPastPlanScheduledEnd(plan.plan.startTime, now)) return { ok: false, error: "expired" };
  return null;
}

const memoryStore: PlanCollaborationStore = {
  async createInvite(planId, token, input) {
    if (!isPlanId(planId) || !validKey(input.idempotencyKey) || !Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 5 || input.expiresInMinutes > 10_080) return { ok: false, error: "invalid" };
    const identity = await member(planId, token, "host");
    if (!identity) return { ok: false, error: "forbidden" };
    const idem = idempotencyKey(planId, identity.memberId, "invite:create", input.idempotencyKey);
    const replay = memory.idempotency.get(idem) as { ok: true; invite: PlanInvite; token: string } | undefined;
    if (replay) return structuredClone(replay);
    const rawToken = randomBytes(32).toString("hex");
    const now = input.now ?? new Date();
    const expires = await resolveInviteExpiresAt(planId, input.expiresInMinutes, now);
    if (!expires.ok) return expires;
    const invite: StoredInvite = {
      id: randomUUID(),
      planId,
      role: "guest",
      createdAt: now.toISOString(),
      expiresAt: expires.expiresAt,
      revokedAt: null,
      redeemedAt: null,
      tokenHash: inviteHash(rawToken),
    };
    memory.invites.set(invite.id, invite);
    const result = { ok: true as const, invite: publicInvite(invite), token: rawToken };
    memory.idempotency.set(idem, result);
    return structuredClone(result);
  },

  async revokeInvite(planId, token, inviteId, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token, "host");
    if (!identity) return { ok: false, error: "forbidden" };
    const idem = idempotencyKey(planId, identity.memberId, "invite:revoke", key);
    const replay = memory.idempotency.get(idem) as { ok: true; invite: PlanInvite } | undefined;
    if (replay) return structuredClone(replay);
    const invite = memory.invites.get(inviteId);
    if (!invite || invite.planId !== planId) return { ok: false, error: "not_found" };
    if (!invite.revokedAt) invite.revokedAt = now.toISOString();
    const result = { ok: true as const, invite: publicInvite(invite) };
    memory.idempotency.set(idem, result);
    return structuredClone(result);
  },

  async consumeInvite(planId, rawToken, now = new Date()) {
    if (!isPlanId(planId) || typeof rawToken !== "string" || !rawToken.trim()) return { ok: false, error: "invalid" };
    const hash = inviteHash(rawToken.trim());
    const invite = [...memory.invites.values()].find((candidate) => candidate.planId === planId && candidate.tokenHash === hash);
    if (!invite) return { ok: false, error: "not_found" };
    if (invite.revokedAt) return { ok: false, error: "revoked" };
    if (Date.parse(invite.expiresAt) <= now.getTime()) return { ok: false, error: "expired" };
    const ended = await rejectIfPlanEnded(planId, now);
    if (ended) return ended;
    if (invite.redeemedAt) return { ok: false, error: "replayed" };
    invite.redeemedAt = now.toISOString();
    return { ok: true, inviteId: invite.id, role: "guest" };
  },

  async redeemInviteAndJoin(planId, rawToken, name, now = new Date(), options = {}) {
    if (!isPlanId(planId) || typeof rawToken !== "string" || !rawToken.trim()) return { ok: false, error: "invalid" };
    const hash = inviteHash(rawToken.trim());
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const userId = typeof options.userId === "string" ? options.userId.trim() : "";
    const requestHash = planRequestDigest({
      name,
      inviteHash: hash,
      ...(userId ? { userId } : {}),
    });
    const requestKey = `${planId}:invite:join:${key}`;
    const replay = memory.idempotency.get(requestKey) as { requestHash: string; result: { ok: true; plan: PlanState | null; memberToken: string; role: "guest"; collaborationAuthorized: true } } | undefined;
    if (replay) {
      if (replay.requestHash === requestHash) {
        if (!await planMemberIdentity(planId, replay.result.memberToken)) return { ok: false, error: "conflict" };
        return structuredClone(replay.result);
      }
      if (userId && replay.requestHash === planRequestDigest({ name, inviteHash: hash })) {
        const accountReplay = reconcileMemoryPlanAccountJoin(
          planId,
          key,
          name,
          true,
          userId,
        );
        if (accountReplay) {
          if (!accountReplay.ok) {
            return accountReplay.error === "full"
              ? { ok: false, error: "full" }
              : accountReplay.error === "account_conflict"
                ? { ok: false, error: "account_conflict" }
                : accountReplay.error === "not_found"
                  ? { ok: false, error: "not_found" }
                  : accountReplay.error === "conflict"
                    ? { ok: false, error: "conflict" }
                    : { ok: false, error: "error" };
          }
          return { ...accountReplay, collaborationAuthorized: true as const };
        }
      }
      return { ok: false, error: "conflict" };
    }
    const invite = [...memory.invites.values()].find((candidate) => candidate.planId === planId && candidate.tokenHash === hash);
    if (!invite) return { ok: false, error: "not_found" };
    if (invite.revokedAt) return { ok: false, error: "revoked" };
    if (Date.parse(invite.expiresAt) <= now.getTime()) return { ok: false, error: "expired" };
    const ended = await rejectIfPlanEnded(planId, now);
    if (ended) return ended;
    if (invite.redeemedAt) return { ok: false, error: "replayed" };
    invite.redeemedAt = now.toISOString();
    const joined = await planStore().join(planId, name, {
      collaborationAuthorized: true,
      idempotencyKey: key,
      userId: userId || undefined,
    });
    if (!joined.ok) {
      invite.redeemedAt = null;
      return joined.error === "full"
        ? { ok: false, error: "full" }
        : joined.error === "account_conflict"
          ? { ok: false, error: "account_conflict" }
          : { ok: false, error: joined.error === "not_found" ? "not_found" : "error" };
    }
    const result = { ...joined, collaborationAuthorized: true as const };
    memory.idempotency.set(requestKey, { requestHash, result });
    return result;
  },

  async upgradeMemberInvite(planId, rawMemberToken, rawInviteToken, now = new Date()) {
    const identity = await planMemberIdentity(planId, rawMemberToken);
    if (!identity || identity.role !== "guest") return { ok: false, error: "forbidden" };
    if (identity.collaborationAuthorized) return { ok: true, collaborationAuthorized: true, inviteId: null };
    if (typeof rawInviteToken !== "string" || !rawInviteToken.trim()) return { ok: false, error: "invalid" };
    const invite = [...memory.invites.values()].find((candidate) => candidate.planId === planId && candidate.tokenHash === inviteHash(rawInviteToken.trim()));
    if (!invite) return { ok: false, error: "not_found" };
    if (invite.revokedAt) return { ok: false, error: "revoked" };
    if (invite.redeemedAt) return { ok: false, error: "replayed" };
    if (Date.parse(invite.expiresAt) <= now.getTime()) return { ok: false, error: "expired" };
    const ended = await rejectIfPlanEnded(planId, now);
    if (ended) return ended;
    if (!grantMemoryPlanCollaboration(planId, rawMemberToken)) return { ok: false, error: "error" };
    invite.redeemedAt = now.toISOString();
    return { ok: true, collaborationAuthorized: true, inviteId: invite.id };
  },

  async addConstraint(planId, token, input) {
    const kinds: PlanConstraintKind[] = ["accessibility", "budget", "zero_proof", "timing", "transport", "other"];
    const value = cleanText(input.value, 180);
    if (!isPlanId(planId) || !validKey(input.idempotencyKey) || !kinds.includes(input.kind) || !value || !["required", "preference"].includes(input.priority)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const idem = idempotencyKey(planId, identity.memberId, "constraint:add", input.idempotencyKey);
    const replay = memory.idempotency.get(idem) as { ok: true; constraint: PlanConstraint } | undefined;
    if (replay) return structuredClone(replay);
    const constraint: PlanConstraint = {
      id: randomUUID(), planId, memberId: identity.memberId, kind: input.kind, value,
      priority: input.priority, createdAt: (input.now ?? new Date()).toISOString(), resolvedAt: null, resolvedByMemberId: null, evidence: null,
    };
    memory.constraints.set(constraint.id, constraint);
    const result = { ok: true as const, constraint: { ...constraint } };
    memory.idempotency.set(idem, result);
    return structuredClone(result);
  },

  async resolveConstraint(planId, token, constraintId, input) {
    if (!isPlanId(planId) || !validKey(input.idempotencyKey)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token, "host");
    if (!identity) return { ok: false, error: "forbidden" };
    const constraint = memory.constraints.get(constraintId);
    if (!constraint || constraint.planId !== planId) return { ok: false, error: "not_found" };
    const now = input.now ?? new Date();
    const proposal = memory.proposals.get(input.evidence.proposalId);
    if (!proposal || proposal.planId !== planId || proposal.status !== "pending") return { ok: false, error: "not_found" };
    const evidence = cleanConstraintEvidence(input.evidence, proposal, now);
    if (!evidence) return { ok: false, error: "invalid" };
    constraint.resolvedAt = now.toISOString();
    constraint.resolvedByMemberId = identity.memberId;
    constraint.evidence = evidence;
    return { ok: true, constraint: structuredClone(constraint) };
  },

  async createProposal(planId, token, input) {
    const reason = cleanText(input.reason, 300);
    if (!isPlanId(planId) || !validKey(input.idempotencyKey) || !reason || !Number.isInteger(input.expectedRouteRevision) || input.expectedRouteRevision < 1 || !validStops(input.stops) || !Array.isArray(input.resolvedConstraintIds) || input.resolvedConstraintIds.length > 0) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const planLookup = await planStateResult(planId);
    if (!planLookup.ok) return { ok: false, error: "error" };
    if (!planLookup.plan) return { ok: false, error: "not_found" };
    if (planLookup.plan.plan.anchorVenueId) return { ok: false, error: "forbidden" };
    const idem = idempotencyKey(planId, identity.memberId, "proposal:create", input.idempotencyKey);
    const replay = memory.idempotency.get(idem) as { ok: true; proposal: PlanRouteProposal } | undefined;
    if (replay) return structuredClone(replay);
    const activeConstraints = [...memory.constraints.values()].filter((constraint) => constraint.planId === planId);
    const resolved: string[] = [];
    const proposal: PlanRouteProposal = {
      id: randomUUID(), planId, proposedByMemberId: identity.memberId,
      expectedRouteRevision: input.expectedRouteRevision,
      stops: input.stops.map((stop) => ({ ...stop })), reason,
      resolvedConstraintIds: resolved,
      unresolvedConstraintIds: activeConstraints.filter((constraint) => constraint.priority === "required" && !resolved.includes(constraint.id)).map((constraint) => constraint.id),
      status: "pending", createdAt: (input.now ?? new Date()).toISOString(), decidedAt: null,
    };
    memory.proposals.set(proposal.id, proposal);
    const result = { ok: true as const, proposal: cloneProposal(proposal) };
    memory.idempotency.set(idem, result);
    return structuredClone(result);
  },

  async vote(planId, token, proposalId, value, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !["approve", "reject", "abstain"].includes(value)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const idem = idempotencyKey(planId, identity.memberId, "vote", key);
    const replay = memory.idempotency.get(idem) as { ok: true; vote: PlanVote } | undefined;
    if (replay) return structuredClone(replay);
    const proposal = memory.proposals.get(proposalId);
    if (!proposal || proposal.planId !== planId) return { ok: false, error: "not_found" };
    if (proposal.status !== "pending") return { ok: false, error: "conflict" };
    const existing = [...memory.votes.values()].find((vote) => vote.proposalId === proposalId && vote.memberId === identity.memberId);
    const vote: PlanVote = existing ?? { id: randomUUID(), planId, proposalId, memberId: identity.memberId, value, createdAt: now.toISOString() };
    vote.value = value;
    memory.votes.set(vote.id, vote);
    const result = { ok: true as const, vote: { ...vote } };
    memory.idempotency.set(idem, result);
    return structuredClone(result);
  },

  async recordVibeVote(planId, token, vibe, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !isVibeChipId(vibe)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const idem = idempotencyKey(planId, identity.memberId, "vibe-vote", key);
    const replay = memory.idempotency.get(idem) as { ok: true; vote: PlanVibeVote } | undefined;
    if (replay) return structuredClone(replay);
    const mapKey = vibeKey(planId, identity.memberId);
    const existing = memory.vibeVotes.get(mapKey);
    // Upsert: one row per member, revote replaces the vibe, createdAt is the
    // first cast (mirrors the proposal vote's createdAt semantics).
    const vote: PlanVibeVote = { planId, memberId: identity.memberId, vibe, createdAt: existing?.createdAt ?? now.toISOString() };
    memory.vibeVotes.set(mapKey, vote);
    const result = { ok: true as const, vote: { ...vote } };
    memory.idempotency.set(idem, result);
    return structuredClone(result);
  },

  async vibeTally(planId) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const votes = [...memory.vibeVotes.values()].filter((vote) => vote.planId === planId);
    return { ok: true, tally: votes.length === 0 ? EMPTY_VIBE_TALLY : tallyVibeVotes(votes) };
  },

  async decideProposal(planId, token, proposalId, decision, key, apply, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !["accepted", "rejected"].includes(decision)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token, "host");
    if (!identity) return { ok: false, error: "forbidden" };
    if (decision === "accepted") {
      const planLookup = await planStateResult(planId);
      if (!planLookup.ok) return { ok: false, error: "error" };
      if (!planLookup.plan) return { ok: false, error: "not_found" };
      if (planLookup.plan.plan.anchorVenueId) return { ok: false, error: "forbidden" };
    }
    const idem = idempotencyKey(planId, identity.memberId, "proposal:decision", key);
    const replay = memory.idempotency.get(idem) as { ok: true; proposal: PlanRouteProposal } | undefined;
    if (replay) return structuredClone(replay);
    const proposal = memory.proposals.get(proposalId);
    if (!proposal || proposal.planId !== planId) return { ok: false, error: "not_found" };
    if (proposal.status !== "pending") return { ok: false, error: "conflict" };
    const currentRequired = [...memory.constraints.values()].filter((constraint) => constraint.planId === planId && constraint.priority === "required");
    proposal.unresolvedConstraintIds = currentRequired.filter((constraint) => !evidenceCoversProposal(constraint, proposal)).map((constraint) => constraint.id);
    if (decision === "accepted" && proposal.unresolvedConstraintIds.length > 0) return { ok: false, error: "constraints_unresolved" };
    if (decision === "accepted" && !(await apply(cloneProposal(proposal)))) return { ok: false, error: "conflict" };
    proposal.status = decision;
    proposal.decidedAt = now.toISOString();
    const result = { ok: true as const, proposal: cloneProposal(proposal) };
    memory.idempotency.set(idem, result);
    return structuredClone(result);
  },

  async list(planId, token) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    return {
      ok: true,
      memberId: identity.memberId,
      invites: identity.role === "host" ? [...memory.invites.values()].filter((value) => value.planId === planId && !value.revokedAt && !value.redeemedAt).map(publicInvite) : [],
      constraints: [...memory.constraints.values()].filter((value) => value.planId === planId).map((value) => ({ ...value })),
      proposals: [...memory.proposals.values()].filter((value) => value.planId === planId).map((value) => {
        const proposal = cloneProposal(value);
        proposal.unresolvedConstraintIds = [...memory.constraints.values()].filter((constraint) => constraint.planId === planId && constraint.priority === "required" && !evidenceCoversProposal(constraint, proposal)).map((constraint) => constraint.id);
        return proposal;
      }),
      votes: [...memory.votes.values()].filter((value) => value.planId === planId).map((value) => ({ ...value })),
    };
  },
};

const INVITES = "plan_invites";
const CONSTRAINTS = "plan_constraints";
const PROPOSALS = "plan_route_proposals";
const VOTES = "plan_votes";
const VIBE_VOTES = "plan_vibe_votes";

const supabaseStore: PlanCollaborationStore = {
  async createInvite(planId, token, input) {
    if (!isPlanId(planId) || !validKey(input.idempotencyKey) || !Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 5 || input.expiresInMinutes > 10_080) return { ok: false, error: "invalid" };
    const identity = await member(planId, token, "host");
    if (!identity || typeof token !== "string") return { ok: false, error: "forbidden" };
    const admin = requireSupabaseAdmin();
    const key = input.idempotencyKey.trim();
    const rawToken = createHash("sha256").update(`${process.env.PLAN_INVITE_TOKEN_SALT ?? process.env.ACTOR_HASH_SALT ?? "pubmax-plan-invite"}:${planId}:${identity.memberId}:${token}:${key}`).digest("hex");
    const now = input.now ?? new Date();
    const expires = await resolveInviteExpiresAt(planId, input.expiresInMinutes, now);
    if (!expires.ok) return expires;
    const { data, error } = await admin.rpc("create_plan_invite_atomic", {
      p_plan_id: planId,
      p_invite_id: randomUUID(),
      p_created_by_member_id: identity.memberId,
      p_token_hash: inviteHash(rawToken),
      p_idempotency_key: key,
      p_created_at: now.toISOString(),
      p_expires_at: expires.expiresAt,
    });
    if (error) return { ok: false, error: "error" };
    const result = atomicRow(data);
    if (result?.code === "not_found") return { ok: false, error: "not_found" };
    return result?.row
      ? { ok: true, invite: inviteFromRow(result.row), token: rawToken }
      : { ok: false, error: "error" };
  },

  async revokeInvite(planId, token, inviteId, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key)) return { ok: false, error: "invalid" };
    if (!(await member(planId, token, "host"))) return { ok: false, error: "forbidden" };
    const admin = requireSupabaseAdmin();
    const { data, error } = await admin.rpc("revoke_plan_invite_atomic", {
      p_plan_id: planId,
      p_invite_id: inviteId,
      p_revoked_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    const result = atomicRow(data);
    if (result?.code === "not_found") return { ok: false, error: "not_found" };
    return result?.row
      ? { ok: true, invite: inviteFromRow(result.row) }
      : { ok: false, error: "conflict" };
  },

  async consumeInvite(planId, rawToken, now = new Date()) {
    if (!isPlanId(planId) || typeof rawToken !== "string" || !rawToken.trim()) return { ok: false, error: "invalid" };
    const boundary = await legacyPlanBoundary(planId);
    if (boundary) return boundary;
    const admin = requireSupabaseAdmin();
    const { data, error } = await admin.rpc("consume_plan_invite_atomic", {
      p_plan_id: planId,
      p_token_hash: inviteHash(rawToken.trim()),
      p_redeemed_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    const result = atomicRow(data);
    if (result?.code === "not_found") return { ok: false, error: "not_found" };
    if (["revoked", "expired", "replayed"].includes(result?.code ?? "")) {
      return { ok: false, error: result!.code as "revoked" | "expired" | "replayed" };
    }
    return result?.code === "consumed" && result.row
      ? { ok: true, inviteId: String(result.row.id), role: "guest" }
      : { ok: false, error: "error" };
  },

  async redeemInviteAndJoin(planId, rawToken, name, now = new Date(), options = {}) {
    if (!isPlanId(planId) || typeof rawToken !== "string" || !rawToken.trim() || !name) return { ok: false, error: "invalid" };
    const ended = await rejectIfPlanEnded(planId, now);
    if (ended) return ended;
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const inviteTokenHash = inviteHash(rawToken.trim());
    const anonymousRequestHash = planRequestDigest({ name, inviteHash: inviteTokenHash });
    const userId = typeof options.userId === "string" ? options.userId.trim() : "";
    const memberToken = planIdempotencyDigest(`plan-invite-join-token:${planId}`, key);
    const admin = requireSupabaseAdmin();
    const redeemArgs = {
      p_plan_id: planId,
      p_invite_token_hash: inviteTokenHash,
      p_member_id: planIdempotentUuid(`plan-invite-join-member:${planId}`, key),
      p_member_name: name,
      p_member_token_hash: hashPlanMemberToken(memberToken),
      p_joined_at: now.toISOString(),
      p_idempotency_key_hash: planIdempotencyDigest(`plan-invite-join-key:${planId}`, key),
      p_request_hash: planRequestDigest({ name, inviteHash: inviteTokenHash, ...(userId ? { userId } : {}) }),
    };
    let { data, error } = await admin.rpc(userId
      ? "redeem_plan_invite_account_idempotent_atomic"
      : "redeem_plan_invite_idempotent_atomic", {
      ...redeemArgs,
      ...(userId ? { p_user_id: userId } : {}),
    });
    if (userId && error && isMissingDatabaseFunction(error)) {
      // The current Plan schema may be present while the invite-redemption
      // FUNCTION is unavailable (0106 precedent). Redeeming without the
      // account stamp keeps development parity; the seat binds later through
      // the claim lane. Only a missing FUNCTION may take this path.
      if (await planAccountHasActiveSeat(planId, userId)) {
        return { ok: false, error: "account_conflict" };
      }
      console.warn("[plans] account invite redeem RPC missing; redeeming without account stamp");
      ({ data, error } = await admin.rpc("redeem_plan_invite_idempotent_atomic", {
        ...redeemArgs,
        p_request_hash: anonymousRequestHash,
      }));
    }
    if (error) return { ok: false, error: "error" };
    if (data !== "joined" && data !== "replayed") return { ok: false, error: data === "full" ? "full" : data === "expired" ? "expired" : data === "revoked" ? "revoked" : data === "capability_replayed" ? "replayed" : data === "conflict" ? "conflict" : data === "account_conflict" ? "account_conflict" : data === "not_found" ? "not_found" : "error" };
    const plan = await planStore().get(planId);
    return { ok: true, plan, memberToken, role: "guest", collaborationAuthorized: true };
  },

  async upgradeMemberInvite(planId, rawMemberToken, rawInviteToken, now = new Date()) {
    if (!isPlanId(planId) || typeof rawMemberToken !== "string" || typeof rawInviteToken !== "string") return { ok: false, error: "invalid" };
    const ended = await rejectIfPlanEnded(planId, now);
    if (ended) return ended;
    const admin = requireSupabaseAdmin();
    const tokenHash = inviteHash(rawInviteToken.trim());
    const { data, error } = await admin.rpc("upgrade_plan_member_invite_atomic", {
      p_plan_id: planId,
      p_invite_token_hash: tokenHash,
      p_member_token_hash: hashPlanMemberToken(rawMemberToken.trim()),
      p_redeemed_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    if (data !== "upgraded" && data !== "already_authorized") {
      return { ok: false, error: data === "expired" ? "expired" : data === "revoked" ? "revoked" : data === "replayed" ? "replayed" : data === "forbidden" ? "forbidden" : "not_found" };
    }
    // Read-only lookup, no schema/RPC change: the atomic function only
    // returns a status string, so the invite's own row id (safe to emit —
    // see CUSTOM_PROP_VALIDATORS.inviteId in lib/analyticsEvents.ts) is
    // fetched separately purely for the invite_redeemed metrics event.
    const found = await admin.from(INVITES).select("id").eq("plan_id", planId).eq("token_hash", tokenHash).maybeSingle();
    const inviteId = found.data ? String((found.data as Record<string, unknown>).id) : null;
    return { ok: true, collaborationAuthorized: true, inviteId };
  },

  async addConstraint(planId, token, input) {
    const kinds: PlanConstraintKind[] = ["accessibility", "budget", "zero_proof", "timing", "transport", "other"];
    const value = cleanText(input.value, 180);
    if (!isPlanId(planId) || !validKey(input.idempotencyKey) || !kinds.includes(input.kind) || !value || !["required", "preference"].includes(input.priority)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const admin = requireSupabaseAdmin();
    const key = input.idempotencyKey.trim();
    const { data, error } = await admin.rpc("add_plan_constraint_atomic", {
      p_plan_id: planId,
      p_constraint_id: randomUUID(),
      p_member_id: identity.memberId,
      p_kind: input.kind,
      p_value: value,
      p_priority: input.priority,
      p_idempotency_key: key,
      p_created_at: (input.now ?? new Date()).toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    const result = atomicRow(data);
    if (result?.code === "not_found") return { ok: false, error: "not_found" };
    return result?.row
      ? { ok: true, constraint: constraintFromRow(result.row) }
      : { ok: false, error: "error" };
  },

  async resolveConstraint(planId, token, constraintId, input) {
    if (!isPlanId(planId) || !validKey(input.idempotencyKey)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token, "host");
    if (!identity) return { ok: false, error: "forbidden" };
    const now = input.now ?? new Date();
    const admin = requireSupabaseAdmin();
    const existing = await admin.from(CONSTRAINTS).select("*").eq("id", constraintId).eq("plan_id", planId).maybeSingle();
    if (existing.error) return { ok: false, error: "error" };
    if (!existing.data) return { ok: false, error: "not_found" };
    const proposalRow = await admin.from(PROPOSALS).select("*").eq("id", input.evidence.proposalId).eq("plan_id", planId).eq("status", "pending").maybeSingle();
    if (proposalRow.error) return { ok: false, error: "error" };
    if (!proposalRow.data) return { ok: false, error: "not_found" };
    const evidence = cleanConstraintEvidence(input.evidence, proposalFromRow(proposalRow.data as Record<string, unknown>), now);
    if (!evidence) return { ok: false, error: "invalid" };
    const { data, error } = await admin.rpc("resolve_plan_constraint_atomic", {
      p_plan_id: planId,
      p_constraint_id: constraintId,
      p_resolved_by_member_id: identity.memberId,
      p_resolution_evidence: evidence,
      p_resolution_idempotency_key: input.idempotencyKey.trim(),
      p_resolved_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    const result = atomicRow(data);
    if (result?.code === "not_found") return { ok: false, error: "not_found" };
    return result?.row
      ? { ok: true, constraint: constraintFromRow(result.row) }
      : { ok: false, error: "error" };
  },

  async createProposal(planId, token, input) {
    const reason = cleanText(input.reason, 300);
    if (!isPlanId(planId) || !validKey(input.idempotencyKey) || !reason || !Number.isInteger(input.expectedRouteRevision) || input.expectedRouteRevision < 1 || !validStops(input.stops) || input.resolvedConstraintIds.length > 0) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const planLookup = await planStateResult(planId);
    if (!planLookup.ok) return { ok: false, error: "error" };
    if (!planLookup.plan) return { ok: false, error: "not_found" };
    if (planLookup.plan.plan.anchorVenueId) return { ok: false, error: "forbidden" };
    const admin = requireSupabaseAdmin();
    const key = input.idempotencyKey.trim();
    const constraints = await admin.from(CONSTRAINTS).select("id,priority,resolved_at").eq("plan_id", planId);
    if (constraints.error) return { ok: false, error: "error" };
    const rows = (constraints.data ?? []) as Array<{ id: string; priority: string; resolved_at: string | null }>;
    const resolved: string[] = [];
    const unresolved = rows.filter((item) => item.priority === "required" && !resolved.includes(String(item.id))).map((item) => String(item.id));
    const { data, error } = await admin.rpc("create_plan_route_proposal_atomic", {
      p_plan_id: planId,
      p_proposal_id: randomUUID(),
      p_proposed_by_member_id: identity.memberId,
      p_expected_route_revision: input.expectedRouteRevision,
      p_stops: input.stops,
      p_reason: reason,
      p_resolved_constraint_ids: resolved,
      p_unresolved_constraint_ids: unresolved,
      p_idempotency_key: key,
      p_created_at: (input.now ?? new Date()).toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    const result = atomicRow(data);
    if (result?.code === "not_found") return { ok: false, error: "not_found" };
    return result?.row
      ? { ok: true, proposal: proposalFromRow(result.row) }
      : { ok: false, error: "error" };
  },

  async vote(planId, token, proposalId, value, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !["approve", "reject", "abstain"].includes(value)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const admin = requireSupabaseAdmin();
    const { data: voteRow, error } = await admin.rpc("record_plan_vote_atomic", {
      p_plan_id: planId, p_proposal_id: proposalId, p_member_id: identity.memberId,
      p_value: value, p_idempotency_key: key.trim(), p_vote_id: randomUUID(), p_created_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    if (!voteRow || typeof voteRow !== "object") return { ok: false, error: "conflict" };
    if ((voteRow as Record<string, unknown>).code === "not_found") return { ok: false, error: "not_found" };
    return { ok: true, vote: voteFromRow(voteRow as Record<string, unknown>) };
  },

  async recordVibeVote(planId, token, vibe, key, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !isVibeChipId(vibe)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const admin = requireSupabaseAdmin();
    const { data: voteRow, error } = await admin.rpc("record_plan_vibe_vote_atomic", {
      p_plan_id: planId, p_member_id: identity.memberId, p_vibe: vibe,
      p_idempotency_key: key.trim(), p_vote_id: randomUUID(), p_created_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "error" };
    if (!voteRow || typeof voteRow !== "object") return { ok: false, error: "conflict" };
    if ((voteRow as Record<string, unknown>).code === "not_found") return { ok: false, error: "not_found" };
    return { ok: true, vote: vibeVoteFromRow(voteRow as Record<string, unknown>) };
  },

  async vibeTally(planId) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const boundary = await legacyPlanBoundary(planId);
    if (boundary) return boundary;
    const admin = requireSupabaseAdmin();
    const { data, error } = await admin.from(VIBE_VOTES).select("plan_id,member_id,vibe,created_at").eq("plan_id", planId);
    if (error) return { ok: false, error: "error" };
    const votes = (data ?? []).map((row) => vibeVoteFromRow(row as Record<string, unknown>));
    return { ok: true, tally: votes.length === 0 ? EMPTY_VIBE_TALLY : tallyVibeVotes(votes) };
  },

  async decideProposal(planId, token, proposalId, decision, key, apply, now = new Date()) {
    if (!isPlanId(planId) || !validKey(key) || !["accepted", "rejected"].includes(decision)) return { ok: false, error: "invalid" };
    if (!(await member(planId, token, "host"))) return { ok: false, error: "forbidden" };
    if (decision === "accepted") {
      const planLookup = await planStateResult(planId);
      if (!planLookup.ok) return { ok: false, error: "error" };
      if (!planLookup.plan) return { ok: false, error: "not_found" };
      if (planLookup.plan.plan.anchorVenueId) return { ok: false, error: "forbidden" };
    }
    const admin = requireSupabaseAdmin();
    const { data, error } = await admin.rpc("decide_plan_route_proposal_atomic", {
      p_plan_id: planId,
      p_proposal_id: proposalId,
      p_token_hash: memberTokenHash(String(token)),
      p_decision: decision,
      p_idempotency_key: key.trim(),
      p_decided_at: now.toISOString(),
    });
    void apply;
    if (error) return { ok: false, error: "error" };
    if (data === "forbidden") return { ok: false, error: "forbidden" };
    if (data === "not_found") return { ok: false, error: "not_found" };
    if (data === "constraints_unresolved") return { ok: false, error: "constraints_unresolved" };
    if (data !== "decided" && data !== "already_decided") return { ok: false, error: "conflict" };
    const updated = await admin.from(PROPOSALS).select("*").eq("id", proposalId).eq("plan_id", planId).maybeSingle();
    return !updated.error && updated.data ? { ok: true, proposal: proposalFromRow(updated.data as Record<string, unknown>) } : { ok: false, error: "error" };
  },

  async list(planId, token) {
    if (!isPlanId(planId)) return { ok: false, error: "invalid" };
    const identity = await member(planId, token);
    if (!identity) return { ok: false, error: "forbidden" };
    const admin = requireSupabaseAdmin();
    const [invites, constraints, proposals, votes] = await Promise.all([
      identity.role === "host" ? admin.from(INVITES).select("id,plan_id,role,created_at,expires_at,revoked_at,redeemed_at").eq("plan_id", planId).is("revoked_at", null).is("redeemed_at", null).order("created_at") : Promise.resolve({ data: [], error: null }),
      admin.from(CONSTRAINTS).select("*").eq("plan_id", planId).order("created_at"),
      admin.from(PROPOSALS).select("*").eq("plan_id", planId).order("created_at"),
      admin.from(VOTES).select("*").eq("plan_id", planId).order("created_at"),
    ]);
    if (invites.error || constraints.error || proposals.error || votes.error) return { ok: false, error: "error" };
    const publicConstraints = (constraints.data ?? []).map((row) => constraintFromRow(row as Record<string, unknown>));
    const publicProposals = (proposals.data ?? []).map((row) => {
      const proposal = proposalFromRow(row as Record<string, unknown>);
      proposal.unresolvedConstraintIds = publicConstraints.filter((constraint) => constraint.priority === "required" && !evidenceCoversProposal(constraint, proposal)).map((constraint) => constraint.id);
      return proposal;
    });
    return { ok: true, memberId: identity.memberId, invites: (invites.data ?? []).map((row) => inviteFromRow(row as Record<string, unknown>)), constraints: publicConstraints, proposals: publicProposals, votes: (votes.data ?? []).map((row) => voteFromRow(row as Record<string, unknown>)) };
  },
};

function safeStore(store: PlanCollaborationStore): PlanCollaborationStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, target, args);
        } catch (error) {
          if (error instanceof LegacyPlanNotFoundError) {
            return { ok: false, error: "not_found" };
          }
          console.error("[plan-collaboration] store failed:", error instanceof Error ? error.message : error);
          return { ok: false, error: "error" };
        }
      };
    },
  }) as PlanCollaborationStore;
}

const safeMemoryStore = safeStore(memoryStore);
const safeSupabaseStore = safeStore(supabaseStore);

export function planCollaborationStore(): PlanCollaborationStore {
  return selectStore(safeMemoryStore, safeSupabaseStore);
}

export function __resetPlanCollaboration(): void {
  memory.invites.clear();
  memory.constraints.clear();
  memory.proposals.clear();
  memory.votes.clear();
  memory.vibeVotes.clear();
  memory.idempotency.clear();
}
