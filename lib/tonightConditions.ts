// Tonight Conditions summary — pure composition of the strip's four lines.
//
// Ties today's date, the cached weather, a drink-weather verdict and a nearby
// venue tally into the small string bag the strip renders. No fetch, no React;
// the route does the IO (loads the weather snapshot and venue index, counts
// nearby matches) and hands the numbers here so this stays unit-testable.
//
// Honesty rules, matching the rest of the app:
//   - no verdict from the rules table (grey in-between weather) -> null, no strip
//   - zero matching venues, or no location to measure "near you" -> weather line
//     with no venue claim (never a fabricated count)
//   - a pint-under-ceiling claim only when price data actually supports it

import { evaluateDrinkWeather, type VenueLens } from "@/lib/drinkWeather";
import { haversineKm } from "@/lib/haversine";
import type { ConciergeVenue } from "@/lib/concierge/rank";

/** Pints at or below this are "under 6 quid" for the garden framing. */
export const PINT_CEILING_GBP = 6;

/** "Near you" means a short walk, not the whole city. */
export const NEAR_RADIUS_KM = 2.5;

export type ConditionsWeather = {
  tempC: number;
  condition: string;
  precipitationProbabilityPct: number;
};

/**
 * Nearby-venue tally for the verdict's lens, or null when no claim can be made
 * (no location, or a lens with no supporting amenity data such as fireplace).
 *   count       - venues near you matching the lens
 *   underCeiling - subset of those with a known pint under PINT_CEILING_GBP
 */
export type VenueLensTally = {
  count: number;
  underCeiling: number;
} | null;

export type TonightConditionsSummary = {
  /** "Saturday 19 Jul" */
  dateLabel: string;
  /** "18C, light cloud" */
  weatherLabel: string;
  /** The verdict's calm line, e.g. "Warm and dry. Beer garden weather." */
  drinkLine: string;
  /** Lower-case drink phrase, e.g. "a cold lager or cider". */
  drinkSuggestion: string;
  /** "4 gardens near you with a pint under 6 quid", or null. */
  venueClaim: string | null;
};

/** Format a date as the app's calm "Saturday 19 Jul" style (London time). */
export function formatConditionDate(date: Date, timeZone = "Europe/London"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone,
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${weekday} ${day} ${month}`.trim();
}

/** Calendar month (1-12) for a moment in the given timezone. */
export function londonMonth(date: Date, timeZone = "Europe/London"): number {
  const value = new Intl.DateTimeFormat("en-GB", { month: "numeric", timeZone }).format(date);
  return Number.parseInt(value, 10);
}

function weatherLabel(weather: ConditionsWeather): string {
  const temp = `${Math.round(weather.tempC)}°C`;
  const condition = weather.condition.trim();
  return condition ? `${temp}, ${condition.toLocaleLowerCase("en-GB")}` : temp;
}

/**
 * Predicate for the amenity/curation flag a lens claims against, or null when
 * the lens has no supporting data in the venue vocabulary (fireplace has no
 * amenity flag; "any" makes no venue claim at all).
 */
export function lensVenuePredicate(
  lens: VenueLens,
): ((venue: ConciergeVenue) => boolean) | null {
  if (lens === "beer-garden") return (venue) => venue.amenities.beerGarden === true;
  if (lens === "riverside") return (venue) => venue.nearWater === true;
  return null;
}

/**
 * Tally venues near a point matching the lens, and how many of those have a
 * known pint under the ceiling. Pure over an already-loaded venue array. Null
 * when the lens supports no claim (the route then makes none). Coordinates are
 * [lng, lat] to match the app's haversine convention.
 */
export function tallyLensMatches(
  venues: readonly ConciergeVenue[],
  lens: VenueLens,
  point: [number, number],
  radiusKm = NEAR_RADIUS_KM,
): VenueLensTally {
  const predicate = lensVenuePredicate(lens);
  if (!predicate) return null;
  let count = 0;
  let underCeiling = 0;
  for (const venue of venues) {
    if (!predicate(venue)) continue;
    if (haversineKm(point, [venue.lng, venue.lat]) > radiusKm) continue;
    count += 1;
    if (typeof venue.cheapestPrice === "number" && venue.cheapestPrice < PINT_CEILING_GBP) {
      underCeiling += 1;
    }
  }
  return { count, underCeiling };
}

function lensNoun(lens: VenueLens, plural: boolean): string | null {
  if (lens === "beer-garden") return plural ? "gardens" : "garden";
  if (lens === "riverside") return plural ? "riverside pubs" : "riverside pub";
  // fireplace and "any" make no venue claim: no supporting amenity flag exists.
  return null;
}

/**
 * Build the venue half of the strip, or null when there is no honest claim to
 * make. Prefers the price-backed "pint under 6 quid" framing when any nearby
 * match has price data; otherwise a plain count. Never claims zero.
 */
export function buildVenueClaim(lens: VenueLens, tally: VenueLensTally): string | null {
  if (!tally || tally.count <= 0) return null;
  if (tally.underCeiling > 0) {
    const noun = lensNoun(lens, tally.underCeiling !== 1);
    if (!noun) return null;
    return `${tally.underCeiling} ${noun} near you with a pint under ${PINT_CEILING_GBP} quid`;
  }
  const noun = lensNoun(lens, tally.count !== 1);
  if (!noun) return null;
  return `${tally.count} ${noun} near you`;
}

/**
 * Compose the full strip summary, or null when the rules table gives no verdict
 * for tonight's weather (the caller then renders nothing).
 */
export function summariseTonightConditions(args: {
  weather: ConditionsWeather;
  now: Date;
  tally: VenueLensTally;
  timeZone?: string;
}): TonightConditionsSummary | null {
  const { weather, now, tally, timeZone } = args;
  const month = londonMonth(now, timeZone);
  const verdict = evaluateDrinkWeather({
    tempC: weather.tempC,
    precipitationProbabilityPct: weather.precipitationProbabilityPct,
    month,
  });
  if (!verdict) return null;
  return {
    dateLabel: formatConditionDate(now, timeZone),
    weatherLabel: weatherLabel(weather),
    drinkLine: verdict.line,
    drinkSuggestion: verdict.drinkSuggestion,
    venueClaim: buildVenueClaim(verdict.venueLens, tally),
  };
}
