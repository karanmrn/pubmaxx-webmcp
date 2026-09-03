import "server-only";

import { createHash } from "node:crypto";

import { hashPlanMemberToken } from "@/lib/planStore";
import type { OutOpenPlan } from "@/lib/out";
import { OPEN_PLAN_LIST_LIMIT } from "@/lib/openSocialCrew";
import {
  isSocialCrewMutationCode,
  isSocialCrewRole,
  isSocialCrewVisibility,
  parseSocialCrewPublicPreviewSource,
  type SocialCrewMutationResult,
  type SocialCrewMutationCode,
  type SocialCrewJoinRequestQueueDTO,
  parseSocialCrewJoinRequestQueue,
  type SocialCrewListPageDTO,
  type SocialCrewReadDTO,
  type SocialCrewPublicPreviewSource,
  type SocialCrewRole,
  type SocialCrewVisibility,
} from "@/lib/socialCrew";
import {
  projectSocialCrewListPage,
  projectSocialCrewRead,
  type RawSocialCrewListPage,
  type SocialCrewListCursorPosition,
} from "@/lib/socialCrewProjection.server";
import {
  SocialCrewCursorInvalidError,
  decodeSocialCrewMemberCursor,
  encodeSocialCrewMemberCursor,
  readSocialCrewCursorEnvelope,
} from "@/lib/socialCrewCursor.server";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SocialCrewRpcName =
  | "create_social_crew_atomic"
  | "invite_social_crew_member_atomic"
  | "accept_social_crew_invitation_atomic"
  | "revoke_social_crew_invitation_atomic"
  | "request_social_crew_join_atomic"
  | "decide_social_crew_join_request_atomic"
  | "set_social_crew_role_atomic"
  | "transfer_social_crew_owner_atomic"
  | "remove_social_crew_member_atomic"
  | "leave_social_crew_atomic"
  | "update_social_crew_visibility_atomic";

export type SocialCrewSnapshotRpcName =
  | "read_social_crew_snapshot"
  | "read_social_crew_member_page"
  | "read_social_crew_join_requests"
  | "list_open_social_crews"
  | "read_social_crew_public_preview";

