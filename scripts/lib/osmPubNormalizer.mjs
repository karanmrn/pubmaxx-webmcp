/**
 * Canonical normalizer for raw OpenStreetMap pub/bar elements.
 *
 * City, London borough, and UK-wide seed builders consume this module so field
 * retention cannot drift between data packs.
 */

/**
 * The locality OSM states for a pub, in the order the UK place index already
 * reads them (scripts/lib/ukPlaceIndex.mjs). This is the pub's OWN word for
 * where it is, so a pack covering more than one town can label each pin with
 * its town instead of the pack's name. Null when OSM states none — never
 * guessed from the postcode or from which pack found the pub.
 *
 * @param {Record<string, string> | undefined} tags
 */
function readLocality(tags) {
  if (!tags) return null;
  for (const key of ["addr:city", "addr:town", "addr:village", "addr:place", "addr:suburb"]) {
    const value = typeof tags[key] === "string" ? tags[key].trim() : "";
    if (value) return value;
  }
  return null;
}

/**
 * @param {Record<string, string> | undefined} tags
 * @param {string | null} fallbackCity
 */
function buildAddress(tags, fallbackCity) {
  if (!tags) return fallbackCity;
  const parts = [];
  if (tags["addr:housenumber"]) parts.push(tags["addr:housenumber"]);
  if (tags["addr:street"]) parts.push(tags["addr:street"]);
  const city = tags["addr:city"] || fallbackCity;
  if (city) parts.push(city);
  if (tags["addr:postcode"]) parts.push(tags["addr:postcode"]);
  return parts.join(", ") || fallbackCity;
}

/**
 * Keep every `smoking` and `smoking:*` tag verbatim. OSM uses values such as
 * `outside`, `isolated`, and `separated`, so reducing these to a boolean would
 * discard information needed by a future filter.
 *
 * @param {Record<string, string>} tags
 */
function collectSmokingTags(tags) {
  const smoking = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key === "smoking" || key.startsWith("smoking:")) smoking[key] = value;
  }
  return Object.keys(smoking).length > 0 ? smoking : null;
}

/**
 * @param {any} element raw Overpass node/way with tags and coordinates
 * @param {{ fallbackCity?: string | null }} [options]
 * @returns {Record<string, unknown> | null}
 */
export function normalizeOsmPubElement(element, { fallbackCity = null } = {}) {
  const tags = element?.tags ?? {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!name) return null;

  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    osmId: `${element.type}/${element.id}`,
    name,
    amenity: typeof tags.amenity === "string" ? tags.amenity : null,
    lat,
    lng,
    address: buildAddress(tags, fallbackCity),
    locality: readLocality(tags),
    postcode: tags["addr:postcode"] || null,
    website: tags.website || tags["contact:website"] || null,
    phone: tags.phone || tags["contact:phone"] || null,
    openingHours: tags.opening_hours || null,
    brewery: tags.brewery || null,
    operator: tags.operator || null,
    outdoorSeating: tags.outdoor_seating === "yes",
    smoking: collectSmokingTags(tags),
    cuisine: tags.cuisine || null,
    wikidata: tags.wikidata || null,
    wikipedia: tags.wikipedia || null,
  };
}

/**
 * Tags the work-spot vertical needs and a pub pack never carried. Kept as a
 * table so the UK venue pack and any later reader agree on what was retained,
 * and so a tag OSM does not state stays absent rather than becoming a guessed
 * default. `laptop` / `laptop_friendly` are not approved OSM keys, so they are
 * read only when a mapper has stated one.
 */
const WORK_SPOT_TAGS = /** @type {const} */ ([
  ["internetAccess", "internet_access"],
  ["internetAccessFee", "internet_access:fee"],
  ["internetAccessSsid", "internet_access:ssid"],
  ["wheelchair", "wheelchair"],
  ["capacity", "capacity"],
  ["brand", "brand"],
  ["laptop", "laptop"],
  ["laptopFriendly", "laptop_friendly"],
  ["takeaway", "takeaway"],
  ["food", "food"],
  ["alcohol", "alcohol"],
]);

function readWorkSpotTags(tags) {
  /** @type {Record<string, string>} */
  const extra = {};
  for (const [field, key] of WORK_SPOT_TAGS) {
    const value = typeof tags[key] === "string" ? tags[key].trim() : "";
    if (value) extra[field] = value;
  }
  return extra;
}

/**
 * Normalize any OSM venue element the UK venue pack covers - a pub, a cafe, a
 * library, a coworking desk - onto the pub contract plus the work-spot tags.
 *
 * The pub fields are produced by `normalizeOsmPubElement` itself rather than
 * restated here, so a pub row from this function and a pub row from the pub
 * pack cannot drift. `kind` and `taxonomyKey` are what the caller decided the
 * element is; this function never guesses them from the tags.
 *
 * @param {any} element raw Overpass node/way with tags and coordinates
 * @param {{ kind: string, taxonomyKey: string, fallbackCity?: string | null }} options
 * @returns {Record<string, unknown> | null}
 */
export function normalizeOsmVenueElement(element, { kind, taxonomyKey, fallbackCity = null }) {
  const base = normalizeOsmPubElement(element, { fallbackCity });
  if (!base) return null;
  const tags = element?.tags ?? {};
  return {
    ...base,
    kind,
    taxonomyKey,
    shop: typeof tags.shop === "string" ? tags.shop : null,
    tourism: typeof tags.tourism === "string" ? tags.tourism : null,
    office: typeof tags.office === "string" ? tags.office : null,
    ...readWorkSpotTags(tags),
  };
}

/**
 * Sort normalized OSM pubs by stable geographic and identity keys.
 *
 * @param {Array<Record<string, any>>} pubs
 */
export function sortOsmPubs(pubs) {
  pubs.sort(
    (a, b) =>
      a.lat - b.lat ||
      a.lng - b.lng ||
      String(a.name).localeCompare(String(b.name)) ||
      String(a.osmId).localeCompare(String(b.osmId)),
  );
  return pubs;
}
