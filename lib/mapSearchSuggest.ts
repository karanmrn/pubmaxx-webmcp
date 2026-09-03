// Pure derivations behind the map search suggestions popup — the as-you-type
// panel under the map's search input that names matching AREAS and PUBS, each
// with its distance from the viewer.
//
// House pattern (see lib/areaButton.ts, lib/mapVenueList.ts): all the matching,
// ranking and distance logic lives here, hermetic and node-testable, so the
// React shell in components/map/MapSearchSuggest.tsx is a thin render over these
// models. No fs, no serverEnv, no route imports — safe to import on the client
// and to unit test without a DOM.

import {
  areaCoverageLabel,
  type AreaCoverageLabel,
  type AreaElsewhereOption,
} from "@/lib/areaButton";
import { slugifyBorough } from "@/lib/boroughs";
import { listEnabledCities, type CityId } from "@/lib/cities";
import { buildCityChooserSearchResults } from "@/lib/cityChooserSearch";
import { haversineKm } from "@/lib/haversine";
import type { Locality } from "@/lib/localities";
import { getNightAreasForCity } from "@/lib/nightAreas";
import {
  UK_PLACE_MAP_ZOOM,
  type UkPlace,
} from "@/lib/ukPlaceSearch";
import type { Venue, VenueKind } from "@/lib/venues";
import {
  compactVenueAnchor,
  type CompactVenueAnchor,
} from "@/lib/venueAnchorPresentation";
import {
  isPubVenue,
  venueKindLabel,
} from "@/lib/venueKindFilters";
import {
  searchUkBasePubsByName,
  SUGGEST_UK_BASE_PUB_LIMIT,
  type UkBasePubSuggestion,
} from "@/lib/ukBasePubSearch";
import type { UkBasePub } from "@/lib/ukBasePubs";

export type { UkBasePubSuggestion };
export { SUGGEST_UK_BASE_PUB_LIMIT, UK_BASE_SEARCH_GROUP_LABEL } from "@/lib/ukBasePubSearch";

/** How many pub name-matches the panel shows at most. Kept tight so the popup
 *  stays scannable on a phone; the map itself already narrows to every match. */
export const SUGGEST_PUB_LIMIT = 6;
/** Cap on the Areas group while a query is being typed. */
export const SUGGEST_AREA_LIMIT = 6;
/** Cap on the "nearby areas" shown on an empty query (taste-first, minimal). */
export const SUGGEST_EMPTY_AREA_LIMIT = 5;
/** Cap on UK place matches from the national gazetteer. */
export const SUGGEST_PLACE_LIMIT = 6;

/** Visible group head for national place rows in MapSearchSuggest. */
export const UK_PLACE_SEARCH_GROUP_LABEL = "UK places";

/** Camera zoom a locality tap flies to. A locality is tighter than a modelled
 *  area, so it sits one notch deeper than the area fly's default (14). */
export const LOCALITY_FLY_ZOOM = 14.5;

/** Where the row distances are measured from — decides the honest label. */
export type SuggestOrigin = "user" | "map-centre";

export type AreaSuggestion = {
  /** Stable React key + fly identity ("area:shoreditch" / "locality:willesden"
   *  / "borough:hackney"). */
  key: string;
  kind: "area" | "locality" | "borough";
  slug: string;
  name: string;
  /** A quiet second-line hint — the borough for a locality; "" otherwise. */
  contextLabel: string;
  /** Canonical Night Area or borough slug for context surfaces such as Area news. */
  areaNewsArea: string;
  /** [lng, lat] the map flies to — GeoJSON order, matching the camera helpers. */
  center: [number, number];
  /** Camera zoom the fly should use; undefined lets the caller keep its default. */
  flyZoom?: number;
  distanceKm: number;
  /** "1.2 km away" (from the viewer) or "1.2 km from centre" — never faked. */
  distanceLabel: string;
  /** Honest coverage for a modelled area; null for a locality or a plain
   *  borough (a locality is a place, not a coverage promise). The row never
   *  prints it: it rides the pick to the area sheet, which is where a reader
   *  asks about planning. */
  coverage: AreaCoverageLabel;
};

