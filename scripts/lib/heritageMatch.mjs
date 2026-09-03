// Pure, dependency-free matcher that joins Historic England's National Heritage
// List for England (NHLE) "Listed Building points" to our pub dataset.
//
// Design rule (owner-set): a FALSE POSITIVE is worse than a miss. We only claim
// a pub is listed when a listed-building point carries the SAME core name AND
// sits on top of the pub. Two conservative tiers, both distance-gated:
//   • exact     — core name sets are identical, within STRONG_MATCH_M metres
//   • contained — pub's (>=2-token) core name is a subset of the listing's,
//                 within CONTAIN_MATCH_M metres (tighter, because it is weaker)
// Everything here is pure so scripts/build_heritage_listings.mjs and the unit
// test share one source of truth; the build script owns network + spatial
// bucketing and calls evaluateMatch() per candidate.

import { haversineMeters } from "./geo.mjs";

export { haversineMeters };

// Distance gates (metres). Deliberately tight — a listed building on the pub is
// the pub; a "same name" listing a street away is not worth a wrong badge.
export const STRONG_MATCH_M = 120;
export const CONTAIN_MATCH_M = 45;

// Words that carry no distinguishing power for a pub name. Stripped from BOTH
// sides before comparison, so "The Dove" matches "THE DOVE PUBLIC HOUSE".
// Kept deliberately small: "arms", "tavern", "head", "crown" etc. ARE
// distinctive and must survive.
const GENERIC_TOKENS = new Set([
  "the",
  "ye",
  "public",
  "house",
  "ph",
  "and",
  "a",
  "of",
  "at",
  "no",
  "nos",
  "number",
  "numbers",
  "former",
  "attached",
  "adjoining",
]);

// Tokens that mean the listing describes something OTHER than the pub building
// itself — its stables, gateway, railings, an adjacent monument, a social club.
// When such a word appears in the listing name but NOT the pub name, the point
// is a different structure that merely shares the pub's name, so we refuse the
// match. This is what stops "Stables in rear yard of the Duke of Hamilton PH
// (public house not included)" from badging the Duke of Hamilton as listed.
const STRUCTURE_DENY = new Set([
  "stables",
  "stable",
  "gateway",
  "gates",
  "gate",
  "railing",
  "railings",
  "wall",
  "walls",
  "forecourt",
  "cross",
  "monument",
  "memorial",
  "milestone",
  "fountain",
  "statue",
  "bollard",
  "bollards",
  "lamp",
  "kiosk",
  "pump",
  "bridge",
  "arch",
  "tomb",
  "well",
  "mounting",
  "obelisk",
  "trough",
  "shelter",
  "church",
  "chapel",
  "school",
  "cottage",
  "cottages",
  "social",
  "club",
  "chambers",
  "warehouse",
  "terrace",
  "rear",
  "yard",
]);

// Building-type suffixes that DO appear verbatim in an NHLE listing name, so we
// may honestly echo them in the fact line ("Grade II listed public house").
// Order matters: longest phrase first.
const TYPE_SUFFIXES = [
  { re: /\bpublic house\b/, word: "public house" },
  { re: /\bcoaching inn\b/, word: "coaching inn" },
  { re: /\bpublic house and\b/, word: "public house" },
  { re: /\binn\b/, word: "inn" },
  { re: /\btavern\b/, word: "tavern" },
  { re: /\bhotel\b/, word: "hotel" },
];

/** Lowercase, drop apostrophes + bracketed asides, keep alphanumerics only. */
export function normaliseName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distinguishing tokens of a name — normalised, minus GENERIC_TOKENS. */
export function coreTokens(value) {
  return normaliseName(value)
    .split(" ")
    .filter((token) => token && !GENERIC_TOKENS.has(token));
}

function setEqual(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((token) => setB.has(token));
}

function isSubset(inner, outer) {
  const setOuter = new Set(outer);
  return inner.every((token) => setOuter.has(token));
}

// True when the raw listing name explicitly calls itself a drinking house. Used
// to gate the weaker "contained" tier: a listing with EXTRA distinctive tokens
// beyond the pub name (e.g. a place name) is only accepted when it also names
// itself a pub, which keeps "The High Cross" off the "Tottenham High Cross"
// monument while still accepting "... Public House and adjoining ...".
const PUB_MARKER_RE = /\b(public house|coaching inn|inn|tavern|hotel|arms)\b/;
export function hasPubMarker(name) {
  return PUB_MARKER_RE.test(normaliseName(name));
}

/** The building-type word to echo, or "building" when the name names no type. */
export function buildingTypeWord(name) {
  const lower = normaliseName(name);
  for (const { re, word } of TYPE_SUFFIXES) {
    if (re.test(lower)) return word;
  }
  return "building";
}

/** Title-case an ALL-CAPS NHLE listing name for a human-readable description.
 * Capitalises the first letter of each whitespace-separated token only, so an
 * apostrophe-s ("Druid's", "O'Nails") is preserved rather than upper-cased. */
export function titleCaseName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Plain, provenance-honest fact line. No em dashes, no invented era/date. */
export function buildFactText(grade, name) {
  const g = String(grade ?? "").trim();
  if (!g) return null;
  return `Grade ${g} listed ${buildingTypeWord(name)}.`;
}

/**
 * Decide whether a single NHLE listing is the given pub.
 * pub:     { name, lat, lng }
 * listing: { name, grade, lat, lng }
 * Returns { matched, tier, distanceM } — matched:false when no tier passes.
 * Missing grade or coordinates can never match (honest: no badge without data).
 */
export function evaluateMatch(pub, listing) {
  const miss = { matched: false, tier: null, distanceM: Infinity };
  if (!listing || !String(listing.grade ?? "").trim()) return miss;
  if (![pub.lat, pub.lng, listing.lat, listing.lng].every((n) => Number.isFinite(n))) {
    return miss;
  }
  const pubTokens = coreTokens(pub.name);
  const listTokens = coreTokens(listing.name);
  if (pubTokens.length === 0 || listTokens.length === 0) return miss;

  // Refuse when the listing names a different structure (stables/gateway/etc.)
  // that the pub name does not — a same-name neighbour, not the pub building.
  const pubSet = new Set(pubTokens);
  for (const token of listTokens) {
    if (!pubSet.has(token) && STRUCTURE_DENY.has(token)) return miss;
  }

  const distanceM = haversineMeters(pub.lat, pub.lng, listing.lat, listing.lng);

  if (setEqual(pubTokens, listTokens) && distanceM <= STRONG_MATCH_M) {
    return { matched: true, tier: "exact", distanceM };
  }
  if (
    pubTokens.length >= 2 &&
    isSubset(pubTokens, listTokens) &&
    hasPubMarker(listing.name) &&
    distanceM <= CONTAIN_MATCH_M
  ) {
    return { matched: true, tier: "contained", distanceM };
  }
  return miss;
}

/**
 * Best (closest passing) listing for a pub among candidates. Pure; the caller
 * supplies an already-narrowed candidate list (spatial prefilter lives in the
 * build script). Ties break on the smaller distance, then lower list entry.
 */
export function bestMatch(pub, candidates) {
  let best = null;
  for (const listing of candidates) {
    const result = evaluateMatch(pub, listing);
    if (!result.matched) continue;
    if (
      !best ||
      result.distanceM < best.distanceM ||
      (result.distanceM === best.distanceM &&
        Number(listing.listEntry) < Number(best.listing.listEntry))
    ) {
      best = { listing, ...result };
    }
  }
  return best;
}
