// Client-safe presentation logic for the W1 Tonight surface: the whats-on PIN
// BADGE join (venueId → glyph summary) and the Tonight LANE card derivation.
// Pure and Node/React-free so both the map/lane components and vitest can
// exercise it directly.
//
// Spine reconciliation (recorded cycle decision): the venueId-joined What's-On
// spine (/api/whats-on — quiz/sport/deal/music) is PRIMARY here. The CityMCP
// things-to-do layer stays a secondary city-events lane and is NOT consumed by
// this module. Badges join on the row's own `venueId` — never haversine.
//
// Owner decision 4 (2026-07-12 grill): quiz = timed hero; sport = untimed
// "Screens live sport" attribute badge; deal + music are timed. Hero-kind
// priority for a venue with several rows: quiz > sport > deal > music.

import { walkLabel, walkMinutes } from "@/lib/tonight";
import {
  WHATS_ON_KINDS,
  whatsOnBarePriceGbp,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export type WhatsOnKindMeta = {
  kind: WhatsOnKind;
  /** Short chip label ("Quiz"). */
  label: string;
  /** Fuller badge/summary phrase ("Quiz night"). */
  badgeLabel: string;
  /** Whether a start time is meaningful to surface for this kind. */
  timed: boolean;
  /** Hero-selection priority — LOWER wins when a venue has several kinds. */
  priority: number;
};

export const WHATS_ON_KIND_META: Record<WhatsOnKind, WhatsOnKindMeta> = {
  quiz: { kind: "quiz", label: "Quiz", badgeLabel: "Quiz night", timed: true, priority: 0 },
  sport: {
    kind: "sport",
    label: "Sport",
    badgeLabel: "Screens live sport",
    timed: false,
    priority: 1,
  },
  deal: { kind: "deal", label: "Deal", badgeLabel: "Deal on", timed: true, priority: 2 },
  music: { kind: "music", label: "Live music", badgeLabel: "Live music", timed: true, priority: 3 },
  event: { kind: "event", label: "Event", badgeLabel: "On tonight", timed: true, priority: 4 },
};

/** Ordered kinds by hero priority — used for stable, priority-sorted output. */
const KINDS_BY_PRIORITY: WhatsOnKind[] = [...WHATS_ON_KINDS].sort(
  (a, b) => WHATS_ON_KIND_META[a].priority - WHATS_ON_KIND_META[b].priority,
);

export type VenueWhatsOnSummary = {
  venueId: string;
  /** Highest-priority kind present at this venue tonight. */
  heroKind: WhatsOnKind;
  /** Distinct kinds present, hero-priority sorted. */
  kinds: WhatsOnKind[];
  /** Whether the HERO kind carries a meaningful start time. */
  timed: boolean;
  /** Total rows folded into this summary. */
  count: number;
};

/**
 * Join whats-on rows to venues by their OWN `venueId` (never haversine). Rows
 * lacking a resolved venueId are dropped from the badge join — an unplaced row
 * can still ride the lane, but it cannot badge a pin it can't be pinned to.
 * Returns one summary per venue with a hero kind + the full kind set.
 */
export function summariseWhatsOnByVenue(
  rows: readonly WhatsOnRow[],
): Map<string, VenueWhatsOnSummary> {
  const kindsByVenue = new Map<string, { kinds: Set<WhatsOnKind>; count: number }>();
  for (const row of rows) {
    if (typeof row.venueId !== "string" || row.venueId.length === 0) continue;
    const entry = kindsByVenue.get(row.venueId) ?? { kinds: new Set<WhatsOnKind>(), count: 0 };
    entry.kinds.add(row.kind);
    entry.count += 1;
    kindsByVenue.set(row.venueId, entry);
  }

  const out = new Map<string, VenueWhatsOnSummary>();
  for (const [venueId, { kinds, count }] of kindsByVenue) {
    const ordered = KINDS_BY_PRIORITY.filter((k) => kinds.has(k));
    const heroKind = ordered[0];
    out.set(venueId, {
      venueId,
      heroKind,
      kinds: ordered,
      timed: WHATS_ON_KIND_META[heroKind].timed,
      count,
    });
  }
  return out;
}

// ── Tonight lane cards ──────────────────────────────────────────────────────

export type WhatsOnLaneCard = {
  id: string;
  venueId?: string;
  kind: WhatsOnKind;
  kindLabel: string;
  badgeLabel: string;
  title: string;
  placeName: string;
  /** Exact London clock or source-listed time wording; null when unavailable. */
  timeLabel: string | null;
  priceGbp?: number;
  /** Straight-line "~N min walk" when the viewer shared a location. */
  walkLabel?: string;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  confidence: WhatsOnRow["confidence"];
};

/** London wall-clock time label ("8:00 pm") for an ISO instant, or null. */
export function formatWhatsOnTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(new Date(ms))
      .replace(/\s?([ap])m$/i, (_m, p: string) => ` ${p.toLowerCase()}m`);
  } catch {
    return null;
  }
}