export type MapSearchAreaOption = AreaElsewhereOption & {
  /** Canonical Night Area or borough slug for context surfaces such as Area news. */
  areaNewsArea: string;
};

export type PubSuggestion = {
  id: string;
  name: string;
  kind?: VenueKind;
  typeLabel: string;
  /** The pub's borough, for a quiet second-line hint ("" when unknown). */
  boroughLabel: string;
  /** "£5.20" verified cheapest, or null when nothing is priced yet. */
  priceLabel: string | null;
  anchor: CompactVenueAnchor | null;
  distanceKm: number;
  distanceLabel: string;
};

/**
 * A UK place from the national gazetteer (public/data/uk_base/places.json).
 * Uses the same arrival hrefs as /choose-city so an uncovered pick lands the
 * UkPlaceArrivalBanner, and a place inside a curated pack opens that city map.
 */
export type PlaceSuggestion = {
  key: string;
  name: string;
  /** Postcode area for an uncovered place; "" for a curated city-guide row. */
  contextLabel: string;
  description: string;
  href: string;
  placeKind: "curated" | "uncovered";
  /** Set for curated rows so the shell can fly in-place when already there. */
  cityId?: CityId;
  /** [lng, lat] fly target when staying on the current city map. */
  center: [number, number];
  flyZoom: number;
  distanceKm: number;
  distanceLabel: string;
};

export type MapSearchSuggestions = {
  origin: SuggestOrigin;
  /** The normalised query these suggestions answer. */
  query: string;
  areas: AreaSuggestion[];
  pubs: PubSuggestion[];
  places: PlaceSuggestion[];
  /**
   * Resident UK base pubs matching the query. Empty when no shards are loaded
   * or the query is empty — never a country-wide scan.
   */
  ukBasePubs: UkBasePubSuggestion[];
  hasResults: boolean;
  isEmptyQuery: boolean;
};

export type MapSearchSuggestInput = {
  cityId: CityId;
  query: string;
  venues: Venue[];
  /** The Greater London locality gazetteer (public/data/london_localities.json).
   *  Optional + defaults to []: a non-London city, or a fetch that hasn't
   *  landed yet, simply falls back to the modelled areas + boroughs. */
  localities?: Locality[];
  /**
   * National UK place index (lazy-loaded). Optional + defaults to []: until
   * places.json lands, the panel keeps answering with local areas and pubs.
   */
  places?: readonly UkPlace[];
  /**
   * UK base pubs currently resident from useUkBaseStreaming. Optional +
   * defaults to []: below the zoom gate, or before the first shard lands, the
   * base group simply does not appear. Never the full 38k pack.
   */
  ukBasePubs?: readonly UkBasePub[];
  /**
   * When false, skip modelled areas / localities / boroughs / pubs. Used on a
   * limited-coverage UK place arrival where the city pack is emptied and the
   * national gazetteer is what can still answer.
   */
  includeLocalResults?: boolean;
  /** The viewer's GPS position when Near me granted it; else null. */
  userLocation: { lat: number; lng: number } | null;
  /** Live map centre [lng, lat] — the honest fallback origin. */
  mapCenter: [number, number];
  now?: Date;
  pubLimit?: number;
  areaLimit?: number;
  placeLimit?: number;
  ukBasePubLimit?: number;
};

/**
 * Turn chooser-shaped place matches into map-search rows with honest distance
 * labels. Pure so MapSearchSuggest stays a thin render, and so limited-coverage
 * arrivals can answer with places alone when venues/localities are emptied.
 */
