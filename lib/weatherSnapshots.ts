import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";

export const WEATHER_SNAPSHOT_VERSION = 1 as const;

export type WeatherEvidenceSource = {
  sourceUrl: string;
  publisher: string;
  publishedAt: string;
};

export type NightAreaWeatherObservation = {
  nightArea: NightAreaSlug;
  observedAt: string;
  expiresAt: string;
  condition: string;
  feelsLikeC: number;
  precipitationProbabilityPct: number;
  windKph: number | null;
  source: WeatherEvidenceSource;
};

export type WeatherSnapshot = {
  version: typeof WEATHER_SNAPSHOT_VERSION;
  generatedAt: string;
  observations: NightAreaWeatherObservation[];
};

export type PlanningWeather = NightAreaWeatherObservation & {
  kind: "warm-dry" | "rainy" | "cold" | "mild";
};

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    ? value.trim()
    : null;
}

function httpUrl(value: unknown): string | null {
  const candidate = text(value, 2_000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!(["https:", "http:"] as const).includes(url.protocol as "https:" | "http:")) return null;
    if (url.username || url.password || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function validateWeatherObservation(value: unknown): NightAreaWeatherObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const nightArea = NIGHT_AREA_SLUGS.includes(row.nightArea as NightAreaSlug)
    ? row.nightArea as NightAreaSlug
    : null;
  const observedAt = iso(row.observedAt);
  const expiresAt = iso(row.expiresAt);
  const condition = text(row.condition, 120);
  const feelsLikeC = typeof row.feelsLikeC === "number" && Number.isFinite(row.feelsLikeC)
    && row.feelsLikeC >= -40 && row.feelsLikeC <= 60 ? row.feelsLikeC : null;
  const precipitationProbabilityPct = typeof row.precipitationProbabilityPct === "number"
    && Number.isFinite(row.precipitationProbabilityPct)
    && row.precipitationProbabilityPct >= 0 && row.precipitationProbabilityPct <= 100
    ? row.precipitationProbabilityPct
    : null;
  const windKph = row.windKph === null
    ? null
    : typeof row.windKph === "number" && Number.isFinite(row.windKph) && row.windKph >= 0 && row.windKph <= 300
      ? row.windKph
      : undefined;
  const sourceRow = row.source && typeof row.source === "object" && !Array.isArray(row.source)
    ? row.source as Record<string, unknown>
    : null;
  const sourceUrl = httpUrl(sourceRow?.sourceUrl);
  const publisher = text(sourceRow?.publisher, 160);
  const publishedAt = iso(sourceRow?.publishedAt);
  if (!nightArea || !observedAt || !expiresAt || !condition || feelsLikeC === null
    || precipitationProbabilityPct === null || windKph === undefined || !sourceUrl || !publisher || !publishedAt) return null;
  if (Date.parse(expiresAt) <= Date.parse(observedAt) || Date.parse(publishedAt) > Date.parse(observedAt)) return null;
  return {
    nightArea,
    observedAt,
    expiresAt,
    condition,
    feelsLikeC,
    precipitationProbabilityPct,
    windKph,
    source: { sourceUrl, publisher, publishedAt },
  };
}

export function validateWeatherSnapshot(value: unknown): WeatherSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const generatedAt = iso(row.generatedAt);
  if (row.version !== WEATHER_SNAPSHOT_VERSION || !generatedAt || !Array.isArray(row.observations)) return null;
  const parsed = row.observations.map(validateWeatherObservation);
  if (parsed.some((observation) => observation === null)) return null;
  const observations = parsed as NightAreaWeatherObservation[];
  if (new Set(observations.map((observation) => observation.nightArea)).size !== observations.length) return null;
  if (observations.some((observation) => Date.parse(observation.observedAt) > Date.parse(generatedAt))) return null;
  return { version: WEATHER_SNAPSHOT_VERSION, generatedAt, observations };
}

function weatherKind(observation: NightAreaWeatherObservation): PlanningWeather["kind"] {
  const condition = observation.condition.toLocaleLowerCase("en-GB");
  if (observation.precipitationProbabilityPct >= 40 || /rain|drizzle|storm|shower|snow/.test(condition)) return "rainy";
  if (observation.feelsLikeC < 10) return "cold";
  if (observation.feelsLikeC >= 15 && observation.precipitationProbabilityPct < 30) return "warm-dry";
  return "mild";
}

/** Returns only a source-backed, non-future, unexpired cached observation. */
export function planningWeatherForArea(
  value: unknown,
  nightArea: NightAreaSlug,
  now = Date.now(),
): PlanningWeather | null {
  const snapshot = validateWeatherSnapshot(value);
  if (!snapshot || Date.parse(snapshot.generatedAt) > now) return null;
  const observation = snapshot.observations.find((candidate) => candidate.nightArea === nightArea);
  if (!observation || Date.parse(observation.observedAt) > now || Date.parse(observation.expiresAt) <= now) return null;
  return { ...observation, kind: weatherKind(observation) };
}