/** Time label to show on a card: exact clock first, then source-listed wording. */
export function laneTimeLabel(row: WhatsOnRow): string | null {
  if (!WHATS_ON_KIND_META[row.kind].timed) return null;
  return formatWhatsOnTime(row.startsAt) ?? row.timeEvidence ?? null;
}

/** Rows for the active kind, or all when no kind is selected. */
export function filterLaneRows(
  rows: readonly WhatsOnRow[],
  kind: WhatsOnKind | null,
): WhatsOnRow[] {
  if (!kind) return [...rows];
  return rows.filter((row) => row.kind === kind);
}

export type WhatsOnKindFacet = { kind: WhatsOnKind; label: string; count: number };

/**
 * Filter-chip facets for the kinds actually present, hero-priority ordered so
 * the chip row reflects the real rows rather than a fixed taxonomy.
 */
export function laneKindFacets(rows: readonly WhatsOnRow[]): WhatsOnKindFacet[] {
  const counts = new Map<WhatsOnKind, number>();
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  return KINDS_BY_PRIORITY.filter((k) => counts.has(k)).map((kind) => ({
    kind,
    label: WHATS_ON_KIND_META[kind].label,
    count: counts.get(kind) ?? 0,
  }));
}

/**
 * Derive lane cards from whats-on rows, preserving the incoming order (the
 * store already sorts by nearness when `near` is supplied) and capping at
 * `limit` (default 5, per the PRD's "3–5 nearby cards").
 *
 * When `near` is provided, each card with venue coords gets a haversine
 * "~N min walk" label — same estimate as `/tonight`, never an N-row journey
 * fan-out.
 */
export function laneCardsFromRows(
  rows: readonly WhatsOnRow[],
  opts: { limit?: number; near?: { lat: number; lng: number } | null } = {},
): WhatsOnLaneCard[] {
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 5;
  const near = opts.near ?? null;
  const cards: WhatsOnLaneCard[] = [];
  for (const row of rows) {
    const meta = WHATS_ON_KIND_META[row.kind];
    const card: WhatsOnLaneCard = {
      id: row.id,
      kind: row.kind,
      kindLabel: meta.label,
      badgeLabel: meta.badgeLabel,
      title: row.title,
      placeName: row.placeName,
      timeLabel: laneTimeLabel(row),
      sourceLabel: row.source.label,
      sourceUrl: row.source.url,
      observedAt: row.observedAt,
      confidence: row.confidence,
    };
    if (typeof row.venueId === "string" && row.venueId.length > 0) card.venueId = row.venueId;
    const barePrice = whatsOnBarePriceGbp(row);
    if (barePrice !== null) card.priceGbp = barePrice;
    const walk = walkLabel(
      walkMinutes(near, {
        lat: typeof row.lat === "number" ? row.lat : Number.NaN,
        lng: typeof row.lng === "number" ? row.lng : Number.NaN,
      }),
    );
    if (walk) card.walkLabel = walk;
    cards.push(card);
    if (cards.length >= limit) break;
  }
  return cards;
}

/**
 * Honest "Checked 12 Jul" freshness line from an ISO observedAt / asOf.
 * London wall-clock date parts — the same zone formatWhatsOnTime renders in —
 * so a 23:xx UTC check during BST reads as the London calendar day it actually
 * happened on, not the UTC day before midnight.
 */
// Minutes before start when a listing reads "soon" rather than a wall clock.
export const LISTING_URGENCY_SOON_MINUTES = 60;

export type ListingUrgencyTier = "live" | "soon" | "later";

export type ListingUrgency = {
  tier: ListingUrgencyTier;
  label: string;
};

/**
 * Honest start-time urgency for a what's-on row. Untimed kinds (sport) and
 * rows without a parseable start, or listings that already ended, return null.
 */
export function listingUrgency(row: WhatsOnRow, now: Date = new Date()): ListingUrgency | null {
  if (!WHATS_ON_KIND_META[row.kind].timed) return null;
  if (!row.startsAt) return null;
  const startMs = Date.parse(row.startsAt);
  if (!Number.isFinite(startMs)) return null;
  const nowMs = now.getTime();
  const endMs = row.endsAt ? Date.parse(row.endsAt) : Number.NaN;
  if (Number.isFinite(endMs) && nowMs >= endMs) return null;

  if (nowMs >= startMs) {
    return { tier: "live", label: "Happening now" };
  }

  const minutesUntil = Math.ceil((startMs - nowMs) / 60_000);
  if (minutesUntil <= LISTING_URGENCY_SOON_MINUTES) {
    return {
      tier: "soon",
      label: minutesUntil <= 1 ? "Starts in 1 min" : `Starts in ${minutesUntil} min`,
    };
  }

  const clock = formatWhatsOnTime(row.startsAt);
  if (!clock) return null;
  return { tier: "later", label: clock };
}

export function checkedLabel(iso?: string | null): string {
  if (!iso) return "No date on this yet";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "No date on this yet";
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "numeric",
      month: "short",
    }).format(new Date(ms));
    return `Checked ${formatted.replace(/,/g, "")}`;
  } catch {
    return "No date on this yet";
  }
}
