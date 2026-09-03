// Hand-written types for the plain-JS nearest-station zone module (allowJs is
// off, so tsc needs a declaration to typecheck the unit tests that import it).
// Keep in lockstep with scripts/lib/stationZones.mjs.

export interface StationZone {
  name: string;
  lat: number;
  lng: number;
  zone: number;
}

export interface NearestStationZone {
  zone: number;
  station: string;
  distanceKm: number;
}

export function haversineKm(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
): number;

export function nearestStationZone(
  lat: number,
  lng: number,
  stations: readonly StationZone[],
): NearestStationZone | null;

export function loadStationZones(): Promise<StationZone[]>;
