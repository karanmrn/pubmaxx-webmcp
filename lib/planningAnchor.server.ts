import "server-only";

import type { CityId } from "@/lib/cities";
import { venueIdMatchesCity } from "@/lib/cityVenueIds";
import {
  nearestNightAreaForViewport,
  isNightAreaRouteReady,
} from "@/lib/nightAreas";
import { nearestNightPatch } from "@/lib/nearestNightPatch";
import { resolveNightPatch } from "@/lib/nightPatches";
import {
  planningAnchorConflict,
  type PlanningAnchorConflict,
  type PlanningAnchorPriceEvidence,
  type PlanningAnchorResult,
} from "@/lib/planningAnchor";
import type { PlanningIntentArea } from "@/lib/planningIntent";
import { isKnownStepFree } from "@/lib/venueAccessibility";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import { getVenueDetail } from "@/lib/venueDetailIndex";
import type { Venue } from "@/lib/venues";
import { isPubVenue } from "@/lib/venueKindFilters";

/**
 * `resolvePlanningAnchor` is the single server-owned seam that turns a client's
 * accepted-Venue reference into either a canonical, privacy-safe anchor or a
 * machine-readable conflict. The same canonical DTO it returns is what anchored
 * generation consumes, so the accepted Venue, area, and freshness can never be
 * silently re-derived downstream. It never widens the accepted area to make an
 * anchor fit.
 *
 * The dataset carries no promoted/sponsored flag, no reviewed safety-exclusion
 * list, and no per-Venue opening hours. Those three checks are therefore honest
 * injectable policy seams: their defaults assert "not promoted / not excluded /
 * opening unknown" so they never fabricate a signal, while tests inject real
 * fixtures to exercise every conflict code.
 */

const VENUE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export type ResolvePlanningAnchorInput = {
  cityId: CityId;
  venueId: string;
  startsAt: string | null;
  acceptedArea: PlanningIntentArea;
  now?: number;
  /** Optional additive requirements; absent means no constraint. */
  budgetPerPersonPence?: number | null;
  requiresStepFreeAccess?: boolean;
};

export type OpeningEvidence = "open" | "closed" | "unknown";

export type ResolvePlanningAnchorDeps = {
  loadVenue: (id: string) => Promise<Venue | null>;
  resolveAlias: (id: string) => Promise<string>;
  matchesCity: (venueId: string, cityId: CityId) => boolean;
  isPromoted: (venue: Venue) => boolean;
  isSafetyExcluded: (venue: Venue) => boolean;
  openingForWindow: (venue: Venue, startsAt: string | null, now: number) => OpeningEvidence;
  hasRouteContext: (venue: Venue, acceptedArea: PlanningIntentArea) => boolean;
};

const DEFAULT_DEPS: ResolvePlanningAnchorDeps = {
  loadVenue: getVenueDetail,
  resolveAlias: resolveCanonicalVenueId,
  matchesCity: venueIdMatchesCity,
  // Seeded demo content must never masquerade as a real accepted result.
  isPromoted: (venue) => venue.curation.provenance === "demo",
  // No venue is currently on a reviewed safety-exclusion list.
  isSafetyExcluded: () => false,
  // The dataset has no per-venue opening hours; we never guess a closure.
  openingForWindow: () => "unknown",
  hasRouteContext: () => true,
};

function normalizeBorough(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalStartsAt(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) return null;
  return value;
}

function venueInAcceptedArea(venue: Venue, acceptedArea: PlanningIntentArea): boolean {
  if (acceptedArea === null) return true;
  if (acceptedArea.kind === "borough") {
    const target = normalizeBorough(acceptedArea.name);
    return [venue.primaryBorough, ...venue.visibleBoroughs]
      .map(normalizeBorough)
      .includes(target);
  }
  // A night patch is membership by nearest-patch, never a widened radius.
  const patch = nearestNightPatch(venue.latitude, venue.longitude);
  return patch?.id === acceptedArea.id;
}

function gbpLabel(price: number): string {
  return `£${price.toFixed(2)}`;
}

function priceEvidenceFor(venue: Venue): PlanningAnchorPriceEvidence | null {
  const contributorAt = venue.latestContributorAt;
  if (
    typeof venue.latestContributorPrice === "number"
    && typeof contributorAt === "string"
    && Number.isFinite(Date.parse(contributorAt))
  ) {
    return {
      kind: "price",
      label: gbpLabel(venue.latestContributorPrice),
      observedAt: contributorAt,
      freshnessKind: "provider-observed",
    };
  }
  if (typeof venue.cheapestPrice === "number") {
    return {
      kind: "price",
      label: gbpLabel(venue.cheapestPrice),
      observedAt: null,
      freshnessKind: "dataset-generated",
    };
  }
  return null;
}

