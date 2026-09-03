// What the Crews surface is allowed to say and send. Presentation-free.
//
// A CREW IS A NIGHT. `social_crews` is bound one-to-one to a plan
// (supabase/migrations/…_0075_social_crews.sql: `plan_id uuid not null unique`),
// its title IS the plan's title, and `create_social_crew_atomic` refuses any
// plan that is not hosted by the actor. There is no crew row without a night,
// so a "crew name" is the night's name and nothing else. Naming a crew is
// therefore naming a plan, which is why `startCrewPlanBody` shapes a plan
// create and `CREW_NAME_MAX` caps the plan title rather than a second field.
//
// Private and friends crews remain relationship-bound at the database. Open
// crews have a separate account-free preview and still require verified Social
// authority before somebody can ask to join.
//
// There is no read of invitations addressed to you. An invitation is reachable
// only through the link its host sends (crewId + invitationId), the same way a
// plan invite already travels in lib/planCrewInviteUrl.ts.

import type {
  SocialCrewListItemDTO,
  SocialCrewListPageDTO,
  SocialCrewJoinRequestQueueDTO,
  SocialCrewMemberDTO,
  SocialCrewPageDTO,
  SocialCrewPhase,
  SocialCrewReadDTO,
  SocialCrewPublicPreviewDTO,
  SocialCrewRole,
  SocialCrewVisibility,
} from "@/lib/socialCrew";
import {
  isSocialCrewRole,
  isSocialCrewVisibility,
  parseSocialCrewJoinRequestQueue,
} from "@/lib/socialCrew";
import type { OpenPlanPlaceKind } from "@/lib/openSocialCrew";

/**
 * The cap on the name a drinker types when starting a crew. Narrower than the
 * plan store's own PLAN_TITLE_MAX (80) on purpose: a crew name is read in a row
 * beside a date and a role, and 30 is what fits a 320px phone without wrapping
 * the row into three lines.
 */
export const CREW_NAME_MAX = 30;

/** Ids are UUIDs everywhere in the crew API (isSocialCrewId in socialCrewHttp). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCrewId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Collapse whitespace and cap; empty means the drinker gave no name. */
export function cleanCrewName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, CREW_NAME_MAX);
}

export function isUsableCrewName(value: unknown): boolean {
  return cleanCrewName(value).length > 0;
}

/**
 * Every crew write demands an Idempotency-Key of 16 to 128 characters
 * (socialCrewIdempotencyKey). Mint one per attempt so a retry after a timeout
 * replays rather than duplicating; `crypto.randomUUID` is 36 characters.
 */
export function crewIdempotencyKey(
  prefix: string,
  random: () => string = () => crypto.randomUUID(),
): string {
  const clean = prefix.replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "crew";
  return `${clean}-${random()}`.slice(0, 128);
}

export const CREW_PHASE_LABEL: Record<SocialCrewPhase, string> = {
  planning: "Planning",
  live: "Out now",
  ended: "Done",
};

export const CREW_ROLE_LABEL: Record<SocialCrewRole, string> = {
  owner: "You host",
  cohost: "You co-host",
  member: "You are in",
};

export const CREW_VISIBILITY_LABEL: Record<SocialCrewVisibility, string> = {
  private: "Invite only",
  friends: "Your lot can ask to join",
  open: "Anyone can ask to join",
};

/** Only a host or co-host may invite, set a role, or remove somebody. */
export function canManageCrew(role: SocialCrewRole): boolean {
  return role === "owner" || role === "cohost";
}

/**
 * The owner cannot leave; the database answers `owner_cannot_leave`, which the
 * store turns into a 409. Say so before the tap rather than after it.
 */
export function canLeaveCrew(role: SocialCrewRole): boolean {
  return role !== "owner";
}

export const CREW_OWNER_LEAVE_NOTE =
  "A host cannot leave their own night. Hand the crew to somebody else first.";

/** What a crew is, in one line, on the surface that offers to start one. */
export const CREW_WHAT_IT_IS =
  "A crew is one night out, shared with your lot. Name the night, pick where it starts, and bring people in.";

/** Why a stranger cannot be invited. The database refuses it, so the copy owns it. */
export const CREW_MUTUALS_ONLY_NOTE =
  "You can only bring in mates who follow you back.";

/** The one honest sentence about how somebody joins. */
export const CREW_INVITE_LINK_NOTE =
  "Send this link to your mate. It only works for them.";

