// Patch-level evidence gating (Wayfinder 3.1). The city-level truth model
// (lib/cityCapabilities.ts: CityReleaseTier + per-capability CapabilityAvailability
// with dated evidence) answers "what does this CITY honestly support". This
// module pushes that same model down to patch granularity over the eight London
// night patches (lib/nightPatches.ts) so a supported ZONE is labelled honestly
// and no uniform-coverage claim ships: Soho is not Hackney, and the surface
// should say so from real counts, never a flat "we cover London".
//
// Everything here is PURE and HERMETIC. Availability is DERIVED from actual data
// counts (priced venues, coordinate-pinned listings, food-serving pubs, rated
// transport anchors) inside a patch's walking footprint — never hand-asserted.
// The counting functions take already-loaded data (slim venues, whats-on rows)
// as arguments, so both a client surface (which holds the slim index in memory)
// and a server surface can derive the same tiers, and tiny fixtures test the
// derivation end to end.
//
// Honesty contract mirrors lib/zones.ts: a capability only reads "available"
// once it clears an explicit evidence floor. Below the floor it is "limited"
// (value first, but flagged), and with zero evidence it is "unavailable". The
// floors are the single knob; a fence test proves nothing renders "available"
// under its floor.

import type {
  CapabilityAvailability,
  CityCapabilityEvidence,
} from "@/lib/cityCapabilities";
import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { haversineKm } from "@/lib/haversine";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import {
  NIGHT_PATCHES,
  type NightPatch,
  type NightPatchId,
} from "@/lib/nightPatches";

/**
 * A patch is a walkable district around its heart (a station exit / high
 * street), wider than the 12-min "near me" ring (lib/nearMeAnswer.ts). Evidence
 * within ~1.2 km of the patch centre counts toward that patch's footprint.
 */
export const PATCH_FOOTPRINT_KM = 1.2;

/**
 * Evidence floors, per capability: the count at or above which a capability is
 * "available", and the count at or above which it is "limited" (some real
 * evidence, but under the available bar). Below the limited floor is
 * "unavailable". The price floor mirrors lib/zones.ts MIN_PRICED_VENUES (10) so
 * a patch is only "well priced" once it could publish a zone median. Listings
 * and food floors are lower because those datasets are sparser per patch.
 */
export const PATCH_EVIDENCE_FLOORS = {
  prices: { available: 10, limited: 1 },
  whatsOn: { available: 5, limited: 1 },
  food: { available: 8, limited: 1 },
  transport: { available: 6, limited: 1 },
} as const satisfies Record<string, { available: number; limited: number }>;

/** The four capabilities gated per patch. */
export type PatchCapabilityKey = keyof typeof PATCH_EVIDENCE_FLOORS;

/** Raw evidence counts inside a patch footprint — the input to every tier. */
export type PatchEvidenceCounts = Readonly<{
  /** Venues with a real cheapest-pint observation inside the footprint. */
  pricedVenues: number;
  /** Coordinate-pinned whats-on rows inside the footprint (city-wide, coordless
   *  rows never count toward a patch — they are not patch evidence). */
  whatsOnRows: number;
  /** Priced venues inside the footprint that list food. */
  foodVenues: number;
  /** Priced venues inside the footprint carrying a rated TfL fare zone — the
   *  honest proxy that the patch sits on the metered transport network. */
  transportAnchors: number;
}>;

/**
 * A patch's release tier, the patch analogue of CityReleaseTier. Derived purely
 * from the price evidence (the headline capability): "core" once the patch
 * clears the price floor, "preview" while it is thinner. There is no "flagship"
 * at patch level — that word stays reserved for the city.
 */
export type PatchReleaseTier = "core" | "preview";

export type PatchCapabilityProfile = Readonly<{
  patchId: string;
  patchLabel: string;
  releaseTier: PatchReleaseTier;
  counts: PatchEvidenceCounts;
  prices: CityCapabilityEvidence;
  whatsOn: CityCapabilityEvidence;
  food: CityCapabilityEvidence;
  transport: CityCapabilityEvidence;
}>;

// ── Structural inputs ──────────────────────────────────────────────────────
// Kept minimal/structural so a SlimVenue (lib/venuesSlim.ts) and a WhatsOnRow
// (lib/whatsOn.ts) satisfy them directly — no mapping pass, no coupling.

export type PatchPricedInput = {
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  kind?: VenueKind;
  zone?: number;
  filterHints?: { amenities?: { food?: boolean } };
};

export type PatchListingInput = { lat?: number; lng?: number };

export type PatchEvidenceSources = {
  venues?: readonly PatchPricedInput[];
  listings?: readonly PatchListingInput[];
};

