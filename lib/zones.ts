// Zone-based price lens — the "a pint in Zone 1 costs more than Zone 3" play.
//
// TfL fare zones are STATION-based, not area polygons. Every venue is assigned
// the zone of its NEAREST station (see scripts/lib/stationZones.mjs, run at
// build time and stamped onto the slim index as `zone`). This module is the
// pure, client-safe maths on top of that field: the picker's zone set, the
// per-zone median "pint index", and the low-observation honesty gate. It never
// invents a number — a zone with too few priced venues is reported as such.

import type { VenueKind } from "@/lib/venues";

/** Filterable fare zones offered by the picker: 1–6 plus "all". */
export const ZONE_IDS = [1, 2, 3, 4, 5, 6] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

/** A zone selection: a concrete zone, or "all" (no zone narrowing). */
export type ZoneSelection = ZoneId | "all";

/**
 * Minimum number of priced venues a zone needs before we publish a median.
 * Below this the zone reads "not enough pints logged yet — fix that", never a
 * shaky number pretending to be a trend.
 */
export const MIN_PRICED_VENUES = 10;

/** Short human label for a zone selection. */
export function zoneLabel(selection: ZoneSelection): string {
  return selection === "all" ? "All zones" : `Zone ${selection}`;
}

/** Coerce an unknown value to a filterable ZoneId, or null if out of 1–6. */
export function toZoneId(value: unknown): ZoneId | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return null;
  return (ZONE_IDS as readonly number[]).includes(n) ? (n as ZoneId) : null;
}

/** Parse a URL / query zone param ("3", "all") into a ZoneSelection or null. */
export function parseZoneParam(raw: string | null | undefined): ZoneSelection | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "all") return "all";
  return toZoneId(value);
}

/**
 * Does a venue's zone match a selection?
 * "all" (or an empty string) matches everything. A concrete zone matches only
 * venues whose assigned zone equals it; a venue with an unknown zone (null)
 * never matches a concrete zone — honest, not guessed into a bucket.
 */
export function venueMatchesZone(
  venueZone: number | null | undefined,
  selection: ZoneSelection | "" | null | undefined,
): boolean {
  if (selection == null || selection === "" || selection === "all") return true;
  return venueZone === selection;
}

/** Median of a numeric list (average of the two middle values for even n). */
export function median(values: readonly number[]): number | null {
  const nums = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

/** Minimal venue shape the zone index needs. */
export type ZonePricedVenue = {
  zone?: number | null;
  cheapestPrice?: number | null;
  kind?: VenueKind;
};

/** One zone's row in the pint index. */
export type ZonePintIndexRow = {
  zone: ZoneId;
  /** Median cheapest pint across priced venues in this zone, or null if gated. */
  medianGbp: number | null;
  /** Count of venues in this zone that have a numeric price. */
  pricedCount: number;
  /** True when pricedCount >= MIN_PRICED_VENUES, so medianGbp is publishable. */
  enough: boolean;
};

export type ZonePintIndex = {
  rows: ZonePintIndexRow[];
  /** Zones that cleared the observation gate, cheapest → dearest by median. */
  ranked: ZonePintIndexRow[];
  /** Dearest publishable zone (highest median), or null if none qualify. */
  dearest: ZonePintIndexRow | null;
  /** Cheapest publishable zone (lowest median), or null if none qualify. */
  cheapest: ZonePintIndexRow | null;
  /** Dearest − cheapest median across publishable zones — the "zone tax". */
  taxGbp: number | null;
};

/**
 * Compute the per-zone pint index from priced venues. Pure and deterministic:
 * groups venues by their assigned zone, takes the median of each zone's cheapest
 * pint, and gates any zone with fewer than MIN_PRICED_VENUES priced venues.
 */
export function computeZonePintIndex(venues: readonly ZonePricedVenue[]): ZonePintIndex {
  const pricesByZone = new Map<ZoneId, number[]>();
  for (const id of ZONE_IDS) pricesByZone.set(id, []);

  for (const venue of venues) {
    if (venue.kind !== undefined && venue.kind !== "pub") continue;
    const zone = toZoneId(venue.zone);
    if (zone === null) continue;
    const price = venue.cheapestPrice;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    pricesByZone.get(zone)!.push(price);
  }

  const rows: ZonePintIndexRow[] = ZONE_IDS.map((zone) => {
    const prices = pricesByZone.get(zone)!;
    const enough = prices.length >= MIN_PRICED_VENUES;
    return {
      zone,
      pricedCount: prices.length,
      enough,
      medianGbp: enough ? median(prices) : null,
    };
  });

  const ranked = rows
    .filter((row): row is ZonePintIndexRow & { medianGbp: number } => row.medianGbp !== null)
    .sort((a, b) => a.medianGbp - b.medianGbp);

  const cheapest = ranked[0] ?? null;
  const dearest = ranked.length ? ranked[ranked.length - 1] : null;
  const taxGbp =
    cheapest && dearest && cheapest !== dearest
      ? Number((dearest.medianGbp! - cheapest.medianGbp!).toFixed(2))
      : cheapest && dearest
        ? 0
        : null;

  return { rows, ranked, dearest, cheapest, taxGbp };
}

/** "£6.40" style GBP for the index; null → en dash placeholder. */
export function formatZoneGbp(value: number | null): string {
  return typeof value === "number" ? `£${value.toFixed(2)}` : "–";
}
