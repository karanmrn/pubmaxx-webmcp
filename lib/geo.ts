// Small shared geo helpers used across client and server egress boundaries.

export type LatLngPoint = { lat: number; lng: number };

const VIEWER_COORDINATE_FACTOR = 1_000;

/**
 * Reduce a viewer point to three decimals before network egress.
 *
 * Three decimals is roughly a 70 to 110 metre cell in the UK. That still
 * answers nearest-pub and nearest-station questions without transmitting the
 * browser's building-level GPS fix. Browser request builders and server
 * third-party forwarders both use this seam, so direct API callers cannot
 * bypass the same reduction downstream.
 */
export function coarsenViewerPoint(point: LatLngPoint): LatLngPoint {
  return {
    lat: Math.round(point.lat * VIEWER_COORDINATE_FACTOR) / VIEWER_COORDINATE_FACTOR,
    lng: Math.round(point.lng * VIEWER_COORDINATE_FACTOR) / VIEWER_COORDINATE_FACTOR,
  };
}
