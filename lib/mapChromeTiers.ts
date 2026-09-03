// Map-chrome tier model (the #352 consolidation verdict, implemented).
//
// At full merge the mobile map was headed for SEVEN peer chips on 390px —
// instrument-panel, not answer. This module is the single source of truth for
// what sits where, so the shell renders hierarchy instead of a flat rail:
//
//   TIER 1  Near me            — THE answer; a round map-edge FAB, the map's
//                                one primary action.
//   TIER 2  Filters            — one icon-button in the single top bar. It
//                                absorbs the old Drinks + price chips (both
//                                always opened the same sheet), the zone
//                                picker, and the venue-type toggles.
//   TIER 3  TfL               — compact corner icon-button with badges, out of
//                                the answer's way. List lives in Layers.
//
// Design judgement 2026-08-01, finding 2.3 collapsed the phone chrome to ONE
// bar. A permanent Tonight slot in that bar still fails the 320px arithmetic,
// so Tonight does not reclaim a sixth control. When What's On has listings,
// a measured cold-start chip docks under the bar (same pattern as the active
// search chip) and opens overlay "tonight" in one tap. More → Events and the
// tab bar stay as homes; they are no longer the only phone path.
//
// Pure and render-free so the hierarchy is unit-testable; the shell just maps
// descriptors to components. Adoption notes for the in-flight chip PRs live in
// docs/MAP_CHROME_TIERS.md.

export type NearMeStatus = "idle" | "requesting" | "ready" | "error";
export type TflStatus = "checking" | "clear" | "issues" | "unavailable";

export type PrimaryChipModel = {
  label: string;
  disabled: boolean;
  pressed: boolean;
};

export type FiltersChipModel = {
  label: "Filters";
  /** Number of active refinement groups (drinks, price cap, zone later). */
  refinements: number;
  /** Screen-reader detail, e.g. "Filters — drinks and ≤£8.00 active". */
  ariaLabel: string;
};

export type TonightChipModel = {
  label: "On tonight";
  count: number;
  /** Screen-reader detail, e.g. "On tonight: 3 listings" or "... near you". */
  ariaLabel: string;
};

export type CornerUtilityModel = {
  id: "tfl";
  /** Compact status suffix rendered beside the icon ("OK", "?", or null). */
  statusSuffix: string | null;
  badge: number | null;
  ariaLabel: string;
};

export function buildNearMeChip(status: NearMeStatus, nearbyCount: number): PrimaryChipModel {
  return {
    label:
      status === "requesting"
        ? "Locating"
        : status === "ready"
          ? `Nearby ${nearbyCount}`
          : status === "error"
            ? "Try near me"
            : "Near me",
    disabled: status === "requesting",
    pressed: status === "ready",
  };
}

export function buildFiltersChip(input: {
  drinkFiltersActive: boolean;
  priceCapActive: boolean;
  priceLabel: string;
  /** #329 adoption: the zone lens filter counts as a third refinement. */
  zoneActive?: boolean;
  /** Dedicated experience view, named separately from drink filters. */
  experienceLabel?: "no-alcohol view" | "food view";
  /** Phone Filters sheet: Saved only is on (same field as the desktop rail). */
  savedOnlyActive?: boolean;
  /** Open now is on (known-closed pubs dropped; unknown hours stay). */
  openNowActive?: boolean;
}): FiltersChipModel {
  const refinements =
    (input.drinkFiltersActive ? 1 : 0) +
    (input.priceCapActive ? 1 : 0) +
    (input.zoneActive ? 1 : 0) +
    (input.experienceLabel ? 1 : 0) +
    (input.savedOnlyActive ? 1 : 0) +
    (input.openNowActive ? 1 : 0);
  const parts: string[] = [];
  if (input.experienceLabel) parts.push(input.experienceLabel);
  if (input.drinkFiltersActive) parts.push("drinks");
  if (input.priceCapActive) parts.push(input.priceLabel);
  if (input.zoneActive) parts.push("zone");
  if (input.savedOnlyActive) parts.push("saved only");
  if (input.openNowActive) parts.push("open now");
  return {
    label: "Filters",
    refinements,
    ariaLabel: refinements === 0 ? "Filters" : `Filters: ${parts.join(" and ")} active`,
  };
}

export function buildTflCorner(status: TflStatus, count: number): CornerUtilityModel {
  const statusSuffix = status === "clear" ? "OK" : status === "unavailable" ? "?" : null;
  return {
    id: "tfl",
    statusSuffix,
    badge: count > 0 ? count : null,
    ariaLabel:
      status === "clear"
        ? "TfL live: lines running well"
        : status === "unavailable"
          ? "TfL live: status unavailable"
          : count > 0
            ? `TfL live: ${count} updates`
            : "TfL live",
  };
}

/**
 * Cold-start Tonight entry for the phone map. Honest empty: no chip when the
 * What's On spine has nothing to show, so a quiet night never advertises a
 * dead door. The shell mounts this under the one top bar, never inside it.
 */
export function buildTonightChip(
  rowCount: number,
  nearReader: boolean,
): TonightChipModel | null {
  if (!Number.isFinite(rowCount) || rowCount <= 0) return null;
  const count = Math.floor(rowCount);
  const nearSuffix = nearReader ? " near you" : "";
  return {
    label: "On tonight",
    count,
    ariaLabel:
      count === 1
        ? `On tonight: 1 listing${nearSuffix}`
        : `On tonight: ${count} listings${nearSuffix}`,
  };
}
