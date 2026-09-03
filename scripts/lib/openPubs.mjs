/**
 * Open Pubs (getthedata.com) evaluation helpers.
 *
 * Pure parse + identity match for the FSA-derived UK pub CSV. Used by
 * scripts/evaluate_open_pubs.mjs and __tests__/openPubs.test.ts.
 *
 * This module never invents prices and never mutates the curated slim index.
 * Matching is conservative: same normalised name, distance gate, optional
 * postcode outward conflict block (mirrors scripts/lib/ukOsmSeed.mjs).
 *
 * Upstream: https://www.getthedata.com/open-pubs
 * Columns (headerless CSV): fsa_id, name, address, postcode, easting, northing,
 * latitude, longitude, local_authority.
 */

import { normalisePubName } from "./venueMatch.mjs";
import {
  haversineMeters,
  normalizeVenueIdentityName,
  postcodeOutward,
} from "./venueCanonicalization.mjs";

/** Official zip download (redirect target from getthedata.com). */
export const OPEN_PUBS_DOWNLOAD_URL =
  "https://download.getthedata.com/downloads/open_pubs.csv.zip";

/** Same building-width gate as curated ↔ OSM overlap. */
export const OPEN_PUBS_MATCH_RADIUS_M = 150;

/** Cap for sample unmatched names in London / JSON reports. */
export const OPEN_PUBS_SAMPLE_UNMATCHED_CAP = 20;

/**
 * Greater London local_authority labels as they appear in the Open Pubs CSV
 * (mirrors lib/boroughs.ts LONDON_BOROUGHS — the 33 GLA authorities).
 */
export const LONDON_OPEN_PUBS_AUTHORITIES = Object.freeze([
  "Barking and Dagenham",
  "Barnet",
  "Bexley",
  "Brent",
  "Bromley",
  "Camden",
  "City of London",
  "Croydon",
  "Ealing",
  "Enfield",
  "Greenwich",
  "Hackney",
  "Hammersmith and Fulham",
  "Haringey",
  "Harrow",
  "Havering",
  "Hillingdon",
  "Hounslow",
  "Islington",
  "Kensington and Chelsea",
  "Kingston upon Thames",
  "Lambeth",
  "Lewisham",
  "Merton",
  "Newham",
  "Redbridge",
  "Richmond upon Thames",
  "Southwark",
  "Sutton",
  "Tower Hamlets",
  "Waltham Forest",
  "Wandsworth",
  "Westminster",
]);

const LONDON_AUTHORITY_SET = new Set(
  LONDON_OPEN_PUBS_AUTHORITIES.map((name) => name.toLowerCase()),
);

export const OPEN_PUBS_COLUMNS = [
  "fsa_id",
  "name",
  "address",
  "postcode",
  "easting",
  "northing",
  "latitude",
  "longitude",
  "local_authority",
];

const INDEX_CELL_DEG = 0.01;

/** True when the Open Pubs local_authority is one of the 33 London boroughs. */
export function isLondonOpenPubsAuthority(localAuthority) {
  if (localAuthority == null) return false;
  return LONDON_AUTHORITY_SET.has(String(localAuthority).trim().toLowerCase());
}

/**
 * Keep only Greater London rows (by CSV local_authority). Dry-run filter —
 * does not mutate the input array.
 * @param {OpenPubsRow[]} rows
 * @returns {OpenPubsRow[]}
 */
export function filterOpenPubsRowsForLondon(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => isLondonOpenPubsAuthority(row?.localAuthority));
}

function cellKey(lat, lng) {
  return `${Math.floor(lat / INDEX_CELL_DEG)}:${Math.floor(lng / INDEX_CELL_DEG)}`;
}

/** Parse a CSV scalar that may be quoted, empty, or MySQL-style \N. */
export function parseCsvNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "" || s === "\\N" || s.toLowerCase() === "null") return null;
  return s;
}

