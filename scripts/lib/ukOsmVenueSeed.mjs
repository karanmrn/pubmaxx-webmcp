/**
 * The UK-wide OSM venue taxonomy: what a "place to drink, eat or work" is in
 * OpenStreetMap tags, which PubMaxing venue kind each one becomes, and the
 * Overpass query that asks for it.
 *
 * This is the widening of `scripts/lib/ukOsmSeed.mjs`, which asks for
 * `amenity=pub` alone. The grid, the UK area clip, the retry contract and the
 * curated overlap rules are unchanged and still live there: this module owns
 * ONLY the taxonomy and the per-group query. A group is what one Overpass
 * request asks for, so a heavy lane timing out cannot lose the lane beside it.
 *
 * THE RULE this table encodes: a row exists because OSM STATES the thing.
 * `restaurant` is not a drinking venue, so only a restaurant that states a bar,
 * a microbrewery or real ale is taken; `fast_food` is not a night venue, so only
 * one that states alcohol or 24/7 hours is taken. Nothing is inferred from a
 * name, a chain or a postcode.
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import { normalizeOsmVenueElement, sortOsmPubs } from "./osmPubNormalizer.mjs";

/** @typedef {[number, number, number, number]} Bbox south,west,north,east */

/**
 * One taxonomy row. `selectors` are Overpass tag filters; an element matching
 * ANY of them is that row. Rows are evaluated in table order and the FIRST
 * match wins, so a pub that also sells bottles to take away stays a pub.
 *
 * @typedef {{ key: string, kind: string, group: string, selectors: string[], match: (tags: Record<string, string>) => boolean, note: string }} TaxonomyRow
 */

const yes = (value) => value === "yes";

/** @type {TaxonomyRow[]} */
export const UK_VENUE_TAXONOMY = [
  {
    key: "pub",
    kind: "pub",
    group: "drink",
    selectors: ['["amenity"="pub"]'],
    match: (tags) => tags.amenity === "pub",
    note: "amenity=pub - the layer the pub pack already carries",
  },
  {
    key: "bar",
    kind: "bar",
    group: "drink",
    selectors: ['["amenity"="bar"]'],
    match: (tags) => tags.amenity === "bar",
    note: "amenity=bar",
  },
  {
    key: "biergarten",
    kind: "bar",
    group: "drink",
    selectors: ['["amenity"="biergarten"]'],
    match: (tags) => tags.amenity === "biergarten",
    note: "amenity=biergarten",
  },
  {
    key: "restaurant_bar",
    kind: "restaurant",
    group: "drink",
    selectors: [
      '["amenity"="restaurant"]["bar"="yes"]',
      '["amenity"="restaurant"]["microbrewery"="yes"]',
      '["amenity"="restaurant"]["real_ale"~"^(yes|only|sometimes)$"]',
    ],
    match: (tags) =>
      tags.amenity === "restaurant" &&
      (yes(tags.bar) ||
        yes(tags.microbrewery) ||
        ["yes", "only", "sometimes"].includes(tags.real_ale ?? "")),
    note: "amenity=restaurant only where OSM states a bar, a microbrewery or real ale",
  },
  {
    key: "hotel_bar",
    kind: "hotel_lounge",
    group: "drink",
    selectors: ['["tourism"="hotel"]["bar"="yes"]'],
    match: (tags) => tags.tourism === "hotel" && yes(tags.bar),
    note: "tourism=hotel only where OSM states a bar; a hotel with no stated bar is not a lounge",
  },
  {
    key: "off_licence",
    kind: "other",
    group: "drink",
    selectors: ['["shop"="alcohol"]', '["shop"="off_licence"]'],
    match: (tags) => tags.shop === "alcohol" || tags.shop === "off_licence",
    note: "shop=alcohol / shop=off_licence",
  },
  {
    key: "cafe",
    kind: "cafe",
    group: "food",
    selectors: ['["amenity"="cafe"]'],
    match: (tags) => tags.amenity === "cafe",
    note: "amenity=cafe",
  },
  {
    key: "coffee_shop",
    kind: "cafe",
    group: "food",
    selectors: ['["shop"="coffee"]'],
    match: (tags) => tags.shop === "coffee",
    note: "shop=coffee - the roaster-counter half of a coffee shop",
  },
  {
    key: "late_fast_food",
    kind: "food",
    group: "food",
    selectors: [
      '["amenity"="fast_food"]["alcohol"~"^(yes|served)$"]',
      '["amenity"="fast_food"]["opening_hours"="24/7"]',
    ],
    match: (tags) =>
      tags.amenity === "fast_food" &&
      (["yes", "served"].includes(tags.alcohol ?? "") || tags.opening_hours === "24/7"),
    note: "amenity=fast_food only where OSM states alcohol or 24/7 hours - never inferred from a name",
  },
  {
    key: "coworking",
    kind: "coworking",
    group: "work",
    selectors: ['["amenity"="coworking_space"]', '["office"="coworking"]'],
    match: (tags) => tags.amenity === "coworking_space" || tags.office === "coworking",
    note: "amenity=coworking_space / office=coworking",
  },
  {
    key: "library",
    kind: "library",
    group: "work",
    selectors: ['["amenity"="library"]'],
    match: (tags) => tags.amenity === "library",
    note: "amenity=library",
  },
  {
    key: "community_centre_wifi",
    kind: "other",
    group: "work",
    selectors: ['["amenity"="community_centre"]["internet_access"~"^(wlan|yes|wired|terminal)$"]'],
    match: (tags) =>
      tags.amenity === "community_centre" &&
      ["wlan", "yes", "wired", "terminal"].includes(tags.internet_access ?? ""),
    note: "amenity=community_centre only where OSM states internet access",
  },
];

