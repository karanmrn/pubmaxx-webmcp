// Pub Pal locality grounding (Trusted Handoff L16). Pure, node-testable: decides
// WHERE a Pal answer is grounded from the real gazetteer/night-area taxonomy —
// never inventing a locality and never describing a London-wide answer as local.
//
// Precedence (contract §L16): an area named in the query beats the remembered
// area; a remembered area fills in when the query names none; with no context at
// all the honest answer is London-wide, explicitly NOT ranked by distance.

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import {
  NIGHT_PATCHES,
  resolveNightPatch,
  type NightPatchId,
  type RememberedArea,
} from "@/lib/nightPatches";
import type { PlanningIntentArea } from "@/lib/planningIntent";

export type PalLocalityScope = "query" | "remembered" | "london-wide";

export type PalLocality = {
  scope: PalLocalityScope;
  /** The canonical acceptance area, ready for the "pal" PlanningIntent. Null = London-wide. */
  area: PlanningIntentArea;
  /** Human label for copy ("Brixton", "Soho", "London"). */
  label: string;
  /** True only when a real area was resolved; false = London-wide, distance-unranked. */
  grounded: boolean;
};

/** Honest "no distance evidence" marker — never replaced with a fabricated number. */
export const PAL_DISTANCE_UNKNOWN = "Distance not sourced";

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function mentions(haystack: string, needle: string): boolean {
  const token = normalize(needle);
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/** First gazetteer area named in the query, night patches (nightlife order) before boroughs. */
function areaFromQuery(query: string): PlanningIntentArea {
  const text = normalize(query);
  if (!text) return null;
  for (const patch of NIGHT_PATCHES) {
    if (mentions(text, patch.label) || mentions(text, patch.id)) {
      return { kind: "night-patch", id: patch.id as NightPatchId };
    }
  }
  for (const borough of LONDON_BOROUGHS) {
    if (mentions(text, borough)) return { kind: "borough", name: borough };
  }
  return null;
}

/** Map the remembered-area store shape onto a canonical acceptance area. */
function areaFromRemembered(remembered: RememberedArea | null): PlanningIntentArea {
  if (!remembered) return null;
  if (remembered.kind === "borough") {
    return LONDON_BOROUGHS.includes(remembered.name)
      ? { kind: "borough", name: remembered.name }
      : null;
  }
  return NIGHT_PATCHES.some((patch) => patch.id === remembered.id)
    ? { kind: "night-patch", id: remembered.id as NightPatchId }
    : null;
}

function labelFor(area: PlanningIntentArea): string {
  if (area === null) return "London";
  if (area.kind === "borough") return area.name;
  return resolveNightPatch(area.id)?.label ?? area.id;
}

/**
 * Resolve where a Pal answer is grounded. Explicit query area wins; else the
 * remembered area; else an honest London-wide scope that must never be shown as
 * a local, distance-ranked result.
 */
export function resolvePalLocality(
  query: string,
  remembered: RememberedArea | null,
): PalLocality {
  const fromQuery = areaFromQuery(query);
  if (fromQuery) {
    return { scope: "query", area: fromQuery, label: labelFor(fromQuery), grounded: true };
  }
  const fromRemembered = areaFromRemembered(remembered);
  if (fromRemembered) {
    return { scope: "remembered", area: fromRemembered, label: labelFor(fromRemembered), grounded: true };
  }
  return { scope: "london-wide", area: null, label: "London", grounded: false };
}

/** House-voice locality line. Grounded answers name the area; London-wide is explicit. */
export function palLocalityLine(locality: PalLocality): string {
  if (locality.grounded) {
    return locality.scope === "query"
      ? `Grounded in ${locality.label}, the area you named.`
      : `Grounded around ${locality.label}, your remembered area.`;
  }
  return "Across London. No area set, so these are not ranked by distance.";
}

/**
 * Honest walk label: a real minute count, or null so the card omits distance
 * rather than inventing one. Callers show PAL_DISTANCE_UNKNOWN when they must
 * state the absence explicitly.
 */
export function palWalkLabel(walkMinutes: number | null | undefined): string | null {
  return typeof walkMinutes === "number" && Number.isFinite(walkMinutes) && walkMinutes >= 0
    ? `about ${Math.round(walkMinutes)} min on foot`
    : null;
}
