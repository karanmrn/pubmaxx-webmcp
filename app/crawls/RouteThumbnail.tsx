// Tiny honest route-shape thumbnail for the /crawls cards (E4): the crawl's
// resolved stop coordinates as a normalised polyline in a square viewBox.
// Straight lines between stops — deliberately NOT a map, matching the
// "straight-line" honesty rule in lib/routeLegs. Renders nothing when fewer
// than 2 points exist (never fakes a shape). Strokes/fills use currentColor
// so the card's CSS color drives it in both themes with zero new tokens.

type RouteThumbnailProps = {
  /** Ordered stop coordinates in [lng, lat] (GeoJSON) order. */
  points: readonly [number, number][];
  className?: string;
  label?: string;
};

const VIEW = 100;
const PAD = 14;

export default function RouteThumbnail({ points, className, label }: RouteThumbnailProps) {
  if (points.length < 2) return null;

  // Equirectangular normalisation: scale longitude by cos(mid-latitude) so a
  // route's proportions survive the degrees→pixels squash at London latitudes,
  // then fit the larger span into the padded square (uniform scale, centred on
  // the shorter axis) with Y flipped (north up).
  const midLat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const xsRaw = points.map((p) => p[0] * lngScale);
  const ysRaw = points.map((p) => p[1]);
  const minX = Math.min(...xsRaw);
  const maxX = Math.max(...xsRaw);
  const minY = Math.min(...ysRaw);
  const maxY = Math.max(...ysRaw);
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const inner = VIEW - PAD * 2;
  const xOffset = (span - (maxX - minX)) / 2;
  const yOffset = (span - (maxY - minY)) / 2;
  const coords = points.map((_, i): [number, number] => [
    PAD + ((xsRaw[i] - minX + xOffset) / span) * inner,
    PAD + ((maxY - ysRaw[i] + yOffset) / span) * inner,
  ]);
  const polylinePoints = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={className}
      role="img"
      aria-label={label ?? `Route shape: straight lines between ${points.length} stops`}
      preserveAspectRatio="xMidYMid meet"
    >
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
      {coords.map(([x, y], i) => (
        <circle
          // Coordinate pairs can repeat (out-and-back routes); index keys a static list.
          key={`${x}-${y}-${i}`}
          cx={x}
          cy={y}
          r={i === 0 || i === coords.length - 1 ? 4 : 2.6}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
