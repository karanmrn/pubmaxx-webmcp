// Multi-city map configuration foundation.
// London stays the default flagship. Every city with a shipped OSM slim pack is
// enabled for browse; Manchester, Glasgow, Oxford, Liverpool, Cambridge,
// Durham, and Bristol also ship editorial landmarks/crawls/POIs.
//
// Which pack a city ships (and so whether it browses at all) comes from
// lib/cityVenuePacks.mjs, because the deployment config has to read the same
// list and cannot import TypeScript. A city's BOX comes from lib/cityBounds.mjs
// for the same reason: the pack builder and the data validator read it too.

import { CITY_BOUNDS, type CityBounds } from "@/lib/cityBounds.mjs";
import { CITY_VENUE_PACKS } from "@/lib/cityVenuePacks.mjs";

export type CityId =
  | "london"
  | "manchester"
  | "liverpool"
  | "oxford"
  | "durham"
  | "glasgow"
  | "bristol"
  | "cambridge"
  | "bath"
  | "llandudno";

export type { CityBounds };

export type CityMapView = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

export type CityConfig = {
  id: CityId;
  displayName: string;
  tagline: string;
  country: "england" | "scotland" | "wales";
  bounds: CityBounds;
  mapView: CityMapView;
  /** Browser-shipped slim venues path (London keeps existing path for back-compat) */
  slimVenuesPath: string;
  poisPath: string | null;
  transitLinesPath: string | null;
  lastRideLabel: string; // "Last Pint" | "Last Tram" | "Last Subway" | "Last Train"
  /** Browseable when a slim venue pack ships under public/data. */
  enabled: boolean;
};

const CITY_ID_SET = new Set<string>(Object.keys(CITY_VENUE_PACKS));

/** Shared cinematic tilt for every city map (matches London's opening camera). */
const DEFAULT_PITCH = 42;
const DEFAULT_BEARING = -12;

function city(
  partial: Omit<
    CityConfig,
    "mapView" | "slimVenuesPath" | "enabled" | "bounds"
  > & {
    mapView: Pick<CityMapView, "center" | "zoom"> &
      Partial<Pick<CityMapView, "pitch" | "bearing">>;
  },
): CityConfig {
  const { mapView, ...rest } = partial;
  const pack = CITY_VENUE_PACKS[partial.id];
  const bounds = CITY_BOUNDS[partial.id];
  if (!bounds) throw new Error(`No bounds for city "${partial.id}"`);
  return {
    ...rest,
    bounds,
    slimVenuesPath: pack?.slimVenuesPath ?? "",
    enabled: Boolean(pack?.enabled),
    mapView: {
      center: mapView.center,
      zoom: mapView.zoom,
      pitch: mapView.pitch ?? DEFAULT_PITCH,
      bearing: mapView.bearing ?? DEFAULT_BEARING,
    },
  };
}