export const CREW_EMPTY_COPY =
  "No crews yet. Start one and your lot can join the night.";

export const CREW_LIST_UNAVAILABLE_COPY =
  "Could not load your crews. That is us, not you.";

/**
 * The link a host sends. It carries the invitation id because there is no read
 * that tells an invitee they were invited; `accept_social_crew_invitation_atomic`
 * still refuses anybody who is not the named target, so the link is a pointer,
 * never authority.
 */
export function crewInvitePath(crewId: string, invitationId: string): string {
  return `/social/crews/${encodeURIComponent(crewId)}?invitation=${encodeURIComponent(invitationId)}`;
}

export function crewInviteUrl(
  crewId: string,
  invitationId: string,
  origin?: string,
): string {
  const path = crewInvitePath(crewId, invitationId);
  return origin ? `${origin.replace(/\/$/, "")}${path}` : path;
}

export function crewPath(crewId: string): string {
  return `/social/crews/${encodeURIComponent(crewId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCrewJoinRequestQueue(
  value: unknown,
): SocialCrewJoinRequestQueueDTO | null {
  return parseSocialCrewJoinRequestQueue(value);
}

function isPhase(value: unknown): value is SocialCrewPhase {
  return value === "planning" || value === "live" || value === "ended";
}

function parseListItem(value: unknown): SocialCrewListItemDTO | null {
  if (!isRecord(value) || !isRecord(value.viewer)) return null;
  if (
    value.kind !== "member" ||
    !isCrewId(value.crewId) ||
    typeof value.title !== "string" ||
    !isPhase(value.phase) ||
    (value.nightArea !== null && typeof value.nightArea !== "string") ||
    typeof value.startsAt !== "string" ||
    !isCrewId(value.viewer.memberId) ||
    !isSocialCrewRole(value.viewer.role)
  ) {
    return null;
  }
  return {
    kind: "member",
    crewId: value.crewId,
    title: value.title,
    phase: value.phase,
    nightArea: value.nightArea as string | null,
    startsAt: value.startsAt,
    viewer: { memberId: value.viewer.memberId, role: value.viewer.role },
  };
}

/** A malformed row poisons the page; refuse the whole reply instead. */
export function parseCrewListPage(value: unknown): SocialCrewListPageDTO | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items: SocialCrewListItemDTO[] = [];
  for (const candidate of value.items) {
    const item = parseListItem(candidate);
    if (!item) return null;
    items.push(item);
  }
  const nextCursor = value.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  return { items, nextCursor: nextCursor as string | null };
}

function parseMember(value: unknown): SocialCrewMemberDTO | null {
  if (
    !isRecord(value) ||
    !isCrewId(value.memberId) ||
    typeof value.handle !== "string" ||
    !isSocialCrewRole(value.role) ||
    typeof value.joinedAt !== "string"
  ) {
    return null;
  }
  return {
    memberId: value.memberId,
    handle: value.handle,
    role: value.role,
    joinedAt: value.joinedAt,
  };
}

export function parseCrewRead(value: unknown): SocialCrewReadDTO | null {
  if (!isRecord(value)) return null;
  if (value.kind === "preview") {
    if (
      typeof value.title !== "string" ||
      !isPhase(value.phase) ||
      (value.nightArea !== null && typeof value.nightArea !== "string") ||
      typeof value.startsAt !== "string" ||
      (value.joinRequestState !== "none" &&
        value.joinRequestState !== "pending" &&
        value.joinRequestState !== "declined")
    ) {
      return null;
    }
    return {
      kind: "preview",
      title: value.title,
      phase: value.phase,
      nightArea: value.nightArea as string | null,
      startsAt: value.startsAt,
      joinRequestState: value.joinRequestState,
      ...(typeof value.hostHandle === "string" ? { hostHandle: value.hostHandle } : {}),
      ...(value.stopVenueId === null || typeof value.stopVenueId === "string"
        ? { stopVenueId: value.stopVenueId }
        : {}),
      ...(value.stopVenueName === null || typeof value.stopVenueName === "string"
        ? { stopVenueName: value.stopVenueName }
        : {}),
      ...(Number.isInteger(value.memberCount) ? { memberCount: Number(value.memberCount) } : {}),
    };
  }
  if (value.kind !== "member") return null;
  if (
    !isCrewId(value.crewId) ||
    typeof value.title !== "string" ||
    !isSocialCrewVisibility(value.visibility) ||
    !isPhase(value.phase) ||
    (value.nightArea !== null && typeof value.nightArea !== "string") ||
    typeof value.startsAt !== "string" ||
    !Number.isSafeInteger(value.authorityRevision) ||
    !isRecord(value.viewer) ||
    !isCrewId(value.viewer.memberId) ||
    !isSocialCrewRole(value.viewer.role) ||
    !isRecord(value.owner) ||
    !isCrewId(value.owner.memberId) ||
    typeof value.owner.handle !== "string" ||
    !Array.isArray(value.members)
  ) {
    return null;
  }
  const members: SocialCrewMemberDTO[] = [];
  for (const candidate of value.members) {
    const member = parseMember(candidate);
    if (!member) return null;
    members.push(member);
  }
  return {
    ...(value as unknown as SocialCrewPageDTO),
    kind: "member",
    members,
  };
}

function isPublicMeetingPoint(value: unknown): value is SocialCrewPublicPreviewDTO["meetingPoint"] {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 4 || !["kind", "name", "lat", "lng"].every((key) => keys.includes(key))) {
    return false;
  }
  return (
    (value.kind === "venue" || value.kind === "place") &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.lat === "number" &&
    Number.isFinite(value.lat) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lng) &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}

/** Parse the deliberately narrow anonymous Open Crew contract. */
export function parsePublicCrewPreview(value: unknown): SocialCrewPublicPreviewDTO | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 6 ||
    !["kind", "crewId", "title", "hostHandle", "startsAt", "meetingPoint"].every((key) =>
      keys.includes(key),
    ) ||
    value.kind !== "public" ||
    !isCrewId(value.crewId) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.hostHandle !== "string" ||
    !value.hostHandle.trim() ||
    typeof value.startsAt !== "string" ||
    !Number.isFinite(Date.parse(value.startsAt)) ||
    !isPublicMeetingPoint(value.meetingPoint)
  ) {
    return null;
  }
  return {
    kind: "public",
    crewId: value.crewId,
    title: value.title,
    hostHandle: value.hostHandle,
    startsAt: value.startsAt,
    meetingPoint: {
      kind: value.meetingPoint.kind as OpenPlanPlaceKind,
      name: value.meetingPoint.name,
      lat: value.meetingPoint.lat,
      lng: value.meetingPoint.lng,
    },
  };
}

export type CrewMutationOutcome = {
  code: string;
  replayed: boolean;
  crewId?: string;
  invitationId?: string;
  memberId?: string;
  requestId?: string;
};

export function parseCrewMutation(value: unknown): CrewMutationOutcome | null {
  if (!isRecord(value) || typeof value.code !== "string") return null;
  return {
    code: value.code,
    replayed: value.replayed === true,
    ...(isCrewId(value.crewId) ? { crewId: value.crewId } : {}),
    ...(isCrewId(value.invitationId) ? { invitationId: value.invitationId } : {}),
    ...(isCrewId(value.memberId) ? { memberId: value.memberId } : {}),
    ...(isCrewId(value.requestId) ? { requestId: value.requestId } : {}),
  };
}

export type StartCrewInput = {
  name: string;
  startTime: string;
  hostName: string;
  venue: { id: string; name: string };
};

/**
 * The plan a crew is made of. `/api/plans` needs a start time, the host's own
 * name and at least one listed venue (cleanCreatePlan in lib/plan.ts), so the
 * crew composer collects exactly those three and nothing more.
 */
export function startCrewPlanBody(input: StartCrewInput): Record<string, unknown> | null {
  const title = cleanCrewName(input.name);
  const hostName = typeof input.hostName === "string" ? input.hostName.trim().slice(0, 40) : "";
  const startMs = Date.parse(input.startTime);
  if (!title || !hostName || !Number.isFinite(startMs)) return null;
  if (!input.venue?.id || !input.venue?.name) return null;
  return {
    title,
    startTime: new Date(startMs).toISOString(),
    creatorName: hostName,
    stops: [{ venueId: input.venue.id, venueName: input.venue.name }],
  };
}

/**
 * A crew starts invite-only. Visibility changes stay an explicit host choice.
 */
export const CREW_DEFAULT_VISIBILITY: SocialCrewVisibility = "private";

export function crewStartsCaption(
  startsAt: string,
  now: number = Date.now(),
): string | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return null;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(start));
  return start < now ? `Started ${formatted}` : `Starts ${formatted}`;
}
