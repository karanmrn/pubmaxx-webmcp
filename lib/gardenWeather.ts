// Beer-garden weather heuristic — pure, no fetch, no React. The /discover
// GardenTonightCard feeds this the /api/citymcp/status weather block and only
// renders when it says yes. Honest empty: missing data means NOT garden
// weather (we never invent sunshine).

export const MIN_FEELS_LIKE_C = 16;
export const MAX_PRECIP_PROBABILITY_PCT = 40;

export type GardenWeatherInput = {
  feelsLikeC?: number | null;
  precipProbabilityPct?: number | null;
  isDay?: boolean | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * True when it's decent beer-garden weather:
 *  - feels-like is known and >= MIN_FEELS_LIKE_C
 *  - precip probability, when known, is < MAX_PRECIP_PROBABILITY_PCT
 *  - not explicitly night (isDay === false blocks; undefined does not,
 *    because city_status may omit it and a warm dry evening still counts)
 * Missing feels-like → false (we never guess warmth).
 */
export function isGardenWeather(
  weather: GardenWeatherInput | null | undefined,
): boolean {
  if (!weather) return false;
  if (!isFiniteNumber(weather.feelsLikeC)) return false;
  if (weather.feelsLikeC < MIN_FEELS_LIKE_C) return false;
  if (
    isFiniteNumber(weather.precipProbabilityPct) &&
    weather.precipProbabilityPct >= MAX_PRECIP_PROBABILITY_PCT
  ) {
    return false;
  }
  if (weather.isDay === false) return false;
  return true;
}

/**
 * Headline for the nudge card, e.g. "24° and dry — beer-garden night".
 * Returns null when it isn't garden weather (callers render nothing).
 */
export function gardenWeatherHeadline(
  weather: GardenWeatherInput | null | undefined,
): string | null {
  if (!weather || !isGardenWeather(weather)) return null;
  if (!isFiniteNumber(weather.feelsLikeC)) return null;
  return `${Math.round(weather.feelsLikeC)}° and dry. Beer-garden night`;
}