export function buildMapPlaceSuggestions(input: {
  query: string;
  places: readonly UkPlace[];
  /** Names already shown as local areas — dropped to avoid a double row. */
  excludedNames?: readonly string[];
  /** Curated city currently on screen — its own guide row is not re-offered. */
  currentCityId?: CityId;
  userLocation: { lat: number; lng: number } | null;
  mapCenter: [number, number];
  limit?: number;
}): PlaceSuggestion[] {
  const limit = input.limit ?? SUGGEST_PLACE_LIMIT;
  if (limit <= 0) return [];
  const origin: SuggestOrigin = input.userLocation ? "user" : "map-centre";
  const originPoint: [number, number] = input.userLocation
    ? [input.userLocation.lng, input.userLocation.lat]
    : input.mapCenter;
  const excluded = new Set(
    (input.excludedNames ?? []).map((name) => normalize(name)).filter(Boolean),
  );
  const results: PlaceSuggestion[] = [];
  for (const result of buildCityChooserSearchResults(
    input.query,
    listEnabledCities(),
    input.places,
    Math.max(limit + excluded.size, limit),
  )) {
    if (excluded.has(normalize(result.name))) continue;
    if (
      result.kind === "curated" &&
      input.currentCityId !== undefined &&
      result.cityId === input.currentCityId &&
      normalize(result.name) ===
        normalize(
          listEnabledCities().find((city) => city.id === result.cityId)
            ?.displayName ?? "",
        )
    ) {
      // Already on this city guide — the empty-query nearby areas cover it.
      continue;
    }
    const center: [number, number] = [result.lng, result.lat];
    const distanceKm = distanceKmFrom(originPoint, center);
    results.push({
      key: `place:${result.kind}:${result.href}:${result.name}`,
      name: result.name,
      contextLabel: result.kind === "uncovered" ? result.context : "",
      description: result.description,
      href: result.href,
      placeKind: result.kind,
      ...(result.kind === "curated" ? { cityId: result.cityId } : {}),
      center,
      flyZoom: UK_PLACE_MAP_ZOOM,
      distanceKm,
      distanceLabel: formatSuggestDistance(distanceKm, origin),
    });
    if (results.length >= limit) break;
  }
  return results;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Match tier of a query against a set of labels (name + aliases):
 * 0 = whole-label exact, 1 = starts a label or one of its words, 2 = appears
 * inside a label (only for queries of two or more characters, so a single stray
 * key never floods the panel). null = no match.
 */
function matchTier(labels: readonly string[], query: string): number | null {
  let best: number | null = null;
  for (const label of labels) {
    const hay = normalize(label);
    if (!hay) continue;
    if (hay === query) return 0;
    if (hay.startsWith(query) || hay.split(" ").some((word) => word.startsWith(query))) {
      best = best === null ? 1 : Math.min(best, 1);
    } else if (query.length >= 2 && hay.includes(query)) {
      best = best === null ? 2 : Math.min(best, 2);
    }
  }
  return best;
}

/**
 * The price the map's pins already show for a venue: a contributor's verified
 * drop overrides the baseline. Mirrors lib/areaButton so the popup and the area
 * sheet never disagree on a pub's price.
 */
function verifiedPrice(venue: Venue): number | null {
  const price = isPubVenue(venue)
    ? venue.latestContributorPrice ?? venue.cheapestPrice
    : venue.cheapestPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

function distanceKmFrom(origin: [number, number], point: [number, number]): number {
  if (![origin[0], origin[1], point[0], point[1]].every(Number.isFinite)) return Number.NaN;
  return haversineKm(origin, point);
}

/**
 * A short, honest distance line. From the viewer's own position it reads
 * "away"; from the map centre it reads "from centre" so we never pretend a map
 * position is the viewer's. A non-finite distance yields "" (the row simply
 * drops the label rather than inventing one).
 */
export function formatSuggestDistance(km: number, origin: SuggestOrigin): string {
  if (!Number.isFinite(km) || km < 0) return "";
  const suffix = origin === "user" ? "away" : "from centre";
  if (km < 0.1) return origin === "user" ? "right here" : "at the centre";
  if (km < 1) return `${Math.round(km * 1000)} m ${suffix}`;
  return `${km.toFixed(1)} km ${suffix}`;
}

/**
 * Borough centroids derived from the loaded pins: the mean position of every
 * venue whose primaryBorough matches. Gives a fly target for boroughs (like
 * Hackney) that aren't one of the modelled areas but that people still search.
 */
function buildBoroughCentroids(
  venues: Venue[],
): Map<string, { center: [number, number]; count: number }> {
  const acc = new Map<string, { lng: number; lat: number; count: number }>();
  for (const venue of venues) {
    const name = (venue.primaryBorough ?? "").trim();
    if (!name) continue;
    if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) continue;
    const current = acc.get(name) ?? { lng: 0, lat: 0, count: 0 };
    current.lng += venue.longitude;
    current.lat += venue.latitude;
    current.count += 1;
    acc.set(name, current);
  }
  const out = new Map<string, { center: [number, number]; count: number }>();
  for (const [name, sum] of acc) {
    out.set(name, { center: [sum.lng / sum.count, sum.lat / sum.count], count: sum.count });
  }
  return out;
}

/** Kind precedence when tier + distance tie: a modelled area (with its coverage
 *  chip) leads, then a named locality, then a plain borough. */
const AREA_KIND_RANK: Record<AreaSuggestion["kind"], number> = {
  area: 0,
  locality: 1,
  borough: 2,
};

/** Areas first by match tier, then nearest, then modelled area over a locality
 *  over a plain borough, then name — a stable, deterministic order. */
function compareArea(
  left: { tier: number; suggestion: AreaSuggestion },
  right: { tier: number; suggestion: AreaSuggestion },
): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  const leftKm = Number.isFinite(left.suggestion.distanceKm) ? left.suggestion.distanceKm : Infinity;
  const rightKm = Number.isFinite(right.suggestion.distanceKm) ? right.suggestion.distanceKm : Infinity;
  if (leftKm !== rightKm) return leftKm - rightKm;
  if (left.suggestion.kind !== right.suggestion.kind) {
    return AREA_KIND_RANK[left.suggestion.kind] - AREA_KIND_RANK[right.suggestion.kind];
  }
  return left.suggestion.name.localeCompare(right.suggestion.name);
}

