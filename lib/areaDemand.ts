// Area-demand domain helpers — validation, normalisation, source allowlist, and
// the "nearest supported night patch" resolver behind the honest unsupported-
// area preview (Wayfinder 3.2). Browser-safe: no Supabase / node-only imports,
// so a "use client" preview component shares the EXACT validation the route
// enforces (no fake success on the client that the server would then reject).
//
// The taste doctrine (docs/UNIVERSAL_DAY0_PRD.md) governs this surface: value
// first, never a form-wall, and areas people actually SAY. So the "area" here is
// free text as the user typed/picked it (e.g. "Peckham"), optionally matched to
// a supported patch. Email is OPTIONAL — demand is captured WITHOUT it; an
// address is stored only if the user offers one for a heads-up.

import { haversineKm } from "@/lib/haversine";
import { parseEmail } from "@/lib/emailAddress";
import {
  CENTRAL_PATCH,
  NIGHT_PATCHES,
  type NightPatch,
  type NightPatchId,
} from "@/lib/nightPatches";

/** Where a demand capture happened. Constrained to a known allowlist so a
 *  spoofed body can't invent an arbitrary source (mirrors the DB check in
 *  migration 0045). */
export const AREA_DEMAND_SOURCES = ["near-empty", "area-picker", "map-miss"] as const;
export type AreaDemandSource = (typeof AREA_DEMAND_SOURCES)[number];

/** Free-text area, capped. A night out is named in a word or two ("Broadway
 *  Market", "Peckham Rye") — anything longer is not an area name. */
export const MAX_AREA_LENGTH = 80;

/**
 * Trim + collapse internal whitespace + cap length. Returns the cleaned area, or
 * null when it is empty / whitespace-only after cleaning. Callers never
 * re-normalise, so client and server store the identical canonical form.
 */
export function normaliseArea(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_AREA_LENGTH);
}

/** True when `value` is a known capture source. */
export function isAreaDemandSource(value: unknown): value is AreaDemandSource {
  return (
    typeof value === "string" &&
    (AREA_DEMAND_SOURCES as readonly string[]).includes(value)
  );
}

/** Coerce an optional body `source` to a valid source, defaulting to the generic
 *  map-miss surface. An unknown value is NOT trusted — it collapses to the
 *  default rather than being stored raw. */
export function coerceAreaDemandSource(value: unknown): AreaDemandSource {
  return isAreaDemandSource(value) ? value : "map-miss";
}

/**
 * Match free text to a supported night patch id, case-insensitively, against
 * each patch label and id (plus "central"). Returns the matched id or null when
 * the text names no supported patch — the honest "we don't cover this" signal.
 * Deliberately exact-ish (equality after normalisation), NOT fuzzy: a wrong
 * guess would fabricate coverage the area does not have.
 */
export function matchNightPatch(value: unknown): NightPatchId | "central" | null {
  if (typeof value !== "string") return null;
  const key = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!key) return null;
  if (key === CENTRAL_PATCH.id || key === CENTRAL_PATCH.label.toLowerCase()) return "central";
  const hit = NIGHT_PATCHES.find(
    (patch) => patch.id === key || patch.label.toLowerCase() === key,
  );
  return hit ? hit.id : null;
}

export type NearestPatch = {
  patch: NightPatch;
  distanceKm: number;
};

/**
 * The supported night patch closest to a coordinate, with the great-circle
 * distance — the REAL "nearest area we cover well" fact the preview leads with.
 * Ranges over the eight user-facing NIGHT_PATCHES only (the priced footprint),
 * never CENTRAL_PATCH. Returns null only if the patch list were empty.
 */
export function nearestSupportedPatch(lat: number, lng: number): NearestPatch | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: NearestPatch | null = null;
  for (const patch of NIGHT_PATCHES) {
    const distanceKm = haversineKm([lng, lat], [patch.lng, patch.lat]);
    if (!best || distanceKm < best.distanceKm) best = { patch, distanceKm };
  }
  return best;
}

/** One decimal km, or "under 1 km" when very close — honest, no false precision. */
export function formatApproxKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return "under 1 km";
  return `about ${km.toFixed(1)} km`;
}

/** The canonical, validated demand record shape the store persists. */
export type NormalisedAreaDemand = {
  area: string;
  matchedPatchId: NightPatchId | "central" | null;
  source: AreaDemandSource;
  /** Present only when the user offered an address for a heads-up. */
  email: string | null;
};

export type ParseAreaDemandResult =
  | { ok: true; value: NormalisedAreaDemand }
  | { ok: false; error: string; code: "INVALID_AREA" | "INVALID_EMAIL" };

/**
 * Validate + normalise a raw request body into a demand record. Area is
 * REQUIRED (that is the whole point of the capture). Email is OPTIONAL: absent /
 * empty is fine (demand without contact), but a NON-empty address that fails
 * validation is a 400 — never silently dropped, never fake success.
 */
export function parseAreaDemandInput(body: Record<string, unknown>): ParseAreaDemandResult {
  const area = normaliseArea(body.area);
  if (!area) {
    return { ok: false, error: "Tell us which area you want.", code: "INVALID_AREA" };
  }

  let email: string | null = null;
  const rawEmail = body.email;
  const emailOffered = typeof rawEmail === "string" && rawEmail.trim().length > 0;
  if (emailOffered) {
    const parsed = parseEmail(rawEmail);
    if (!parsed) {
      return { ok: false, error: "Enter a valid email address.", code: "INVALID_EMAIL" };
    }
    email = parsed;
  }

  // Trust the client's matched patch only if it re-derives from the area text or
  // is a known id — never store an arbitrary body-supplied match.
  const suppliedMatch = matchNightPatch(body.matchedPatchId) ?? matchNightPatch(area);

  return {
    ok: true,
    value: {
      area,
      matchedPatchId: suppliedMatch,
      source: coerceAreaDemandSource(body.source),
      email,
    },
  };
}

/**
 * Build the POST body the preview component sends. Email is OMITTED entirely
 * when blank so the wire payload for a no-contact capture carries no `email`
 * key at all (not an empty string). Shared with the UI so the request the
 * browser sends is exactly what the route validates.
 */
export function buildAreaDemandRequest(input: {
  area: string;
  // A patch id (or "central"), loosely typed — the server re-derives and
  // validates via matchNightPatch, so an arbitrary hint is never trusted.
  matchedPatchId?: string | null;
  source: AreaDemandSource;
  email?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    area: input.area,
    source: input.source,
  };
  if (input.matchedPatchId) body.matchedPatchId = input.matchedPatchId;
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (email) body.email = email;
  return body;
}