function withinFootprint(
  patch: { lat: number; lng: number },
  lat: number | undefined,
  lng: number | undefined,
  footprintKm: number,
): boolean {
  if (typeof lat !== "number" || !Number.isFinite(lat)) return false;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return false;
  return haversineKm([lng, lat], [patch.lng, patch.lat]) <= footprintKm;
}

function isPriced(price: number | null | undefined): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

/**
 * Count the real evidence inside a patch's footprint. Pure and deterministic:
 * a venue counts toward prices when it carries a finite positive cheapest pint,
 * toward food when it also lists food, toward transport when it also carries a
 * rated fare zone; a listing counts only when it is coordinate-pinned within the
 * footprint. Missing sources simply produce zero for that capability — never an
 * invented number.
 */
export function countPatchEvidence(
  patch: { lat: number; lng: number },
  sources: PatchEvidenceSources,
  footprintKm: number = PATCH_FOOTPRINT_KM,
): PatchEvidenceCounts {
  let pricedVenues = 0;
  let foodVenues = 0;
  let transportAnchors = 0;
  let whatsOnRows = 0;

  for (const venue of sources.venues ?? []) {
    if (!isPubVenueKind(venue.kind)) continue;
    if (!withinFootprint(patch, venue.lat, venue.lng, footprintKm)) continue;
    if (!isPriced(venue.cheapestPrice)) continue;
    pricedVenues += 1;
    if (venue.filterHints?.amenities?.food === true) foodVenues += 1;
    if (typeof venue.zone === "number" && Number.isFinite(venue.zone) && venue.zone > 0) {
      transportAnchors += 1;
    }
  }

  for (const listing of sources.listings ?? []) {
    if (withinFootprint(patch, listing.lat, listing.lng, footprintKm)) whatsOnRows += 1;
  }

  return { pricedVenues, whatsOnRows, foodVenues, transportAnchors };
}

/** Map a count to an availability against a capability's evidence floor. */
export function availabilityForCount(
  count: number,
  floors: { available: number; limited: number },
): CapabilityAvailability {
  if (count >= floors.available) return "available";
  if (count >= floors.limited) return "limited";
  return "unavailable";
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n === 1 ? one : many;
}

function pricesEvidence(count: number, asOf: string | null): CityCapabilityEvidence {
  const availability = availabilityForCount(count, PATCH_EVIDENCE_FLOORS.prices);
  const explanation =
    availability === "available"
      ? `${count} priced ${plural(count, "pub")} logged in this patch.`
      : availability === "limited"
        ? `Only ${count} priced ${plural(count, "pub")} logged here so far.`
        : "No priced pubs logged in this patch yet.";
  return { availability, asOf: count > 0 ? asOf : null, explanation };
}

function whatsOnEvidence(count: number, asOf: string | null): CityCapabilityEvidence {
  const availability = availabilityForCount(count, PATCH_EVIDENCE_FLOORS.whatsOn);
  const explanation =
    availability === "available"
      ? `${count} listings pinned in this patch tonight.`
      : availability === "limited"
        ? `Thin on listings, ${count} pinned in this patch.`
        : "No listings pinned in this patch tonight.";
  return { availability, asOf: count > 0 ? asOf : null, explanation };
}

function foodEvidence(count: number, asOf: string | null): CityCapabilityEvidence {
  const availability = availabilityForCount(count, PATCH_EVIDENCE_FLOORS.food);
  const explanation =
    availability === "available"
      ? `${count} ${plural(count, "pub")} listing food in this patch.`
      : availability === "limited"
        ? `Thin on food, ${count} ${plural(count, "pub")} listing it.`
        : "No pubs listing food in this patch yet.";
  return { availability, asOf: count > 0 ? asOf : null, explanation };
}

function transportEvidence(count: number, asOf: string | null): CityCapabilityEvidence {
  const availability = availabilityForCount(count, PATCH_EVIDENCE_FLOORS.transport);
  const explanation =
    availability === "available"
      ? `${count} pubs here sit within a rated fare zone.`
      : availability === "limited"
        ? `Only ${count} pubs here carry a rated fare zone.`
        : "No rated fare-zone anchors in this patch yet.";
  return { availability, asOf: count > 0 ? asOf : null, explanation };
}

export type DerivePatchOptions = {
  /** ISO date stamped as the dated evidence for present capabilities. Defaults
   *  to the bundled pint dataset's collection date (the observed prices are the
   *  evidence). Injectable so tests are hermetic. */
  asOf?: string | null;
};

