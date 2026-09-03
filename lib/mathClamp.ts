/** Numeric clamp shared by map/crawl/score helpers. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
