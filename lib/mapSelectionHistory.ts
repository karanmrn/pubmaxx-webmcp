// Selection-history sentinel model (trusted-handoff §4.6).
//
// The Map owns a single history sentinel so Back has an exact contract:
//   Back over an open Venue closes the sheet and reveals a clean Map; a second
//   Back leaves the Map. This module is the PURE core — the sentinel shape, the
//   URL builders that preserve owned non-selection params, and the transition
//   decider. The Map surface navigation owner applies these URL rules beside
//   its complete surface snapshot; keeping them here makes URL decisions
//   unit-testable with no DOM.
//
// Server-safe: no window/DOM/React.

/** The sentinel stamped onto a selected history entry via history.pushState. */
export const PUBMAX_SELECTION_SENTINEL = 1 as const;

export type PubmaxSelectionHistory = {
  pubmaxSelection: typeof PUBMAX_SELECTION_SENTINEL;
  venueId: string;
};

// sel is the inspected Venue; accept=1 / src=<source> are the accepted-handoff
// markers; at=<lat>,<lng> is sel's companion location hint for a UK base pub
// (see SELECTION_HINT_PARAM). All four belong to a specific selection/
// acceptance arrival and are stripped when we build a clean Map entry.
// Everything else (pubs, mode, plan, log, style, band, …) is owned passthrough
// and is preserved on every rewrite.
const SELECTION_PARAMS = ["sel", "accept", "src", "at"] as const;
const ACCEPTANCE_PARAMS = ["accept", "src"] as const;

/**
 * `sel` may travel with a companion location hint (`at=<lat>,<lng>`). A UK base
 * pub's `venue-uk-…` id names an OSM ref, not a venue record: on a shared or
 * reloaded link the id alone cannot say which base shard cell to stream or
 * where to fly the camera, so the selecting tap writes the pub's rounded
 * coordinates alongside `sel`. Deliberately NOT embedded in the id itself —
 * those ids are already written into community_prices rows, and a pack refresh
 * nudging a pub across a cell boundary must never orphan its prices.
 */
export const SELECTION_HINT_PARAM = "at";

