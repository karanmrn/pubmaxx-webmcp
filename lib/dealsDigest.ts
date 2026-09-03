// Syndicated-deal digest core (Lane M2). Pure, React-free, no fetch and no clock
// of its own: every function takes its inputs explicitly so the whole surface is
// hermetically unit-testable. This is the fix for the live-taste P0 where one
// chain promotion owned a whole surface: five identical "Pizza Club - every
// Wednesday" Wetherspoon cards in a row, the same deal topping Today.
//
// Three jobs, each a small pure primitive so any surface can compose them:
//   1. GROUP identical listings (same normalised title + source, same kind)
//      across venues into ONE digest entry that carries the REAL distinct-venue
//      count and the nearest (or soonest) venue. The count is row data, counted
//      from the actual rows; it is never invented or padded.
//   2. DIVERSITY CAP: at most one card per source in a section's primary band;
//      further cards from a source already shown are ranked lower (an overflow
//      band appended after the primary one), never silently dropped.
//   3. STABLE ORDERING: within a group, soonest/nearest first; across groups,
//      strongest confidence, then soonest, then nearest, then input order.
//
// Surface-agnostic on purpose: it returns rows plus structured digest data, not
// a Today-specific DTO, so Tonight's lane (lib/whatsOnBadges.ts, owned elsewhere)
// can adopt it unchanged later by mapping SectionPick to its own card shape.
//
// No em dashes or en dashes in any string this module builds (product-copy rule).

import { haversineKm } from "@/lib/haversine";
import type { WhatsOnConfidence, WhatsOnRow } from "@/lib/whatsOn";

/** A viewer's rough location, used to resolve the "nearest" venue in a group. */
export type NearPoint = { lat: number; lng: number };

// A confirmed listing outranks a merely listed one, which outranks a
// cross-referenced inference. Mirrors lib/todayBrief.ts so this module never
// ranks a weaker row above a stronger one.
const CONFIDENCE_RANK: Record<WhatsOnConfidence, number> = {
  confirmed: 2,
  listed: 1,
  derived: 0,
};

// Conservative text identity: Unicode compatibility form, case, and surrounding
// or repeated whitespace are ignored, but punctuation and wording still separate
// genuinely different listings. Same conservatism as rankTonightPicks' titleKey.
function normaliseText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-GB").trim().replace(/\s+/g, " ");
}

/**
 * The grouping key for a row: normalised title + source label, scoped by kind.
 * The spec is "normalised title + source"; kind is folded in as a cheap guard so
 * a same-named quiz and deal from one source can never merge into one group and
 * report a wrong venue count. In practice identical title+source already implies
 * one kind, so this never splits a real syndicated deal.
 */
export function dealDigestKey(row: WhatsOnRow): string {
  const title = normaliseText(typeof row.title === "string" ? row.title : "");
  const source = normaliseText(row.source?.label ?? "");
  // NUL separators: they never occur in scraped or hand-authored strings, so the
  // three joined fields cannot collide across a boundary.
  return `${row.kind}\u0000${title}\u0000${source}`;
}

// A venue's identity for the distinct-count: its resolved venueId when it has
// one, else its normalised place name (so a scraped-by-name row and its later
// venue-matched twin count as one venue, not two).
function venueIdentity(row: WhatsOnRow): string {
  if (typeof row.venueId === "string" && row.venueId.length > 0) return `id:${row.venueId}`;
  return `name:${normaliseText(typeof row.placeName === "string" ? row.placeName : "")}`;
}

