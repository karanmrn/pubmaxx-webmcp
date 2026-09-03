// Pure, client-safe route metrics for the /crawls cards (E4). Derives an
// HONEST straight-line summary for a curated crawl from the slim venue index
// (lib/venuesSlim — the only client-side source of venue coords + price):
// haversine leg distances at the shared WALK_KMH pace, and a "pints from"
// range off each stop's cheapestPrice. Anything unresolvable is skipped —
// a crawl whose stops aren't in the slim index simply gets no metrics, never
// invented ones. Mirrors lib/routeLegs semantics ("straight-line", ceil to a
// whole minute, never "0 min") without importing the Venue-typed leg builder.

import { haversineKm } from "@/lib/haversine";
import { WALK_KMH } from "@/lib/routeLegs";
import type { SlimVenue } from "@/lib/venuesSlim";

export type CrawlRouteSummary = {
  /** Straight-line (haversine) total across resolved stops, km. */
  totalKm: number;
  /** Minutes at WALK_KMH, rounded up, floored at 1. */
  totalMinutes: number;
  /** Resolved stop coordinates in [lng, lat] (GeoJSON) order. */
  points: [number, number][];
};

/**
 * Walk venueIds in crawl order, resolving each against the slim index.
 * Missing venues are skipped (a partial line is still honest — it connects
 * only real, resolved stops). Fewer than 2 resolved stops → undefined:
 * there is no line to measure or draw.
 */
export function buildCrawlRouteSummary(
  venueIds: readonly string[],
  slimById: ReadonlyMap<string, SlimVenue>,
): CrawlRouteSummary | undefined {
  const points: [number, number][] = [];
  for (const id of venueIds) {
    const venue = slimById.get(id);
    if (venue) points.push([venue.lng, venue.lat]);
  }
  if (points.length < 2) return undefined;
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    totalKm += haversineKm(points[i], points[i + 1]);
  }
  const totalMinutes = Math.max(1, Math.ceil((totalKm / WALK_KMH) * 60));
  return { totalKm, totalMinutes, points };
}

/** "24 min walk · 1.8 km, straight-line" — same framing as lib/routeLegs. */
export function formatCrawlRouteSummary(summary: CrawlRouteSummary): string {
  return `${summary.totalMinutes} min walk · ${summary.totalKm.toFixed(1)} km, straight-line`;
}

export type CrawlPriceRange = { minGbp: number; maxGbp: number };

/**
 * Range of the resolved stops' cheapestPrice values. Stops without a price
 * (null / unresolved) are skipped; no priced stops → undefined (show nothing
 * rather than a fake figure).
 */
export function crawlPriceRange(
  venueIds: readonly string[],
  slimById: ReadonlyMap<string, SlimVenue>,
): CrawlPriceRange | undefined {
  const prices: number[] = [];
  for (const id of venueIds) {
    const price = slimById.get(id)?.cheapestPrice;
    if (typeof price === "number" && Number.isFinite(price)) prices.push(price);
  }
  if (prices.length === 0) return undefined;
  return { minGbp: Math.min(...prices), maxGbp: Math.max(...prices) };
}

/** "£4.20–£6.50", collapsing to "£4.20" when min === max. */
export function formatPriceRange(range: CrawlPriceRange): string {
  const gbp = (value: number) => `£${value.toFixed(2)}`;
  return range.minGbp === range.maxGbp
    ? gbp(range.minGbp)
    : `${gbp(range.minGbp)}–${gbp(range.maxGbp)}`;
}
