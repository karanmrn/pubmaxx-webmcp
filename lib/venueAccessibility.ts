import type { Venue } from "@/lib/venues";

// Accessible-venue facts (PRD issue #28 — the unbuilt half of Accessibility &
// Legacy Mode). Every field is OPTIONAL and absence means honestly UNKNOWN — we
// NEVER default a missing fact to `false`, because "we don't know" and "no" are
// different truths and this repo's whole moat is not fabricating data. A pub is
// only ever shown as step-free / accessible-toilet / seated-service when that
// fact is publicly documented (see lib/venueAccessibilitySeeds.ts for the
// provenance-stamped curated seed). Everything else stays unknown.
export type VenueAccessibility = {
  // Step-free / level entry to the pub (no step at the door).
  stepFree?: boolean;
  // A dedicated accessible / disabled toilet is available.
  accessibleToilet?: boolean;
  // Table / seated service is offered (you can be served without standing at
  // the bar) — matters for anyone who can't queue at a busy bar.
  seatedService?: boolean;
  // Free-text quiet-hours note where a venue publishes one, e.g.
  // "Quieter before 5pm weekdays". Rare — most pubs never state one.
  quietHours?: string;
};

// The three boolean facets the filter checkboxes map to. quietHours is a
// display-only free-text note, not a filter, so it isn't in this set.
export type AccessibilityFacet = "stepFree" | "accessibleToilet" | "seatedService";

export type AccessibilityFilters = {
  stepFree: boolean;
  accessibleToilet: boolean;
  seatedService: boolean;
};

export const EMPTY_ACCESSIBILITY_FILTERS: AccessibilityFilters = {
  stepFree: false,
  accessibleToilet: false,
  seatedService: false,
};

// Human labels for each facet — shared by the filter checkboxes and the venue
// chips so copy never drifts between the two surfaces.
export const ACCESSIBILITY_FACET_LABELS: Record<AccessibilityFacet, string> = {
  stepFree: "Step-free entry",
  accessibleToilet: "Accessible toilet",
  seatedService: "Seated service",
};

// ---------------------------------------------------------------------------
// Predicates. Each returns true ONLY when the fact is KNOWN true — an undefined
// (unknown) field is never treated as a yes. Callers that want to distinguish
// "known false" from "unknown" should read the raw field; these predicates are
// the "confirmed yes?" question the filters and chips ask.

export function isKnownStepFree(venue: Venue): boolean {
  return venue.accessibility?.stepFree === true;
}

export function isKnownAccessibleToilet(venue: Venue): boolean {
  return venue.accessibility?.accessibleToilet === true;
}

export function isKnownSeatedService(venue: Venue): boolean {
  return venue.accessibility?.seatedService === true;
}

const FACET_PREDICATES: Record<AccessibilityFacet, (venue: Venue) => boolean> = {
  stepFree: isKnownStepFree,
  accessibleToilet: isKnownAccessibleToilet,
  seatedService: isKnownSeatedService,
};

// True when a venue has at least one KNOWN-true accessibility fact worth showing
// as a chip (quietHours counts — a published quiet-hours note is a real fact).
export function hasKnownAccessibility(venue: Venue): boolean {
  return (
    isKnownStepFree(venue) ||
    isKnownAccessibleToilet(venue) ||
    isKnownSeatedService(venue) ||
    hasQuietHours(venue)
  );
}

export function hasQuietHours(venue: Venue): boolean {
  return typeof venue.accessibility?.quietHours === "string" &&
    venue.accessibility.quietHours.trim().length > 0;
}

// ---------------------------------------------------------------------------
// The core filter contract: an UNKNOWN field FAILS a positive filter. Filtering
// for step-free must show ONLY pubs we KNOW are step-free — a pub with no data
// is excluded, never optimistically included. An all-off filter set is a no-op
// (every venue passes), preserving existing behaviour when nothing is selected.
export function matchesAccessibilityFilters(
  venue: Venue,
  filters: AccessibilityFilters,
): boolean {
  return (Object.keys(FACET_PREDICATES) as AccessibilityFacet[]).every(
    (facet) => !filters[facet] || FACET_PREDICATES[facet](venue),
  );
}

// Any accessibility filter switched on? Lets callers cheaply decide whether to
// show the honest "only confirmed pubs" count/empty copy.
export function anyAccessibilityFilterActive(filters: AccessibilityFilters): boolean {
  return filters.stepFree || filters.accessibleToilet || filters.seatedService;
}

// ---------------------------------------------------------------------------
// Display helpers.

// The known-true accessibility facets on a venue, as facet keys — for rendering
// the chip row (unknown/known-false facets are simply omitted, never shown as a
// "No", per the honesty rule).
export function knownAccessibilityFacets(venue: Venue): AccessibilityFacet[] {
  return (Object.keys(FACET_PREDICATES) as AccessibilityFacet[]).filter((facet) =>
    FACET_PREDICATES[facet](venue),
  );
}

// A short chip label for each known-true facet, in display order.
export function accessibilityChipLabels(venue: Venue): string[] {
  return knownAccessibilityFacets(venue).map((facet) => ACCESSIBILITY_FACET_LABELS[facet]);
}

// The published quiet-hours note, trimmed, or null when none is documented.
export function quietHoursLabel(venue: Venue): string | null {
  const raw = venue.accessibility?.quietHours;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Honest count/empty copy for the filter rail: how many pubs in the current set
// are CONFIRMED for the active accessibility filters, framed so a small number
// never reads as a broken filter — it reads as "help us by spilling what you
// know". Returns null when no accessibility filter is active (nothing to say).
export function accessibilityFilterSummary(
  filters: AccessibilityFilters,
  confirmedCount: number,
): string | null {
  if (!anyAccessibilityFilterActive(filters)) return null;
  const active = (Object.keys(FACET_PREDICATES) as AccessibilityFacet[])
    .filter((facet) => filters[facet])
    .map((facet) => ACCESSIBILITY_FACET_LABELS[facet].toLowerCase());
  const phrase =
    active.length === 1
      ? active[0]
      : `${active.slice(0, -1).join(", ")} and ${active[active.length - 1]}`;
  return `Only showing pubs with confirmed ${phrase}. ${confirmedCount} confirmed so far; help by spilling what you know.`;
}