const DEFAULT_ASOF = isoDate(PINT_DATASET_OBSERVED_AT);

/**
 * Derive a patch's honest capability profile from its evidence counts. Pure:
 * every availability comes from availabilityForCount against the published
 * floors, so no capability can read "available" under its floor (the fence).
 */
export function derivePatchProfileFromCounts(
  patchId: string,
  patchLabel: string,
  counts: PatchEvidenceCounts,
  options: DerivePatchOptions = {},
): PatchCapabilityProfile {
  const asOf = options.asOf === undefined ? DEFAULT_ASOF : options.asOf;
  const prices = pricesEvidence(counts.pricedVenues, asOf);
  return {
    patchId,
    patchLabel,
    releaseTier: prices.availability === "available" ? "core" : "preview",
    counts,
    prices,
    whatsOn: whatsOnEvidence(counts.whatsOnRows, asOf),
    food: foodEvidence(counts.foodVenues, asOf),
    transport: transportEvidence(counts.transportAnchors, asOf),
  };
}

/** Count then derive one patch's profile from raw data sources. */
export function derivePatchProfile(
  patch: NightPatch,
  sources: PatchEvidenceSources,
  options: DerivePatchOptions & { footprintKm?: number } = {},
): PatchCapabilityProfile {
  const counts = countPatchEvidence(patch, sources, options.footprintKm ?? PATCH_FOOTPRINT_KM);
  return derivePatchProfileFromCounts(patch.id, patch.label, counts, options);
}

/**
 * Derive every night patch's profile from shared data sources — the whole
 * honest coverage map in one call. Keyed by patch id so a surface can look up
 * the active patch in O(1). Future zones slot in by extending NIGHT_PATCHES.
 */
export function derivePatchCapabilities(
  sources: PatchEvidenceSources,
  options: DerivePatchOptions & { footprintKm?: number } = {},
): Record<NightPatchId, PatchCapabilityProfile> {
  const out = {} as Record<NightPatchId, PatchCapabilityProfile>;
  for (const patch of NIGHT_PATCHES) {
    out[patch.id] = derivePatchProfile(patch, sources, options);
  }
  return out;
}

/** True when a patch has NOT cleared the price floor, so the surface should show
 *  the honest thin-coverage note and offer demand capture (value first, always
 *  after the pints). "core" patches are fully supported and skip the ask. */
export function patchIsLimited(profile: PatchCapabilityProfile): boolean {
  return profile.releaseTier !== "core";
}

/** Short plain-register tier label for a chip/badge. No em dashes. */
export function patchTierLabel(profile: PatchCapabilityProfile): string {
  return profile.releaseTier === "core" ? "Well covered" : "Lightly covered";
}

export type SummariseOptions = {
  /** Add a listings clause from the whats-on evidence (server surfaces that
   *  actually measured listings; a client with only the slim index leaves this
   *  off rather than assert a listings count it did not measure). */
  includeListings?: boolean;
  /** Add a food clause from the food evidence. */
  includeFood?: boolean;
};

/**
 * One honest line for a surface: the priced-pub headline (always real, always
 * measured from the slim index) plus, when the caller measured them, a listings
 * and/or food clause. Real counts only, plain British register, no invented
 * numbers, no em dashes. Examples:
 *   "12 priced pubs around Soho, thin on listings."
 *   "Only 4 priced pubs logged around Hackney yet."
 *   "No priced pubs logged around Peckham yet."
 */
export function summarisePatchEvidence(
  profile: PatchCapabilityProfile,
  options: SummariseOptions = {},
): string {
  const { pricedVenues } = profile.counts;
  const label = profile.patchLabel;

  if (profile.prices.availability === "unavailable") {
    return `No priced pubs logged around ${label} yet.`;
  }

  const head =
    profile.prices.availability === "available"
      ? `${pricedVenues} priced ${plural(pricedVenues, "pub")} around ${label}`
      : `Only ${pricedVenues} priced ${plural(pricedVenues, "pub")} logged around ${label} yet`;

  const clauses: string[] = [];
  if (options.includeListings) {
    if (profile.whatsOn.availability === "available") {
      clauses.push(`${profile.counts.whatsOnRows} listings tonight`);
    } else if (profile.whatsOn.availability === "limited") {
      clauses.push("thin on listings");
    }
  }
  if (options.includeFood) {
    if (profile.food.availability === "available") {
      clauses.push(`${profile.counts.foodVenues} with food`);
    } else if (profile.food.availability === "limited") {
      clauses.push("thin on food");
    }
  }

  return clauses.length > 0 ? `${head}, ${clauses.join(", ")}.` : `${head}.`;
}
