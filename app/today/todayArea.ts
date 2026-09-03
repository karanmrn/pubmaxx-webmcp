// The one place /today answers "near you" from. The morning brief has no map
// centre to lean on (unlike the map's Area button), so its location-aware cards
// resolve a coordinate from the viewer's remembered area, with a central London
// default. A remembered patch uses its own walking-heart coordinate; a
// remembered borough (which carries no coordinate of its own here) and no memory
// at all both fall back to central London. Pure and node-testable: no
// localStorage, no DOM.

import {
  CENTRAL_PATCH,
  resolveNightPatch,
  type NightPatch,
  type RememberedArea,
} from "@/lib/nightPatches";

/**
 * The patch coordinate /today treats as "near you", derived from the remembered
 * area. Always returns a usable patch (central London when nothing better is
 * known), so the location-aware cards never have to reason about a blank centre.
 */
export function rememberedAreaCentre(remembered: RememberedArea | null): NightPatch {
  if (remembered?.kind === "patch") {
    const patch = resolveNightPatch(remembered.id);
    if (patch) return patch;
  }
  return CENTRAL_PATCH;
}
