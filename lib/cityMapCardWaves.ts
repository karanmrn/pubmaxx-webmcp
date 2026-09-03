import {
  deriveOgPriceWaveLayers,
  type OgPriceWaveLayer,
  type PriceBandCounts,
} from "@/lib/ogPriceWaves";

const CITY_MAP_CARD_SIZE = {
  width: 1200,
  height: 630,
} as const;

// Wave layer fills — restricted to the three-colour palette (ink near-black,
// warm paper, coral accent) as varying-opacity washes, never a fourth hue.
// Cheap pints read coral (the most inviting band); dear pints read ink,
// receding into the card's own dark ground.
const WAVE_COLOURS: Readonly<Record<0 | 1 | 2, string>> = {
  0: "rgba(255,90,95,0.22)",
  1: "rgba(255,244,232,0.10)",
  2: "rgba(25,25,39,0.4)",
};

export function waveColour(band: 0 | 1 | 2): string {
  return WAVE_COLOURS[band];
}

/**
 * Wraps deriveOgPriceWaveLayers at this card's fixed size, so a route test can
 * prove different band distributions produce different SVG paths without
 * touching next/og internals.
 */
export function buildOgMapCardWaveLayers(
  counts: PriceBandCounts,
): OgPriceWaveLayer[] {
  return deriveOgPriceWaveLayers(counts, CITY_MAP_CARD_SIZE);
}