/** The pack groups. A pack is one file per group, so a group is the unit the
 * 100 MiB commit budget is split on. */
export const UK_VENUE_GROUPS = ["drink", "food", "work"];

/**
 * What ONE Overpass request asks for. `all` is the default and the whole
 * taxonomy: the grid contract is 132 chunks, and asking three times per cell
 * tripled the requests against public mirrors that were already answering 504,
 * which turned a 2 hour pull into a day of backoff. A group name is still
 * accepted so a cell that fails as a whole can be retried one lane at a time.
 */
export const UK_VENUE_QUERY_SCOPES = ["all", ...UK_VENUE_GROUPS];

/** Every venue kind this taxonomy can produce. */
export const UK_VENUE_KINDS = [...new Set(UK_VENUE_TAXONOMY.map((row) => row.kind))].sort();

/** @param {string} scope a pack group, or `all` for the whole taxonomy */
export function taxonomyForScope(scope) {
  if (scope === "all") return [...UK_VENUE_TAXONOMY];
  const rows = UK_VENUE_TAXONOMY.filter((row) => row.group === scope);
  if (rows.length === 0) throw new Error(`Unknown venue scope "${scope}"`);
  return rows;
}

/**
 * Classify a raw Overpass element against the taxonomy. Returns null when
 * nothing in the table claims it - an element only a neighbouring group's
 * selector matched, or a way whose tags came back thinner than the filter.
 *
 * @param {Record<string, string> | undefined} tags
 * @returns {TaxonomyRow | null}
 */
export function classifyVenueTags(tags) {
  if (!tags) return null;
  for (const row of UK_VENUE_TAXONOMY) {
    if (row.match(tags)) return row;
  }
  return null;
}

const UK_AREA_ID = 3_600_062_149;

function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Overpass QL for one grid cell and one query scope, clipped to the UK area
 * relation exactly as the pub query is.
 *
 * @param {Bbox} bbox
 * @param {string} [scope]
 * @param {{ timeout?: number }} [options]
 */
export function buildUkVenueQuery(bbox, scope = "all", { timeout = 90 } = {}) {
  const box = bbox.map((n) => roundCoord(n)).join(",");
  const lines = [];
  for (const row of taxonomyForScope(scope)) {
    for (const selector of row.selectors) {
      lines.push(`  node${selector}(area.uk)(${box});`);
      lines.push(`  way${selector}(area.uk)(${box});`);
    }
  }
  return `
[out:json][timeout:${timeout}];
area(id:${UK_AREA_ID})->.uk;
(
${lines.join("\n")}
);
out center tags;
`.trim();
}

/**
 * Normalize raw Overpass elements from any number of chunks into one sorted,
 * OSM-id-unique venue list carrying its kind.
 *
 * An element the taxonomy does not claim is dropped and counted, because a
 * silent drop is how a selector change stops covering a lane without anything
 * saying so.
 *
 * @param {Iterable<any>} elements
 * @returns {{ venues: Array<Record<string, any>>, unclassified: number, unnamed: number }}
 */
export function normalizeVenueElements(elements) {
  const byOsmId = new Map();
  let unclassified = 0;
  let unnamed = 0;
  for (const element of elements) {
    const row = classifyVenueTags(element?.tags);
    if (!row) {
      unclassified += 1;
      continue;
    }
    const venue = normalizeOsmVenueElement(element, { kind: row.kind, taxonomyKey: row.key });
    if (!venue) {
      unnamed += 1;
      continue;
    }
    if (byOsmId.has(venue.osmId)) continue; // shared cell edges return duplicates
    byOsmId.set(venue.osmId, venue);
  }
  return { venues: sortOsmPubs([...byOsmId.values()]), unclassified, unnamed };
}

/**
 * Count venues by kind and by taxonomy key.
 * @param {Array<Record<string, any>>} venues
 */
export function countVenues(venues) {
  /** @type {Record<string, number>} */
  const byKind = {};
  /** @type {Record<string, number>} */
  const byTaxonomyKey = {};
  for (const venue of venues) {
    byKind[venue.kind] = (byKind[venue.kind] ?? 0) + 1;
    byTaxonomyKey[venue.taxonomyKey] = (byTaxonomyKey[venue.taxonomyKey] ?? 0) + 1;
  }
  return { byKind, byTaxonomyKey };
}