export function parseFiniteNumber(value) {
  const s = parseCsvNull(value);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minimal RFC4180-ish CSV splitter for the Open Pubs export (quoted fields,
 * commas inside quotes, no embedded newlines in practice).
 * @param {string} text
 * @returns {string[][]}
 */
export function splitCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function looksLikeHeader(cells) {
  if (!cells?.length) return false;
  const first = String(cells[0] ?? "")
    .trim()
    .toLowerCase();
  return first === "fsa_id" || first === "fsaid";
}

/**
 * @typedef {{
 *   fsaId: number,
 *   name: string,
 *   address: string,
 *   postcode: string | null,
 *   easting: number | null,
 *   northing: number | null,
 *   lat: number | null,
 *   lng: number | null,
 *   localAuthority: string | null,
 * }} OpenPubsRow
 */

/**
 * Normalise one Open Pubs field array into a row, or null when unusable.
 * Requires a numeric fsa_id and a non-empty name. Coordinates may be null
 * (some easting/northing rows ship `\N` lat/lng).
 * @param {string[]} cells
 * @returns {OpenPubsRow | null}
 */
export function normalizeOpenPubsCells(cells) {
  if (!Array.isArray(cells) || cells.length < 4) return null;
  const fsaId = parseFiniteNumber(cells[0]);
  if (fsaId == null || fsaId <= 0) return null;
  const name = parseCsvNull(cells[1]);
  if (!name) return null;
  return {
    fsaId: Math.trunc(fsaId),
    name,
    address: parseCsvNull(cells[2]) ?? "",
    postcode: parseCsvNull(cells[3]),
    easting: parseFiniteNumber(cells[4]),
    northing: parseFiniteNumber(cells[5]),
    lat: parseFiniteNumber(cells[6]),
    lng: parseFiniteNumber(cells[7]),
    localAuthority: parseCsvNull(cells[8]),
  };
}

/**
 * Parse a full Open Pubs CSV body into normalised rows. Headerless by default;
 * a leading fsa_id header row is skipped when present.
 * @param {string} text
 * @returns {OpenPubsRow[]}
 */
export function parseOpenPubsCsv(text) {
  const raw = splitCsv(text);
  if (raw.length === 0) return [];
  let start = 0;
  if (looksLikeHeader(raw[0])) start = 1;
  const out = [];
  for (let i = start; i < raw.length; i += 1) {
    const row = normalizeOpenPubsCells(raw[i]);
    if (row) out.push(row);
  }
  return out;
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   lat: number,
 *   lng: number,
 *   address?: string | null,
 *   postcode?: string | null,
 *   layer: "curated" | "osm",
 * }} IdentityCandidate
 */

/**
 * @typedef {{
 *   byCell: Map<string, Array<IdentityCandidate & { normalizedName: string, identityName: string, outward: string | null }>>,
 *   size: number,
 * }} IdentityIndex
 */

/**
 * Spatial + name index over curated slim and/or OSM identity candidates.
 * @param {IdentityCandidate[]} candidates
 * @returns {IdentityIndex}
 */
export function buildIdentityIndex(candidates) {
  const byCell = new Map();
  let size = 0;
  for (const entry of candidates) {
    if (!entry?.id || !entry?.name) continue;
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) continue;
    const layer = entry.layer === "osm" ? "osm" : "curated";
    const indexed = {
      id: String(entry.id),
      name: String(entry.name),
      lat: entry.lat,
      lng: entry.lng,
      address: entry.address ?? null,
      postcode: entry.postcode ?? null,
      layer,
      normalizedName: normalisePubName(String(entry.name)),
      identityName: normalizeVenueIdentityName(String(entry.name)),
      outward: postcodeOutward(entry.postcode ?? entry.address ?? ""),
    };
    if (!indexed.normalizedName && !indexed.identityName) continue;
    const key = cellKey(entry.lat, entry.lng);
    const bucket = byCell.get(key);
    if (bucket) bucket.push(indexed);
    else byCell.set(key, [indexed]);
    size += 1;
  }
  return { byCell, size };
}

function postcodesConflict(aOutward, bOutward) {
  return Boolean(aOutward && bOutward && aOutward !== bOutward);
}

/**
 * Match one Open Pubs row to an identity candidate inside the radius gate.
 * Within the same name tier, curated beats OSM (we want the product id when
 * both layers know the pub); distance is the tie-break inside a layer.
 * @param {OpenPubsRow} row
 * @param {IdentityIndex} index
 * @param {{ radiusM?: number }} [opts]
 * @returns {{
 *   id: string,
 *   layer: "curated" | "osm",
 *   name: string,
 *   matchType: "exact-name-distance" | "identity-name-distance",
 *   distanceM: number,
 * } | null}
 */
