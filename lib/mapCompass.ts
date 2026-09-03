export type CompassAction =
  | { kind: "reset-north" }
  | { kind: "adopt-attitude"; bearing: number; pitch: number }
  | { kind: "none" };

export const COMPASS_ROTATED_EPSILON = 0.5;

/**
 * Rotated map returns to north. Map at north adopts designed city attitude.
 */
export function resolveCompassAction(
  currentBearing: number,
  designed: { pitch?: number; bearing?: number },
): CompassAction {
  if (Math.abs(currentBearing) > COMPASS_ROTATED_EPSILON) {
    return { kind: "reset-north" };
  }
  const bearing = designed.bearing ?? 0;
  const pitch = designed.pitch ?? 0;
  if (bearing === 0 && pitch === 0) return { kind: "none" };
  return { kind: "adopt-attitude", bearing, pitch };
}
