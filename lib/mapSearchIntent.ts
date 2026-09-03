// Classify a map search query as borough / city / area / UK place / venue.
// Pure and hermetic so MapSearchSuggest and GET /api/map-search share one brain.

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { listEnabledCities } from "@/lib/cities";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { normaliseUkPlaceQuery } from "@/lib/ukPlaceSearch";

export type MapSearchIntentKind =
  | "borough"
  | "city"
  | "area"
  | "uk_place"
  | "venue"
  | "unknown";

export type MapSearchIntentCandidate = {
  kind: MapSearchIntentKind;
  /** Display label for the matched geo entity, or "" for venue/unknown. */
  label: string;
  /** 0 = strongest. */
  score: number;
};

export type MapSearchIntent = {
  query: string;
  primary: MapSearchIntentKind;
  candidates: MapSearchIntentCandidate[];
};

const VENUE_HINT =
  /\b(the|arms|inn|tavern|hotel|bar|pub|brewery|taproom|tap\s*room|alehouse|wine|club|house)\b/i;

function normalize(value: string): string {
  return normaliseUkPlaceQuery(value);
}

function matchTier(haystack: string, query: string): number | null {
  if (!haystack || !query) return null;
  if (haystack === query) return 0;
  if (haystack.startsWith(query) || haystack.split(" ").some((word) => word.startsWith(query))) {
    return 1;
  }
  if (query.length >= 3 && haystack.includes(query)) return 2;
  return null;
}

/**
 * Ranked intent candidates for a free-text map query. Empty / tiny queries
 * resolve to `unknown` so the panel can keep its empty-state nearby areas.
 */
export function classifyMapSearchIntent(rawQuery: string): MapSearchIntent {
  const query = normalize(rawQuery);
  if (query.length < 2) {
    return { query, primary: "unknown", candidates: [] };
  }

  const candidates: MapSearchIntentCandidate[] = [];

  for (const city of listEnabledCities()) {
    const tier = matchTier(normalize(city.displayName), query);
    if (tier === null) continue;
    candidates.push({
      kind: "city",
      label: city.displayName,
      score: tier,
    });
  }

  for (const borough of LONDON_BOROUGHS) {
    const tier = matchTier(normalize(borough), query);
    if (tier === null) continue;
    candidates.push({
      kind: "borough",
      label: borough,
      score: tier,
    });
  }

  for (const area of getNightAreasForCity("london")) {
    const tier = matchTier(normalize(area.name), query);
    if (tier === null) continue;
    candidates.push({
      kind: "area",
      label: area.name,
      score: tier,
    });
  }

  // Venue hints bump venue even when a soft geo substring also matched.
  if (VENUE_HINT.test(rawQuery) || query.length >= 4) {
    const venueScore = VENUE_HINT.test(rawQuery) ? 0 : 3;
    candidates.push({ kind: "venue", label: "", score: venueScore });
  }

  if (candidates.length === 0) {
    return {
      query,
      primary: "unknown",
      candidates: [{ kind: "unknown", label: "", score: 9 }],
    };
  }

  candidates.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    const rank = (kind: MapSearchIntentKind): number => {
      switch (kind) {
        case "borough":
          return 0;
        case "area":
          return 1;
        case "city":
          return 2;
        case "uk_place":
          return 3;
        case "venue":
          return 4;
        default:
          return 5;
      }
    };
    return rank(left.kind) - rank(right.kind);
  });

  // Prefer an exact geo match over a generic venue bucket.
  const exactGeo = candidates.find(
    (row) =>
      row.score === 0 &&
      (row.kind === "borough" || row.kind === "area" || row.kind === "city"),
  );
  const primary = exactGeo?.kind ?? candidates[0]!.kind;

  return { query, primary, candidates };
}

export function intentLooksLikeVenueSearch(intent: MapSearchIntent): boolean {
  if (intent.primary === "venue") return true;
  if (intent.primary === "unknown" && intent.query.length >= 3) return true;
  // Soft geo match still often wants pub names ("Hackney Arms").
  return intent.candidates.some((row) => row.kind === "venue" && row.score <= 1);
}
