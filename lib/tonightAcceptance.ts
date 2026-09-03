// The Tonight acceptance seam (DAG L15). The Tonight-surface counterpart to the
// Near seam (lib/venueAcceptance): an explicit "Keep this venue" turns a browsed
// listing into an EXPLICIT acceptance the trusted handoff can rely on — a strict
// PlanningIntent envelope (source "tonight", what's-on evidence) plus the accept
// deep link and the exact venue_accepted telemetry.
//
// Pure and isomorphic on purpose (storage and clock injectable), so the node-env
// suite exercises every branch without a DOM. The component only wires the click
// to it and emits the returned telemetry.
//
// Trust rules (§3.2, §4.8): only an explicit "Keep this venue" reaches here (a
// tap to open a listing never does); the source is fixed "tonight", never
// guessed; and acceptance requires the envelope to persist — on any storage
// failure nothing is accepted and no telemetry is emitted, and TonightClient
// stays on Tonight reporting VENUE_ACCEPTANCE_STORAGE_ERROR rather than
// navigating, so a claimed-but-unrecorded acceptance cannot exist.

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { type CityId } from "@/lib/cities";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { NIGHT_PATCHES, type NightPatchId, type RememberedArea } from "@/lib/nightPatches";
import {
  writePlanningIntent,
  type PlanningIntentArea,
  type PlanningIntentInput,
  type PlanningIntentOptions,
} from "@/lib/planningIntent";
import type { VenueAcceptance } from "@/lib/venueAcceptance";
import { venueAcceptUrl, venueMapUrl } from "@/lib/venueMapUrl";

// Built from the canonical patch registry so an unknown id can never slip in.
const LONDON_PATCH_IDS = new Set<string>(NIGHT_PATCHES.map((patch) => patch.id));

/**
 * Canonicalise Tonight's remembered area into an area PlanningIntent will accept.
 * A non-canonical borough or unknown patch drops to null (accept the Venue
 * without an area) rather than failing the whole acceptance over a context field.
 */
function canonicalArea(raw: RememberedArea | null): PlanningIntentArea {
  if (!raw) return null;
  if (raw.kind === "patch") {
    return LONDON_PATCH_IDS.has(raw.id) ? { kind: "night-patch", id: raw.id as NightPatchId } : null;
  }
  return LONDON_BOROUGHS.includes(raw.name) ? { kind: "borough", name: raw.name } : null;
}

export type TonightAcceptanceInput = {
  venueId: string;
  /** The area Tonight's list was ordered from (remembered patch or borough), or
   *  null when the order came from the person's live location. */
  area: RememberedArea | null;
  /** Tonight answers "tonight"; like Near, no explicit future date is chosen. */
  startsAt: string | null;
  /** Source freshness behind the listing (the response's sourceObservedAt, which
   *  is null when the source time is unknown — never the request instant). */
  observedAt: string | null;
  /** City to record when the venue id does not resolve to one on its own. */
  fallbackCityId: CityId;
  /** Which read put this row on the list. Defaults to the what's-on spine. */
  evidenceKind?: TonightEvidenceKind;
};

/** The two reads Tonight's list is built from, as the intent records them. */
export type TonightEvidenceKind = "whats-on" | "out-listing";

export type TonightAcceptanceError = {
  venueId: string;
  familyKey: string;
  message: string;
};

export function tonightAcceptanceFamilyKey(row: {
  kind?: string | null;
  title?: string | null;
  source?: { label?: string | null } | null;
}): string {
  return `${row.kind ?? ""}|${row.title ?? ""}|${row.source?.label ?? ""}`;
}

export function tonightRowAcceptanceError(
  error: TonightAcceptanceError | null,
  venueId: string,
  familyKey: string,
): string | null {
  return error
    && error.venueId === venueId
    && error.familyKey === familyKey
    ? error.message
    : null;
}

/**
 * Explicitly accept a Tonight Venue into the trusted handoff. Writes one strict
 * PlanningIntent (source "tonight"), then reports where to navigate and what to
 * measure. Never throws — storage failures degrade to a browse selection.
 */
export function acceptTonightVenue(
  input: TonightAcceptanceInput,
  options: PlanningIntentOptions = {},
): VenueAcceptance {
  const browseHref = venueMapUrl(input.venueId);

  const intentInput: PlanningIntentInput = {
    source: "tonight",
    cityId: cityIdFromVenueId(input.venueId) ?? input.fallbackCityId,
    acceptedVenueId: input.venueId,
    acceptedArea: canonicalArea(input.area),
    startsAt: input.startsAt,
    displayEvidence: {
      kind: input.evidenceKind ?? "whats-on",
      observedAt: input.observedAt,
    },
  };

  const intent = writePlanningIntent(intentInput, options);
  if (!intent) {
    return { accepted: false, href: browseHref, telemetry: null };
  }

  // Read the booleans off the persisted envelope, not the raw input, so the
  // metric reflects exactly what carried over.
  return {
    accepted: true,
    href: venueAcceptUrl(input.venueId, "tonight"),
    telemetry: {
      source: "tonight",
      hasArea: intent.acceptedArea !== null,
      hasDate: intent.startsAt !== null,
      hasProvenance: intent.displayEvidence.observedAt !== null,
    },
  };
}
