// The ONE lat/lon box per city.
//
// Three readers need this table and cannot share a TypeScript module:
// lib/cities.ts builds CityConfig.bounds from it (and so the map's MapLibre
// maxBounds and every "is this point in a curated city" answer),
// scripts/fetch_city_osm_pubs.mjs queries or cuts each pack to it, and
// scripts/validate-data.mjs checks every shipped pack's pins against it.
//
// It lives here, once, because those three used to hold their own copies of the
// numbers: validation would then pass one box while the map clamped to another,
// and a pin could sit outside the map that is supposed to contain it. Plain ESM
// with no imports, the lib/pintIndexCanonical.mjs pattern, so a build script can
// load it without a build step.

/** @typedef {{ latMin: number, lonMin: number, latMax: number, lonMax: number }} CityBounds */

/** @type {Record<string, CityBounds>} */
export const CITY_BOUNDS = {
  london: { latMin: 51.28, lonMin: -0.55, latMax: 51.72, lonMax: 0.35 },
  manchester: { latMin: 53.38, lonMin: -2.35, latMax: 53.55, lonMax: -2.1 },
  liverpool: { latMin: 53.35, lonMin: -3.05, latMax: 53.48, lonMax: -2.85 },
  oxford: { latMin: 51.72, lonMin: -1.3, latMax: 51.8, lonMax: -1.2 },
  durham: { latMin: 54.76, lonMin: -1.6, latMax: 54.8, lonMax: -1.54 },
  glasgow: { latMin: 55.82, lonMin: -4.35, latMax: 55.9, lonMax: -4.15 },
  bristol: { latMin: 51.42, lonMin: -2.65, latMax: 51.5, lonMax: -2.52 },
  cambridge: { latMin: 52.18, lonMin: 0.08, latMax: 52.24, lonMax: 0.16 },
  bath: { latMin: 51.36, lonMin: -2.4, latMax: 51.4, lonMax: -2.32 },
  llandudno: { latMin: 53.25, lonMin: -3.87, latMax: 53.35, lonMax: -3.69 },
};

/**
 * The same box in Overpass order, `[south, west, north, east]`.
 *
 * @param {string} cityId
 * @returns {[number, number, number, number]}
 */
export function overpassBbox(cityId) {
  const bounds = CITY_BOUNDS[cityId];
  if (!bounds) throw new Error(`No bounds for city "${cityId}"`);
  return [bounds.latMin, bounds.lonMin, bounds.latMax, bounds.lonMax];
}
