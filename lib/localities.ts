// The Greater London locality gazetteer — every neighbourhood/district a
// Londoner would name (Willesden, Cricklewood, Gospel Oak, Dollis Hill…), so the
// map's search popup can fly the camera to any of the hundreds of place labels
// the basemap paints, not just the 20 modelled Night Areas.
//
// The data ships as public/data/london_localities.json, generated once from
// OpenStreetMap place nodes by scripts/gen_london_localities.mjs (see that file
// for the source + ODbL licence). This module is the hermetic, node-testable
// parser the client fetches through: no fs, no route imports, safe to unit test.
//
// A locality is a NAVIGATION target, not a coverage promise: it carries no
// coverage chip. Search flies there; the coverage surface (the area button) stays
// on the modelled areas.

/** One gazetteer entry: a named place with a centroid and its borough. */
export type Locality = {
  name: string;
  /** WGS84 latitude of the place centroid. */
  lat: number;
  /** WGS84 longitude of the place centroid. */
  lng: number;
  /** The Greater London borough the centroid falls inside (display name). */
  borough: string;
};

/** The committed JSON shape: attribution header + the localities array. */
export type LocalityGazetteer = {
  source: string;
  license: string;
  attribution: string;
  generatedAt: string;
  bbox: [number, number, number, number];
  count: number;
  localities: Locality[];
};

// Greater London safety bounds — identical to scripts/validate-data.mjs so a
// row the validator rejects can never slip through the runtime parser either.
const LON_MIN = -0.55;
const LON_MAX = 0.3;
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;

function inLondon(lng: number, lat: number): boolean {
  return lng >= LON_MIN && lng <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}

/** A single row is a locality iff it has a non-empty name/borough and finite
 *  coordinates inside Greater London. Mirrors the validate-data row rules. */
export function isValidLocality(value: unknown): value is Locality {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || row.name.trim().length === 0) return false;
  if (typeof row.borough !== "string" || row.borough.trim().length === 0) return false;
  if (typeof row.lat !== "number" || !Number.isFinite(row.lat)) return false;
  if (typeof row.lng !== "number" || !Number.isFinite(row.lng)) return false;
  return inLondon(row.lng, row.lat);
}

/**
 * Parse a fetched gazetteer into a clean Locality[]. Fail-soft: a malformed
 * payload (or the file 404-ing on a non-London city) yields [] rather than
 * throwing, and any individual bad row is dropped — the map degrades to the
 * modelled areas + boroughs it already had, never a crash.
 */
export function parseLocalityGazetteer(raw: unknown): Locality[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as LocalityGazetteer).localities)
      ? (raw as LocalityGazetteer).localities
      : [];
  const out: Locality[] = [];
  for (const row of rows) {
    if (!isValidLocality(row)) continue;
    out.push({
      name: row.name.trim(),
      lat: row.lat,
      lng: row.lng,
      borough: row.borough.trim(),
    });
  }
  return out;
}
