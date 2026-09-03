import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import {
  getNightArea,
  nearestNightAreaForViewport,
  type NightAreaSlug,
} from "@/lib/nightAreas";
import { planningWeatherForArea } from "@/lib/weatherSnapshots";
import { loadWeatherSnapshot } from "@/lib/weatherSnapshots.server";
import { evaluateDrinkWeather } from "@/lib/drinkWeather";
import {
  lensVenuePredicate,
  londonMonth,
  summariseTonightConditions,
  tallyLensMatches,
  type TonightConditionsSummary,
  type VenueLensTally,
} from "@/lib/tonightConditions";
import weatherSnapshot from "@/public/data/weather/latest.json";

const DEFAULT_AREA: NightAreaSlug = "piccadilly-soho";

export type ResolveConditionsOptions = {
  point: [number, number] | null;
  now: Date;
  snapshot?: unknown;
  loadVenues?: (cityId: CityId) => Promise<ConciergeVenue[]>;
};

export async function resolveTonightConditions(
  options: ResolveConditionsOptions,
): Promise<TonightConditionsSummary | null> {
  const { point, now } = options;
  const snapshot = options.snapshot ?? (await loadWeatherSnapshot()) ?? weatherSnapshot;
  const loadVenues = options.loadVenues ?? loadConciergeVenues;
  const area = point
    ? nearestNightAreaForViewport(DEFAULT_CITY_ID, point)
    : getNightArea(DEFAULT_AREA);
  if (!area) return null;

  const weather = planningWeatherForArea(snapshot, area.slug, now.getTime());
  if (!weather) return null;
  const conditionsWeather = {
    tempC: weather.feelsLikeC,
    condition: weather.condition,
    precipitationProbabilityPct: weather.precipitationProbabilityPct,
  };
  const verdict = evaluateDrinkWeather({
    tempC: conditionsWeather.tempC,
    precipitationProbabilityPct: conditionsWeather.precipitationProbabilityPct,
    month: londonMonth(now),
  });
  if (!verdict) return null;

  let tally: VenueLensTally = null;
  if (point && lensVenuePredicate(verdict.venueLens)) {
    try {
      const venues = await loadVenues(DEFAULT_CITY_ID);
      tally = tallyLensMatches(venues, verdict.venueLens, point);
    } catch {
      tally = null;
    }
  }
  return summariseTonightConditions({ weather: conditionsWeather, now, tally });
}
