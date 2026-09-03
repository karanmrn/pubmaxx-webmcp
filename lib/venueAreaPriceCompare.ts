// One compare line for the venue Overview: this pub's pint against the patch.
//
// "Am I getting mugged?" — a drinker with a displayable pint price and a real
// borough or zone yardstick gets one sentence. No yardstick, no line. Never
// invent a median; never joke beside a figure.
//
// Authority order:
//   1. Borough average from the public Pint Index league (`buildLeagueTable`)
//   2. Fare-zone median from `computeZonePintIndex` when the zone cleared its
//      observation gate
// Silence when neither answers. Demo-only inventing is out of scope here: the
// caller must pass a displayable pint (the same stack the sheet already shows),
// and zone/league helpers already refuse thin or ineligible inputs.

import { LONDON_BOROUGHS, slugifyBorough } from "@/lib/boroughs";
import {
  boroughCode,
  buildLeagueTable,
  type LeagueRow,
  type PintIndexSnapshot,
} from "@/lib/pintIndex";
import { formatPrice } from "@/lib/venues";
import {
  computeZonePintIndex,
  toZoneId,
  zoneLabel,
  type ZonePintIndex,
  type ZonePricedVenue,
} from "@/lib/zones";

/** Within this many pounds of the patch figure reads as "about average". */
export const AREA_PRICE_ABOUT_AVERAGE_GBP = 0.3;

export type VenueAreaPriceCompareInput = {
  /** Displayable pint at this pub, GBP. Null/undefined → no line. */
  priceGbp: number | null | undefined;
  /** Venue primary borough; resolved to a canonical London name when possible. */
  primaryBorough?: string | null;
  /** Nearest-station fare zone (1–6), when known. */
  zone?: number | null;
  /** Pre-built league rows from `buildLeagueTable`. `null` = fetch not settled. */
  leagueRows?: readonly LeagueRow[] | null;
  /** Live/public Pint Index snapshot; used only when `leagueRows` is omitted. */
  snapshot?: PintIndexSnapshot | null;
  /** Pre-built zone pint index. */
  zoneIndex?: ZonePintIndex | null;
  /** Priced venues for `computeZonePintIndex` when `zoneIndex` is omitted. */
  zoneVenues?: readonly ZonePricedVenue[] | null;
};

export type VenueAreaPriceCompareResult = {
  line: string;
  kind: "borough" | "zone";
  areaLabel: string;
  areaGbp: number;
  priceGbp: number;
};

/** Canonical borough display name, or null when the string is not a London borough. */
export function resolveCompareBorough(
  primaryBorough: string | null | undefined,
): string | null {
  const raw = primaryBorough?.trim();
  if (!raw) return null;
  const stripped = raw.replace(/^(?:royal|london)\s+borough\s+of\s+/i, "");
  const slug = slugifyBorough(stripped);
  if (!slug) return null;
  return LONDON_BOROUGHS.find((name) => slugifyBorough(name) === slug) ?? null;
}

function resolveLeagueRows(
  input: VenueAreaPriceCompareInput,
): readonly LeagueRow[] | null {
  // `null` means the league fetch has not settled yet — do not let zone answer
  // early and flash a yardstick that borough may replace.
  if (input.leagueRows === null) return null;
  if (input.leagueRows) return input.leagueRows;
  if (input.snapshot) return buildLeagueTable(input.snapshot);
  return [];
}

function resolveZoneIndex(input: VenueAreaPriceCompareInput): ZonePintIndex | null {
  if (input.zoneIndex) return input.zoneIndex;
  if (input.zoneVenues) return computeZonePintIndex(input.zoneVenues);
  return null;
}

function isAboutAverage(priceGbp: number, areaGbp: number): boolean {
  return Math.abs(priceGbp - areaGbp) <= AREA_PRICE_ABOUT_AVERAGE_GBP;
}

function formatCompareLine(
  priceGbp: number,
  areaGbp: number,
  areaLabel: string,
  kind: "borough" | "zone",
): string {
  if (isAboutAverage(priceGbp, areaGbp)) {
    return `About average for ${areaLabel}.`;
  }
  if (kind === "borough") {
    return `${formatPrice(priceGbp)} here. ${areaLabel} average ${formatPrice(areaGbp)}.`;
  }
  return `${formatPrice(priceGbp)} here. ${areaLabel} median ${formatPrice(areaGbp)}.`;
}

function boroughCompare(
  priceGbp: number,
  primaryBorough: string | null | undefined,
  leagueRows: readonly LeagueRow[],
): VenueAreaPriceCompareResult | null {
  const borough = resolveCompareBorough(primaryBorough);
  if (!borough || leagueRows.length === 0) return null;
  const slug = boroughCode(borough);
  const row = leagueRows.find(
    (entry) => entry.slug === slug || entry.name === borough,
  );
  if (!row || !Number.isFinite(row.averageGbp) || row.averageGbp <= 0) return null;
  const areaLabel = row.name;
  return {
    kind: "borough",
    areaLabel,
    areaGbp: row.averageGbp,
    priceGbp,
    line: formatCompareLine(priceGbp, row.averageGbp, areaLabel, "borough"),
  };
}

function zoneCompare(
  priceGbp: number,
  zone: number | null | undefined,
  zoneIndex: ZonePintIndex | null,
): VenueAreaPriceCompareResult | null {
  if (!zoneIndex) return null;
  const zoneId = toZoneId(zone);
  if (zoneId === null) return null;
  const row = zoneIndex.rows.find((entry) => entry.zone === zoneId);
  if (!row?.enough || row.medianGbp === null || !Number.isFinite(row.medianGbp)) {
    return null;
  }
  const areaLabel = zoneLabel(zoneId);
  return {
    kind: "zone",
    areaLabel,
    areaGbp: row.medianGbp,
    priceGbp,
    line: formatCompareLine(priceGbp, row.medianGbp, areaLabel, "zone"),
  };
}

/**
 * Compare one displayable pint against borough (Pint Index) or zone median.
 * Returns null when there is no price or not enough patch data — prefer silence.
 */
export function venueAreaPriceCompare(
  input: VenueAreaPriceCompareInput,
): VenueAreaPriceCompareResult | null {
  const priceGbp = input.priceGbp;
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp) || priceGbp <= 0) {
    return null;
  }

  const leagueRows = resolveLeagueRows(input);
  if (leagueRows === null) return null;

  const fromBorough = boroughCompare(priceGbp, input.primaryBorough, leagueRows);
  if (fromBorough) return fromBorough;

  return zoneCompare(priceGbp, input.zone, resolveZoneIndex(input));
}

/** Convenience: the reader-facing sentence, or null. */
export function venueAreaPriceCompareLine(
  input: VenueAreaPriceCompareInput,
): string | null {
  return venueAreaPriceCompare(input)?.line ?? null;
}
