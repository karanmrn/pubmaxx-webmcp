// scripts/whatson/greeneKingSportParser.mjs
//
// Pure parsers for the What's-On SPORT vertical (PRD_WHATS_ON B2).
// No fetching here: every function is a plain transform so the whole module
// unit-tests offline against saved fixtures (__tests__/fixtures/whats_on/*).
// Fetch orchestration lives in scripts/whatson/scrape_greene_king_sport.mjs.
//
// Source is Greene King's own public per-pub pages (first-party):
//   https://www.greeneking.co.uk/pubs/{region}/{slug}
// Each page inlines a first-party boolean "sports":true|false. We emit ONE
// venue-level attribute row per pub flagged true (kind:"sport", NO startsAt —
// it is an attribute, not a timed event). Timed fixtures are delivered through
// Greene King's FANZO partner behind gated booking links (/*book?sportId=,
// /*book?date=) which robots.txt disallows and which are not first-party — so
// no timed rows are ever produced here (see scrape_greene_king_sport.mjs).

import { venueGroupingKey, stableVenueIdFromKey } from "../lib/venueMatch.mjs";

// Shared, honest copy for every attribute row: what the flag actually means,
// and why we do not list individual fixtures.
export const SPORT_ATTRIBUTE_TITLE = "Shows live sport";
export const SPORT_ATTRIBUTE_DETAIL =
  "Greene King lists this pub as a live-sport venue with screens for televised " +
  "fixtures. Specific fixtures are partner-gated and not published here.";

// Read the first-party "sports" boolean from a Greene King pub page.
// Returns true / false, or null when the flag is absent OR the page carries
// conflicting values (never guessed).
export function parseGreeneKingSportsFlag(html) {
  const matches = [...String(html ?? "").matchAll(/"sports"\s*:\s*(true|false)\b/g)];
  if (matches.length === 0) return null;
  const values = new Set(matches.map((m) => m[1] === "true"));
  if (values.size !== 1) return null; // conflicting flags -> refuse to guess
  return values.values().next().value;
}

// The public pub page URL for a venue: its menuUrl minus the trailing /menu.
export function pubPageUrlFromMenuUrl(menuUrl) {
  return String(menuUrl ?? "").replace(/\/+$/, "").replace(/\/menu$/, "");
}

// Deterministic, reusable venueId for a Greene King raw menu.json record,
// using the shared venue-key functions. Returns null when lat/lng are missing
// (identity keys on 5-dp coordinates, so it cannot be synthesised without them).
function coordOf(value) {
  // Number(null) is 0 — treat null/undefined as genuinely missing, never 0,0.
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function gkVenueIdFromRecord(record) {
  const lat = coordOf(record?.lat);
  const lng = coordOf(record?.lng);
  if (lat === null || lng === null) return null;
  const key = venueGroupingKey({
    pub_name: String(record?.name ?? ""),
    address: String(record?.address ?? ""),
    latitude: lat,
    longitude: lng,
  });
  return stableVenueIdFromKey(key);
}

// Build a single What's-On SPORT attribute row (B1 contract shape) from a raw
// menu.json record. venueId / lat / lng are omitted when unavailable, never
// invented. Callers only invoke this for pubs whose sports flag is true.
export function sportAttributeRow(record, observedAt) {
  const url = pubPageUrlFromMenuUrl(record?.menuUrl);
  const slug = url.split("/").filter(Boolean).pop() ?? "";
  const venueId = gkVenueIdFromRecord(record);
  const lat = coordOf(record?.lat);
  const lng = coordOf(record?.lng);
  return {
    id: `sport-attr-gk-${slug}`,
    ...(venueId ? { venueId } : {}),
    placeName: String(record?.name ?? ""),
    ...(lat !== null ? { lat } : {}),
    ...(lng !== null ? { lng } : {}),
    kind: "sport",
    title: SPORT_ATTRIBUTE_TITLE,
    detail: SPORT_ATTRIBUTE_DETAIL,
    source: { label: "Greene King", url },
    observedAt,
    confidence: "listed",
  };
}

// Assemble attribute rows + coverage counts from parsed venues.
// `venues`: [{ record, showsSport: boolean | null }]. Rows are emitted only for
// showsSport === true; false and null (undetermined) are counted, not guessed.
// Rows are sorted by id for stable, reviewable diffs.
export function buildSportAttributeRows({ venues, observedAt }) {
  const rows = [];
  const counts = { pubsChecked: 0, showsLiveSport: 0, noLiveSport: 0, undetermined: 0 };
  for (const { record, showsSport } of venues) {
    counts.pubsChecked += 1;
    if (showsSport === true) {
      counts.showsLiveSport += 1;
      rows.push(sportAttributeRow(record, observedAt));
    } else if (showsSport === false) {
      counts.noLiveSport += 1;
    } else {
      counts.undetermined += 1;
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { rows, counts };
}
