// What a deals surface may claim, and in what order it may show its rows.
//
// The deal kind already carries everything this module needs: `endsAt` (every
// row in public/data/whats_on/deals_london.json has one, because a deal window
// is exact) and `observedAt` (the listing file's own generatedAt). So nothing
// here derives a figure. It reads what the row says, or it says nothing.
//
// Three jobs, all pure so any surface can compose them:
//
//   1. ORDER. Nearest first, then ending soonest. The proximity input is the
//      viewer's coarse night-area CENTRE, never their own point (see
//      dealProximityAnchor), so ranking by exact metres would be false
//      precision: two pubs 40m apart are the same answer from an anchor that is
//      already a kilometre out. Distance is therefore bucketed into rings and
//      `endsAt` orders within a ring. That is what makes "then endsAt" a real
//      tie-break rather than a line that never runs.
//
//   2. CAPTION. `dealEndsCaption` prints the row's own closing time and nothing
//      else. `dealListingAgeCaption` says how old the listing is once it is old
//      enough to doubt, and hands the reader the only reliable check there is.
//
//   3. SELECT. `liveDeals` drops an ended deal (grace is 0 for this kind, see
//      POINT_ROW_GRACE_MS) and `dealsEndingSoon` is the small set a surface may
//      call urgent.
//
// What this module will never hold: a saved-money counter. There is no
// counterfactual for what a drinker would otherwise have paid, so any figure
// would be invented. Deals earn attention by being near, real and about to
// close, which the row can prove.

import { haversineKm } from "@/lib/haversine";
import type { CityId } from "@/lib/cities";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import { isPastDated, londonServiceDayBounds, type WhatsOnRow } from "@/lib/whatsOn";
import { formatWhatsOnTime } from "@/lib/whatsOnBadges";

export type DealProximityAnchor = { lat: number; lng: number };

/**
 * Distance ring, in kilometres, that deals share before `endsAt` decides the
 * order. Sized to the anchor: a night-area centre answers "which patch", not
 * "which street", so anything finer would be a precision the input has not got.
 */
export const DEAL_PROXIMITY_RING_KM = 1;

/** A deal ending within this long is the set a surface may call ending soon. */
export const DEAL_ENDING_SOON_MS = 2 * 60 * 60 * 1000;

/** Listings older than this get their age said out loud beside them. */
export const DEAL_LISTING_STALE_DAYS = 14;

/** Past this age the caption counts in months, because "9 weeks" reads as noise. */
const LISTING_AGE_MONTHS_FROM_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The one point a deal surface is allowed to measure from: the centre of the
 * viewer's nearest night area. Public, fixed, and shared by everyone standing
 * in that area, so the ordering can be "near you" without a deal path ever
 * holding a viewer's own coordinates. Returns null when there is no location to
 * work from, and the surfaces then order by closing time alone.
 */
export function dealProximityAnchor(
  viewer: { lat: number; lng: number } | null | undefined,
  cityId: CityId = "london",
): DealProximityAnchor | null {
  if (!viewer || !Number.isFinite(viewer.lat) || !Number.isFinite(viewer.lng)) return null;
  const area = nearestNightAreaForViewport(cityId, [viewer.lng, viewer.lat]);
  if (!area) return null;
  return { lat: area.centre.lat, lng: area.centre.lng };
}

/** Ring index from the anchor. A row without coordinates sorts to the last ring. */
function proximityRing(row: WhatsOnRow, anchor: DealProximityAnchor | null): number {
  if (!anchor) return 0;
  if (typeof row.lat !== "number" || typeof row.lng !== "number") return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return Number.POSITIVE_INFINITY;
  const km = haversineKm([row.lng, row.lat], [anchor.lng, anchor.lat]);
  return Math.floor(km / DEAL_PROXIMITY_RING_KM);
}