/**
 * Collect every identity candidate that clears the name + distance + postcode
 * gates for one Open Pubs row, best first (tier, then curated-over-OSM, then
 * distance). Used by the classifier so ambiguous ties are visible.
 * @param {OpenPubsRow} row
 * @param {IdentityIndex} index
 * @param {{ radiusM?: number }} [opts]
 * @returns {Array<{
 *   id: string,
 *   layer: "curated" | "osm",
 *   name: string,
 *   matchType: "exact-name-distance" | "identity-name-distance",
 *   distanceM: number,
 *   tier: number,
 *   layerRank: number,
 * }>}
 */
export function collectOpenPubIdentityCandidates(row, index, opts = {}) {
  if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return [];
  const radiusM = opts.radiusM ?? OPEN_PUBS_MATCH_RADIUS_M;
  const normalized = normalisePubName(row.name);
  const identity = normalizeVenueIdentityName(row.name);
  if (!normalized && !identity) return [];
  const outward = postcodeOutward(row.postcode ?? row.address ?? "");

  const latCell = Math.floor(row.lat / INDEX_CELL_DEG);
  const lngCell = Math.floor(row.lng / INDEX_CELL_DEG);
  /** @type {Array<{ id: string, layer: "curated" | "osm", name: string, matchType: "exact-name-distance" | "identity-name-distance", distanceM: number, tier: number, layerRank: number }>} */
  const hits = [];

  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLng = -1; dLng <= 1; dLng += 1) {
      const bucket = index.byCell.get(`${latCell + dLat}:${lngCell + dLng}`);
      if (!bucket) continue;
      for (const candidate of bucket) {
        if (postcodesConflict(outward, candidate.outward)) continue;
        const distanceM = haversineMeters(row.lat, row.lng, candidate.lat, candidate.lng);
        if (distanceM > radiusM) continue;

        let matchType = null;
        let tier = 9;
        if (normalized && candidate.normalizedName === normalized) {
          matchType = "exact-name-distance";
          tier = 0;
        } else if (identity && candidate.identityName === identity) {
          matchType = "identity-name-distance";
          tier = 1;
        } else {
          continue;
        }

        const layerRank = candidate.layer === "curated" ? 0 : 1;
        hits.push({
          id: candidate.id,
          layer: candidate.layer,
          name: candidate.name,
          matchType,
          distanceM,
          tier,
          layerRank,
        });
      }
    }
  }

  hits.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.layerRank !== b.layerRank) return a.layerRank - b.layerRank;
    if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
    return a.id.localeCompare(b.id);
  });
  return hits;
}

/**
 * Classify one Open Pubs row against identity.
 * Ambiguous = two or more distinct ids share the best tier + layer (refuse to
 * guess by distance alone — curator report must surface the tie).
 * @param {OpenPubsRow} row
 * @param {IdentityIndex} index
 * @param {{ radiusM?: number }} [opts]
 * @returns {{
 *   status: "matched" | "unmatched" | "ambiguous" | "skipped",
 *   match: null | {
 *     id: string,
 *     layer: "curated" | "osm",
 *     name: string,
 *     matchType: "exact-name-distance" | "identity-name-distance",
 *     distanceM: number,
 *   },
 *   candidates: Array<{ id: string, layer: "curated" | "osm", name: string, matchType: string, distanceM: number }>,
 *   reason: string | null,
 * }}
 */
export function classifyOpenPubMatch(row, index, opts = {}) {
  if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
    return { status: "skipped", match: null, candidates: [], reason: "no-coords" };
  }
  const hits = collectOpenPubIdentityCandidates(row, index, opts);
  if (hits.length === 0) {
    return {
      status: "unmatched",
      match: null,
      candidates: [],
      reason: "no-identity-match",
    };
  }
  const best = hits[0];
  const tied = hits.filter(
    (h) => h.tier === best.tier && h.layerRank === best.layerRank && h.id !== best.id,
  );
  const publicCandidates = hits.slice(0, 5).map((h) => ({
    id: h.id,
    layer: h.layer,
    name: h.name,
    matchType: h.matchType,
    distanceM: Math.round(h.distanceM),
  }));
  if (tied.length > 0) {
    return {
      status: "ambiguous",
      match: null,
      candidates: publicCandidates,
      reason: "ambiguous-identity",
    };
  }
  return {
    status: "matched",
    match: {
      id: best.id,
      layer: best.layer,
      name: best.name,
      matchType: best.matchType,
      distanceM: Math.round(best.distanceM),
    },
    candidates: publicCandidates,
    reason: null,
  };
}

