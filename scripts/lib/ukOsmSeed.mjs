/**
 * Pure helpers for the UK-wide (Great Britain + Northern Ireland) OSM pub seed
 * packs. Kept out of scripts/fetch_uk_osm_pubs.mjs so the grid maths,
 * normalization and curated-dedupe rules are unit-testable without network or
 * filesystem access. Mirrors the taxonomy of scripts/fetch_city_osm_pubs.mjs
 * (amenity=pub, nodes + ways, `out center`).
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import {
  normalizeOsmPubElement,
  sortOsmPubs,
} from "./osmPubNormalizer.mjs";
import { haversineMeters } from "./geo.mjs";
import { normalisePubName } from "./venueMatch.mjs";

export { haversineMeters };

/** Bounding box of the United Kingdom, [south, west, north, east] (Overpass order).
 * West reaches St Kilda (-8.58), north Out Stack (60.86), east Lowestoft (1.76),
 * south the Isles of Scilly (49.86); padded to whole/half degrees. */
export const UK_BBOX = [49.8, -8.7, 61.0, 1.9];

/** OSM relation 62149 = United Kingdom (ISO3166-1 GB). Overpass area ids are
 * relation id + 3600000000. The area filter is what keeps the Republic of
 * Ireland, the Isle of Man and the Channel Islands out of grid cells that
 * straddle a border - a bbox alone cannot. */
export const UK_AREA_ID = 3_600_062_149;

export const DEFAULT_LAT_STEP = 1;
export const DEFAULT_LON_STEP = 1;

/** Amenity values pulled into the UK packs. Pubs only: bars are a London-seed
 * concern (data/osm/outer_london_osm_pubs.json) and would roughly double the
 * pack for venues the UK wave does not yet claim. */
export const UK_TAXONOMY = ["amenity=pub"];

/** Two pubs this close with the same normalized name are the same pub. Curated
 * London coordinates come from a different source than OSM, so they disagree by
 * a building's width, not by a street. */
export const CURATED_MATCH_RADIUS_M = 150;

/** @typedef {[number, number, number, number]} Bbox south,west,north,east */
/** @typedef {{ id: string, bbox: Bbox, row: number, col: number }} GridChunk */

function roundCoord(value) {
  // Grid steps are decimal degrees; float accumulation would otherwise produce
  // 51.900000000000006 in chunk ids and query strings.
  return Math.round(value * 1e6) / 1e6;
}

function formatCoord(value) {
  return roundCoord(value).toFixed(2);
}

/**
 * Split a bbox into a regular lat/lon grid. Cells are half-open in intent but
 * Overpass bboxes are inclusive on every edge, so elements sitting exactly on a
 * shared edge come back in both neighbours - normalizeElements dedupes by OSM id.
 *
 * @param {{ bbox?: Bbox, latStep?: number, lonStep?: number }} [options]
 * @returns {GridChunk[]}
 */
export function buildGrid({ bbox = UK_BBOX, latStep = DEFAULT_LAT_STEP, lonStep = DEFAULT_LON_STEP } = {}) {
  if (!(latStep > 0) || !(lonStep > 0)) throw new Error("grid steps must be positive");
  const [south, west, north, east] = bbox;
  const chunks = [];
  let row = 0;
  for (let lat = south; lat < north - 1e-9; lat = roundCoord(lat + latStep), row += 1) {
    let col = 0;
    for (let lon = west; lon < east - 1e-9; lon = roundCoord(lon + lonStep), col += 1) {
      const cell = /** @type {Bbox} */ ([
        roundCoord(lat),
        roundCoord(lon),
        roundCoord(Math.min(lat + latStep, north)),
        roundCoord(Math.min(lon + lonStep, east)),
      ]);
      chunks.push({ id: chunkId(cell), bbox: cell, row, col });
    }
  }
  return chunks;
}

/** Stable, human-readable chunk id from its south-west corner. */
export function chunkId(bbox) {
  return `lat${formatCoord(bbox[0])}_lon${formatCoord(bbox[1])}`;
}

export function chunkFileName(chunk) {
  return `chunk_${chunk.id}.json`;
}

/**
 * Overpass QL for one grid cell: UK-area-clipped amenity=pub nodes and ways.
 * `out center` gives ways a representative point without full geometry.
 * @param {Bbox} bbox
 * @param {{ timeout?: number }} [options]
 */
export function buildUkOverpassQuery(bbox, { timeout = 90 } = {}) {
  const box = bbox.map((n) => roundCoord(n)).join(",");
  return `
[out:json][timeout:${timeout}];
area(id:${UK_AREA_ID})->.uk;
(
  node["amenity"="pub"](area.uk)(${box});
  way["amenity"="pub"](area.uk)(${box});
);
out center tags;
`.trim();
}

/**
 * Normalize raw Overpass elements from any number of chunks into one sorted,
 * OSM-id-unique pub list.
 * @param {Iterable<any>} elements
 */