function comparePub(
  left: { tier: number; suggestion: PubSuggestion },
  right: { tier: number; suggestion: PubSuggestion },
): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  const leftKm = Number.isFinite(left.suggestion.distanceKm) ? left.suggestion.distanceKm : Infinity;
  const rightKm = Number.isFinite(right.suggestion.distanceKm) ? right.suggestion.distanceKm : Infinity;
  if (leftKm !== rightKm) return leftKm - rightKm;
  return left.suggestion.name.localeCompare(right.suggestion.name);
}

function buildPubSuggestion(
  venue: Venue,
  originPoint: [number, number],
  origin: SuggestOrigin,
): PubSuggestion {
  const distanceKm = distanceKmFrom(originPoint, [
    venue.longitude,
    venue.latitude,
  ]);
  const price = verifiedPrice(venue);
  const anchor = compactVenueAnchor(venue);
  const canShowPrice = isPubVenue(venue) || anchor !== null;

  return {
    id: venue.id,
    name: venue.name,
    ...(venue.kind !== undefined ? { kind: venue.kind } : {}),
    typeLabel: venueKindLabel(venue.kind),
    boroughLabel: (venue.primaryBorough ?? "").trim(),
    priceLabel:
      price !== null && canShowPrice ? `£${price.toFixed(2)}` : null,
    anchor,
    distanceKm,
    distanceLabel: formatSuggestDistance(distanceKm, origin),
  };
}

