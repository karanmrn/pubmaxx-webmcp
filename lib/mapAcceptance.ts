// Map-originated Venue acceptance (trusted-handoff §4.8).
//
// Turning an inspected Venue into an accepted Stop 1 from the Map writes a
// PlanningIntent only after the reader presses the explicit action. This module
// builds the exact, minimal envelope and resolves the typed acceptance source,
// so both are unit-testable with no DOM.
//
// Honesty: a Map acceptance carries no accepted area or date yet (the server
// resolvePlanningAnchor recomputes the canonical Night Area, §4.3), and its
// evidence is the map directory listing, not a dated price. So area/date are
// null and evidence is "directory" with no observedAt — never invented.
//
// Server-safe: no window/DOM/React.

import type { CityId } from "@/lib/cities";
import type {
  PlanningIntentV1,
  PlanningIntentInput,
  PlanningIntentOptions,
  PlanningIntentSource,
} from "@/lib/planningIntent";
import {
  canonicalizePlanningIntentVenueId,
  PLANNING_INTENT_CHANGED_EVENT,
  PLANNING_INTENT_SOURCES,
  readPlanningIntent,
  writePlanningIntent,
} from "@/lib/planningIntent";
import { browseSelectionUrl, refreshSelectionUrl } from "@/lib/mapSelectionHistory";
import type { VenueAcceptedTelemetry } from "@/lib/venueAcceptance";

/** Valid PlanningIntent sources that a Map acceptance can legitimately carry. */
export function isPlanningIntentSource(
  value: string | null | undefined,
): value is PlanningIntentSource {
  return (
    typeof value === "string" &&
    (PLANNING_INTENT_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * The typed acceptance source seeded from an accepted-handoff arrival
 * (`?accept=1&src=<source>`). Only a valid, present source counts; a missing,
 * unknown, or accept-less arrival yields null (a later Map-search selection sets
 * "map-search" instead). Never guesses a source from the current UI.
 */
export function initialAcceptanceSource(search: string): PlanningIntentSource | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("accept") !== "1") return null;
  const src = params.get("src");
  return isPlanningIntentSource(src) ? src : null;
}

/**
 * Build the minimal, honest PlanningIntent envelope for a Map acceptance of
 * `acceptedVenueId` with a typed `source`. Area/date are null and evidence is
 * the undated map directory listing — the server re-derives the canonical area,
 * price, and freshness from the Venue id.
 */
export function buildMapAcceptanceIntentInput(input: {
  source: PlanningIntentSource;
  cityId: CityId;
  acceptedVenueId: string;
}): PlanningIntentInput {
  return {
    source: input.source,
    cityId: input.cityId,
    acceptedVenueId: input.acceptedVenueId,
    acceptedArea: null,
    startsAt: null,
    displayEvidence: { kind: "directory", observedAt: null },
  };
}

export type MapAcceptanceInput = {
  cityId: CityId;
  acceptedVenueId: string;
  /** The frozen Map arrival search, used to recognise an accepted handoff. */
  search?: string;
};

export type MapAcceptanceResult = {
  accepted: boolean;
  /** Only a confirmed write may hand the reader to Plan. */
  destination: "/plan" | null;
  telemetry: VenueAcceptedTelemetry | null;
};

export type AcceptedArrivalInput = {
  search: string;
  selectedVenueId: string;
  cityId: CityId;
};

export type AcceptedArrivalExpiryScheduler = {
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
};

function planningIntentInput(intent: PlanningIntentV1): PlanningIntentInput {
  return {
    source: intent.source,
    cityId: intent.cityId,
    acceptedVenueId: intent.acceptedVenueId,
    acceptedArea: intent.acceptedArea,
    startsAt: intent.startsAt,
    displayEvidence: intent.displayEvidence,
  };
}

function acceptedArrivalIntent(
  input: AcceptedArrivalInput,
  options: PlanningIntentOptions = {},
): PlanningIntentV1 | null {
  const search = input.search;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const source = initialAcceptanceSource(search);
  if (
    source === null ||
    params.get("sel") !== input.selectedVenueId
  ) {
    return null;
  }

  const existing = readPlanningIntent(options);
  if (
    !existing ||
    existing.source !== source ||
    existing.cityId !== input.cityId ||
    existing.acceptedVenueId !== input.selectedVenueId
  ) {
    return null;
  }
  return existing;
}

/**
 * Return a trusted accepted-arrival source only when URL markers match a live
 * PlanningIntent for the same Venue and city. URL text alone carries no
 * acceptance authority.
 */
export function verifiedAcceptedArrivalSource(
  input: AcceptedArrivalInput,
  options: PlanningIntentOptions = {},
): PlanningIntentSource | null {
  return acceptedArrivalIntent(input, options)?.source ?? null;
}

/**
 * The URL a landed Venue detail owes a canonicalised selection, or null when
 * the acceptance could not travel with it.
 *
 * Acceptance markers and the stored intent move together or not at all. When
 * the markers name an acceptance nothing verifies — an expired or foreign
 * intent — there is no acceptance to carry, so the selection is canonicalised
 * as ordinary browsing rather than left on an id the Venue detail already
 * resolved away from. That never upgrades an unverified acceptance.
 */
export function canonicalizeAcceptedArrivalSelection(input: {
  pathname: string;
  search: string;
  hash?: string;
  requestedVenueId: string;
  canonicalVenueId: string;
}, options: PlanningIntentOptions = {}): string | null {
  const acceptedSource = initialAcceptanceSource(input.search);
  if (acceptedSource) {
    const existing = readPlanningIntent(options);
    if (
      !existing
      || existing.source !== acceptedSource
      || existing.acceptedVenueId !== input.requestedVenueId
    ) {
      return browseSelectionUrl(
        input.pathname,
        input.search,
        input.canonicalVenueId,
        input.hash,
      );
    }
    const intent = canonicalizePlanningIntentVenueId(
      input.requestedVenueId,
      input.canonicalVenueId,
      options,
    );
    if (!intent || intent.source !== acceptedSource) return null;
  }
  return refreshSelectionUrl(
    input.pathname,
    input.search,
    input.canonicalVenueId,
    input.hash,
  );
}

// `useSyncExternalStore` asks its snapshot on EVERY render, so an unmemoised
// reader ran a localStorage read plus a JSON.parse per PubMap render. The cache
// holds one answer per (revision, query) pair; the revision is bumped by the
// subscriber the moment a write, a clear, another tab, or a history move could
// have changed the answer, so a stale answer is not reachable.
let acceptedArrivalRevision = 0;
let acceptedArrivalCache: {
  key: string;
  value: PlanningIntentSource | null;
  expiresAt: number | null;
} | null = null;

/** Drop the memoised answer. The subscriber calls this before it notifies. */
export function invalidateAcceptedArrivalSource(): void {
  acceptedArrivalRevision += 1;
  acceptedArrivalCache = null;
}

/**
 * An accepted arrival's answer is half URL and half stored intent, so moving
 * the URL in place has to announce itself the same way a storage write does.
 * `history.replaceState` raises no event of its own and Next's own search-param
 * readers never hear it, so a canonicalised `sel` would otherwise be read
 * against the previous id until something else happened to notify.
 */
export function announceAcceptedArrivalUrlChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PLANNING_INTENT_CHANGED_EVENT));
}

