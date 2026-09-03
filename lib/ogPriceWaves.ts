export type PriceBandCounts = readonly [number, number, number];

export type OgWaveSize = Readonly<{
  width: number;
  height: number;
}>;

export type OgPriceWaveLayer = Readonly<{
  band: 0 | 1 | 2;
  count: number;
  share: number;
  path: string;
}>;

const BASELINE_RATIOS = [0.38, 0.56, 0.74] as const;

function normalizeCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function buildClosedWavePath(
  band: 0 | 1 | 2,
  share: number,
  size: OgWaveSize,
): string {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const baseline = Math.round(height * BASELINE_RATIOS[band]);
  const amplitude = Math.round(height * (0.06 + share * 0.18));
  const firstControlX = Math.round(width * (0.14 + share * 0.08));
  const secondControlX = Math.round(width * (0.34 + band * 0.04));
  const midpointX = Math.round(width * (0.53 - share * 0.05 + band * 0.015));
  const finalControlX = Math.round(width * (0.78 + band * 0.02));
  const finalControlY = baseline - Math.round(amplitude * 0.85);
  const endY = baseline + Math.round(amplitude * 0.2);

  return [
    `M 0 ${baseline}`,
    `C ${firstControlX} ${baseline - amplitude}`,
    `${secondControlX} ${baseline + amplitude}`,
    `${midpointX} ${baseline}`,
    `S ${finalControlX} ${finalControlY}`,
    `${width} ${endY}`,
    `L ${width} ${height}`,
    `L 0 ${height}`,
    "Z",
  ].join(" ");
}

/**
 * Convert cheap, middle, and dear pint-band counts into deterministic SVG
 * layers. Zero-count bands produce no layer, so every visible curve carries
 * data and the card never fills a gap with decorative noise.
 */
export function deriveOgPriceWaveLayers(
  counts: PriceBandCounts,
  size: OgWaveSize,
): OgPriceWaveLayer[] {
  const normalized: [number, number, number] = [
    normalizeCount(counts[0]),
    normalizeCount(counts[1]),
    normalizeCount(counts[2]),
  ];
  const total = normalized.reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];

  const layers: OgPriceWaveLayer[] = [];
  normalized.forEach((count, index) => {
    if (count === 0) return;
    const band = index as 0 | 1 | 2;
    const share = count / total;
    layers.push({
      band,
      count,
      share,
      path: buildClosedWavePath(band, share, size),
    });
  });
  return layers;
}
