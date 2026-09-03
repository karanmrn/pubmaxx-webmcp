// What an OSM locality tag has to look like before it may be offered as
// somebody's town, and how it is printed once it may.
//
// Three consumers need the SAME answer and cannot share a TypeScript module:
// the builder (scripts/lib/ukPlaceIndex.mjs) that writes the index, the data
// gate (scripts/validate-data.mjs) that refuses a regressed one, and the app
// (lib/ukPlaceSearch.ts) that parses what ships. Restating the rule in each is
// how "<different>" reached search in the first place, so it lives here as
// plain ESM with no imports and all three import it.
//
// The rule is about the SHAPE of a name, never about which places we like:
// address tags carry editing noise ("<different>"), multi-place lists
// ("Hythe;West Hythe") and land-use words a mapper typed into an address field
// ("retail"). Genuine names that are merely miscased ("blantyre") are real
// places and are capitalised for display rather than dropped.

/**
 * Land-use and placeholder words that appear in `addr:*` locality tags. Matched
 * against the WHOLE name, so "Retail Park Lane" and "Newton Unknown" survive.
 */
const NON_PLACE_NAMES = new Set([
  "business",
  "centre",
  "center",
  "commercial",
  "estate",
  "industrial",
  "n/a",
  "na",
  "none",
  "null",
  "other",
  "private",
  "residential",
  "retail",
  "tbc",
  "test",
  "unknown",
  "undefined",
]);

/**
 * @param {string} value raw or normalised locality tag
 * @returns {boolean} whether it may be offered as a UK place
 */
export function isPublishableUkPlaceName(value) {
  const name = String(value ?? "").trim();
  return (
    name.length >= 2 &&
    name.length <= 100 &&
    !/[;<>]/.test(name) &&
    /^[\p{L}\p{N}]/u.test(name) &&
    !/[\u0000-\u001f\u007f]/u.test(name) &&
    !NON_PLACE_NAMES.has(name.toLocaleLowerCase("en-GB"))
  );
}

/**
 * The printed form of a publishable name. Only the first character is touched,
 * because the rest of a UK place name is not ours to restyle ("Ynys Môn",
 * "King's Lynn", "Stoke-on-Trent").
 *
 * @param {string} value
 * @returns {string}
 */
export function displayUkPlaceName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return name.replace(/^\p{Ll}/u, (first) => first.toLocaleUpperCase("en-GB"));
}
