import type {
  CrawlEnding,
  PlanActionDTO,
  PlanDTO,
  PlannedNightStatus,
  PlanStopDTO,
} from "@/lib/plan";
import type { NightContext } from "@/lib/nightPlanning";
import type { OutOpenPlanMeetingPoint } from "@/lib/out";

export const SOCIAL_CREW_ROLES = ["owner", "cohost", "member"] as const;
export type SocialCrewRole = (typeof SOCIAL_CREW_ROLES)[number];

export const SOCIAL_CREW_VISIBILITIES = ["private", "friends", "open"] as const;
export type SocialCrewVisibility = (typeof SOCIAL_CREW_VISIBILITIES)[number];

export type SocialCrewPhase = "planning" | "live" | "ended";
export const SOCIAL_CREW_MEMBERSHIP_STATES = ["active", "left", "removed"] as const;
export type SocialCrewMembershipState = (typeof SOCIAL_CREW_MEMBERSHIP_STATES)[number];
export type SocialCrewInvitationState =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";
export type SocialCrewJoinRequestState =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type SocialCrewJoinRequestDTO = {
  requestId: string;
  requesterHandle: string;
};

export type SocialCrewJoinRequestQueueDTO = {
  items: SocialCrewJoinRequestDTO[];
  hasMore: boolean;
};

const SOCIAL_CREW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function socialCrewRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function socialCrewExactRecordKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key));
}

export function parseSocialCrewJoinRequestQueue(
  value: unknown,
): SocialCrewJoinRequestQueueDTO | null {
  if (
    !socialCrewRecord(value) ||
    !socialCrewExactRecordKeys(value, ["items", "hasMore"]) ||
    !Array.isArray(value.items) ||
    typeof value.hasMore !== "boolean"
  ) {
    return null;
  }
  const items: SocialCrewJoinRequestDTO[] = [];
  const requestIds = new Set<string>();
  if (value.items.length > 50) return null;
  for (const candidate of value.items) {
    if (
      !socialCrewRecord(candidate) ||
      !socialCrewExactRecordKeys(candidate, [
        "requestId",
        "requesterHandle",
      ]) ||
      typeof candidate.requestId !== "string" ||
      !SOCIAL_CREW_UUID_RE.test(candidate.requestId) ||
      typeof candidate.requesterHandle !== "string" ||
      candidate.requesterHandle.trim().length === 0 ||
      requestIds.has(candidate.requestId)
    ) {
      return null;
    }
    requestIds.add(candidate.requestId);
    items.push({
      requestId: candidate.requestId,
      requesterHandle: candidate.requesterHandle,
    });
  }
  return { items, hasMore: value.hasMore };
}

export type SocialCrewMemberDTO = {
  memberId: string;
  handle: string;
  role: SocialCrewRole;
  joinedAt: string;
};

export type SocialCrewPlanDTO = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  context: NightContext | null;
  actions: PlanActionDTO[];
  ending: CrawlEnding | null;
};

export type SocialCrewPreviewDTO = {
  kind: "preview";
  title: string;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  joinRequestState: "none" | "pending" | "declined";
  hostHandle?: string;
  stopVenueId?: string | null;
  stopVenueName?: string | null;
  memberCount?: number;
};

export type SocialCrewPageDTO = {
  kind: "member";
  crewId: string;
  title: string;
  visibility: SocialCrewVisibility;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  authorityRevision: number;
  viewer: { memberId: string; role: SocialCrewRole };
  owner: { memberId: string; handle: string };
  members: SocialCrewMemberDTO[];
  plan: SocialCrewPlanDTO;
};

export type SocialCrewReadDTO = SocialCrewPreviewDTO | SocialCrewPageDTO;

/**
 * Service-only source row for anonymous Open Crew reads. Stop 1 is resolved
 * against the current venue and POI indexes before this reaches a browser.
 */
export type SocialCrewPublicPreviewSource = {
  crewId: string;
  title: string;
  hostHandle: string;
  startsAt: string;
  stopVenueId: string;
  stopVenueName: string;
};

/**
 * Account-free Open Crew contract. This is intentionally smaller than the
 * authenticated preview and never carries member, request, or plan fields.
 */
export type SocialCrewPublicPreviewDTO = {
  kind: "public";
  crewId: string;
  title: string;
  hostHandle: string;
  startsAt: string;
  meetingPoint: OutOpenPlanMeetingPoint;
};

export type SocialCrewListItemDTO = Pick<
  SocialCrewPageDTO,
  "kind" | "crewId" | "title" | "phase" | "nightArea" | "startsAt" | "viewer"
>;

export type SocialCrewListPageDTO = {
  items: SocialCrewListItemDTO[];
  nextCursor: string | null;
};

export const SOCIAL_CREW_MUTATION_CODES = [
  "created",
  "invited",
  "accepted",
  "declined",
  "revoked",
  "requested",
  "cancelled",
  "updated",
  "transferred",
  "removed",
  "left",
  "replayed",
] as const;
export type SocialCrewMutationCode = (typeof SOCIAL_CREW_MUTATION_CODES)[number];

export type SocialCrewMutationResult = {
  code: SocialCrewMutationCode;
  replayed: boolean;
  crewId?: string;
  memberId?: string;
  invitationId?: string;
  requestId?: string;
  authorityRevision?: number;
};

export function isSocialCrewRole(value: unknown): value is SocialCrewRole {
  return SOCIAL_CREW_ROLES.includes(value as SocialCrewRole);
}

export function isSocialCrewMembershipState(
  value: unknown,
): value is SocialCrewMembershipState {
  return SOCIAL_CREW_MEMBERSHIP_STATES.includes(value as SocialCrewMembershipState);
}

export function isSocialCrewVisibility(
  value: unknown,
): value is SocialCrewVisibility {
  return SOCIAL_CREW_VISIBILITIES.includes(value as SocialCrewVisibility);
}

export function isSocialCrewMutationCode(
  value: unknown,
): value is SocialCrewMutationCode {
  return SOCIAL_CREW_MUTATION_CODES.includes(value as SocialCrewMutationCode);
}

const SOCIAL_CREW_PUBLIC_SOURCE_KEYS = [
  "crewId",
  "title",
  "hostHandle",
  "startsAt",
  "stopVenueId",
  "stopVenueName",
] as const;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function publicIsoTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
  ) {
    return null;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

/** Parse service output before any public preview route can use it. */
export function parseSocialCrewPublicPreviewSource(
  value: unknown,
): SocialCrewPublicPreviewSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!exactKeys(row, SOCIAL_CREW_PUBLIC_SOURCE_KEYS)) return null;
  if (
    typeof row.crewId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.crewId) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    typeof row.hostHandle !== "string" ||
    !row.hostHandle.trim() ||
    typeof row.stopVenueId !== "string" ||
    !row.stopVenueId.trim() ||
    typeof row.stopVenueName !== "string" ||
    !row.stopVenueName.trim()
  ) {
    return null;
  }
  const startsAt = publicIsoTimestamp(row.startsAt);
  if (!startsAt) return null;
  return {
    crewId: row.crewId,
    title: row.title,
    hostHandle: row.hostHandle,
    startsAt,
    stopVenueId: row.stopVenueId,
    stopVenueName: row.stopVenueName,
  };
}

export function socialCrewPhase(status: PlannedNightStatus): SocialCrewPhase {
  switch (status) {
    case "draft":
    case "ready":
      return "planning";
    case "active":
    case "ending":
      return "live";
    case "completed":
    case "abandoned":
      return "ended";
  }
}