/**
 * Everything the map search popup renders, derived once and hermetically
 * testable. Matches AREAS (the modelled Night Areas, then the Greater London
 * locality gazetteer, then boroughs that don't collide with either) and PUBS by
 * name, each carrying its distance from the viewer's position when granted, else
 * from the map centre — labelled honestly. Only modelled areas carry a coverage
 * chip; localities and boroughs are navigation targets, not coverage promises.
 *
 * When `places` is supplied and the query is two or more characters, UK places
 * from the national gazetteer join as a third group (same routing as
 * /choose-city). On a limited-coverage arrival, pass `includeLocalResults:
 * false` so emptied venues/localities do not leave an empty panel — places fill
 * the gap.
 *
 * An empty query returns the nearest few areas (a minimal, taste-first prompt)
 * and no pubs. A non-empty query with no match returns empty groups, so the
 * shell can show one honest "nothing matching" line rather than a dead panel.
 */
export function buildMapSearchSuggestions(input: MapSearchSuggestInput): MapSearchSuggestions {
  const { cityId, userLocation, mapCenter, now = new Date() } = input;
  const includeLocalResults = input.includeLocalResults !== false;
  const venues = includeLocalResults ? input.venues : [];
  const localities = includeLocalResults ? (input.localities ?? []) : [];
  const places = input.places ?? [];
  const pubLimit = input.pubLimit ?? SUGGEST_PUB_LIMIT;
  const query = normalize(input.query);
  const isEmptyQuery = query.length === 0;

  const origin: SuggestOrigin = userLocation ? "user" : "map-centre";
  const originPoint: [number, number] = userLocation
    ? [userLocation.lng, userLocation.lat]
    : mapCenter;

  const areaMatches: { tier: number; suggestion: AreaSuggestion }[] = [];
  const modelledLabels = new Set<string>();
  const shownLocalityLabels = new Set<string>();

  if (includeLocalResults) {
    const areas = getNightAreasForCity(cityId);
    for (const area of areas) {
      modelledLabels.add(normalize(area.name));
      for (const alias of area.aliases) modelledLabels.add(normalize(alias));
    }

    for (const area of areas) {
      // Empty query: every area is an equal-tier "nearby" candidate, ranked by
      // distance below. Typed query: keep only the ones that match.
      const tier = isEmptyQuery ? 1 : matchTier([area.name, ...area.aliases], query);
      if (tier === null) continue;
      const center: [number, number] = [area.centre.lng, area.centre.lat];
      const distanceKm = distanceKmFrom(originPoint, center);
      areaMatches.push({
        tier,
        suggestion: {
          key: `area:${area.slug}`,
          kind: "area",
          slug: area.slug,
          name: area.name,
          contextLabel: "",
          areaNewsArea: area.slug,
          center,
          distanceKm,
          distanceLabel: formatSuggestDistance(distanceKm, origin),
          coverage: areaCoverageLabel(area, now),
        },
      });
    }

    // Localities (public/data/london_localities.json) join only for a typed query
    // — the empty-query prompt stays to the modelled areas. A locality whose name
    // is already a modelled area (or one of its aliases) is dropped so search never
    // double-lists it; the curated area, with its coverage chip, wins. Localities
    // carry NO coverage — they are places to fly to, not coverage promises.
    if (!isEmptyQuery) {
      for (const locality of localities) {
        const label = normalize(locality.name);
        if (!label || modelledLabels.has(label) || shownLocalityLabels.has(label)) continue;
        const tier = matchTier([locality.name], query);
        if (tier === null) continue;
        if (!Number.isFinite(locality.lng) || !Number.isFinite(locality.lat)) continue;
        shownLocalityLabels.add(label);
        const center: [number, number] = [locality.lng, locality.lat];
        const distanceKm = distanceKmFrom(originPoint, center);
        areaMatches.push({
          tier,
          suggestion: {
            key: `locality:${slugify(locality.name)}`,
            kind: "locality",
            slug: `locality:${slugify(locality.name)}`,
            name: locality.name,
            contextLabel: locality.borough,
            areaNewsArea: slugifyBorough(locality.borough),
            center,
            flyZoom: LOCALITY_FLY_ZOOM,
            distanceKm,
            distanceLabel: formatSuggestDistance(distanceKm, origin),
            coverage: null,
          },
        });
      }
    }

    // Boroughs join only for a typed query (empty-query prompts stay to the
    // modelled areas). A borough whose name is already a modelled area (or one of
    // its aliases) is dropped so we never show "Camden" twice — the curated area,
    // with its real centre and coverage, wins.
    if (!isEmptyQuery) {
      for (const [name, info] of buildBoroughCentroids(venues)) {
        const label = normalize(name);
        // Drop a borough that collides with a modelled area (curated area wins) or
        // with a locality already shown (no "Bromley" twice — the locality centroid
        // is the finer target).
        if (modelledLabels.has(label) || shownLocalityLabels.has(label)) continue;
        const tier = matchTier([name], query);
        if (tier === null) continue;
        const distanceKm = distanceKmFrom(originPoint, info.center);
        areaMatches.push({
          tier,
          suggestion: {
            key: `borough:${slugify(name)}`,
            kind: "borough",
            slug: `borough:${slugify(name)}`,
            name,
            contextLabel: "",
            areaNewsArea: slugifyBorough(name),
            center: info.center,
            distanceKm,
            distanceLabel: formatSuggestDistance(distanceKm, origin),
            coverage: null,
          },
        });
      }
    }
  }

  const areaLimit = input.areaLimit ?? (isEmptyQuery ? SUGGEST_EMPTY_AREA_LIMIT : SUGGEST_AREA_LIMIT);
  const rankedAreas = areaMatches
    .sort(compareArea)
    .slice(0, Math.max(0, areaLimit))
    .map((entry) => entry.suggestion);

  const pubMatches: { tier: number; suggestion: PubSuggestion }[] = [];
  if (includeLocalResults && !isEmptyQuery) {
    const seen = new Set<string>();
    for (const venue of venues) {
      if (!venue.name || seen.has(venue.id)) continue;
      const tier = matchTier([venue.name], query);
      if (tier === null) continue;
      seen.add(venue.id);
      pubMatches.push({
        tier,
        suggestion: buildPubSuggestion(venue, originPoint, origin),
      });
    }
  }
  const rankedPubs = pubMatches
    .sort(comparePub)
    .slice(0, Math.max(0, pubLimit))
    .map((entry) => entry.suggestion);

  // National places join only for a typed query of two or more characters
  // (searchUkPlaces / chooser already enforce that). Names already shown as
  // local areas are dropped so Camden is not listed twice on a London map.
  const rankedPlaces =
    isEmptyQuery || places.length === 0
      ? []
      : buildMapPlaceSuggestions({
          query: input.query,
          places,
          excludedNames: rankedAreas.map((area) => area.name),
          currentCityId: cityId,
          userLocation,
          mapCenter,
          limit: input.placeLimit ?? SUGGEST_PLACE_LIMIT,
        });

  // Resident base pubs only (lib/ukBasePubSearch.ts). Curated venues keep the
  // Venues group; this is a separate "Pubs on the map" lane so an unpriced OSM
  // pin never masquerades as a priced product row.
  const rankedUkBasePubs = isEmptyQuery
    ? []
    : searchUkBasePubsByName({
        pubs: input.ukBasePubs ?? [],
        query: input.query,
        userLocation,
        mapCenter,
        limit: input.ukBasePubLimit ?? SUGGEST_UK_BASE_PUB_LIMIT,
      });

  return {
    origin,
    query,
    areas: rankedAreas,
    pubs: rankedPubs,
    places: rankedPlaces,
    ukBasePubs: rankedUkBasePubs,
    hasResults:
      rankedAreas.length > 0 ||
      rankedPubs.length > 0 ||
      rankedPlaces.length > 0 ||
      rankedUkBasePubs.length > 0,
    isEmptyQuery,
  };
}

