/**
 * What may float on the map surface itself.
 *
 * Search stays. One toast stays. Key, list, price, and filters do not stack
 * over the pins — readers reach the price key and the venue list through
 * Layers (`MapLayersControl` / overlay "layers").
 */

export type MapSurfaceToastKind = "none" | "selection" | "soft-retry";

export function pickMapSurfaceToast(input: {
  selectionNotice: boolean;
  selectionNoticePriority?: boolean;
  softRetry: boolean;
}): MapSurfaceToastKind {
  if (input.selectionNotice && input.selectionNoticePriority) return "selection";
  if (input.softRetry) return "soft-retry";
  if (input.selectionNotice) return "selection";
  return "none";
}