function areaNameFor(
  acceptedArea: PlanningIntentArea,
  nightAreaName: string | null,
): string | null {
  if (acceptedArea === null) return nightAreaName;
  if (acceptedArea.kind === "borough") return acceptedArea.name;
  return resolveNightPatch(acceptedArea.id)?.label ?? nightAreaName;
}

/** Resolve one accepted Venue into a canonical anchor or a machine-readable conflict. */
export async function resolvePlanningAnchor(
  input: ResolvePlanningAnchorInput,
  overrides: Partial<ResolvePlanningAnchorDeps> = {},
): Promise<PlanningAnchorResult> {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const now = typeof input.now === "number" && Number.isFinite(input.now) ? input.now : Date.now();

  if (typeof input.venueId !== "string" || !VENUE_ID_PATTERN.test(input.venueId)) {
    return conflict("ANCHOR_VENUE_INVALID");
  }

  const canonicalVenueId = (await deps.resolveAlias(input.venueId)).trim();
  if (!canonicalVenueId) return conflict("ANCHOR_VENUE_INVALID");

  const venue = await deps.loadVenue(canonicalVenueId);
  if (!venue) return conflict("ANCHOR_VENUE_INVALID");
  if (!isPubVenue(venue)) return conflict("ANCHOR_VENUE_INVALID");

  if (!deps.matchesCity(canonicalVenueId, input.cityId)) return conflict("ANCHOR_CITY_MISMATCH");
  if (deps.isPromoted(venue)) return conflict("ANCHOR_PROMOTED");
  if (deps.isSafetyExcluded(venue)) return conflict("ANCHOR_SAFETY_EXCLUDED");
  if (!venueInAcceptedArea(venue, input.acceptedArea)) return conflict("ANCHOR_AREA_CONFLICT");

  const startsAt = canonicalStartsAt(input.startsAt);
  if (deps.openingForWindow(venue, startsAt, now) === "closed") return conflict("ANCHOR_OPENING_CONFLICT");

  if (
    typeof input.budgetPerPersonPence === "number"
    && Number.isFinite(input.budgetPerPersonPence)
    && typeof venue.cheapestPrice === "number"
    && Math.round(venue.cheapestPrice * 100) > input.budgetPerPersonPence
  ) {
    return conflict("ANCHOR_BUDGET_CONFLICT");
  }

  if (input.requiresStepFreeAccess === true && !isKnownStepFree(venue)) {
    return conflict("ANCHOR_ACCESS_CONFLICT");
  }

  if (!deps.hasRouteContext(venue, input.acceptedArea)) return conflict("ANCHOR_ROUTE_CONFLICT");

  const nightArea = nearestNightAreaForViewport(input.cityId, [venue.longitude, venue.latitude]);
  const priceEvidence = priceEvidenceFor(venue);
  const routeWindowOk = nightArea ? isNightAreaRouteReady(nightArea, new Date(now)) : true;
  const accessibilityCompatible = input.requiresStepFreeAccess !== true || isKnownStepFree(venue);
  const budgetCompatible = !(
    typeof input.budgetPerPersonPence === "number"
    && Number.isFinite(input.budgetPerPersonPence)
    && typeof venue.cheapestPrice === "number"
    && Math.round(venue.cheapestPrice * 100) > input.budgetPerPersonPence
  );

  return {
    status: "resolved",
    display: {
      venueId: canonicalVenueId,
      venueName: venue.name,
      areaName: areaNameFor(input.acceptedArea, nightArea?.name ?? null),
      startLabel: startsAt,
      priceEvidence,
      routeWindowOk,
      budgetCompatible,
      accessibilityCompatible,
    },
    canonical: {
      cityId: input.cityId,
      venueId: canonicalVenueId,
      nightAreaSlug: nightArea?.slug ?? null,
      acceptedArea: input.acceptedArea,
      coordinates: { lat: venue.latitude, lng: venue.longitude },
      startsAt,
      priceObservedAt: priceEvidence?.observedAt ?? null,
      priceFreshnessKind: priceEvidence?.freshnessKind ?? "unknown",
    },
  };
}

function conflict(code: PlanningAnchorConflict["code"]): PlanningAnchorConflict {
  return planningAnchorConflict(code);
}