/** ~11 m of precision: enough to target the cell and centre the camera. */
export function formatSelectionHint(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Parse the `at=` hint out of a search string; null when absent/malformed. */
export function parseSelectionHint(search: string): { lat: number; lng: number } | null {
  const raw = normalizeSearch(search).get(SELECTION_HINT_PARAM);
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Type guard: does an unknown history.state carry our selection sentinel? */
export function isSelectionSentinel(state: unknown): state is PubmaxSelectionHistory {
  if (typeof state !== "object" || state === null) return false;
  const record = state as { pubmaxSelection?: unknown; venueId?: unknown };
  return (
    record.pubmaxSelection === PUBMAX_SELECTION_SENTINEL &&
    typeof record.venueId === "string"
  );
}

/** The sentinel's venueId when present, else null. */
export function selectionSentinelVenueId(state: unknown): string | null {
  return isSelectionSentinel(state) ? state.venueId : null;
}

/** Build the sentinel state object for a given Venue. */
export function selectionSentinel(venueId: string): PubmaxSelectionHistory {
  return { pubmaxSelection: PUBMAX_SELECTION_SENTINEL, venueId };
}

/**
 * Merge the sentinel INTO the existing history.state so the framework router's
 * own state on this entry survives (Next.js App Router keeps its routing tree
 * there). isSelectionSentinel only inspects our two keys, so extra keys are
 * ignored on read.
 */
export function withSelectionSentinel(
  base: unknown,
  venueId: string,
): PubmaxSelectionHistory & Record<string, unknown> {
  const carry = base && typeof base === "object" ? (base as Record<string, unknown>) : {};
  return { ...carry, pubmaxSelection: PUBMAX_SELECTION_SENTINEL, venueId };
}

function normalizeSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function toUrl(pathname: string, params: URLSearchParams, hash: string): string {
  const query = params.toString();
  return query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`;
}

/** Does the arrival search already name an inspected Venue (`?sel=`)? */
export function searchHasSelection(search: string): boolean {
  return normalizeSearch(search).get("sel") !== null;
}

/**
 * The clean-Map URL: selection + acceptance params removed, every owned
 * passthrough param preserved. This is the entry Back reveals.
 */
export function cleanMapUrl(pathname: string, search: string, hash = ""): string {
  const params = normalizeSearch(search);
  for (const key of SELECTION_PARAMS) params.delete(key);
  return toUrl(pathname, params, hash);
}

/**
 * A browse-selection URL for `venueId`: owned params kept, acceptance markers
 * dropped (a pin/switch selection is browse-only, §4.8), and `sel` set. Used
 * for the in-Map push (clean → selected) and replace (selected → other).
 *
 * `hint` is the base-pub location companion (formatSelectionHint): set for a
 * UK base selection, and always cleared otherwise so a base → curated switch
 * never leaves a stale `at=` pointing at the previous pub.
 */
export function browseSelectionUrl(
  pathname: string,
  search: string,
  venueId: string,
  hash = "",
  hint = "",
): string {
  const params = normalizeSearch(search);
  for (const key of ACCEPTANCE_PARAMS) params.delete(key);
  params.set("sel", venueId);
  if (hint) params.set(SELECTION_HINT_PARAM, hint);
  else params.delete(SELECTION_HINT_PARAM);
  return toUrl(pathname, params, hash);
}

/**
 * Refresh the URL for the Venue that is already selected. Unlike a switch to a
 * different Venue, this keeps accepted-arrival markers so a tab or detail
 * hydration update cannot silently turn an accepted Venue back into browsing.
 */
export function refreshSelectionUrl(
  pathname: string,
  search: string,
  venueId: string,
  hash = "",
  hint = "",
): string {
  const params = normalizeSearch(search);
  params.set("sel", venueId);
  if (hint) params.set(SELECTION_HINT_PARAM, hint);
  else params.delete(SELECTION_HINT_PARAM);
  return toUrl(pathname, params, hash);
}

export type SelectionHistoryAction =
  | { kind: "none" }
  /** clean Map → first Venue selection: push one selected entry. */
  | { kind: "push"; venueId: string }
  /** switching Venue while a sentinel is active: replace the selected entry. */
  | { kind: "replace"; venueId: string }
  /** close and the current entry owns the sentinel: pop it with history.back(). */
  | { kind: "back" }
  /** close with no sentinel: replace the URL, stripping sel/accept/src. */
  | { kind: "strip" };

/**
 * Decide the history action for a selectedVenueId transition.
 *
 * - prev/next are the previous and next selectedVenueId ("" = no selection).
 * - currentSentinelVenueId is the sentinel Venue id on history.state, if any.
 *
 * Closing (next === "") pops the sentinel entry with Back when we own it, so a
 * single Back returns to the clean Map; otherwise we strip the params in place
 * so a stray `?sel=` never survives a local close.
 */
export function selectionTransition(input: {
  prev: string;
  next: string;
  currentSentinelVenueId: string | null;
}): SelectionHistoryAction {
  const prev = input.prev || "";
  const next = input.next || "";
  if (next === prev) return { kind: "none" };
  if (next) {
    if (input.currentSentinelVenueId === next) return { kind: "none" };
    return prev ? { kind: "replace", venueId: next } : { kind: "push", venueId: next };
  }
  return input.currentSentinelVenueId !== null ? { kind: "back" } : { kind: "strip" };
}

/** What a resolved Venue detail should do to the selection URL. */
export type SelectionResolution =
  /** Leave the URL alone. */
  | { kind: "none" }
  /** The SAME pub answered to a canonical id: rewrite `sel` to it. */
  | { kind: "canonicalise"; venueId: string }
  /** A `sel` that never landed in the trail: strip the selection params. */
  | { kind: "clean" };

/**
 * Decide what a landed Venue detail owes the URL.
 *
 * The cleanup case exists for a `sel` the trail never took up. It must not
 * catch a Venue that simply answered to its own id: an accepted arrival
 * (`?sel=…&accept=1&src=near`) resolves its detail while the trail is still
 * initialising, so the cleanup used to strip the acceptance markers seconds
 * after arrival, and a reload then read the arrival as ordinary browsing.
 * Nothing resolved is nothing to do.
 */
export function selectionResolution(input: {
  requestedVenueId: string;
  canonicalVenueId: string;
  /** The trail's current Venue surface id, or null when it is not a Venue. */
  currentVenueId: string | null;
  /** `sel` as the URL carries it right now. */
  liveSelectedVenueId: string | null;
}): SelectionResolution {
  const requested = input.requestedVenueId.trim();
  const canonical = input.canonicalVenueId.trim();
  if (!requested || !canonical) return { kind: "none" };
  if (requested === canonical) return { kind: "none" };
  if (
    input.currentVenueId === requested
    || (input.currentVenueId === null && input.liveSelectedVenueId === requested)
  ) {
    return { kind: "canonicalise", venueId: canonical };
  }
  return input.currentVenueId !== null && input.liveSelectedVenueId === requested
    ? { kind: "clean" }
    : { kind: "none" };
}