/** Closing instant, or Infinity when the row never said when it closes. */
function endsAtMs(row: WhatsOnRow): number {
  const ms = row.endsAt ? Date.parse(row.endsAt) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * Order any deal-carrying items by ring, then closing time, then their incoming
 * order. Generic over the item so a surface can order raw rows or the grouped
 * families the Tonight list renders without either one restating the rule.
 */
export function orderDealsByNearThenEnding<T>(
  items: readonly T[],
  toRow: (item: T) => WhatsOnRow,
  anchor: DealProximityAnchor | null,
): T[] {
  return items
    .map((item, index) => {
      const row = toRow(item);
      return { item, index, ring: proximityRing(row, anchor), ends: endsAtMs(row) };
    })
    .sort((a, b) => a.ring - b.ring || a.ends - b.ends || a.index - b.index)
    .map((entry) => entry.item);
}

/** The same order for plain rows. */
export function orderDeals(
  rows: readonly WhatsOnRow[],
  anchor: DealProximityAnchor | null,
): WhatsOnRow[] {
  return orderDealsByNearThenEnding(rows, (row) => row, anchor);
}

/**
 * Put the deals in deal order without moving anything else. A mixed What's-On
 * list answers four questions at once, so deals may not reshuffle a quiz or a
 * match to get themselves nearer the top: they may only take the slots deals
 * already hold, in the order the deal rule gives. That way the deals order is
 * true on the page a reader actually opens, and it needs no filter tapped first.
 */
export function orderDealsInPlace<T>(
  items: readonly T[],
  toRow: (item: T) => WhatsOnRow,
  anchor: DealProximityAnchor | null,
): T[] {
  const slots: number[] = [];
  const deals: T[] = [];
  items.forEach((item, index) => {
    if (toRow(item).kind !== "deal") return;
    slots.push(index);
    deals.push(item);
  });
  if (deals.length < 2) return [...items];
  const ordered = orderDealsByNearThenEnding(deals, toRow, anchor);
  const out = [...items];
  slots.forEach((slot, i) => {
    out[slot] = ordered[i] as T;
  });
  return out;
}

/**
 * Deal rows that are still running. Grace for this kind is 0 (lib/whatsOn.ts),
 * so a deal whose window has closed leaves every surface the moment it closes.
 */
export function liveDeals(rows: readonly WhatsOnRow[], now: number = Date.now()): WhatsOnRow[] {
  return rows.filter((row) => row.kind === "deal" && !isPastDated(row, now));
}

/** Live deals closing within DEAL_ENDING_SOON_MS. A row with no endsAt never qualifies. */
export function dealsEndingSoon(
  rows: readonly WhatsOnRow[],
  now: number = Date.now(),
): WhatsOnRow[] {
  return liveDeals(rows, now).filter((row) => {
    const ends = endsAtMs(row);
    return Number.isFinite(ends) && ends > now && ends - now <= DEAL_ENDING_SOON_MS;
  });
}

/**
 * "Ends 9:45 pm" from the row's own `endsAt`. Null when the row never said, when
 * the window has already closed, or when it closes outside tonight's window: a
 * bare clock for another day would read as tonight and would be a lie the row
 * never told.
 *
 * The clock comes from formatWhatsOnTime, the same formatter that prints the
 * row's START on every What's-On card, so one row never mixes a 12 hour start
 * with a 24 hour close and leave the reader doing the arithmetic.
 */
export function dealEndsCaption(row: WhatsOnRow, now: number = Date.now()): string | null {
  const ends = row.endsAt ? Date.parse(row.endsAt) : Number.NaN;
  if (!Number.isFinite(ends) || ends <= now) return null;
  const { start, end } = londonServiceDayBounds(now);
  if (ends < Date.parse(start) || ends > Date.parse(end)) return null;
  const clock = formatWhatsOnTime(row.endsAt);
  return clock ? `Ends ${clock}` : null;
}

/** Whole weeks or months since the listing was written down. */
function listingAgePhrase(days: number): string {
  if (days >= LISTING_AGE_MONTHS_FROM_DAYS) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
}

/**
 * "Listed 3 weeks ago - check at the bar." from the row's `observedAt`, which
 * for a bundled listing is the file's own generatedAt. Silent until the listing
 * is old enough to doubt: saying the age of something written down this morning
 * would be noise beside every card.
 */
export function dealListingAgeCaption(
  row: WhatsOnRow,
  now: number = Date.now(),
): string | null {
  const observed = Date.parse(row.observedAt);
  if (!Number.isFinite(observed) || observed > now) return null;
  const days = Math.floor((now - observed) / DAY_MS);
  if (days < DEAL_LISTING_STALE_DAYS) return null;
  return `Listed ${listingAgePhrase(days)} - check at the bar`;
}
