// M5 — pure donut-cluster geometry/segment math. No DOM, no MapLibre types:
// every function here takes plain numbers/strings and returns plain
// numbers/strings, so it is unit-testable without a browser or a map
// instance. The marker-sync module (components/map/canvas/donutClusters.ts)
// is the only caller; it owns the DOM/MapLibre wiring.

/** Price-band bucket order: ≤£5.50, >£5.50–≤£7, >£7, no price (matches
 *  priceBucket() in components/map/canvas/geojson.ts and the legend in
 *  MapKey.tsx: green / amber / red / muted). */
export type DonutCounts = readonly [number, number, number, number];

/** Mirrors the existing `["step", point_count, 11, 25, 15, 100, 20]` circle
 *  radius expression used for the plain cluster-circle layer, so a donut
 *  marker is the same visual size as the bubble it replaces at any given
 *  cluster density. */
export function donutOuterRadius(totalCount: number): number {
  if (totalCount >= 100) return 20;
  if (totalCount >= 25) return 15;
  return 11;
}

export type DonutStrokeSegment = {
  index: number;
  count: number;
  color: string;
  /** SVG `stroke-dasharray` value: "<arc length> <remaining circumference>". */
  dasharray: string;
  /** SVG `stroke-dashoffset` value (negative — segments are laid end to end,
   *  starting from 12 o'clock via the caller's -90deg group rotation). */
  dashoffset: number;
};

/** Builds concentric-circle stroke segments (dasharray/dashoffset), one per
 *  non-zero bucket, proportional to its share of the total. This is the
 *  standard "circle as pie/donut" SVG technique — far simpler and more
 *  robust than hand-rolled arc `path d=` math (no edge cases for a segment
 *  that spans a full circle). Buckets with a zero count are omitted so the
 *  DOM/paint stays proportional to what is actually drawn. */
export function buildDonutStrokeSegments(
  counts: DonutCounts,
  colors: readonly string[],
  radius: number,
): DonutStrokeSegment[] {
  const total = counts.reduce((sum, n) => sum + Math.max(0, n), 0);
  if (total <= 0 || radius <= 0) return [];
  const circumference = 2 * Math.PI * radius;
  const segments: DonutStrokeSegment[] = [];
  let cumulative = 0;
  counts.forEach((count, index) => {
    if (count <= 0) return;
    const arcLength = (count / total) * circumference;
    segments.push({
      index,
      count,
      color: colors[index] ?? "#888888",
      dasharray: `${arcLength.toFixed(3)} ${(circumference - arcLength).toFixed(3)}`,
      dashoffset: -cumulative,
    });
    cumulative += arcLength;
  });
  return segments;
}

export type DonutMarkerSvgParams = {
  counts: DonutCounts;
  /** Colors indexed the same way as `counts` (bucket 0..3). */
  colors: readonly string[];
  /** Track ring color (drawn under the segments at low opacity). */
  ringColor: string;
  /** Count-in-the-hole text color. */
  textColor: string;
};

/** Total across all buckets — the number rendered in the donut's hole. */
export function donutTotal(counts: DonutCounts): number {
  return counts.reduce((sum, n) => sum + Math.max(0, n), 0);
}

/** Matches supercluster's `getClusterProperties` abbreviation exactly (the
 *  same formatting MapLibre's `point_count_abbreviated` property carries for
 *  the legacy `cluster-count` text layer — see
 *  node_modules/maplibre-gl/dist/maplibre-gl-dev.js), so a cluster's label
 *  reads identically whether it's rendered as a donut marker or (past
 *  DONUT_CAP) the plain circle+count GL layers it hands off to:
 *  count >= 10000 → round to the nearest 1000, e.g. 12345 -> "12k"
 *  count >= 1000   → round to one decimal of a thousand, e.g. 1500 -> "1.5k"
 *  otherwise       → the exact count. */
export function formatDonutCount(total: number): string {
  if (total >= 10000) return `${Math.round(total / 1000)}k`;
  if (total >= 1000) return `${Math.round(total / 100) / 10}k`;
  return String(total);
}

/** Builds the full marker SVG markup (string in, string out — pure) for a
 *  cluster's price-band mix. Segment stroke-width and overall size scale with
 *  the same step function as the legacy circle-radius expression so donut
 *  markers read at a consistent size against the layers they replace. */
export function buildDonutMarkerSvg(params: DonutMarkerSvgParams): string {
  const total = donutTotal(params.counts);
  const outerRadius = donutOuterRadius(total);
  const strokeWidth = Math.max(3, outerRadius * 0.42);
  const ringRadius = outerRadius - strokeWidth / 2;
  const size = outerRadius * 2;
  const segments = buildDonutStrokeSegments(params.counts, params.colors, ringRadius);
  const fontSize = Math.max(8, outerRadius * 0.62);
  const label = formatDonutCount(total);
  const segmentMarkup = segments
    .map(
      (seg) =>
        `<circle cx="${outerRadius}" cy="${outerRadius}" r="${ringRadius}" fill="none" ` +
        `stroke="${seg.color}" stroke-width="${strokeWidth}" ` +
        `stroke-dasharray="${seg.dasharray}" stroke-dashoffset="${seg.dashoffset}" ` +
        `stroke-linecap="butt" data-bucket="${seg.index}" />`,
    )
    .join("");
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${total} pubs">` +
    `<circle cx="${outerRadius}" cy="${outerRadius}" r="${ringRadius}" fill="none" ` +
    `stroke="${params.ringColor}" stroke-width="${strokeWidth}" opacity="0.28" />` +
    `<g transform="rotate(-90 ${outerRadius} ${outerRadius})">${segmentMarkup}</g>` +
    `<text x="${outerRadius}" y="${outerRadius}" text-anchor="middle" dominant-baseline="central" ` +
    `fill="${params.textColor}" font-size="${fontSize}" font-weight="700" ` +
    `font-family="sans-serif">${label}</text>` +
    `</svg>`
  );
}