export type SocialCrewStoreDependencies = {
  rpc(name: SocialCrewRpcName, input: Record<string, unknown>): Promise<unknown>;
  snapshot(
    name: SocialCrewSnapshotRpcName,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  signingKey(): Buffer;
};

export class SocialCrewStoreError extends Error {
  constructor(
    public readonly code: "INVALID" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE",
    public readonly status: 400 | 404 | 409 | 422 | 503,
    message: string,
  ) {
    super(message);
  }
}

type WriteInput = { idempotencyKey: string };
type CreateInput = WriteInput & {
  planId: string;
  hostCapability: string;
  visibility: SocialCrewVisibility;
};
type InviteInput = WriteInput & { crewId: string; targetProfileId: string };
type InvitationActionInput = WriteInput & {
  crewId: string;
  invitationId: string;
  action: "accept" | "decline";
};
type InvitationInput = WriteInput & { crewId: string; invitationId: string };
type JoinRequestInput = WriteInput & {
  crewId: string;
  action: "request" | "cancel";
};
type JoinDecisionInput = WriteInput & {
  crewId: string;
  requestId: string;
  decision: "accept" | "decline";
};
type MemberRoleInput = WriteInput & {
  crewId: string;
  memberId: string;
  role: Exclude<SocialCrewRole, "owner">;
};
type MemberInput = WriteInput & { crewId: string; memberId: string };
type CrewInput = WriteInput & { crewId: string };
type VisibilityInput = WriteInput & {
  crewId: string;
  visibility: SocialCrewVisibility;
  expectedAuthorityRevision: number;
};
export type SocialCrewListInput = {
  cursor?: string | null;
  limit?: number;
};

export type SocialCrewStore = {
  read(crewId: string, actor: SocialPostActor): Promise<SocialCrewReadDTO>;
  readPublicPreview(crewId: string): Promise<SocialCrewPublicPreviewSource>;
  list(
    actor: SocialPostActor,
    input: SocialCrewListInput,
  ): Promise<SocialCrewListPageDTO>;
  listOpen(input: {
    from: string;
    until: string;
    city: string;
    limit?: number;
  }): Promise<OutOpenPlan[]>;
  listJoinRequests(
    crewId: string,
    actor: SocialPostActor,
  ): Promise<SocialCrewJoinRequestQueueDTO>;
  create(actor: SocialPostActor, input: CreateInput): Promise<SocialCrewMutationResult>;
  invite(actor: SocialPostActor, input: InviteInput): Promise<SocialCrewMutationResult>;
  acceptInvitation(actor: SocialPostActor, input: InvitationActionInput): Promise<SocialCrewMutationResult>;
  revokeInvitation(actor: SocialPostActor, input: InvitationInput): Promise<SocialCrewMutationResult>;
  requestJoin(actor: SocialPostActor, input: JoinRequestInput): Promise<SocialCrewMutationResult>;
  decideJoin(actor: SocialPostActor, input: JoinDecisionInput): Promise<SocialCrewMutationResult>;
  setRole(actor: SocialPostActor, input: MemberRoleInput): Promise<SocialCrewMutationResult>;
  transferOwner(actor: SocialPostActor, input: MemberInput): Promise<SocialCrewMutationResult>;
  removeMember(actor: SocialPostActor, input: MemberInput): Promise<SocialCrewMutationResult>;
  leave(actor: SocialPostActor, input: CrewInput): Promise<SocialCrewMutationResult>;
  updateVisibility(actor: SocialPostActor, input: VisibilityInput): Promise<SocialCrewMutationResult>;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function invalid(): never {
  throw new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid.");
}

function notFound(): never {
  throw new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found.");
}

function unavailable(): never {
  throw new SocialCrewStoreError("UNAVAILABLE", 503, "Social Crew is unavailable right now.");
}

function validActor(actor: SocialPostActor): boolean {
  return isUuid(actor.accountId) && isUuid(actor.profileId) && typeof actor.handle === "string" && actor.handle.length > 0;
}

function idempotencyKey(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const clean = value.trim();
  if (clean.length < 16 || clean.length > 128) return invalid();
  return clean;
}

function payloadDigest(operation: string, value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify({ operation, ...value }))
    .digest("hex");
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}

function requiredUuid(value: unknown): string {
  return isUuid(value) ? value : unavailable();
}

function requiredRevision(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 1
    ? Number(value)
    : unavailable();
}

type FixedWriteContract = {
  codes: readonly SocialCrewMutationCode[];
  result(
    base: SocialCrewMutationResult,
    value: Record<string, unknown>,
  ): SocialCrewMutationResult;
};

const FIXED_WRITE_CONTRACTS: Partial<Record<SocialCrewRpcName, FixedWriteContract>> = {
  create_social_crew_atomic: {
    codes: ["created", "replayed"],
    result: (base, value) => ({
      ...base,
      crewId: requiredUuid(value.crew_id),
      memberId: requiredUuid(value.member_id),
    }),
  },
  invite_social_crew_member_atomic: {
    codes: ["invited", "replayed"],
    result: (base, value) => ({ ...base, invitationId: requiredUuid(value.invitation_id) }),
  },
  revoke_social_crew_invitation_atomic: {
    codes: ["revoked", "replayed"],
    result: (base, value) => ({ ...base, invitationId: requiredUuid(value.invitation_id) }),
  },
  set_social_crew_role_atomic: {
    codes: ["updated", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  transfer_social_crew_owner_atomic: {
    codes: ["transferred", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  remove_social_crew_member_atomic: {
    codes: ["removed", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  leave_social_crew_atomic: {
    codes: ["left", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  update_social_crew_visibility_atomic: {
    codes: ["updated", "replayed"],
    result: (base, value) => ({
      ...base,
      authorityRevision: requiredRevision(value.authority_revision),
    }),
  },
};

function parseSuccessfulWrite(
  name: SocialCrewRpcName,
  input: Record<string, unknown>,
  value: Record<string, unknown>,
  code: string,
): SocialCrewMutationResult {
  if (!isSocialCrewMutationCode(code)) return unavailable();
  const result: SocialCrewMutationResult = { code, replayed: code === "replayed" };
  const fixedContract = FIXED_WRITE_CONTRACTS[name];
  if (fixedContract) {
    if (!fixedContract.codes.includes(code)) return unavailable();
    return fixedContract.result(result, value);
  }
  switch (name) {
    case "accept_social_crew_invitation_atomic": {
      const expected = input.p_action === "accepted" ? "accepted" : "declined";
      if (code !== expected && code !== "replayed") return unavailable();
      return expected === "accepted"
        ? { ...result, memberId: requiredUuid(value.member_id) }
        : result;
    }
    case "request_social_crew_join_atomic": {
      const expected = input.p_action === "pending" ? "requested" : "cancelled";
      if (code !== expected && code !== "replayed") return unavailable();
      return { ...result, requestId: requiredUuid(value.request_id) };
    }
    case "decide_social_crew_join_request_atomic": {
      const expected = input.p_decision === "accepted" ? "accepted" : "declined";
      if (code !== expected && code !== "replayed") return unavailable();
      return expected === "accepted"
        ? { ...result, memberId: requiredUuid(value.member_id) }
        : result;
    }
    default:
      return unavailable();
  }
}

function parseWriteResponse(
  name: SocialCrewRpcName,
  input: Record<string, unknown>,
  value: unknown,
): SocialCrewMutationResult {
  const wrapped = row(value);
  if ("error" in wrapped || "data" in wrapped) {
    if (wrapped.error) return unavailable();
    return parseWriteResponse(name, input, wrapped.data);
  }
  const code = typeof wrapped.code === "string" ? wrapped.code : "";
  if (wrapped.ok !== true) {
    if (code === "not_found") return notFound();
    if (code === "invalid") return invalid();
    if (
      code === "conflict" ||
      code === "idempotency_conflict" ||
      code === "already_member" ||
      code === "already_pending" ||
      code === "already_decided" ||
      code === "expired" ||
      code === "full" ||
      code === "owner_cannot_leave"
    ) {
      throw new SocialCrewStoreError("CONFLICT", 409, "Social Crew changed before this request.");
    }
    return unavailable();
  }
  return parseSuccessfulWrite(name, input, wrapped, code);
}

function writeArguments(
  actor: SocialPostActor,
  operation: string,
  key: unknown,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!validActor(actor)) return invalid();
  const cleanKey = idempotencyKey(key);
  return {
    p_actor_account_id: actor.accountId,
    ...payload,
    p_idempotency_key: cleanKey,
    p_payload_digest: payloadDigest(operation, payload),
  };
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function invalidList(): never {
  throw new SocialCrewStoreError(
    "INVALID",
    422,
    "Social Crew page is not valid.",
  );
}

function parseListInput(input: SocialCrewListInput): {
  limit: number;
  cursor: unknown;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalidList();
  }
  const keys = Object.keys(input);
  if (
    keys.some((key) => key !== "cursor" && key !== "limit") ||
    keys.length > 2
  ) {
    return invalidList();
  }
  const limit = input.limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return invalidList();
  }
  if (
    input.cursor !== undefined &&
    input.cursor !== null &&
    typeof input.cursor !== "string"
  ) {
    return invalidList();
  }
  return { limit, cursor: input.cursor };
}

function unwrapOpenPlanRows(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) {
    const data = (value as { data: unknown }).data;
    return Array.isArray(data) ? data : null;
  }
  return null;
}

function parseOpenPlanRow(value: unknown): OutOpenPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isUuid(row.crewId)) return null;
  if (typeof row.title !== "string" || !row.title.trim()) return null;
  if (typeof row.startTime !== "string" || !row.startTime.trim()) return null;
  if (typeof row.hostHandle !== "string" || !row.hostHandle.trim()) return null;
  if (!Number.isInteger(row.memberCount) || Number(row.memberCount) < 0) return null;
  if (row.stopVenueId !== null && typeof row.stopVenueId !== "string") return null;
  if (row.stopVenueName !== null && typeof row.stopVenueName !== "string") return null;
  return {
    crewId: row.crewId,
    title: row.title,
    startTime: row.startTime,
    stopVenueId: row.stopVenueId,
    stopVenueName: row.stopVenueName,
    hostHandle: row.hostHandle,
    memberCount: Number(row.memberCount),
    // The city and the map point are DERIVED from Stop 1 by the reader
    // (lib/openSocialCrew.server). Plans store no city, so the RPC lists every
    // upcoming open crew and answers no question about where it is.
    meetingPoint: null,
  };
}

const defaultDependencies: SocialCrewStoreDependencies = {
  async rpc(name, input) {
    const { data, error } = await requireSupabaseAdmin().rpc(name, input);
    if (error) throw new Error(error.message);
    return data;
  },
  async snapshot(name, input) {
    const { data, error } = await requireSupabaseAdmin().rpc(name, input);
    if (error) throw new Error(error.message);
    return data;
  },
  signingKey: trustedSigningKey,
};

export function createSocialCrewStore(
  dependencies: SocialCrewStoreDependencies = defaultDependencies,
): SocialCrewStore {
  async function write(
    name: SocialCrewRpcName,
    actor: SocialPostActor,
    operation: string,
    key: unknown,
    payload: Record<string, unknown>,
  ): Promise<SocialCrewMutationResult> {
    const input = writeArguments(actor, operation, key, payload);
    try {
      return parseWriteResponse(name, input, await dependencies.rpc(name, input));
    } catch (error) {
      if (error instanceof SocialCrewStoreError) throw error;
      return unavailable();
    }
  }

  return {
    async read(crewId, actor) {
      if (!isUuid(crewId) || !validActor(actor)) return notFound();
      let snapshot: unknown;
      try {
        snapshot = await dependencies.snapshot("read_social_crew_snapshot", {
          p_viewer_account_id: actor.accountId,
          p_viewer_profile_id: actor.profileId,
          p_crew_id: crewId,
        });
      } catch {
        return unavailable();
      }
      if (snapshot === null) return notFound();
      try {
        const projected = projectSocialCrewRead(snapshot, actor);
        return projected ?? notFound();
      } catch {
        return unavailable();
      }
    },

    async readPublicPreview(crewId) {
      if (!isUuid(crewId)) return notFound();
      let snapshot: unknown;
      try {
        snapshot = await dependencies.snapshot("read_social_crew_public_preview", {
          p_crew_id: crewId,
        });
      } catch {
        return unavailable();
      }
      if (snapshot === null) return notFound();
      const parsed = parseSocialCrewPublicPreviewSource(snapshot);
      if (!parsed) return unavailable();
      return parsed;
    },

    async list(actor, input) {
      if (!validActor(actor)) return notFound();
      const parsedInput = parseListInput(input);
      let envelope: ReturnType<typeof readSocialCrewCursorEnvelope> | null =
        null;
      if (parsedInput.cursor !== undefined && parsedInput.cursor !== null) {
        try {
          envelope = readSocialCrewCursorEnvelope(parsedInput.cursor);
        } catch {
          return invalidList();
        }
      }
      let signingKey: Buffer;
      try {
        signingKey = dependencies.signingKey();
      } catch {
        return unavailable();
      }
      let cursor: SocialCrewListCursorPosition | null = null;
      if (envelope) {
        try {
          cursor = decodeSocialCrewMemberCursor(
            envelope,
            actor.profileId,
            signingKey,
          );
        } catch (error) {
          if (error instanceof SocialCrewCursorInvalidError) {
            return invalidList();
          }
          return unavailable();
        }
      }
      let snapshot: unknown;
      try {
        snapshot = await dependencies.snapshot("read_social_crew_member_page", {
          p_viewer_account_id: actor.accountId,
          p_viewer_profile_id: actor.profileId,
          p_cursor_joined_at: cursor?.joinedAt ?? null,
          p_cursor_member_id: cursor?.memberId ?? null,
          p_limit: parsedInput.limit,
        });
      } catch {
        return unavailable();
      }
      if (snapshot === null) return notFound();
      try {
        return projectSocialCrewListPage(
          snapshot as RawSocialCrewListPage,
          actor,
          (position) =>
            encodeSocialCrewMemberCursor(
              position,
              actor.profileId,
              signingKey,
            ),
        );
      } catch {
        return unavailable();
      }
    },

    async listOpen(input) {
      const from = typeof input.from === "string" ? input.from.trim() : "";
      const until = typeof input.until === "string" ? input.until.trim() : "";
      const city = typeof input.city === "string" ? input.city.trim() : "";
      if (!from || !until || !city) return unavailable();
      const limit = input.limit ?? OPEN_PLAN_LIST_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > OPEN_PLAN_LIST_LIMIT) {
        return unavailable();
      }
      let snapshot: unknown;
      try {
        snapshot = await dependencies.snapshot("list_open_social_crews", {
          p_from: from,
          p_until: until,
          p_city: city,
          p_limit: limit,
        });
      } catch {
        return unavailable();
      }
      const rows = unwrapOpenPlanRows(snapshot);
      if (!rows) return unavailable();
      const parsed: OutOpenPlan[] = [];
      for (const row of rows) {
        const plan = parseOpenPlanRow(row);
        if (!plan) return unavailable();
        parsed.push(plan);
      }
      return parsed.slice(0, OPEN_PLAN_LIST_LIMIT);
    },

    async listJoinRequests(crewId, actor) {
      if (!isUuid(crewId) || !validActor(actor)) return notFound();
      let snapshot: unknown;
      try {
        snapshot = await dependencies.snapshot("read_social_crew_join_requests", {
          p_viewer_account_id: actor.accountId,
          p_viewer_profile_id: actor.profileId,
          p_crew_id: crewId,
        });
      } catch {
        return unavailable();
      }
      if (snapshot === null) return notFound();
      const queue = parseSocialCrewJoinRequestQueue(snapshot);
      return queue ?? unavailable();
    },

    create(actor, input) {
      if (
        !isUuid(input.planId) ||
        typeof input.hostCapability !== "string" ||
        !input.hostCapability.trim() ||
        !isSocialCrewVisibility(input.visibility)
      ) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("create_social_crew_atomic", actor, "create", input.idempotencyKey, {
        p_plan_id: input.planId,
        p_host_token_hash: hashPlanMemberToken(input.hostCapability.trim()),
        p_visibility: input.visibility,
      });
    },

    invite(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.targetProfileId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("invite_social_crew_member_atomic", actor, "invite", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_profile_id: input.targetProfileId,
      });
    },

    acceptInvitation(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.invitationId) || (input.action !== "accept" && input.action !== "decline")) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("accept_social_crew_invitation_atomic", actor, "invitation-action", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_invitation_id: input.invitationId,
        p_action: input.action === "accept" ? "accepted" : "declined",
      });
    },

    revokeInvitation(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.invitationId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("revoke_social_crew_invitation_atomic", actor, "invitation-revoke", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_invitation_id: input.invitationId,
      });
    },

    requestJoin(actor, input) {
      if (!isUuid(input.crewId) || (input.action !== "request" && input.action !== "cancel")) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("request_social_crew_join_atomic", actor, "join-request", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_action: input.action === "request" ? "pending" : "cancelled",
      });
    },

    decideJoin(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.requestId) || (input.decision !== "accept" && input.decision !== "decline")) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("decide_social_crew_join_request_atomic", actor, "join-decision", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_request_id: input.requestId,
        p_decision: input.decision === "accept" ? "accepted" : "declined",
      });
    },

    setRole(actor, input) {
      const requestedRole: unknown = input.role;
      if (!isUuid(input.crewId) || !isUuid(input.memberId) || !isSocialCrewRole(requestedRole) || requestedRole === "owner") {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("set_social_crew_role_atomic", actor, "set-role", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_member_id: input.memberId,
        p_role: requestedRole,
      });
    },

    transferOwner(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.memberId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("transfer_social_crew_owner_atomic", actor, "transfer-owner", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_member_id: input.memberId,
      });
    },

    removeMember(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.memberId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("remove_social_crew_member_atomic", actor, "remove-member", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_member_id: input.memberId,
      });
    },

    leave(actor, input) {
      if (!isUuid(input.crewId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("leave_social_crew_atomic", actor, "leave", input.idempotencyKey, {
        p_crew_id: input.crewId,
      });
    },

    updateVisibility(actor, input) {
      if (
        !isUuid(input.crewId) ||
        !isSocialCrewVisibility(input.visibility) ||
        !Number.isInteger(input.expectedAuthorityRevision) ||
        input.expectedAuthorityRevision < 0
      ) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("update_social_crew_visibility_atomic", actor, "visibility", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_visibility: input.visibility,
        p_expected_authority_revision: input.expectedAuthorityRevision,
      });
    },
  };
}
