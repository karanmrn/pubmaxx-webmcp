import { listingUrgency, type ListingUrgency } from "@/lib/whatsOnBadges";
import type { WhatsOnRow } from "@/lib/whatsOn";

import "./whatsOnUrgencyBadge.css";

export function WhatsOnUrgencyBadge({
  row,
  now,
}: {
  row: WhatsOnRow;
  now?: Date;
}): React.JSX.Element | null {
  const urgency: ListingUrgency | null = listingUrgency(row, now);
  if (!urgency) return null;
  return (
    <span className="whatsOnUrgencyBadge" data-tier={urgency.tier}>
      {urgency.label}
    </span>
  );
}