/**
 * Match one Open Pubs row to an identity candidate inside the radius gate.
 * Within the same name tier, curated beats OSM (we want the product id when
 * both layers know the pub); distance is the tie-break inside a layer.
 * Pass `{ refuseAmbiguous: true }` to return null when two ids share the best
 * tier + layer (same rule as classifyOpenPubMatch).
 * @param {OpenPubsRow} row
 * @param {IdentityIndex} index
 * @param {{ radiusM?: number, refuseAmbiguous?: boolean }} [opts]
 * @returns {{
 *   id: string,
 *   layer: "curated" | "osm",
 *   name: string,
 *   matchType: "exact-name-distance" | "identity-name-distance",
 *   distanceM: number,
 * } | null}
 */
export function matchOpenPubToIdentity(row, index, opts = {}) {
  if (opts.refuseAmbiguous) {
    const classified = classifyOpenPubMatch(row, index, opts);
    return classified.status === "matched" ? classified.match : null;
  }
  const hits = collectOpenPubIdentityCandidates(row, index, opts);
  if (hits.length === 0) return null;
  const best = hits[0];
  return {
    id: best.id,
    layer: best.layer,
    name: best.name,
    matchType: best.matchType,
    distanceM: Math.round(best.distanceM),
  };
}

/**
 * Dry-run evaluation: match rates only. Never mutates candidates or rows.
 * Counts ambiguous ties separately from unmatched (refuse-to-guess).
 * @param {OpenPubsRow[]} rows
 * @param {IdentityCandidate[]} candidates
 * @param {{ radiusM?: number, sampleUnmatchedCap?: number }} [opts]
 */
export function evaluateOpenPubsMatches(rows, candidates, opts = {}) {
  const index = buildIdentityIndex(candidates);
  const sampleCap = opts.sampleUnmatchedCap ?? OPEN_PUBS_SAMPLE_UNMATCHED_CAP;
  let withCoords = 0;
  let matchedCurated = 0;
  let matchedOsm = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let skippedNoCoords = 0;
  /** @type {Array<{ fsaId: number, name: string, match: NonNullable<ReturnType<typeof matchOpenPubToIdentity>> }>} */
  const matches = [];
  /** @type {Array<{ fsaId: number, name: string, reason: string, candidates?: unknown[] }>} */
  const misses = [];
  /** @type {Array<{ fsaId: number, name: string, candidates: unknown[] }>} */
  const ambiguousRows = [];
  /** @type {string[]} */
  const sampleUnmatchedNames = [];

  for (const row of rows) {
    const classified = classifyOpenPubMatch(row, index, opts);
    if (classified.status === "skipped") {
      skippedNoCoords += 1;
      misses.push({ fsaId: row.fsaId, name: row.name, reason: "no-coords" });
      continue;
    }
    withCoords += 1;
    if (classified.status === "ambiguous") {
      ambiguous += 1;
      ambiguousRows.push({
        fsaId: row.fsaId,
        name: row.name,
        candidates: classified.candidates,
      });
      misses.push({
        fsaId: row.fsaId,
        name: row.name,
        reason: "ambiguous-identity",
        candidates: classified.candidates,
      });
      continue;
    }
    if (classified.status === "unmatched" || !classified.match) {
      unmatched += 1;
      misses.push({ fsaId: row.fsaId, name: row.name, reason: "no-identity-match" });
      if (sampleUnmatchedNames.length < sampleCap) {
        sampleUnmatchedNames.push(row.name);
      }
      continue;
    }
    const match = classified.match;
    matches.push({ fsaId: row.fsaId, name: row.name, match });
    if (match.layer === "curated") matchedCurated += 1;
    else matchedOsm += 1;
  }

  const matched = matchedCurated + matchedOsm;
  const skipped = skippedNoCoords;
  const pct = (n, d) => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

  return {
    rowsRead: rows.length,
    identityCandidates: index.size,
    withCoords,
    skippedNoCoords,
    skipped,
    matched,
    matchedCurated,
    matchedOsm,
    unmatched,
    ambiguous,
    matchRateOfCoordsPct: pct(matched, withCoords),
    curatedRateOfCoordsPct: pct(matchedCurated, withCoords),
    osmOnlyRateOfCoordsPct: pct(matchedOsm, withCoords),
    radiusM: opts.radiusM ?? OPEN_PUBS_MATCH_RADIUS_M,
    matches,
    misses,
    ambiguousRows,
    sampleUnmatchedNames,
    totals: {
      matched,
      unmatched,
      ambiguous,
      skipped,
    },
  };
}

