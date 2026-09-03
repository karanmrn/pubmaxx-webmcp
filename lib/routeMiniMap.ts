// Pure geometry for the plan-page route mini-map (components/plan/PlanRouteMiniMap).
//
// The mini-map is a lightweight, self-contained SVG — no MapLibre mount, no
// tiles, no basemap. It projects a crawl's ordered stop coordinates (and the
// routed walking line the /api/walk-route endpoint returns) into a fixed SVG
// viewBox with a simple equirectangular fit + padding, styled as an abstract
// transit diagram rather than a street map.
//
// Everything here is pure and framework-free so the projection/fit maths is
// unit-testable with no network and no React (mirrors lib/routeLegs.ts).

/** A `[longitude, latitude]` pair — same axis order as GeoJSON positions. */
export type LngLat = [number, number];

/** Geographic extent the projection fits into the viewport. */
export type Bounds = { minLng: number; minLat: number; maxLng: number; maxLat: number };

/** Target SVG box. `padding` reserves room for the numbered discs + any detour
 *  the routed line takes just outside the stop extent. */
export type Viewport = { width: number; height: number; padding: number };

/** A projected point in SVG user units. */
export type Point = { x: number; y: number };

// Coincident-point epsilon in degrees (~1e-9° ≈ 0.1 mm) — below this a span is
// treated as zero so a single-point or perfectly axis-aligned crawl still
// projects to a stable centre instead of dividing by ~0.
const EPS = 1e-9;

/** Tight geographic bounds around the coordinates, or null when empty. */
export function boundsFromCoords(coords: readonly LngLat[]): Bounds | null {
  if (coords.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Project one `[lng, lat]` into the viewport under an equirectangular fit.
 *
 * Longitude is scaled by cos(midLat) so the aspect stays roughly true at London
 * latitudes (a degree of longitude is shorter than a degree of latitude). The
 * fit preserves aspect ratio (one scale for both axes, whichever is tighter)
 * and centres the drawn extent inside the padded box, so the diagram never
 * stretches. Latitude is flipped so north is up. Coincident coordinates land at
 * the box centre rather than dividing by zero.
 */
export function projectPoint(coord: LngLat, bounds: Bounds, vp: Viewport): Point {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cosMid = Math.cos((midLat * Math.PI) / 180) || EPS;
  const spanLng = Math.max((bounds.maxLng - bounds.minLng) * cosMid, 0);
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 0);
  const innerW = Math.max(vp.width - vp.padding * 2, 0);
  const innerH = Math.max(vp.height - vp.padding * 2, 0);

  if (spanLng <= EPS && spanLat <= EPS) {
    return { x: vp.width / 2, y: vp.height / 2 };
  }

  const sx = spanLng > EPS ? innerW / spanLng : Infinity;
  const sy = spanLat > EPS ? innerH / spanLat : Infinity;
  const scale = Math.min(sx, sy);

  const drawnW = spanLng * scale;
  const drawnH = spanLat * scale;
  const offsetX = vp.padding + (innerW - drawnW) / 2;
  const offsetY = vp.padding + (innerH - drawnH) / 2;

  const nx = (coord[0] - bounds.minLng) * cosMid;
  const ny = bounds.maxLat - coord[1]; // invert: north at the top

  return { x: offsetX + nx * scale, y: offsetY + ny * scale };
}

/** Project a list of coordinates against a shared bounds + viewport. */
export function projectCoords(
  coords: readonly LngLat[],
  bounds: Bounds,
  vp: Viewport,
): Point[] {
  return coords.map((coord) => projectPoint(coord, bounds, vp));
}

/** SVG `d` for an open polyline through the points (empty string for < 2). */
export function svgPath(points: readonly Point[]): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`)
    .join(" ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `stops=` query value for GET /api/walk-route: `lng,lat;lng,lat;…`. */
export function stopsParam(coords: readonly LngLat[]): string {
  return coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
}

/**
 * Pull the drawable line out of the walk-route FeatureCollection. The endpoint
 * returns one LineString feature (or an empty collection); this reads the first
 * LineString's coordinates back into LngLat[], defensively skipping anything
 * malformed. Returns [] when there is no usable line.
 */
export function lineCoordsFromFeatureCollection(value: unknown): LngLat[] {
  if (!value || typeof value !== "object") return [];
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  for (const feature of features) {
    const geometry = (feature as { geometry?: unknown })?.geometry;
    if (!geometry || typeof geometry !== "object") continue;
    const geom = geometry as { type?: unknown; coordinates?: unknown };
    if (geom.type !== "LineString" || !Array.isArray(geom.coordinates)) continue;
    const coords: LngLat[] = [];
    for (const pair of geom.coordinates) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [lng, lat] = pair;
      if (typeof lng === "number" && typeof lat === "number") coords.push([lng, lat]);
    }
    if (coords.length >= 2) return coords;
  }
  return [];
}
