import type { PoiCategory } from "@/lib/pois";
import { POI_CATEGORIES, POI_CATEGORY_META } from "@/lib/pois";

// UI toggle groups for the map Layers control. Tube and Rail stay separate
// (plan: Tube, Rail, Bus, River, Parks, Gardens, …); map symbols stay distinct.

export type PoiToggleGroupId =
  | "tube"
  | "rail"
  | "bus"
  | "river"
  | "park"
  | "garden"
  | "market"
  | "historic"
  | "viewpoint"
  | "sight";

export type PoiToggleGroup = {
  id: PoiToggleGroupId;
  label: string;
  color: string;
  categories: readonly PoiCategory[];
};

export type PoiHidden = Record<PoiCategory, boolean>;

/**
 * A poiHidden change: a full next value, or an updater applied to the OWNER'S
 * current state. Chip toggles must send the updater form - a toggle computed
 * from the chip's rendered snapshot loses every toggle the owner has accepted
 * but not yet re-rendered (tap Tube then Rail quickly: Rail's snapshot still
 * hides Tube, so Tube switches straight back off).
 */
export type PoiHiddenChange = PoiHidden | ((current: PoiHidden) => PoiHidden);

/** A stored poiHidden if it is exactly the closed category map, else null. */
export function parsePoiHidden(value: unknown): PoiHidden | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== POI_CATEGORIES.length) return null;
  const parsed = {} as PoiHidden;
  for (const category of POI_CATEGORIES) {
    if (typeof raw[category] !== "boolean") return null;
    parsed[category] = raw[category];
  }
  return parsed;
}

export const POI_TOGGLE_GROUPS: readonly PoiToggleGroup[] = [
  {
    id: "tube",
    label: "Tube",
    color: POI_CATEGORY_META.tube.color,
    categories: ["tube"],
  },
  {
    id: "rail",
    label: "Rail",
    color: POI_CATEGORY_META.rail.color,
    categories: ["rail"],
  },
  { id: "bus", label: "Bus", color: POI_CATEGORY_META.bus.color, categories: ["bus"] },
  {
    id: "river",
    label: "River",
    color: POI_CATEGORY_META.river.color,
    categories: ["river"],
  },
  {
    id: "park",
    label: "Parks",
    color: POI_CATEGORY_META.park.color,
    categories: ["park"],
  },
  {
    id: "garden",
    label: "Gardens",
    color: POI_CATEGORY_META.garden.color,
    categories: ["garden"],
  },
  {
    id: "market",
    label: "Markets",
    color: POI_CATEGORY_META.market.color,
    categories: ["market"],
  },
  {
    id: "historic",
    label: "Historic",
    color: POI_CATEGORY_META.historic.color,
    categories: ["historic"],
  },
  {
    id: "viewpoint",
    label: "Views",
    color: POI_CATEGORY_META.viewpoint.color,
    categories: ["viewpoint"],
  },
  {
    id: "sight",
    label: "Sights",
    color: POI_CATEGORY_META.sight.color,
    categories: ["sight"],
  },
];

// Desktop default: Tube + Rail + Parks + Sights on; denser ambient categories
// off until the viewer opts in (reduces first-paint dot soup).
export function defaultPoiHidden(): Record<PoiCategory, boolean> {
  return {
    tube: false,
    rail: false,
    bus: true,
    river: true,
    park: false,
    garden: true,
    market: true,
    historic: true,
    viewpoint: true,
    sight: false,
  };
}

// Mobile default: every POI layer hidden so the map mid-field stays clean.
// Viewers opt in via the corner Layers control.
export function defaultPoiHiddenMobile(): Record<PoiCategory, boolean> {
  return {
    tube: true,
    rail: true,
    bus: true,
    river: true,
    park: true,
    garden: true,
    market: true,
    historic: true,
    viewpoint: true,
    sight: true,
  };
}

export function isMobileMapViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
}

export function defaultPoiHiddenForViewport(): Record<PoiCategory, boolean> {
  return isMobileMapViewport() ? defaultPoiHiddenMobile() : defaultPoiHidden();
}

export function isPoiGroupOn(
  hidden: Record<PoiCategory, boolean>,
  group: PoiToggleGroup,
): boolean {
  return group.categories.every((category) => !hidden[category]);
}

export function togglePoiGroup(
  hidden: Record<PoiCategory, boolean>,
  group: PoiToggleGroup,
): Record<PoiCategory, boolean> {
  const turnOn = !isPoiGroupOn(hidden, group);
  const next = { ...hidden };
  for (const category of group.categories) {
    next[category] = !turnOn;
  }
  return next;
}

/**
 * The change a Layers chip tap dispatches: an updater over the OWNER'S current
 * state, never over the chip's rendered snapshot. Two taps landing before the
 * owner re-renders share one stale snapshot, so the snapshot form makes each
 * new toggle revert the one before it (the "layers keep disappearing" defect).
 */
export function poiGroupToggleChange(
  group: PoiToggleGroup,
): (current: PoiHidden) => PoiHidden {
  return (current) => togglePoiGroup(current, group);
}

/** Coloured tube-line network follows the Tube chip only (Rail is stations). */
export function isTransitNetworkVisible(hidden: Record<PoiCategory, boolean>): boolean {
  return !hidden.tube;
}
