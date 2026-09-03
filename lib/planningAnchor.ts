import type { CityId } from "@/lib/cities";
import type { PlanningIntentArea } from "@/lib/planningIntent";

/**
 * Shared, client-safe contract for the canonical planning anchor. The server
 * resolver (`planningAnchor.server.ts`) owns the actual venue lookup; this file
 * only holds the vocabulary both sides agree on so a client can render the
 * privacy-safe display and read a machine-readable conflict.
 */

export const ANCHOR_CONFLICT_CODES = [
  "ANCHOR_VENUE_INVALID",
  "ANCHOR_CITY_MISMATCH",
  "ANCHOR_AREA_CONFLICT",
  "ANCHOR_PROMOTED",
  "ANCHOR_SAFETY_EXCLUDED",
  "ANCHOR_OPENING_CONFLICT",
  "ANCHOR_BUDGET_CONFLICT",
  "ANCHOR_ACCESS_CONFLICT",
  "ANCHOR_ROUTE_CONFLICT",
] as const;

export type AnchorConflictCode = (typeof ANCHOR_CONFLICT_CODES)[number];

/** Honest freshness of the recomputed price evidence, mirroring Tonight's split. */
export type PlanningAnchorFreshnessKind =
  | "provider-observed"
  | "dataset-generated"
  | "unknown";

export type PlanningAnchorPriceEvidence = {
  kind: "price" | "whats-on" | "directory";
  label: string;
  observedAt: string | null;
  freshnessKind: PlanningAnchorFreshnessKind;
};

/**
 * Privacy-safe projection of the person's own accepted Venue. It carries no
 * server-internal scoring, no alternative venues, and no Route — only what the
 * acceptance surface needs to confirm "same Venue, same context".
 */
export type PlanningAnchorDisplayDTO = {
  venueId: string;
  venueName: string;
  areaName: string | null;
  startLabel: string | null;
  priceEvidence: PlanningAnchorPriceEvidence | null;
  routeWindowOk: boolean;
  budgetCompatible: boolean;
  accessibilityCompatible: boolean;
};

/**
 * Canonical machine context fed verbatim into anchored generation. Server-owned
 * in practice, but the type is shared so the generation seam cannot drift.
 */
export type PlanningAnchorCanonical = {
  cityId: CityId;
  venueId: string;
  nightAreaSlug: string | null;
  acceptedArea: PlanningIntentArea;
  coordinates: { lat: number; lng: number } | null;
  startsAt: string | null;
  priceObservedAt: string | null;
  priceFreshnessKind: PlanningAnchorFreshnessKind;
};

export type PlanningAnchorResolved = {
  status: "resolved";
  display: PlanningAnchorDisplayDTO;
  canonical: PlanningAnchorCanonical;
};

export type PlanningAnchorConflict = {
  status: "conflict";
  code: AnchorConflictCode;
  message: string;
};

export type PlanningAnchorResult = PlanningAnchorResolved | PlanningAnchorConflict;

// Reader-visible from the moment a conflict reaches the composer, so these say
// "pub" and "plan": "Venue" and "Route" are our own nouns for a row and a
// derived path, and a person reads them as a different product than the one
// whose button they just pressed.
const ANCHOR_CONFLICT_MESSAGES: Record<AnchorConflictCode, string> = {
  ANCHOR_VENUE_INVALID: "We could not find that pub. Choose a pub to build your plan around.",
  ANCHOR_CITY_MISMATCH: "That pub is not in this city. Pick a pub in the same city as your night.",
  ANCHOR_AREA_CONFLICT: "That pub sits outside your accepted area. Keep the area or accept a pub inside it.",
  ANCHOR_PROMOTED: "That pub cannot anchor a plan. Choose a pub you accepted from real results.",
  ANCHOR_SAFETY_EXCLUDED: "That pub is currently excluded. Choose another pub to anchor your plan.",
  ANCHOR_OPENING_CONFLICT: "That pub is not open for your chosen time. Adjust the time or accept another pub.",
  ANCHOR_BUDGET_CONFLICT: "That pub does not fit your budget. Raise the budget or accept another pub.",
  ANCHOR_ACCESS_CONFLICT: "That pub does not meet your access needs. Accept a pub that does.",
  ANCHOR_ROUTE_CONFLICT: "We could not build a route from that pub right now. Try a different pub.",
};

export function isAnchorConflictCode(value: unknown): value is AnchorConflictCode {
  return typeof value === "string" && (ANCHOR_CONFLICT_CODES as readonly string[]).includes(value);
}

/** Build a canonical conflict with a privacy-safe message (never names the Venue). */
export function planningAnchorConflict(code: AnchorConflictCode): PlanningAnchorConflict {
  return { status: "conflict", code, message: ANCHOR_CONFLICT_MESSAGES[code] };
}
