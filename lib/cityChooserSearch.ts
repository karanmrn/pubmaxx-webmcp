import {
  enabledCityContainingPoint,
  type CityConfig,
  type CityId,
} from "@/lib/cities";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { cityMapShareUrl } from "@/lib/cityShare";
import {
  normaliseUkPlaceQuery,
  searchUkPlaces,
  ukPlaceMapUrl,
  type UkPlace,
} from "@/lib/ukPlaceSearch";

export type CityChooserSearchResult =
  | {
      kind: "curated";
      name: string;
      description: string;
      href: string;
      cityId: CityId;
      /** Navigation point — city map centre, or the matched place inside it. */
      lat: number;
      lng: number;
    }
  | {
      kind: "uncovered";
      name: string;
      description: string;
      href: string;
      context: string;
      lat: number;
      lng: number;
    };

const UNCOVERED_DESCRIPTION =
  "No prices logged here yet. Open the pub map and you could be first.";

const SMALL_COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
] as const;

/** The list length, in words a reader can hear. Never a typed city count. */
export function cityGuideCountWord(count: number): string {
  return count >= 0 && count < SMALL_COUNT_WORDS.length
    ? SMALL_COUNT_WORDS[count]
    : String(count);
}

function countedNoun(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${cityGuideCountWord(count)} ${count === 1 ? singular : plural}`;
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function cityGuidesCoverageLine(
  cities: readonly CityConfig[],
): string {
  const capabilities = cities.map((city) => ({
    city,
    profile: getCityCapabilityProfile(city.id),
  }));
  const mapCount = capabilities.filter(
    ({ profile }) => profile.map.availability !== "unavailable",
  ).length;
  const previewCount = capabilities.filter(
    ({ profile }) => profile.releaseTier === "preview",
  ).length;
  const pricedCities = capabilities.filter(
    ({ profile }) => profile.prices.availability === "available",
  );
  const crawlCount = capabilities.filter(
    ({ profile }) => profile.routes.availability === "available",
  ).length;

  const mapSummary = sentenceCase(countedNoun(mapCount, "city map"));
  const previewSummary =
    previewCount > 0 ? `, including ${countedNoun(previewCount, "preview")}` : "";
  const priceSummary =
    pricedCities.length === 1
      ? `${pricedCities[0].city.displayName} has pint prices`
      : `${sentenceCase(countedNoun(pricedCities.length, "city", "cities"))} have pint prices`;
  const crawlSummary = `${countedNoun(crawlCount, "city", "cities")} ${crawlCount === 1 ? "has" : "have"} crawls`;

  return `${mapSummary}${previewSummary}. ${priceSummary}; ${crawlSummary}.`;
}

export function cityGuidesSearchUnavailableLine(count: number): string {
  return `Town search isn’t available right now. The ${cityGuideCountWord(count)} city maps are below.`;
}

/**
 * What a place inside a curated city gets by being part of it. The line names
 * only what that city actually ships: a pack that is the map and nothing else
 * says so, because promising prices and crawls to somebody who taps through to
 * neither is a broken destination rather than a warm welcome.
 */
export function cityGuideMembershipLine(city: CityConfig): string {
  const profile = getCityCapabilityProfile(city.id);
  const has: string[] = [];
  if (profile.prices.availability === "available") has.push("prices");
  if (profile.routes.availability === "available") has.push("crawls");
  const guide = `Part of the ${city.displayName} city guide`;
  return has.length > 0 ? `${guide}, with ${has.join(" and ")}.` : `${guide}.`;
}

export function buildCityChooserSearchResults(
  query: string,
  cities: readonly CityConfig[],
  places: readonly UkPlace[],
  limit = 8,
): CityChooserSearchResult[] {
  const normalizedQuery = normaliseUkPlaceQuery(query);
  if (normalizedQuery.length < 2 || limit <= 0) return [];
  const curated = cities
    .filter((city) =>
      normaliseUkPlaceQuery(city.displayName).includes(normalizedQuery),
    )
    .map((city): CityChooserSearchResult => {
      const [lng, lat] = city.mapView.center;
      return {
        kind: "curated",
        name: city.displayName,
        description: city.tagline,
        href: cityMapShareUrl(city.id),
        cityId: city.id,
        lat,
        lng,
      };
    });
  const routedCityIds = new Set<CityId>(
    curated.flatMap((result) =>
      result.kind === "curated" ? [result.cityId] : [],
    ),
  );
  const matched: CityChooserSearchResult[] = [];
  for (const place of searchUkPlaces(
    query,
    places,
    cities.map((city) => city.displayName),
    Math.max(0, limit - curated.length),
  )) {
    // A locality inside a curated city (Camden, Didsbury, Headingley) is that
    // city. It keeps the rich guide rather than being offered as uncovered.
    const city = enabledCityContainingPoint(place.lat, place.lng);
    if (!city) {
      matched.push({
        kind: "uncovered",
        name: place.name,
        description: UNCOVERED_DESCRIPTION,
        href: ukPlaceMapUrl(place),
        context: place.context,
        lat: place.lat,
        lng: place.lng,
      });
      continue;
    }
    if (routedCityIds.has(city.id)) continue;
    routedCityIds.add(city.id);
    matched.push({
      kind: "curated",
      name: place.name,
      description: cityGuideMembershipLine(city),
      href: cityMapShareUrl(city.id),
      cityId: city.id,
      lat: place.lat,
      lng: place.lng,
    });
  }
  return [...curated, ...matched].slice(0, limit);
}
