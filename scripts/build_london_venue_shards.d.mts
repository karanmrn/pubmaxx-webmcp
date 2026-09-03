export const LONDON_VENUE_DIR_NAME: string;
export const LONDON_VENUE_SHARD_VERSION: number;
export const LONDON_VENUE_GRID: {
  originLat: number;
  originLon: number;
  latStep: number;
  lonStep: number;
};

export function inGreaterLondon(lat: number, lng: number): boolean;
export function londonLayerBbox(): [number, number, number, number];
