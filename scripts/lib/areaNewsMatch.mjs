// Pure, dependency-light matcher that joins an area-news fact to a venue in our
// dataset. It follows the same conservative rule as scripts/lib/heritageMatch:
// a FALSE POSITIVE (wrong pub badged) is worse than a miss, so we only claim a
// match when the fact's pub name resolves to exactly ONE venue in the fact's
// borough. News facts carry no coordinates, so proximity can't be used here the
// way heritageMatch uses it — the borough is our disambiguator instead, and the
// uniqueness requirement stands in for the distance gate.
//
// Two tiers, both borough-scoped:
//   • high   — core name sets are identical and exactly one venue matches
//   • medium — the fact's (>=2-token) core name is a subset of exactly one
//              venue's core name (weaker, so it is labelled lower confidence)
// Anything ambiguous (0 or >1 candidates) yields null — no match, no badge.
//
// Reuses heritageMatch's name normalisation so "The Devonshire" and "THE
// DEVONSHIRE (PUBLIC HOUSE)" collapse to the same core tokens in one place.

import { coreTokens } from "./heritageMatch.mjs";

/** Kebab-case a borough name the same way lib/boroughs.slugifyBorough does. */
export function slugifyBorough(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

/**
 * Match a named pub in a given borough to a venue id.
 * pubName:      the pub's name as it appears in the fact
 * boroughSlug:  the fact's borough (slugified), used to scope candidates
 * venues:       array of { id, name, borough } (the slim index rows)
 * Returns { venueId, confidence: "high"|"medium" } or null when not confident.
 */
export function matchVenue(pubName, boroughSlug, venues) {
  const pubTokens = coreTokens(pubName);
  if (pubTokens.length === 0 || !boroughSlug) return null;

  const inBorough = venues.filter(
    (v) => v && typeof v.id === "string" && slugifyBorough(v.borough) === boroughSlug,
  );
  if (inBorough.length === 0) return null;

  const exact = inBorough.filter((v) => setEqual(pubTokens, coreTokens(v.name)));
  if (exact.length === 1) return { venueId: exact[0].id, confidence: "high" };
  if (exact.length > 1) return null; // ambiguous — refuse

  if (pubTokens.length >= 2) {
    const subset = inBorough.filter((v) => isSubset(pubTokens, coreTokens(v.name)));
    if (subset.length === 1) return { venueId: subset[0].id, confidence: "medium" };
  }
  return null;
}