/**
 * The memoised `verifiedAcceptedArrivalSource`, safe to call on every render.
 * Never reads a rejected envelope's bytes away (`cleanupInvalid: false`): a
 * render is a look, not a decision.
 *
 * The key is the QUERY, not the storage, because one browser has one of those.
 * A caller injecting its own storage invalidates first.
 */
export function readAcceptedArrivalSource(
  input: AcceptedArrivalInput,
  options: Pick<PlanningIntentOptions, "storage" | "now"> = {},
): PlanningIntentSource | null {
  const now = typeof options.now === "function" ? options.now() : options.now ?? Date.now();
  const key = [
    acceptedArrivalRevision,
    input.cityId,
    input.selectedVenueId,
    input.search,
  ].join("|");
  if (
    acceptedArrivalCache?.key === key
    && (acceptedArrivalCache.expiresAt === null || now < acceptedArrivalCache.expiresAt)
  ) return acceptedArrivalCache.value;
  const intent = acceptedArrivalIntent(input, {
    ...options,
    now,
    cleanupInvalid: false,
  });
  const value = intent?.source ?? null;
  const expiresAt = intent ? Date.parse(intent.expiresAt) : null;
  acceptedArrivalCache = { key, value, expiresAt };
  return value;
}

export function scheduleAcceptedArrivalExpiry(
  input: AcceptedArrivalInput,
  onExpire: () => void,
  options: Pick<PlanningIntentOptions, "storage" | "now"> & AcceptedArrivalExpiryScheduler = {},
): () => void {
  const now = typeof options.now === "function" ? options.now() : options.now ?? Date.now();
  const intent = acceptedArrivalIntent(input, {
    storage: options.storage,
    now,
    cleanupInvalid: false,
  });
  if (!intent) return () => undefined;
  const expiresAt = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiresAt)) return () => undefined;
  const schedule = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const cancel = options.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer));
  const timer = schedule(onExpire, Math.max(0, expiresAt - now));
  return () => cancel(timer);
}

/**
 * Explicitly accept the selected Map Venue into the trusted handoff.
 *
 * A matching Near or Tonight arrival may carry a richer intent already written
 * by that surface. Every other Map selection gets the minimal directory input
 * under "map-search". The caller names no source of its own: a Map selection
 * carries no acceptance authority, so only the verified stored intent may name
 * a richer one. The final result is successful only when the input persists.
 */
export function acceptMapVenue(
  input: MapAcceptanceInput,
  options: PlanningIntentOptions = {},
): MapAcceptanceResult {
  const arrivalIntent = acceptedArrivalIntent(
    {
      search: input.search ?? "",
      selectedVenueId: input.acceptedVenueId,
      cityId: input.cityId,
    },
    options,
  );
  let intentInput = buildMapAcceptanceIntentInput({
    source: "map-search",
    cityId: input.cityId,
    acceptedVenueId: input.acceptedVenueId,
  });

  if (arrivalIntent) {
    intentInput = planningIntentInput(arrivalIntent);
  }

  const intent = writePlanningIntent(intentInput, options);
  if (!intent) {
    return { accepted: false, destination: null, telemetry: null };
  }

  return {
    accepted: true,
    destination: "/plan",
    telemetry: {
      source: intent.source,
      hasArea: intent.acceptedArea !== null,
      hasDate: intent.startsAt !== null,
      hasProvenance: intent.displayEvidence.observedAt !== null,
    },
  };
}
