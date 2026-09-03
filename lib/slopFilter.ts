// Slop filter for scraped third-party venue descriptions.
//
// data/borough_embedded_pint_prices.json carries a `description` field that was
// machine-generated from chain listings — of ~693 unique descriptions, the vast
// majority are AI marketing filler ("Welcome to the X pub!", "vibrant
// atmosphere", "Whether you're looking to..."). Rendering that verbatim on a
// venue's story tab reads as slop and undercuts the honest, sourced voice the
// rest of the product carries.
//
// This module is the guard at the render seam: a description that trips any tell
// below renders NOTHING, and the honest empty state ("No heritage note yet...")
// takes over. It never edits the data file — it only decides what to show.
//
// Design: high-precision substring tells (case-insensitive) plus an
// "exclamation-led opener" test. The tells are chosen to catch the marketing
// register without nuking the minority of descriptions that carry a genuine,
// specific fact (a founding date, a listed-building status, a real story) — so
// e.g. "…one of the oldest in London, dating back over 500 years" survives while
// "Welcome to the Prince Albert! …vibrant atmosphere" is filtered.

import {
  NIGHT_OUT_PLACE_SLOP_PHRASES,
  isNightOutPlaceSlopDescription,
  presentableNightOutPlaceDescription,
} from "@/lib/nightOutPlaceContract.mjs";

// Kept as the public name used by the venue-story render seam. The values live
// in the night-out-place contract so runtime, ingestion and validation cannot
// drift onto different marketing-phrase lists.
export const SLOP_PHRASES = NIGHT_OUT_PLACE_SLOP_PHRASES;

/**
 * True when a scraped description reads as AI marketing slop and should not be
 * rendered. Empty / whitespace / nullish input is not slop (there is simply
 * nothing to show) — callers distinguish "no description" from "slop" via
 * {@link presentableDescription}.
 */
export function isSlopDescription(input: string | null | undefined): boolean {
  return isNightOutPlaceSlopDescription(input);
}

/**
 * The description to actually render, or null when there is nothing worth
 * showing. Returns the trimmed description when it is present and passes the
 * slop filter; returns null for missing/empty descriptions AND for slop, so the
 * caller's honest empty state takes over in both cases.
 */
export function presentableDescription(input: string | null | undefined): string | null {
  return presentableNightOutPlaceDescription(input);
}
