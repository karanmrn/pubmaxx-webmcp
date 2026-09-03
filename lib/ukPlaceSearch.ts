import { enabledCityContainingPoint } from "@/lib/cities";
import {
  displayUkPlaceName,
  isPublishableUkPlaceName,
} from "@/lib/ukPlaceName.mjs";

export { isPublishableUkPlaceName };

export const UK_PLACE_INDEX_PATH = "/data/uk_base/places.json";

export type UkPlaceKind = "city" | "town" | "village" | "place" | "suburb";

export type UkPlace = {
  name: string;
  lat: number;
  lng: number;
  kind: UkPlaceKind;
  /** Postcode area where the source supplies one, used only to disambiguate. */
  context: string;
  /**
   * `normaliseUkPlaceQuery(name)`, derived once when the index is parsed.
   * Every keystroke filters and sorts 7.5k rows, so re-deriving it per compare
   * put hundreds of milliseconds of NFKD normalisation on the phone's main
   * thread for the first two characters typed.
   */
  search: string;
};

export type UkPlaceMapArrival = {
  name: string;
  lat: number;
  lng: number;
};

export const UK_PLACE_MAP_ZOOM = 12.5;

const UK_LNG_MIN = -8.7;
const UK_LNG_MAX = 1.9;
const UK_LAT_MIN = 49.8;
const UK_LAT_MAX = 61;
const KINDS = new Set<UkPlaceKind>(["city", "town", "village", "place", "suburb"]);
const KIND_RANK: Record<UkPlaceKind, number> = {
  city: 0,
  town: 1,
  village: 2,
  place: 3,
  suburb: 4,
};

function inUkBounds(lat: number, lng: number): boolean {
  return (
    lat >= UK_LAT_MIN &&
    lat <= UK_LAT_MAX &&
    lng >= UK_LNG_MIN &&
    lng <= UK_LNG_MAX
  );
}

export function normaliseUkPlaceQuery(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-GB");
}

export function parseUkPlaceIndex(raw: unknown): UkPlace[] {
  if (!raw || typeof raw !== "object") return [];
  const rows = (raw as { places?: unknown }).places;
  if (!Array.isArray(rows)) return [];
  const places: UkPlace[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    if (!Array.isArray(value) || value.length < 4 || value.length > 5) continue;
    const [rawName, rawLat, rawLng, rawKind, rawContext = ""] = value;
    if (
      typeof rawName !== "string" ||
      !isPublishableUkPlaceName(rawName) ||
      typeof rawLat !== "number" ||
      !Number.isFinite(rawLat) ||
      typeof rawLng !== "number" ||
      !Number.isFinite(rawLng) ||
      typeof rawKind !== "string" ||
      !KINDS.has(rawKind as UkPlaceKind) ||
      typeof rawContext !== "string" ||
      !inUkBounds(rawLat, rawLng)
    ) {
      continue;
    }
    const name = displayUkPlaceName(rawName);
    const context = rawContext.trim().slice(0, 8);
    const search = normaliseUkPlaceQuery(name);
    const key = `${search}\0${rawLat}\0${rawLng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      name,
      lat: rawLat,
      lng: rawLng,
      kind: rawKind as UkPlaceKind,
      context,
      search,
    });
  }
  return places;
}

function matchRank(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(" ").some((part) => part.startsWith(query))) return 2;
  return 3;
}

export function searchUkPlaces(
  query: string,
  places: readonly UkPlace[],
  excludedNames: readonly string[] = [],
  limit = 8,
): UkPlace[] {
  const normalizedQuery = normaliseUkPlaceQuery(query);
  if (normalizedQuery.length < 2 || limit <= 0) return [];
  const excluded = new Set(excludedNames.map(normaliseUkPlaceQuery));
  return places
    .filter(
      (place) =>
        !excluded.has(place.search) && place.search.includes(normalizedQuery),
    )
    .sort((left, right) => {
      return (
        matchRank(left.search, normalizedQuery) -
          matchRank(right.search, normalizedQuery) ||
        KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
        left.name.localeCompare(right.name, "en-GB") ||
        left.context.localeCompare(right.context, "en-GB") ||
        left.lat - right.lat ||
        left.lng - right.lng
      );
    })
    .slice(0, limit);
}

export function parseUkPlaceMapArrival(
  search: string | URLSearchParams,
): UkPlaceMapArrival | null {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const name = displayUkPlaceName(params.get("place") ?? "");
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (
    !isPublishableUkPlaceName(name) ||
    rawLat === null ||
    rawLng === null ||
    rawLat.trim() === "" ||
    rawLng.trim() === "" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !inUkBounds(lat, lng) ||
    // A point inside a curated city IS that city: answering it as an uncovered
    // place prints "no prices logged here yet" over live priced pins and
    // strips the chrome that does answer there.
    enabledCityContainingPoint(lat, lng) !== null
  ) {
    return null;
  }
  return { name, lat, lng };
}

export function ukPlaceMapUrl(place: UkPlaceMapArrival): string {
  const params = new URLSearchParams({
    place: place.name,
    lat: String(place.lat),
    lng: String(place.lng),
  });
  return `/map?${params.toString()}`;
}

export function ukPlaceMapView(
  arrival: UkPlaceMapArrival,
  cityView: { pitch?: number; bearing?: number },
): {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
} {
  return {
    center: [arrival.lng, arrival.lat],
    zoom: UK_PLACE_MAP_ZOOM,
    pitch: cityView.pitch ?? 0,
    bearing: cityView.bearing ?? 0,
  };
}