export function normalizeElements(elements) {
  const byOsmId = new Map();
  for (const element of elements) {
    const pub = normalizeOsmPubElement(element);
    if (!pub) continue;
    if (byOsmId.has(pub.osmId)) continue; // shared cell edges return duplicates
    byOsmId.set(pub.osmId, pub);
  }
  const pubs = [...byOsmId.values()];
  return sortOsmPubs(pubs);
}

// ~0.01° ≈ 1.1 km of latitude: one cell plus its 8 neighbours always contains
// everything within CURATED_MATCH_RADIUS_M.
const INDEX_CELL_DEG = 0.01;

function cellKey(lat, lng) {
  return `${Math.floor(lat / INDEX_CELL_DEG)}:${Math.floor(lng / INDEX_CELL_DEG)}`;
}

/**
 * @typedef {{ source: string, id: string, name: string, lat: number, lng: number, osmId?: string | null }} CuratedEntry
 */

/**
 * Index curated/existing venues for overlap detection: exact OSM id first, then
 * normalized name within CURATED_MATCH_RADIUS_M (the curated London dataset has
 * no OSM ids at all, so name+distance is the only key it can be matched on).
 * @param {CuratedEntry[]} entries
 */
export function buildCuratedIndex(entries) {
  const byOsmId = new Map();
  const byCell = new Map();
  for (const entry of entries) {
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) continue;
    if (entry.osmId && !byOsmId.has(entry.osmId)) byOsmId.set(entry.osmId, entry);
    const key = cellKey(entry.lat, entry.lng);
    const bucket = byCell.get(key);
    const indexed = { ...entry, normalizedName: normalisePubName(String(entry.name ?? "")) };
    if (bucket) bucket.push(indexed);
    else byCell.set(key, [indexed]);
  }
  return { byOsmId, byCell, size: entries.length };
}

/**
 * @param {{ osmId: string, name: string, lat: number, lng: number }} pub
 * @param {ReturnType<typeof buildCuratedIndex>} index
 * @returns {{ source: string, id: string, matchType: "osm-id" | "name-distance", distanceM?: number } | null}
 */
export function matchCurated(pub, index) {
  const exact = index.byOsmId.get(pub.osmId);
  if (exact) return { source: exact.source, id: exact.id, matchType: "osm-id" };

  const normalized = normalisePubName(String(pub.name ?? ""));
  if (!normalized) return null;

  const latCell = Math.floor(pub.lat / INDEX_CELL_DEG);
  const lngCell = Math.floor(pub.lng / INDEX_CELL_DEG);
  let best = null;
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLng = -1; dLng <= 1; dLng += 1) {
      const bucket = index.byCell.get(`${latCell + dLat}:${lngCell + dLng}`);
      if (!bucket) continue;
      for (const candidate of bucket) {
        if (candidate.normalizedName !== normalized) continue;
        const distanceM = haversineMeters(pub.lat, pub.lng, candidate.lat, candidate.lng);
        if (distanceM > CURATED_MATCH_RADIUS_M) continue;
        if (!best || distanceM < best.distanceM) {
          best = { source: candidate.source, id: candidate.id, matchType: "name-distance", distanceM };
        }
      }
    }
  }
  if (!best) return null;
  return { ...best, distanceM: Math.round(best.distanceM) };
}

/**
 * Annotate UK pubs with `curatedRef` where they already exist in curated or
 * previously-seeded data, and summarise the overlap. Mutates nothing: returns
 * the annotated list plus the report.
 *
 * @param {Array<Record<string, any>>} pubs
 * @param {CuratedEntry[]} curatedEntries
 */
export function annotateCuratedOverlap(pubs, curatedEntries) {
  const index = buildCuratedIndex(curatedEntries);
  const bySource = new Map();
  for (const entry of curatedEntries) {
    const stats = bySource.get(entry.source) ?? { source: entry.source, entries: 0, matched: 0 };
    stats.entries += 1;
    bySource.set(entry.source, stats);
  }

  const annotated = [];
  const byMatchType = { "osm-id": 0, "name-distance": 0 };
  const samples = [];
  for (const pub of pubs) {
    const match = matchCurated(pub, index);
    if (!match) {
      annotated.push(pub);
      continue;
    }
    byMatchType[match.matchType] += 1;
    const stats = bySource.get(match.source);
    if (stats) stats.matched += 1;
    if (samples.length < 20) {
      samples.push({ osmId: pub.osmId, name: pub.name, ...match });
    }
    annotated.push({ ...pub, curatedRef: match });
  }

  const matchedTotal = byMatchType["osm-id"] + byMatchType["name-distance"];
  return {
    pubs: annotated,
    report: {
      ukPubs: pubs.length,
      matchedTotal,
      uniqueToUk: pubs.length - matchedTotal,
      byMatchType,
      matchRadiusM: CURATED_MATCH_RADIUS_M,
      sources: [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source)),
      samples,
    },
  };
}
