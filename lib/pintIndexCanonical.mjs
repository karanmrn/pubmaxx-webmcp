// The ONE canonical form the Pint Index integrity hash is taken over.
//
// A published month answers a citation, so the digest stored beside it has to
// mean the same thing to the app that serves it, the script that publishes it
// and the build gate that re-checks it. Two hand-kept copies of this reduction
// agree until they do not: a separator or a comparator that differs by one
// character reorders the rows, changes the digest, and makes the gate accuse a
// correctly published edition of having been rewritten. So it lives here, in
// plain Node ESM, and both the TypeScript app and scripts/validate-data.mjs
// import it rather than restating it.
//
// Two properties this form has to keep for years:
//   • NUL separates the fields, because it cannot occur in a pub name, a
//     borough code or a source id, so no value can impersonate a boundary.
//   • Rows sort by plain UTF-16 code unit, NOT localeCompare, whose ordering
//     depends on the ICU build and would silently rewrite the digest when the
//     runtime is upgraded under an edition nobody touched.

/** The field boundary inside a sort key. Never appears in a field value. */
export const CANONICAL_FIELD_SEPARATOR = "\u0000";

/** One observation reduced to its meaning: which pub, where, what, when, on whose evidence. */
export function canonicalObservationRow(observation) {
  return [
    observation.venueId,
    observation.boroughCode,
    String(observation.pricePence),
    new Date(observation.observedAt).toISOString(),
    observation.sourceId,
    observation.pubName,
  ];
}

/**
 * The canonical string the hash covers. Formatting, key order and array order
 * in the stored file cannot change it, and no field that carries meaning can
 * change without changing it.
 */
export function canonicalObservationsPayload(observations) {
  const rows = Array.from(observations, canonicalObservationRow);
  rows.sort((a, b) => {
    const left = a.join(CANONICAL_FIELD_SEPARATOR);
    const right = b.join(CANONICAL_FIELD_SEPARATOR);
    if (left < right) return -1;
    return left > right ? 1 : 0;
  });
  return JSON.stringify(rows);
}
