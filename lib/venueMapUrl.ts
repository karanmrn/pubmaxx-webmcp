// Client-safe map deep-link helper. Kept out of lib/venueIndex.ts so browser
// components never pull in Node `fs` (Turbopack rejects that at build time).

import { cityAwareMapPath } from "@/lib/cityMapHref";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";

/** Canonical "open this pub on the map" link — `?sel=` selects the venue on load. */
export function venueMapUrl(id: string): string {
  return cityAwareMapPath(
    cityIdFromVenueId(id),
    `sel=${encodeURIComponent(id)}`,
  );
}

/**
 * The four surfaces that can hand a pub off as an EXPLICIT acceptance (a pin tap
 * or a plain `?sel=` link is browse-only and never appears here — see §4.8).
 */
export const VENUE_ACCEPTANCE_SOURCES = ["near", "map-search", "tonight", "pal"] as const;
export type VenueAcceptanceSource = (typeof VENUE_ACCEPTANCE_SOURCES)[number];

/**
 * Explicit-acceptance deep link (§4.6): `?sel=<id>&accept=1&src=<source>`. Unlike
 * {@link venueMapUrl}, `accept=1` marks a person who committed to this Venue (not
 * just inspected it) and `src` fixes the acceptance origin so the Map never has
 * to guess it from the current UI. City-aware exactly like the browse link.
 */
export function venueAcceptUrl(id: string, source: VenueAcceptanceSource): string {
  return cityAwareMapPath(
    cityIdFromVenueId(id),
    `sel=${encodeURIComponent(id)}&accept=1&src=${encodeURIComponent(source)}`,
  );
}
