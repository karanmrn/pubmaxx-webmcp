// "We're out" check-in — the Social Loop's lightweight, area-level post type.
// Pure domain: types, the 12h expiry rule, and input validation. No React, no
// fetch, no Supabase — every export is a pure function so the whole model is
// covered by __tests__/checkIn.test.ts (mirrors lib/feed.ts / lib/pintDropShared.ts).
//
// Privacy shape, by construction:
//   • Location is AREA-LEVEL ONLY — a night-area slug (lib/nightAreas.ts). There
//     is no lat/lng field anywhere in this model; coordinates cannot be stored.
//   • The area is OPTIONAL. A check-in with no area is a plain presence signal
//     ("out tonight") rather than a broken area name — see normalizeCheckIn in
//     lib/feed.ts and the CheckInCard it feeds.
//   • `venueId` is present ONLY when the author explicitly tagged a venue.
//   • `visibility` defaults to 'friends' (friends-only). 'area' is reserved for a
//     future public opt-in (owner decision pending) — the field is extensible so
//     that switch is a value change, not a schema change.

import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import { cleanText } from "@/lib/textClean";

// friends-only today; 'area' reserved for the pending public opt-in. Kept as a
// readonly tuple so the type, the validator, and the SQL CHECK agree on one set.
export const CHECK_IN_VISIBILITIES = ["friends", "area"] as const;
export type CheckInVisibility = (typeof CHECK_IN_VISIBILITIES)[number];

export const DEFAULT_CHECK_IN_VISIBILITY: CheckInVisibility = "friends";

// A check-in drops out of the feed 12h after it was posted — a night, not a
// permanent record. The store stamps expires_at = createdAt + this; reads filter
// on it; there is no separate "delete" a user must remember.
export const CHECK_IN_TTL_MS = 12 * 60 * 60 * 1000;

const MAX_NOTE = 140;
const MAX_VENUE_ID = 200;

// The validated, normalised input a store persists. `handle` is normalised, the
// area is a known slug, the note is cleaned + capped (or absent), the venue is a
// trimmed id (or absent), and visibility is one of the allowlist values.
export type NormalizedCheckInInput = {
  handle: string;
  areaSlug: NightAreaSlug | null;
  venueId: string | null;
  note: string | null;
  visibility: CheckInVisibility;
};

// A persisted check-in as read back from the store / returned over the wire.
export type CheckIn = {
  id: string;
  handle: string;
  areaSlug: NightAreaSlug | null;
  venueId: string | null;
  note: string | null;
  visibility: CheckInVisibility;
  createdAt: string;
  expiresAt: string;
  /** Approved owned avatar serve path for linked handles only. */
  avatarUrl?: string;
};

// The raw untrusted body a route hands us (post JSON). Everything optional /
// unknown — validateCheckInInput is the trust boundary.
export type CheckInInputRaw = {
  handle?: unknown;
  areaSlug?: unknown;
  venueId?: unknown;
  note?: unknown;
  visibility?: unknown;
};

export type CheckInValidation =
  | { ok: true; value: NormalizedCheckInInput }
  | { ok: false; error: string };

const AREA_SET: ReadonlySet<string> = new Set(NIGHT_AREA_SLUGS);

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Validate + normalise an untrusted check-in body. Fails closed with a flat
 * error string; on success returns the exact shape a store persists. Pure — no
 * clock, no IO. The area is OPTIONAL: a blank area normalises to `null` (a
 * plain "out tonight" signal), but a NAMED area MUST be a known night-area
 * slug (area-level location, never coordinates) — an unknown area is rejected
 * rather than coerced.
 */
export function validateCheckInInput(raw: CheckInInputRaw): CheckInValidation {
  const handle = normalizeHandle(readString(raw.handle));
  if (!handle) {
    return { ok: false, error: "Choose a handle in your account first." };
  }

  const areaRaw = readString(raw.areaSlug).trim();
  let areaSlug: NightAreaSlug | null = null;
  if (areaRaw) {
    if (!AREA_SET.has(areaRaw)) {
      return { ok: false, error: "That area isn't one we cover." };
    }
    areaSlug = areaRaw as NightAreaSlug;
  }

  // Optional explicit venue tag. Trimmed + capped; blank/oversized -> no tag
  // (never an error — the venue is genuinely optional).
  const venueRaw = readString(raw.venueId).trim();
  const venueId = venueRaw && venueRaw.length <= MAX_VENUE_ID ? venueRaw : null;

  // Optional note, cleaned (strips HTML angle brackets/control chars) + capped.
  const noteCleaned = cleanText(readString(raw.note), MAX_NOTE);
  const note = noteCleaned === "" ? null : noteCleaned;

  // Visibility: default friends-only; only an allowlist value is honoured.
  const visRaw = readString(raw.visibility).trim();
  const visibility: CheckInVisibility =
    (CHECK_IN_VISIBILITIES as readonly string[]).includes(visRaw)
      ? (visRaw as CheckInVisibility)
      : DEFAULT_CHECK_IN_VISIBILITY;

  return {
    ok: true,
    value: { handle, areaSlug: areaSlug as NightAreaSlug, venueId, note, visibility },
  };
}

/** The ISO expiry stamp for a check-in created at `createdAtIso` (createdAt + TTL). */
export function expiresAtIso(createdAtIso: string, ttlMs = CHECK_IN_TTL_MS): string {
  const created = Date.parse(createdAtIso);
  const base = Number.isFinite(created) ? created : Date.now();
  return new Date(base + ttlMs).toISOString();
}

/** True when a check-in has passed its expiry (should drop out of the feed). */
export function isExpired(checkIn: Pick<CheckIn, "expiresAt">, now = Date.now()): boolean {
  const expires = Date.parse(checkIn.expiresAt);
  // A malformed/absent expiry is treated as expired — fail closed, never surface
  // a check-in we can't prove is still live.
  if (!Number.isFinite(expires)) return true;
  return expires <= now;
}

/** Keep only non-expired check-ins, newest-first. Pure. */
export function activeCheckIns(checkIns: CheckIn[], now = Date.now()): CheckIn[] {
  return checkIns
    .filter((c) => !isExpired(c, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