/**
 * JSON-ready London curated identity report (dry-run; never merges slim).
 * @param {OpenPubsRow[]} rows  already London-filtered (or not — filter applied here)
 * @param {IdentityCandidate[]} curatedCandidates
 * @param {{ radiusM?: number, sampleUnmatchedCap?: number, csvPath?: string | null }} [opts]
 */
export function buildLondonCuratedMatchReport(rows, curatedCandidates, opts = {}) {
  const londonRows = filterOpenPubsRowsForLondon(rows);
  const curatedOnly = (curatedCandidates ?? []).filter(
    (c) => !c?.layer || c.layer === "curated",
  );
  const summary = evaluateOpenPubsMatches(londonRows, curatedOnly, opts);
  return {
    generatedAt: new Date().toISOString(),
    source: "open-pubs",
    scope: "london-curated",
    downloadUrl: OPEN_PUBS_DOWNLOAD_URL,
    csvPath: opts.csvPath ?? null,
    identity: "curated",
    city: "london",
    dryRun: true,
    mergedIntoSlim: false,
    inventedPrices: false,
    totals: summary.totals,
    stats: {
      rowsRead: summary.rowsRead,
      londonRows: londonRows.length,
      withCoords: summary.withCoords,
      skippedNoCoords: summary.skippedNoCoords,
      identityCandidates: summary.identityCandidates,
      matched: summary.matched,
      matchedCurated: summary.matchedCurated,
      matchedOsm: summary.matchedOsm,
      unmatched: summary.unmatched,
      ambiguous: summary.ambiguous,
      skipped: summary.skipped,
      matchRateOfCoordsPct: summary.matchRateOfCoordsPct,
      curatedRateOfCoordsPct: summary.curatedRateOfCoordsPct,
      radiusM: summary.radiusM,
    },
    sampleUnmatchedNames: summary.sampleUnmatchedNames,
    sampleMatches: summary.matches.slice(0, 50),
    sampleMisses: summary.misses
      .filter((m) => m.reason === "no-identity-match")
      .slice(0, 50),
    sampleAmbiguous: summary.ambiguousRows.slice(0, 20),
  };
}

/**
 * Map a venues_slim row into an identity candidate.
 * @param {{ id?: unknown, name?: unknown, lat?: unknown, lng?: unknown, filterHints?: { searchText?: string } }} venue
 * @returns {IdentityCandidate | null}
 */
export function identityFromSlimVenue(venue) {
  if (!venue || typeof venue.id !== "string" || typeof venue.name !== "string") return null;
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lng)) return null;
  return {
    id: venue.id,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    address: venue.filterHints?.searchText ?? null,
    layer: "curated",
  };
}

/**
 * Map a UK OSM seed pub into an identity candidate (`venue-uk-*` id shape).
 * @param {{ osmId?: unknown, name?: unknown, lat?: unknown, lng?: unknown, address?: unknown, postcode?: unknown }} pub
 * @param {(osmId: string) => string} [idForOsm]
 * @returns {IdentityCandidate | null}
 */
export function identityFromOsmPub(pub, idForOsm) {
  if (!pub || typeof pub.name !== "string") return null;
  if (!Number.isFinite(pub.lat) || !Number.isFinite(pub.lng)) return null;
  const osmId = String(pub.osmId ?? "");
  if (!osmId) return null;
  const id =
    typeof idForOsm === "function"
      ? idForOsm(osmId)
      : `venue-uk-${osmId.replace("node/", "n").replace("way/", "w").replace("relation/", "r")}`;
  return {
    id,
    name: pub.name,
    lat: pub.lat,
    lng: pub.lng,
    address: typeof pub.address === "string" ? pub.address : null,
    postcode: typeof pub.postcode === "string" ? pub.postcode : null,
    layer: "osm",
  };
}
