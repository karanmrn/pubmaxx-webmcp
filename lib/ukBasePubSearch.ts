// Name search over RESIDENT UK base pubs only.
//
// The country-wide pack is ~38k pubs. Search never opens that set: it matches
// against the shards already held in memory by useUkBaseStreaming (the padded
// viewport). A Sheffield drinker who has zoomed in can type a pub name; a
// session that never crossed the zoom gate pays zero and sees no base group.
//
// Kept hermetic and node-testable so MapSearchSuggest stays a thin render over
// these models (same house pattern as lib/mapSearchSuggest.ts).

import { haversineKm } from "@/lib/haversine";
import {
  formatSuggestDistance,
  type SuggestOrigin,
} from "@/lib/mapSearchSuggest";
import type { UkBasePub } from "@/lib/ukBasePubs";

/** Cap on the base-pub group. Tighter than the shard residency so a phone
 *  panel stays scannable even when a dense cell is loaded. */
export const SUGGEST_UK_BASE_PUB_LIMIT = 8;

/** Visible group head in MapSearchSuggest. Honest about residency: these are
 *  pubs the map is already carrying, not a national geocoder. */
export const UK_BASE_SEARCH_GROUP_LABEL = "Pubs on the map";

export type UkBasePubSuggestion = {
  id: string;
  name: string;
  /** OSM address when the pack had one; "" otherwise. Never invented. */
  address: string;
  distanceKm: number;
  distanceLabel: string;
  /** Whole record so selecting a row can open the unverified sheet without a
   *  second lookup (base pubs exist in no venue index). */
  pub: UkBasePub;
};

export type SearchUkBasePubsInput = {
  pubs: readonly UkBasePub[];
  query: string;
  userLocation: { lat: number; lng: number } | null;
  /** Live map centre [lng, lat] — the honest fallback origin. */
  mapCenter: [number, number];
  limit?: number;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Match tier of a query against a pub name:
 * 0 = whole-label exact, 1 = starts the name or one of its words, 2 = appears
 * inside (only for queries of two or more characters). null = no match.
 * Mirrors lib/mapSearchSuggest.ts so curated and base rows rank alike.
 */
function matchTier(name: string, query: string): number | null {
  const hay = normalize(name);
  if (!hay) return null;
  if (hay === query) return 0;
  if (hay.startsWith(query) || hay.split(" ").some((word) => word.startsWith(query))) {
    return 1;
  }
  if (query.length >= 2 && hay.includes(query)) return 2;
  return null;
}

function distanceKmFrom(origin: [number, number], point: [number, number]): number {
  if (![origin[0], origin[1], point[0], point[1]].every(Number.isFinite)) {
    return Number.NaN;
  }
  return haversineKm(origin, point);
}

function compareMatch(
  left: { tier: number; suggestion: UkBasePubSuggestion },
  right: { tier: number; suggestion: UkBasePubSuggestion },
): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  const leftKm = Number.isFinite(left.suggestion.distanceKm)
    ? left.suggestion.distanceKm
    : Infinity;
  const rightKm = Number.isFinite(right.suggestion.distanceKm)
    ? right.suggestion.distanceKm
    : Infinity;
  if (leftKm !== rightKm) return leftKm - rightKm;
  return (
    left.suggestion.name.localeCompare(right.suggestion.name) ||
    left.suggestion.id.localeCompare(right.suggestion.id)
  );
}

/**
 * Match resident UK base pubs by normalised name. Empty / whitespace query
 * returns []; callers that have loaded no shards pass [] and get []. Never
 * fetches, never walks the country-wide pack — only `pubs` already in hand.
 */
export function searchUkBasePubsByName(
  input: SearchUkBasePubsInput,
): UkBasePubSuggestion[] {
  const query = normalize(input.query);
  if (!query || input.pubs.length === 0) return [];

  const limit = input.limit ?? SUGGEST_UK_BASE_PUB_LIMIT;
  const origin: SuggestOrigin = input.userLocation ? "user" : "map-centre";
  const originPoint: [number, number] = input.userLocation
    ? [input.userLocation.lng, input.userLocation.lat]
    : input.mapCenter;

  const matches: { tier: number; suggestion: UkBasePubSuggestion }[] = [];
  const seen = new Set<string>();
  for (const pub of input.pubs) {
    if (!pub.name || seen.has(pub.id)) continue;
    const tier = matchTier(pub.name, query);
    if (tier === null) continue;
    seen.add(pub.id);
    const distanceKm = distanceKmFrom(originPoint, [pub.lng, pub.lat]);
    matches.push({
      tier,
      suggestion: {
        id: pub.id,
        name: pub.name,
        address: pub.address,
        distanceKm,
        distanceLabel: formatSuggestDistance(distanceKm, origin),
        pub,
      },
    });
  }

  return matches
    .sort(compareMatch)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.suggestion);
}
