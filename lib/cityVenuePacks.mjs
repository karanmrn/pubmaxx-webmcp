// Which slim venue pack each city ships, and therefore which cities browse.
//
// Two readers need this table and cannot share a TypeScript module: lib/cities.ts
// builds the app's CityConfig from it, and next.config.mjs reads it while Next
// loads the config, through lib/venueIndexTracing.mjs, where these files are the
// venue-index pack, because every route reaching lib/venueIndex.ts resolves
// venue names at REQUEST time and opens its city's pack. Next traces
// only paths it can see statically, so a path built at request time from this
// config is traced nowhere and whether the file is in the function is an accident
// of lambda grouping — the same defect that made the freshness cron report every
// feed as "unknown" (lib/freshnessTracing.mjs).
//
// So the table lives here, once, rather than being hand-copied into the config:
// a city cannot be browseable in the app and missing from the deployed function.
// The ROUTES that get these files are derived from the import graph rather than
// listed, so a new reader needs nothing here. Plain ESM with no imports so the
// config can load it; the app reads it through lib/cities.ts.
// __tests__/venueIndexTracing.test.ts pins the derivation and
// __tests__/feedTracing.test.ts the /feed pair.

/** @typedef {{ slimVenuesPath: string, enabled: boolean }} CityVenuePack */

/** @type {Record<string, CityVenuePack>} */
export const CITY_VENUE_PACKS = {
  // London keeps the original un-nested path for back-compat.
  london: { slimVenuesPath: "/data/venues_slim.json", enabled: true },
  manchester: { slimVenuesPath: "/data/cities/manchester/venues_slim.json", enabled: true },
  liverpool: { slimVenuesPath: "/data/cities/liverpool/venues_slim.json", enabled: true },
  oxford: { slimVenuesPath: "/data/cities/oxford/venues_slim.json", enabled: true },
  durham: { slimVenuesPath: "/data/cities/durham/venues_slim.json", enabled: true },
  glasgow: { slimVenuesPath: "/data/cities/glasgow/venues_slim.json", enabled: true },
  bristol: { slimVenuesPath: "/data/cities/bristol/venues_slim.json", enabled: true },
  cambridge: { slimVenuesPath: "/data/cities/cambridge/venues_slim.json", enabled: true },
  bath: { slimVenuesPath: "/data/cities/bath/venues_slim.json", enabled: true },
  llandudno: { slimVenuesPath: "/data/cities/llandudno/venues_slim.json", enabled: true },
};

/**
 * The venue packs a request-time venue lookup can open, as `./`-relative paths
 * for Next's outputFileTracingIncludes. Disabled cities are never read, so they
 * are never shipped.
 *
 * @returns {string[]}
 */
export function enabledVenuePackIncludes() {
  return Object.values(CITY_VENUE_PACKS)
    .filter((pack) => pack.enabled)
    .map((pack) => `./public${pack.slimVenuesPath}`);
}

/**
 * The cities the last-ride routes (`/api/last-tram`, `/api/last-merseyrail`,
 * `/api/last-subway`) name when they ask lib/lastRideRoute.ts for the pubs
 * around a stop. __tests__/lastRideRoute.test.ts proves each route really
 * reaches the pack of the city listed here.
 *
 * @type {readonly string[]}
 */
export const LAST_RIDE_CITY_IDS = ["manchester", "liverpool", "glasgow"];

/**
 * The packs of NAMED cities, for a reader that opens one city rather than every
 * enabled one. Taken from the same table, so a moved pack path follows.
 *
 * @param {readonly string[]} cityIds
 * @returns {string[]}
 */
export function venuePackIncludesFor(cityIds) {
  return cityIds.map((cityId) => {
    const pack = CITY_VENUE_PACKS[cityId];
    if (!pack) throw new Error(`Unknown city venue pack: ${cityId}`);
    return `./public${pack.slimVenuesPath}`;
  });
}
