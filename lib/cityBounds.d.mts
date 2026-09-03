export type CityBounds = {
  readonly latMin: number;
  readonly lonMin: number;
  readonly latMax: number;
  readonly lonMax: number;
};

export const CITY_BOUNDS: Record<string, CityBounds>;

export function overpassBbox(
  cityId: string,
): [number, number, number, number];
