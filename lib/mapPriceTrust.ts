// Pin colour / mark trust explainer. One vocabulary with the sheet and legend —
// never a second invented story about why a pin is grey or provisional.

import { COMMUNITY_PROVISIONAL_SHORT_NOTE } from "@/lib/communityPrice";

export type MapPriceTrustBeat = {
  id: "trusted" | "provisional" | "unknown";
  title: string;
  detail: string;
};

/**
 * The three trust states a drinker needs before the map feels honest.
 * Reuses the provisional short note and the legend's unknown framing.
 */
export function mapPriceTrustBeats(): readonly MapPriceTrustBeat[] {
  return [
    {
      id: "trusted",
      title: "Coloured pin",
      detail:
        "The shade is the pub's pint band, from a listed or logged price on record. A drinker-logged price only colours the pin once a second drinker reports a similar price inside the age window.",
    },
    {
      id: "provisional",
      title: "Small blue mark",
      detail: COMMUNITY_PROVISIONAL_SHORT_NOTE,
    },
    {
      id: "unknown",
      title: "Grey pin",
      detail:
        "No trusted pint price on the map yet. The pub may still have a dated row on its sheet.",
    },
  ] as const;
}

/** One-liner for an unpriced pub sheet (no community row to hang trust on). */
export const UNPRICED_VENUE_TRUST_LINE =
  "Grey on the map means no trusted pint price yet. Log tonight's price and a second drinker can move it.";
