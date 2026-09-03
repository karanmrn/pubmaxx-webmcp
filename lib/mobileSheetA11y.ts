import type { MapSheetDetent } from "@/lib/mobileShell";

/** Half and full snaps sit over a blocking scrim — focus stays inside the sheet. */
export function mobileSheetFocusContained(snap: MapSheetDetent): boolean {
  return snap === "half" || snap === "full";
}

/**
 * Peek keeps a sliver of map visible and does not inert the page; half and full
 * block the map behind the scrim and behave as modal surfaces.
 */
export function mobileSheetIsModal(snap: MapSheetDetent): boolean {
  return mobileSheetFocusContained(snap);
}
