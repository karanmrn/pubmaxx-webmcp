import Link from "next/link";

import PubmaxxMark from "@/components/brand/PubmaxxMark";
import {
  OUT_LISTING_VENUE_BADGE_LABEL,
  outListingPubPair,
} from "@/lib/outDesktopGrouping";
import type { WhatsOnRow } from "@/lib/whatsOn";

type OutListingPubPairProps = {
  row: WhatsOnRow;
};

export function OutListingPubPair({ row }: OutListingPubPairProps) {
  const pair = outListingPubPair(row);
  if (pair.status === "absent") {
    return null;
  }
  return (
    <div className="outListingPubPair outListingPubPair--matched">
      <div className="outListingPubPairHead">
        {/* duo, never mono: the Crossing X in a single ink colour at 18px is
            indistinguishable from another company's logo, and it sat one line
            under a Ticketmaster credit. Coral plus the lit ember is ours and
            reads as ours, beside a label that is already coral. */}
        <PubmaxxMark variant="duo" size={20} aria-hidden="true" />
        <span className="outListingPubPairLabel">{OUT_LISTING_VENUE_BADGE_LABEL}</span>
      </div>
      <p className="outListingPubPairName">{pair.placeName}</p>
      <Link className="outListingPubPairLink pressable" href={pair.mapHref}>
        Open on map
      </Link>
    </div>
  );
}
