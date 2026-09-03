import { useEffect } from "react";
import { PlusCircle } from "lucide-react";

import { firstDropNudgeCopy } from "@/lib/firstDropNudge";
import { UNPRICED_VENUE_TRUST_LINE } from "@/lib/mapPriceTrust";

/**
 * Unpriced-pub nudge. Primary CTA opens the community price path (map trust).
 * Optional secondary opens the Pint Drop composer for drinkers who still want it.
 */
export default function FirstDropNudge({
  venueId,
  venueName,
  onLogTonightPrice,
  onStartFirstDrop,
}: {
  venueId: string;
  venueName: string;
  /** Community price / contribution gate path — moves map trust. */
  onLogTonightPrice: () => void;
  /** Optional Pint Drop composer (secondary). */
  onStartFirstDrop?: () => void;
}) {
  const copy = firstDropNudgeCopy(venueId);

  useEffect(() => {
    // Nudge visibility is product-local; conversion rides price_submit_viewed.
  }, [venueId]);

  return (
    <div className="firstDropNudge" role="note">
      <p className="firstDropNudgeLine">{copy.line}</p>
      <p className="firstDropNudgeTrust">{UNPRICED_VENUE_TRUST_LINE}</p>
      <button
        type="button"
        className="firstDropNudgeCta"
        onClick={onLogTonightPrice}
        aria-label={`Log tonight's price at ${venueName}`}
      >
        <PlusCircle size={15} aria-hidden="true" /> {copy.cta}
      </button>
      {onStartFirstDrop ? (
        <button
          type="button"
          className="firstDropNudgeSecondary"
          onClick={onStartFirstDrop}
        >
          Or leave a Pint Drop
        </button>
      ) : null}
    </div>
  );
}
