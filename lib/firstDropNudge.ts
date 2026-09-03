// First-drop nudge (Cycle-8 item 3) — turning unpriced venues into
// contribution invitations. Strategic finding (Cycle 6): pubs don't publish
// prices, so crowdsourced Pint Drops are the moat; the 658 unpriced outer
// venues are the target list. On a venue with NO price on record, the overview
// price area becomes an honest, dry, London-toned invitation to log the first
// drop instead of rendering nothing.
//
// This module is the pure gate + copy layer so the render component stays a
// thin presentational shell and the logic is unit-testable without a DOM.

import type { Venue } from "@/lib/venues";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { TabKey } from "@/lib/venueInspectorTabs";

/**
 * A venue is "unpriced" — and so a first-drop candidate — when NONE of the
 * three honest price sources the overview tab renders exist:
 *   1. a live community contributor price (latestContributorPrice), then
 *   2. a sourced first-party price (PricedVenue.sourcedPrice), then
 *   3. a baseline dataset price (venue.cheapestPrice).
 *
 * This mirrors the precedence in VenueOverviewTab exactly, so the nudge shows
 * in — and only in — the branch that would otherwise render nothing. It has no
 * dependency on the unpriced-pin work (#315): it gates purely on the venue's
 * own price fields, so it works wherever an unpriced venue renders.
 */
export function isVenueUnpriced(
  venue: Venue,
  latestContributorPrice: number | null | undefined,
): boolean {
  if (latestContributorPrice !== null && latestContributorPrice !== undefined) {
    return false;
  }
  const sourcedPrice = (venue as PricedVenue).sourcedPrice ?? null;
  if (sourcedPrice) return false;
  if (venue.cheapestPrice !== null && venue.cheapestPrice !== undefined) {
    return false;
  }
  return true;
}

export type FirstDropCopy = {
  /** The single dry line shown in the price area. One line — never a banner. */
  line: string;
  /** The CTA label on the button that opens the composer. */
  cta: string;
};

// Dry, London, zero begging. One line + CTA per the Cycle-8 tone brief. Variants
// so the nudge doesn't read as a templated string when a user pans across a
// cluster of unpriced outer pubs. Selection is deterministic per venue (below)
// so the same pub always speaks the same way — no reshuffling on re-render.
const FIRST_DROP_VARIANTS: readonly FirstDropCopy[] = [
  { line: "No pint price logged here yet. Be the first.", cta: "Log tonight's price" },
  { line: "Nobody has logged a pint here. Yours can mark the pin.", cta: "Log tonight's price" },
  { line: "No pint on record here. A dated log starts the trust path.", cta: "Log tonight's price" },
  { line: "Prices here: none. Log one so mates can corroborate it.", cta: "Log tonight's price" },
];

/** Stable non-negative hash of a venue id — deterministic variant selection. */
function hashVenueId(venueId: string): number {
  let hash = 0;
  for (let i = 0; i < venueId.length; i += 1) {
    hash = (hash * 31 + venueId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Pick the first-drop copy for a venue. Deterministic by venue id so a given
 * pub always shows the same line (no flicker between renders), while the wider
 * unpriced set reads with variety rather than one repeated string.
 */
export function firstDropNudgeCopy(venueId: string): FirstDropCopy {
  const index = hashVenueId(venueId) % FIRST_DROP_VARIANTS.length;
  return FIRST_DROP_VARIANTS[index];
}

/**
 * The composer-prefill intent the nudge CTA fires. The existing Pint Drop
 * composer is prefilled-for-this-venue purely by rendering on the Pints tab
 * with this venue's id (the composer loads its per-venue draft from venueId),
 * so "prefill" here is: switch to the Pints tab and open the composer for this
 * venue. Returned as a plain object so the wiring is unit-testable.
 */
export type FirstDropComposerIntent = {
  venueId: string;
  tab: TabKey;
  openComposer: true;
};

export function firstDropComposerIntent(venueId: string): FirstDropComposerIntent {
  return { venueId, tab: "pints", openComposer: true };
}
