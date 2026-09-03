// Browser-safe public-invite constants + DTO shapes. NO server imports here
// (no @/lib/supabase, no node:crypto) so the "use client" invite form and
// page can share one source of truth with the server store and routes,
// mirroring the split between lib/reactions.ts and lib/reactionsStore.ts.

export const RSVP_STATUSES = ["going", "maybe"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

const RSVP_STATUS_SET = new Set<string>(RSVP_STATUSES);
export function isRsvpStatus(value: unknown): value is RsvpStatus {
  return typeof value === "string" && RSVP_STATUS_SET.has(value);
}

export const GUEST_DISPLAY_NAME_MAX = 60;

/**
 * F10: two separate ceilings. GUEST_LIST_DISPLAY_CAP trims the visible guest
 * list (summarize() slices to the newest N; `counts` still tallies every
 * row, so the honest "+N more" line is `counts.going + counts.maybe -
 * guests.length`). RSVP_PLAN_CEILING is the hard write-side limit: a brand
 * new guest is refused once a plan already holds this many RSVP rows, but an
 * existing guest can still change Going/Maybe at the ceiling.
 */
export const GUEST_LIST_DISPLAY_CAP = 40;
export const RSVP_PLAN_CEILING = 200;

/** One guest's public RSVP row, as shown on the invite card guest list. */
export type PlanInviteGuest = { id: string; displayName: string; status: RsvpStatus };

/** The full RSVP tally: true counts plus the visible guest list (capped, newest first). */
export type PlanInviteRsvpSummary = {
  counts: { going: number; maybe: number };
  guests: PlanInviteGuest[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Guards the public RSVP response before client state consumes it. */
export function isPlanInviteRsvpSummary(value: unknown): value is PlanInviteRsvpSummary {
  if (!isRecord(value) || !isRecord(value.counts) || !Array.isArray(value.guests)) return false;
  if (!isNonNegativeInteger(value.counts.going) || !isNonNegativeInteger(value.counts.maybe)) {
    return false;
  }
  if (value.counts.going + value.counts.maybe > RSVP_PLAN_CEILING) return false;
  if (value.guests.length > GUEST_LIST_DISPLAY_CAP) return false;

  const guestIds = new Set<string>();
  const visibleCounts: Record<RsvpStatus, number> = { going: 0, maybe: 0 };
  for (const guest of value.guests) {
    const guestId = isRecord(guest) && typeof guest.id === "string" ? guest.id.trim() : "";
    if (
      !isRecord(guest) ||
      guestId.length === 0 ||
      guestIds.has(guestId) ||
      typeof guest.displayName !== "string" ||
      guest.displayName.trim().length === 0 ||
      guest.displayName.length > GUEST_DISPLAY_NAME_MAX ||
      !isRsvpStatus(guest.status)
    ) {
      return false;
    }
    guestIds.add(guestId);
    visibleCounts[guest.status] += 1;
  }

  return value.counts.going >= visibleCounts.going && value.counts.maybe >= visibleCounts.maybe;
}

// A guest's RSVP is remembered on their own device, per Plan, so returning to
// the invite still reads as "you answered this one". It is a memory, never a
// permission: the map link below it is unconditional, because the stops are
// what the link was opened for and a guest who answered on another device, or
// cleared their browser, has lost nothing but the emphasis.
export const INVITE_RSVP_DEVICE_PREFIX = "pubmax:inviteRsvp:v1:";

export type InviteRsvpDeviceStorage = Pick<Storage, "getItem" | "setItem">;

export function inviteRsvpDeviceKey(planId: string): string {
  return `${INVITE_RSVP_DEVICE_PREFIX}${planId.trim()}`;
}

/** True only when this device recorded a confirmed RSVP for this Plan. */
export function readDeviceRsvpCommitted(
  planId: string,
  storage: InviteRsvpDeviceStorage | null,
): boolean {
  if (!planId.trim() || !storage) return false;
  try {
    return storage.getItem(inviteRsvpDeviceKey(planId)) === "1";
  } catch {
    return false;
  }
}

/** Record a confirmed RSVP. Written only after the server accepted it. */
export function markDeviceRsvpCommitted(
  planId: string,
  storage: InviteRsvpDeviceStorage | null,
): void {
  if (!planId.trim() || !storage) return;
  try {
    storage.setItem(inviteRsvpDeviceKey(planId), "1");
  } catch {
    // Storage full or denied. The RSVP still landed; only the emphasis on a
    // later visit is lost, and the map link never depended on it.
  }
}
