// Pure, client-safe helper logic for the first-class /tonight screen. Kept free
// of Node- and React-only imports so both the client screen and tests can use it.
// The primary page reads the shared What's-On spine; opportunity helpers remain
// for the secondary CityMCP overlay and derive its facets from returned kinds.

import type { TonightLocalityBasis } from "@/lib/analyticsEvents";
import { haversineKm } from "@/lib/haversine";
import { resolveNightPatch, type RememberedArea } from "@/lib/nightPatches";
import { WALK_KMH } from "@/lib/routeLegs";
import { labelForKind, opportunityMapHref } from "@/lib/thingsToDoMap";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";

export type TonightOpportunity = ThingsToDoOpportunity;

// Re-export the shared helpers so the screen imports one module.
export { labelForKind, opportunityMapHref };

export function tonightHeading(basis: TonightLocalityBasis): string {
  return basis === "london-default"
    ? "What’s on across London tonight."
    : "What’s on near you tonight.";
}

const OTHER_KIND = "other";

export type KindFacet = { kind: string; label: string; count: number };

/** Normalise an opportunity's kind to a non-empty slug (fallback "other"). */
export function kindSlug(op: TonightOpportunity): string {
  const raw = typeof op.kind === "string" ? op.kind.trim() : "";
  return raw.length > 0 ? raw : OTHER_KIND;
}

/**
 * Filter-chip facets derived from the kinds actually present, most common
 * first (ties broken alphabetically by label) so the chip row reflects the
 * real data rather than a fixed list we might not be able to fill.
 */
