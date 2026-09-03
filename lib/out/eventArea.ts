import { nightAreaForPoint } from "@/lib/pricedLanding";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * Serve-time night-area slug from the row's own point. Never invents a pub.
 *
 * This reads the point directly (`nightAreaForPoint`) rather than going through
 * `assignVenueToNightArea`: that memo is keyed on a venue id, and a provider
 * event id is ephemeral, so a long-lived process would accumulate one permanent
 * entry per listing it has ever served.
 */
export function fillEventArea(row: WhatsOnRow): WhatsOnRow {
  if (row.area) return row;
  if (row.lat === undefined || row.lng === undefined) return row;
  const assigned = nightAreaForPoint(row.lng, row.lat);
  return assigned ? { ...row, area: assigned.slug } : row;
}
