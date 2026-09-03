export const LONDON_BOROUGH_CLASSIFIER_VERSION = "london-borough-point-v1";

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function boroughNameForPoint(lat, lng, boundaries, allowedNames = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const feature of boundaries.features) {
    const name = feature?.properties?.name;
    if (typeof name !== "string" || (allowedNames && !allowedNames.has(name))) continue;
    const geometry = feature.geometry;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const rings of polygons) {
      if (pointInRing(lng, lat, rings[0]) && !rings.slice(1).some((hole) => pointInRing(lng, lat, hole))) {
        return name;
      }
    }
  }
  return null;
}
