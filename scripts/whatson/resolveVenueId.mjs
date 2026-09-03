// scripts/whatson/resolveVenueId.mjs
//
// Shared venue-identity resolver for the What's-On generators (W6). Every
// generator under scripts/whatson/ emits rows sourced from a DIFFERENT
// third-party listing (Question One, Wetherspoons' own directory, a
// hand-curated residency list, …), each with its own name/address shape that
// rarely lines up with the canonical `pub_name|address|lat5|lng5` grouping
// key public/data/pint_prices_app_dataset.json is built from (see
// scripts/lib/venueCanonicalization.mjs, the source of truth this module
// mirrors). Without a resolver those rows ship with no venueId at all, so a
// pin badge/venue chip on the map or venue sheet can never join back to the
// canonical dataset.
//
// This module is PURE: no fs reads happen inside it. Callers load the
// canonical dataset once (loadCanonicalVenueIndex, or buildVenueResolverIndex
// with an already-loaded array) and pass the built index into resolveVenueId
// per row.
//
// Conservative-by-design, mirroring venueCanonicalization.mjs's own merge
// policy (never invent, never guess on ambiguity):
//   Step A (EXACT) — same grouping-key formula as the canonical dataset. A
//     hit here is the highest-confidence match: the source row's own
//     name/address/lat/lng already line up exactly with a canonical row.
//   Step B (CONSERVATIVE FALLBACK) — normalized-name match PLUS an
//     independent confirmation (matching postcode district OR <=75m
//     proximity). If the normalized name matches more than one candidate and
//     more than one (or none) of them also confirms via postcode/proximity,
//     the match is ambiguous and this returns null rather than guessing.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normaliseVenueKeyPart,
  venueGroupingKey,
  stableVenueIdFromKey,
  normalizeVenueIdentityName,
  postcodeOutward,
  haversineMeters,
} from "../lib/venueCanonicalization.mjs";

export { haversineMeters };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANONICAL_DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");

export const VENUE_MATCH_PROXIMITY_METERS = 75;

function coordOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Build the exact grouping key for a bare {name, address, lat, lng} tuple,
// using the SAME formula as venueGroupingKey (which expects pub_name/
// address/latitude/longitude field names on a full price row).
function groupingKeyFromFields(name, address, lat, lng) {
  return venueGroupingKey({
    pub_name: name,
    address,
    latitude: lat,
    longitude: lng,
  });
}

/**
 * Build a resolver index from the canonical price-row dataset (the SAME rows
 * lib/venues.ts groups into venue identities).
 *
 * @param {Array<object>} canonicalRows  raw pint_prices rows (pub_name,
 *   address, latitude, longitude, …)
 * @returns {{
 *   exactByKey: Map<string,string>,
 *   byNormalizedName: Map<string, Array<{venueId:string,name:string,
 *     address:string,lat:number,lng:number,postcode:string|null}>>,
 * }}
 */
export function buildVenueResolverIndex(canonicalRows) {
  const exactByKey = new Map();
  const byNormalizedName = new Map();
  const seenVenueIds = new Set();

  for (const row of canonicalRows ?? []) {
    const key = venueGroupingKey(row);
    const venueId = stableVenueIdFromKey(key);
    if (!exactByKey.has(key)) exactByKey.set(key, venueId);

    // One entry per distinct venue identity in the normalized-name fallback
    // index, not one per price row (a pub has many price rows).
    if (seenVenueIds.has(venueId)) continue;
    seenVenueIds.add(venueId);

    const normName = normalizeVenueIdentityName(row.pub_name);
    if (!normName) continue;
    const lat = coordOf(row.latitude);
    const lng = coordOf(row.longitude);
    const entry = {
      venueId,
      name: String(row.pub_name ?? ""),
      address: String(row.address ?? ""),
      lat,
      lng,
      postcode: postcodeOutward(row.address),
    };
    if (!byNormalizedName.has(normName)) byNormalizedName.set(normName, []);
    byNormalizedName.get(normName).push(entry);
  }

  return { exactByKey, byNormalizedName };
}

// Extract a UK postcode outward code from either an explicit `postcode` field
// or, failing that, from the address string.
function outwardFromRow({ postcode, address }) {
  if (postcode) {
    const fromPostcode = postcodeOutward(postcode);
    if (fromPostcode) return fromPostcode;
    // A bare outward-only postcode (no full postcode, e.g. "N16") won't match
    // the full-postcode regex in postcodeOutward — accept it directly if it
    // already looks like an outward code.
    const m = /^([A-Z]{1,2}\d[A-Z\d]?)/i.exec(String(postcode).trim());
    if (m) return m[1].toUpperCase();
  }
  return postcodeOutward(address);
}

/**
 * Resolve a single source row to a canonical venueId, or null when no
 * confident match exists. Never guesses — see module header for the policy.
 *
 * @param {{name:string, address?:string, postcode?:string, lat?:number, lng?:number}} row
 * @param {ReturnType<typeof buildVenueResolverIndex>} index
 * @returns {string|null}
 */
export function resolveVenueId(row, index) {
  if (!row || !index) return null;
  const name = row.name;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  const address = row.address ?? "";
  const lat = coordOf(row.lat);
  const lng = coordOf(row.lng);

  // Step A — EXACT grouping-key match. Requires address + lat + lng, same as
  // the canonical formula (a missing coordinate can't produce this key).
  if (address && lat !== null && lng !== null) {
    const key = groupingKeyFromFields(name, address, lat, lng);
    const hit = index.exactByKey.get(key);
    if (hit) return hit;
  }

  // Step B — conservative fallback: normalized name + independent
  // confirmation (postcode district match OR <=75m proximity).
  const normName = normalizeVenueIdentityName(name);
  if (!normName) return null;
  const candidates = index.byNormalizedName.get(normName);
  if (!candidates || candidates.length === 0) return null;

  const sourceOutward = outwardFromRow({ postcode: row.postcode, address });

  const confirmed = candidates.filter((c) => {
    const postcodeMatches = Boolean(sourceOutward) && Boolean(c.postcode) && sourceOutward === c.postcode;
    const proximityMatches =
      lat !== null &&
      lng !== null &&
      c.lat !== null &&
      c.lng !== null &&
      haversineMeters(lat, lng, c.lat, c.lng) <= VENUE_MATCH_PROXIMITY_METERS;
    return postcodeMatches || proximityMatches;
  });

  if (confirmed.length === 1) return confirmed[0].venueId;
  // Zero or multiple confirmations — either unresolvable or ambiguous.
  return null;
}

/**
 * Load the canonical venue dataset from disk and build a resolver index.
 * Convenience for the generator scripts' main()/top-level orchestration
 * (fs work stays out of the pure resolve/build functions above).
 */
export function loadCanonicalVenueIndex(datasetPath = CANONICAL_DATASET_PATH) {
  const rows = JSON.parse(readFileSync(datasetPath, "utf8"));
  return buildVenueResolverIndex(Array.isArray(rows) ? rows : []);
}

export { normaliseVenueKeyPart };