function startMs(row: WhatsOnRow): number {
  const ms = Date.parse(row.startsAt ?? "");
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

// Distance from a row's venue to the near point in km, or +Infinity when either
// side lacks a usable coordinate (so coordinate-less rows sort to the tail).
function distanceKm(row: WhatsOnRow, near: NearPoint | null): number {
  if (!near || !Number.isFinite(near.lat) || !Number.isFinite(near.lng)) {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof row.lat !== "number" || typeof row.lng !== "number") return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return Number.POSITIVE_INFINITY;
  return haversineKm([row.lng, row.lat], [near.lng, near.lat]);
}

// A row is usable for grouping when it carries a non-empty title and place name.
// Structurally malformed rows are skipped rather than throwing, so a bad row in
// the feed drops out instead of poisoning the digest.
function isUsableRow(row: WhatsOnRow | null | undefined): row is WhatsOnRow {
  if (!row || typeof row !== "object") return false;
  if (typeof row.title !== "string" || normaliseText(row.title).length === 0) return false;
  if (typeof row.placeName !== "string" || row.placeName.trim().length === 0) return false;
  return true;
}

/** One grouped listing: the real venue count, the venue to render, and the
 *  ranking signals a section uses to order groups against each other. */
export type DealDigest = {
  key: string;
  /** Members, ordered soonest/nearest first (nearest wins when a near point is
   *  supplied; otherwise soonest). */
  members: WhatsOnRow[];
  /** The venue a single card should render for this group (members[0]). */
  display: WhatsOnRow;
  /** Distinct real venues in the group. Counted from the rows, never invented. */
  venueCount: number;
  /** Place name of the display (nearest, or soonest) venue. */
  nearestVenueName: string;
  /** Shared source label (raw, for display and the diversity cap). */
  sourceLabel: string;
  /** Strongest confidence anywhere in the group (a confirmed row anywhere means
   *  the deal is confirmed) - used to rank groups. */
  topConfidence: WhatsOnConfidence;
  /** Soonest start across the group (ms) - used to rank groups. */
  soonestStartMs: number;
  /** First input index of any member - the stable tiebreak for group ranking. */
  firstIndex: number;
};

/**
 * Group identical listings across venues into digest entries. Rows sharing a
 * normalised title + source (and kind) collapse into one entry carrying the real
 * distinct-venue count and, given a near point, the nearest venue as its display
 * row. Malformed rows are skipped. Pure and non-mutating; input order drives the
 * stable tiebreaks. An empty input yields an empty list.
 */
export function groupIdenticalDeals(
  rows: readonly WhatsOnRow[],
  opts: {
    near?: NearPoint | null;
    key?: (row: WhatsOnRow) => string;
  } = {},
): DealDigest[] {
  const near = opts.near ?? null;

  const groups = new Map<string, { row: WhatsOnRow; index: number }[]>();
  rows.forEach((row, index) => {
    if (!isUsableRow(row)) return;
    const key = opts.key?.(row) ?? dealDigestKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push({ row, index });
    else groups.set(key, [{ row, index }]);
  });

  const digests: DealDigest[] = [];
  for (const [key, members] of groups) {
    const ordered = [...members].sort((a, b) => {
      const da = distanceKm(a.row, near);
      const db = distanceKm(b.row, near);
      if (da !== db) return da - db; // finite before Infinity; both Infinity ties
      const sa = startMs(a.row);
      const sb = startMs(b.row);
      if (sa !== sb) return sa - sb;
      return a.index - b.index;
    });
    const memberRows = ordered.map((m) => m.row);
    const display = memberRows[0];
    const venues = new Set(memberRows.map(venueIdentity));
    const topConfidence = memberRows.reduce<WhatsOnConfidence>(
      (best, r) => (CONFIDENCE_RANK[r.confidence] > CONFIDENCE_RANK[best] ? r.confidence : best),
      memberRows[0].confidence,
    );
    const soonestStartMs = memberRows.reduce(
      (min, r) => Math.min(min, startMs(r)),
      Number.POSITIVE_INFINITY,
    );
    const firstIndex = ordered.reduce((min, m) => Math.min(min, m.index), ordered[0].index);
    digests.push({
      key,
      members: memberRows,
      display,
      venueCount: venues.size,
      nearestVenueName: display.placeName,
      sourceLabel: display.source.label,
      topConfidence,
      soonestStartMs,
      firstIndex,
    });
  }
  return digests;
}

/** A section-ready pick: the row to render, plus digest data when this pick
 *  stands in for more than one venue. */
export type SectionPick = {
  row: WhatsOnRow;
  /** Present only for a multi-venue group; a single-venue pick omits it. */
  digest?: { venueCount: number; nearestVenueName: string };
};

// undefined -> default 3; +Infinity -> uncapped; anything not finite or <= 0 ->
// 0 (empty). Mirrors rankTonightPicks' limit handling so behaviour matches.
function normaliseLimit(limit: number | undefined): number {
  if (limit === undefined) return 3;
  if (limit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.floor(limit);
}

/**
 * Rank grouped digests and enforce the per-source diversity cap. Groups are
 * ordered by strongest confidence, then soonest start, then nearest display
 * venue, then input order. The cap then keeps at most one group per source in
 * the primary band; a source already shown is pushed into an overflow band that
 * is appended after the primary one (ranked lower, never dropped). Pure and
 * non-mutating.
 */
export function capBySource(digests: readonly DealDigest[], near: NearPoint | null): DealDigest[] {
  const ranked = [...digests].sort((a, b) => {
    const byConfidence = CONFIDENCE_RANK[b.topConfidence] - CONFIDENCE_RANK[a.topConfidence];
    if (byConfidence !== 0) return byConfidence;
    if (a.soonestStartMs !== b.soonestStartMs) return a.soonestStartMs - b.soonestStartMs;
    const da = distanceKm(a.display, near);
    const db = distanceKm(b.display, near);
    if (da !== db) return da - db;
    return a.firstIndex - b.firstIndex;
  });

  const primary: DealDigest[] = [];
  const overflow: DealDigest[] = [];
  const seenSources = new Set<string>();
  for (const digest of ranked) {
    const source = normaliseText(digest.sourceLabel);
    if (seenSources.has(source)) {
      overflow.push(digest);
    } else {
      seenSources.add(source);
      primary.push(digest);
    }
  }
  return [...primary, ...overflow];
}

/**
 * The whole section pipeline: group identical listings, rank + diversity-cap the
 * groups, cap at `limit`, and reduce each surviving group to a SectionPick. A
 * multi-venue group carries digest data (real count + nearest venue); a
 * single-venue pick carries none. Pure; an empty input yields an empty list.
 */
export function digestSectionPicks(
  rows: readonly WhatsOnRow[],
  opts: { limit?: number; near?: NearPoint | null } = {},
): SectionPick[] {
  const near = opts.near ?? null;
  const limit = normaliseLimit(opts.limit);
  if (limit === 0) return [];

  const capped = capBySource(groupIdenticalDeals(rows, { near }), near);
  const take = limit === Number.POSITIVE_INFINITY ? capped.length : limit;

  return capped.slice(0, take).map((digest) => {
    const pick: SectionPick = { row: digest.display };
    if (digest.venueCount > 1) {
      pick.digest = { venueCount: digest.venueCount, nearestVenueName: digest.nearestVenueName };
    }
    return pick;
  });
}

/**
 * The honest one-line note for a grouped card: "Same deal at 12 pubs". Null for a
 * single venue (nothing to disclose) so a lone listing shows no note. The count
 * is the real distinct-venue total, so the reader always knows a chain promotion
 * is exactly that, not twelve separate recommendations.
 */
export function dealDigestNote(venueCount: number): string | null {
  if (!Number.isFinite(venueCount) || venueCount <= 1) return null;
  return `Same deal at ${venueCount} pubs`;
}
