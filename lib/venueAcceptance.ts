// The Near acceptance seam (DAG L06). It is the single place that turns "this is
// the pub I'm browsing" into an EXPLICIT acceptance the rest of the trusted
// handoff can trust: a strict PlanningIntent envelope (lib/planningIntent) plus
// the accept deep link and the exact venue_accepted telemetry.
//
// Pure and isomorphic on purpose — storage and clock are injectable — so the
// node-env test suite exercises every branch without a DOM. The component
// (NearMeNow) only wires clicks to it and emits the returned telemetry.
//
// Trust rules it enforces (§3.2, §4.8):
//   • Only an explicit "Keep for tonight" reaches here; opening a card for a
//     look never does, so browsing is never mistaken for accepting.
//   • The source is fixed "near" — never guessed from the current UI.
//   • Acceptance requires the envelope to actually persist. If storage denies or
//     the envelope is invalid, nothing is accepted and no telemetry is emitted.
//     NearMeNow then stays on Near and reports VENUE_ACCEPTANCE_STORAGE_ERROR
//     rather than navigating, so a claimed-but-unrecorded acceptance cannot
//     exist. The browse href below remains the safe fallback address for a
//     caller that still chooses to move.

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { type CityId } from "@/lib/cities";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import {
  writePlanningIntent,
  type PlanningIntentArea,
  type PlanningIntentInput,
  type PlanningIntentOptions,
} from "@/lib/planningIntent";
import { venueAcceptUrl, venueMapUrl, type VenueAcceptanceSource } from "@/lib/venueMapUrl";

/** Active browse area before it is canonicalised into an accepted area. */
export type RawAcceptedArea =
  | { kind: "night-patch"; id: string }
  | { kind: "borough"; name: string }
  | null;

export type NearAcceptanceInput = {
  venueId: string;
  /**
   * The area the Near answer was framed by (patch or borough), or null when the
   * answer came from the person's own location with no named area.
   */
  area: RawAcceptedArea;
  /** Near answers "right now"; no explicit future date is chosen, so this is null. */
  startsAt: string | null;
  /** Provenance behind the price shown on the card (the dataset collection date). */
  observedAt: string | null;
  /** City to record when the venue id does not resolve to one on its own. */
  fallbackCityId: CityId;
};

/** venue_accepted props — emitted only on a genuine acceptance. */
export type VenueAcceptedTelemetry = {
  source: VenueAcceptanceSource;
  hasArea: boolean;
  hasDate: boolean;
  hasProvenance: boolean;
};

/**
 * The one sentence every acceptance surface says when the envelope would not
 * persist. Near, Tonight and Map fail the same way and must not word it three
 * ways: it was pasted into three components and had already drifted from the
 * lowercase "Keep this venue" button beside it. "Venue" is our own noun for a
 * row in the index, so the reader is told about a pub instead.
 */
export const VENUE_ACCEPTANCE_STORAGE_ERROR =
  "Couldn’t keep this pub on this device. Try again.";

export type VenueAcceptance = {
  /** True only when the PlanningIntent envelope actually persisted. */
  accepted: boolean;
  /** Accept deep link on success; the canonical browse link on any failure. */
  href: string;
  /** Present only on a real acceptance, so a degraded browse never over-counts. */
  telemetry: VenueAcceptedTelemetry | null;
};

// Built from the canonical patch registry so an unknown id can never slip in.
const LONDON_PATCH_IDS = new Set<string>(NIGHT_PATCHES.map((patch) => patch.id));

/**
 * Keep only an area PlanningIntent will accept. A non-canonical borough or an
 * unknown patch drops to null (accept the Venue without an area) rather than
 * failing the whole acceptance over a contextual field.
 */
function canonicalArea(raw: RawAcceptedArea): PlanningIntentArea {
  if (raw === null) return null;
  if (raw.kind === "night-patch") {
    return raw.id && LONDON_PATCH_IDS.has(raw.id)
      ? { kind: "night-patch", id: raw.id as NightPatchId }
      : null;
  }
  return LONDON_BOROUGHS.includes(raw.name) ? { kind: "borough", name: raw.name } : null;
}

/**
 * Explicitly accept a Near Venue into the trusted handoff. Writes one strict
 * PlanningIntent (source "near"), then reports where to navigate and what to
 * measure. Never throws — storage failures degrade to a browse selection.
 */
export function acceptNearVenue(
  input: NearAcceptanceInput,
  options: PlanningIntentOptions = {},
): VenueAcceptance {
  const browseHref = venueMapUrl(input.venueId);

  const intentInput: PlanningIntentInput = {
    source: "near",
    cityId: cityIdFromVenueId(input.venueId) ?? input.fallbackCityId,
    acceptedVenueId: input.venueId,
    acceptedArea: canonicalArea(input.area),
    startsAt: input.startsAt,
    displayEvidence: { kind: "price", observedAt: input.observedAt },
  };

  const intent = writePlanningIntent(intentInput, options);
  if (!intent) {
    // Denied, oversized, or invalid: still select the Venue so the journey
    // continues, but never claim an acceptance we could not persist.
    return { accepted: false, href: browseHref, telemetry: null };
  }

  // Read the booleans off the persisted envelope, not the raw input, so the
  // metric reflects exactly what carried over.
  return {
    accepted: true,
    href: venueAcceptUrl(input.venueId, "near"),
    telemetry: {
      source: "near",
      hasArea: intent.acceptedArea !== null,
      hasDate: intent.startsAt !== null,
      hasProvenance: intent.displayEvidence.observedAt !== null,
    },
  };
}