export const CITIES: Record<CityId, CityConfig> = {
  london: city({
    id: "london",
    displayName: "London",
    tagline: "Price-aware crawls across the capital",
    country: "england",
    // Start at useful street-level context. The London button still exposes the
    // full-city overview, while granted location refines this to the local pub cloud.
    mapView: { center: [-0.12, 51.52], zoom: 12, pitch: 38, bearing: -8 },
    poisPath: "/data/london_pois.json",
    transitLinesPath: "/data/tfl_lines.json",
    lastRideLabel: "Last Pint",
  }),
  manchester: city({
    id: "manchester",
    displayName: "Manchester",
    tagline: "Northern Quarter rounds and city-centre crawls",
    country: "england",
    mapView: { center: [-2.24, 53.48], zoom: 11.2 },
    poisPath: "/data/cities/manchester/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Tram",
  }),
  liverpool: city({
    id: "liverpool",
    displayName: "Liverpool",
    tagline: "Waterfront crawls and Merseyrail nights",
    country: "england",
    mapView: { center: [-2.98, 53.41], zoom: 11.4 },
    poisPath: "/data/cities/liverpool/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Train",
  }),
  oxford: city({
    id: "oxford",
    displayName: "Oxford",
    tagline: "College-town pints and riverside walks",
    country: "england",
    mapView: { center: [-1.26, 51.75], zoom: 12.2 },
    poisPath: "/data/cities/oxford/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Train",
  }),
  durham: city({
    id: "durham",
    displayName: "Durham",
    tagline: "Cathedral-city snugs on a compact map",
    country: "england",
    mapView: { center: [-1.575, 54.78], zoom: 13 },
    poisPath: "/data/cities/durham/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Train",
  }),
  glasgow: city({
    id: "glasgow",
    displayName: "Glasgow",
    tagline: "West End crawls and Subway nights",
    country: "scotland",
    mapView: { center: [-4.25, 55.86], zoom: 11.5 },
    poisPath: "/data/cities/glasgow/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Subway",
  }),
  bristol: city({
    id: "bristol",
    displayName: "Bristol",
    tagline: "Harbour-side rounds and hillside pubs",
    country: "england",
    mapView: { center: [-2.59, 51.45], zoom: 11.8 },
    poisPath: "/data/cities/bristol/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Train",
  }),
  cambridge: city({
    id: "cambridge",
    displayName: "Cambridge",
    tagline: "Back-lane pubs and riverside college crawls",
    country: "england",
    mapView: { center: [0.12, 52.205], zoom: 12.4 },
    poisPath: "/data/cities/cambridge/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Train",
  }),
  bath: city({
    id: "bath",
    displayName: "Bath",
    tagline: "Georgian streets and spa-city snugs",
    country: "england",
    mapView: { center: [-2.36, 51.38], zoom: 12.8 },
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
  }),
  // One stretch of the North Wales coast rather than one town: Llandudno and
  // the Great Orme, Deganwy and Llandudno Junction, Conwy, Rhos-on-Sea and
  // Colwyn Bay. Each pin carries the town OSM states for it, so a Conwy pub is
  // never labelled Llandudno. Searching Conwy or Colwyn Bay lands on this same
  // map, because a place inside a curated city IS that city.
  llandudno: city({
    id: "llandudno",
    displayName: "Llandudno",
    tagline: "Seafront pubs from the Great Orme to Colwyn Bay",
    country: "wales",
    mapView: { center: [-3.78, 53.3], zoom: 11.6 },
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
  }),
};

export const DEFAULT_CITY_ID: CityId = "london";

export function parseCityId(raw: string | null | undefined): CityId | null {
  if (raw == null) return null;
  const id = raw.trim().toLowerCase();
  return CITY_ID_SET.has(id) ? (id as CityId) : null;
}

export function getCity(id: string | null | undefined): CityConfig {
  return CITIES[parseCityId(id) ?? DEFAULT_CITY_ID];
}

export function listEnabledCities(): CityConfig[] {
  return Object.keys(CITY_VENUE_PACKS)
    .map((id) => CITIES[id as CityId])
    .filter((city): city is CityConfig => Boolean(city?.enabled));
}

export function pointInCityBounds(
  lat: number,
  lng: number,
  cityConfig: CityConfig,
): boolean {
  const { latMin, latMax, lonMin, lonMax } = cityConfig.bounds;
  return lat >= latMin && lat <= latMax && lng >= lonMin && lng <= lonMax;
}

/**
 * The enabled curated city whose bounds contain a point, or null. A place
 * inside a curated city IS that city: it already has priced pins, crawls and
 * the rest of the city chrome, so it may never be presented as uncovered.
 */
export function enabledCityContainingPoint(
  lat: number,
  lng: number,
): CityConfig | null {
  return (
    listEnabledCities().find((city) => pointInCityBounds(lat, lng, city)) ?? null
  );
}

/** MapLibre `maxBounds` tuple from a city's lat/lon box. */
export function cityMaxBounds(
  cityConfig: CityConfig,
): [[number, number], [number, number]] {
  const { lonMin, latMin, lonMax, latMax } = cityConfig.bounds;
  return [
    [lonMin, latMin],
    [lonMax, latMax],
  ];
}
