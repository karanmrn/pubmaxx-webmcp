import type { CityId } from "@/lib/cities";

export type MapSearchCity = {
  id: CityId;
  name: string;
};

export type MapSearchCityInput = {
  id: CityId;
  displayName: string;
};

export type MapSearchVenue = {
  id: string;
  name: string;
  area: string;
};

export type MapSearchPack = {
  cityId: CityId;
  venues: readonly MapSearchVenue[];
};

export type MapSearchIndex = {
  cities: readonly MapSearchCity[];
  venues: readonly MapSearchIndexVenue[];
};

export type MapSearchIndexVenue = MapSearchVenue & {
  cityId: CityId;
};

export type MapSearchIndexResult =
  | MapSearchCityResult
  | MapSearchVenueResult;

export type MapSearchCityResult = {
  kind: "city";
  id: CityId;
  name: string;
};

export type MapSearchVenueResult = MapSearchIndexVenue & {
  kind: "venue";
};

const DEFAULT_RESULT_LIMIT = 12;

function normalise(value: string | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-GB")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function words(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

function isSubsequence(query: string, value: string): boolean {
  let queryIndex = 0;
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

/** Lower score wins. Area/city matches intentionally sit above venue names. */
function matchScore(query: string, name: string, area = ""): number | null {
  const normalisedName = normalise(name);
  const normalisedArea = normalise(area);
  if (!normalisedName && !normalisedArea) return null;

  const nameWords = words(normalisedName);
  const areaWords = words(normalisedArea);
  if (normalisedName === query) return 10;
  if (normalisedName.startsWith(query)) return 20;
  if (nameWords.some((word) => word.startsWith(query))) return 22;
  if (normalisedArea === query) return 30;
  if (normalisedArea.startsWith(query)) return 32;
  if (areaWords.some((word) => word.startsWith(query))) return 34;
  if (normalisedName.includes(query)) return 40;
  if (normalisedArea.includes(query)) return 42;
  if (isSubsequence(query, normalisedName)) return 60;
  if (isSubsequence(query, normalisedArea)) return 62;
  return null;
}

export function buildMapSearchIndex(
  cities: readonly MapSearchCityInput[],
  packs: readonly MapSearchPack[],
): MapSearchIndex {
  const knownCities = new Set(cities.map((city) => city.id));
  const venues: MapSearchIndexVenue[] = [];

  for (const pack of packs) {
    if (!knownCities.has(pack.cityId)) continue;
    for (const venue of pack.venues) {
      if (!venue.id || !venue.name) continue;
      venues.push({
        id: venue.id,
        name: venue.name,
        area: venue.area ?? "",
        cityId: pack.cityId,
      });
    }
  }

  return {
    cities: cities.map(({ id, displayName }) => ({ id, name: displayName })),
    venues,
  };
}

export function searchMapSearchIndex(
  index: MapSearchIndex,
  rawQuery: string,
  limit = DEFAULT_RESULT_LIMIT,
): MapSearchIndexResult[] {
  const query = normalise(rawQuery);
  if (!query || limit <= 0) return [];

  const candidates: Array<{ result: MapSearchIndexResult; score: number }> = [];
  for (const city of index.cities) {
    const score = matchScore(query, city.name);
    if (score !== null) {
      candidates.push({ result: { kind: "city", ...city }, score });
    }
  }
  for (const venue of index.venues) {
    const score = matchScore(query, venue.name, venue.area);
    if (score !== null) {
      candidates.push({ result: { kind: "venue", ...venue }, score });
    }
  }

  return candidates
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      if (left.result.kind !== right.result.kind) {
        return left.result.kind === "city" ? -1 : 1;
      }
      return left.result.name.localeCompare(right.result.name, "en-GB");
    })
    .slice(0, limit)
    .map(({ result }) => result);
}
