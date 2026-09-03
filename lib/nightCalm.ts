// Night calm context — a CALM safety-adjacent hint derived from data.police.uk
// street-level crime (keyless, open data: https://data.police.uk/docs/).
//
// Product posture (non-negotiable): the persona is a 9-to-5 Londoner walking
// home after pints. The tone is a reassuring guardian, NEVER fear-mongering.
// This module therefore:
//   - NEVER exposes crime counts, per-street points, or "danger" language.
//   - aggregates to a coarse Night Area (the ~1 mile disc the police API
//     returns around a lat/lng), never a street.
//   - collapses everything to ONE quiet band + one plain line of copy.
//   - degrades to "no hint" (null band) rather than guess on thin data.
//
// This file is PURE: month maths, response validation, and the aggregation that
// turns a month of street-level crimes into a calm band. The network fetch and
// per-area/per-month cache live in lib/nightCalmSource.ts so this stays trivially
// testable and free of I/O.

import { clamp } from "@/lib/mathClamp";

export const NIGHT_CALM_VERSION = 1 as const;

/**
 * data.police.uk street-level `category` slugs we treat as night-relevant to a
 * lone walk home. Anti-social behaviour and violent crime are the spec core;
 * robbery and weapons possession are the same personal-safety axis at night.
 * Everything else the API returns (shoplifting, vehicle crime, burglary, drugs,
 * etc.) is deliberately excluded — it is not what a walk-home guardian speaks to.
 */
export const NIGHT_RELEVANT_CATEGORIES = [
  "anti-social-behaviour",
  "violent-crime",
  "robbery",
  "possession-of-weapons",
] as const;

/** The minimum month sample below which we stay silent rather than over-read noise. */
export const MIN_CALM_SAMPLE = 20;

/** data.police.uk publishes ~2 months in arrears; this is the fallback target month. */
export const POLICE_DATA_LAG_MONTHS = 2;

export type NightCalmBand = "settled" | "steady" | "aware";

/**
 * Calm, guardian-tone copy per band. Never alarming, even at the least-calm end:
 * the worst we ever do is gently nudge toward main roads. No counts, no colours,
 * no "danger", no em dashes.
 */
export const NIGHT_CALM_LABELS: Record<NightCalmBand, string> = {
  settled: "Busy, well-used streets",
  steady: "Steady local streets",
  aware: "Quieter streets, keep to the main roads",
};

export type NightCalmAggregate = {
  /** Total street-level crimes in the month for the area disc. Internal signal only. */
  sampleSize: number;
  /** null when the sample is too thin to speak to — the caller shows nothing. */
  band: NightCalmBand | null;
  /** Calm copy for the band, or null when silent. */
  label: string | null;
  /** 0-100, higher = calmer. null when silent. Never surfaced as a count. */
  calmScore: number | null;
};

/** A single street-level crime row, pared to only the field we read. */
export type PoliceCrime = { category: string };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The month (YYYY-MM) we ask the police API for by default, accounting for its
 * ~2-month publication lag. Callers should prefer the authoritative month from
 * the API's `crime-last-updated` endpoint; this is the offline fallback.
 */
export function targetCrimeMonth(now: Date = new Date(), lagMonths: number = POLICE_DATA_LAG_MONTHS): string {
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lagMonths, 1));
  return `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}`;
}

/** True for a well-formed `YYYY-MM` month string. */
export function isCrimeMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * Normalise the police `crime-last-updated` payload (`{ date: "YYYY-MM-01" }`)
 * to a `YYYY-MM` month, or null when the shape is unexpected.
 */
export function crimeMonthFromLastUpdated(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const date = (value as { date?: unknown }).date;
  if (typeof date !== "string") return null;
  const month = date.slice(0, 7);
  return isCrimeMonth(month) ? month : null;
}

/**
 * Validate an unknown police street-level response into typed crime rows. Rows
 * without a usable string `category` are dropped rather than rejected wholesale,
 * so one malformed row never blanks a whole area. Returns null only when the
 * top-level shape is not an array.
 */
export function parsePoliceCrimes(value: unknown): PoliceCrime[] | null {
  if (!Array.isArray(value)) return null;
  const rows: PoliceCrime[] = [];
  for (const row of value) {
    const category = (row as { category?: unknown })?.category;
    if (typeof category === "string" && category.trim().length > 0) {
      rows.push({ category: category.trim() });
    }
  }
  return rows;
}

const NIGHT_RELEVANT_SET = new Set<string>(NIGHT_RELEVANT_CATEGORIES);

/** Where the night-relevant share bands sit. Tuned conservative; documented, not magic. */
const STEADY_SHARE_CEILING = 0.18;
const AWARE_SHARE_CEILING = 0.3;
/** Share at which the calm score bottoms out (we never surface a raw share). */
const SHARE_FLOOR_FOR_SCORE = 0.5;

/**
 * Turn a month of street-level crimes for ONE coarse area into a calm band.
 *
 * The signal is a *relative* one: the share of the area's own crime that is
 * night-relevant (anti-social + violent + robbery + weapons). A relative share
 * is fairer than a raw count — a busy, well-used district and a sleepy one are
 * judged on the mix of what happens there, not on footfall. A low share reads as
 * "busy, well-used" (lots of people about, little of it the walk-home kind); a
 * high share nudges gently toward main roads. Below MIN_CALM_SAMPLE crimes we
 * return a null band and say nothing.
 */
export function aggregateNightCalm(crimes: readonly PoliceCrime[]): NightCalmAggregate {
  const sampleSize = crimes.length;
  if (sampleSize < MIN_CALM_SAMPLE) {
    return { sampleSize, band: null, label: null, calmScore: null };
  }
  let nightRelevant = 0;
  for (const crime of crimes) {
    if (NIGHT_RELEVANT_SET.has(crime.category)) nightRelevant += 1;
  }
  const share = nightRelevant / sampleSize;
  const band: NightCalmBand =
    share <= STEADY_SHARE_CEILING ? "settled" : share <= AWARE_SHARE_CEILING ? "steady" : "aware";
  const calmScore = Math.round(clamp(1 - Math.min(share, SHARE_FLOOR_FOR_SCORE) / SHARE_FLOOR_FOR_SCORE, 0, 1) * 100);
  return { sampleSize, band, label: NIGHT_CALM_LABELS[band], calmScore };
}

/** The public, count-free calm context the route serves and the UI renders. */
export type NightCalmContext = {
  band: NightCalmBand | null;
  label: string | null;
  calmScore: number | null;
};

/** Strip the internal sample size, leaving only the calm-safe public fields. */
export function publicNightCalm(aggregate: NightCalmAggregate): NightCalmContext {
  return { band: aggregate.band, label: aggregate.label, calmScore: aggregate.calmScore };
}
