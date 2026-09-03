import type { Venue } from "@/lib/venues";
import { venueKindLabel, venueKindNoun } from "@/lib/venueKindFilters";

export type VenueSheetLabels = {
  typeLabel: string;
  summaryLabel: string;
  detailLabel: string;
  closeLabel: string;
  loadingLabel: string;
  unavailableLabel: string;
};

export function venueSheetLabels(
  venue: Pick<Venue, "kind"> | null | undefined,
): VenueSheetLabels {
  const typeLabel = venue ? venueKindLabel(venue.kind) : "Venue";
  const noun = venue ? venueKindNoun(venue.kind) : "venue";
  const detailLabel = `${noun[0].toUpperCase()}${noun.slice(1)} detail`;
  return {
    typeLabel,
    summaryLabel: `Selected ${noun} summary`,
    detailLabel,
    closeLabel: `Close ${noun} detail`,
    loadingLabel: `Loading full ${noun} details…`,
    unavailableLabel: `Showing fast map details. Full ${noun} notes are unavailable right now.`,
  };
}