export function deriveKindFacets(ops: TonightOpportunity[]): KindFacet[] {
  const counts = new Map<string, number>();
  for (const op of ops) {
    const slug = kindSlug(op);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const facets: KindFacet[] = [];
  for (const [kind, count] of counts) {
    facets.push({ kind, label: labelForKind(kind) ?? "Other", count });
  }
  facets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return facets;
}

/** Rows matching the active kind, or all rows when no kind is selected. */
export function filterByKind(
  ops: TonightOpportunity[],
  activeKind: string | null,
): TonightOpportunity[] {
  if (!activeKind) return ops;
  return ops.filter((op) => kindSlug(op) === activeKind);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Honest provenance line. A valid `asOf` becomes "Checked 12 Jul" (formatted
 * from UTC parts so it never drifts by the viewer's timezone); anything
 * unparseable says so in pub words rather than a fabricated date. VOICE.md
 * rule 2 keeps the freshness spine's own enum out of the reader's line.
 */
export function provenanceLabel(asOf?: string | null): string {
  if (!asOf) return "No date on this yet";
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return "No date on this yet";
  return `Checked ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Honest coverage summary for the header. Thin nights are labelled as thin
 * rather than dressed up; the zero case is owned by the screen's empty state.
 */
export function coverageLabel(count: number): string {
  if (count <= 0) return "Nothing confirmed tonight yet";
  if (count <= 2) return `Thin tonight, ${count} confirmed`;
  return `${count} things on tonight`;
}

type Coord = { lat: number; lng: number };

function isFiniteCoord(c: Coord | null | undefined): c is Coord {
  return (
    !!c &&
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng)
  );
}

// Average walking pace, derived from the same shared pace routeLegs uses
// everywhere else, so a change to the pace can't drift between surfaces.
const WALK_KM_PER_MIN = WALK_KMH / 60;

/**
 * Straight-line walk estimate in minutes between two points, or null when
 * either coordinate is missing / non-finite. Deliberately a haversine estimate
 * (not a per-row transit call): deterministic, testable, no N-row API fan-out,
 * and honest once labelled "~N min walk". Clamped to a minimum of 1 so a
 * co-located venue never reads "0 min".
 */
export function walkMinutes(
  from: Coord | null | undefined,
  to: Coord | null | undefined,
): number | null {
  if (!isFiniteCoord(from) || !isFiniteCoord(to)) return null;
  const km = haversineKm([from.lng, from.lat], [to.lng, to.lat]);
  return Math.max(1, Math.round(km / WALK_KM_PER_MIN));
}

/** "~12 min walk" label, or null when minutes are unknown. */
export function walkLabel(minutes: number | null): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  return `~${minutes} min walk`;
}

// ── Remembered-patch continuity (#427 nightPatches seam) ────────────────────

/** Where Tonight's rows should order from, and whether to say so. */
export type TonightNear = {
  near: Coord;
  /** Patch label to name in the provenance line; null when the order comes
   *  from the viewer's real position (the header already says "near you"). */
  patchLabel: string | null;
};

/**
 * One ordering answer for the Tonight page: the viewer's real position when
 * they've shared it, else the heart of the area they last chose anywhere in
 * the app (the map's Near me writes it), else nothing. A remembered BOROUGH
 * has no single heart to order from, so it stays null rather than pretending.
 * Pure so the precedence is hermetically testable.
 */
export function resolveTonightNear(
  origin: Coord | null,
  remembered: RememberedArea | null,
): TonightNear | null {
  if (isFiniteCoord(origin)) return { near: origin, patchLabel: null };
  if (remembered?.kind === "patch") {
    const patch = resolveNightPatch(remembered.id);
    if (patch) return { near: { lat: patch.lat, lng: patch.lng }, patchLabel: patch.label };
  }
  return null;
}

/**
 * The locality basis the tonight list was actually ordered from (§4.9
 * tonight_result_opened). A live position reports "live-location"; a resolved
 * patch centre reports "remembered-patch". A remembered BOROUGH has no canonical
 * centroid, so resolveTonightNear returns null and the list orders — and this
 * reports — "london-default". It never claims a basis the ordering did not use.
 */
export function tonightLocalityBasis(
  hasOrigin: boolean,
  tonightNear: TonightNear | null,
): TonightLocalityBasis {
  if (hasOrigin) return "live-location";
  if (tonightNear?.patchLabel) return "remembered-patch";
  return "london-default";
}

// ── Venue ↔ opportunity matching (Wave A · A1 sheet chips) ──────────────────

/** Normalise a venue/place name for tolerant comparison. */
function normaliseName(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|ye olde|ye|olde)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Two venues within this straight-line distance are treated as the same place
// when an opportunity carries coordinates (upstream place ids don't align with
// our venue ids, so proximity is the reliable join).
const VENUE_MATCH_KM = 0.12;

export type VenueRef = {
  id?: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
};

/** True when an opportunity plausibly refers to the given venue. */
export function opportunityMatchesVenue(
  op: TonightOpportunity,
  venue: VenueRef,
): boolean {
  const opName = normaliseName(op.place?.name);
  const venueName = normaliseName(venue.name);
  if (opName && venueName && (opName.includes(venueName) || venueName.includes(opName))) {
    return true;
  }
  const loc = op.place?.location;
  if (
    loc &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lng) &&
    typeof venue.latitude === "number" &&
    typeof venue.longitude === "number" &&
    Number.isFinite(venue.latitude) &&
    Number.isFinite(venue.longitude)
  ) {
    return (
      haversineKm([loc.lng, loc.lat], [venue.longitude, venue.latitude]) <=
      VENUE_MATCH_KM
    );
  }
  return false;
}

/** Opportunities plausibly happening at this venue tonight. */
export function matchOpportunitiesToVenue(
  ops: TonightOpportunity[],
  venue: VenueRef,
): TonightOpportunity[] {
  return ops.filter((op) => opportunityMatchesVenue(op, venue));
}

export type EventChip = { kind: string; label: string };

/**
 * De-duplicated event chips for a venue's matched opportunities — one chip per
 * distinct kind, in first-seen order, so the sheet header stays uncluttered
 * even when a venue has several listings of the same kind tonight.
 */
export function eventChipsForVenue(ops: TonightOpportunity[]): EventChip[] {
  const seen = new Set<string>();
  const chips: EventChip[] = [];
  for (const op of ops) {
    const kind = kindSlug(op);
    if (seen.has(kind)) continue;
    seen.add(kind);
    chips.push({ kind, label: labelForKind(kind) ?? "Other" });
  }
  return chips;
}
