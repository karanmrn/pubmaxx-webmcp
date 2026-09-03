// The arrival: national figure to "what about my patch" in one tap.
//
// Someone lands on the Pint Index from a press link or a shared card. They read
// one interesting number about London and then, today, have nowhere obvious to
// go that is about THEM. This module decides what that one tap offers.
//
// Three rules shape it:
//   • No wall. No account, no location permission, no modal. A tap on an area
//     is the whole interaction, and it works on a first visit with no state.
//   • Land somewhere real. The tap opens the map ON the cheapest pint the
//     dataset holds in that area, selected, with its price and provenance in
//     the sheet. A `?q=` browse leaves the phone looking at all of London, and
//     an area with almost nothing priced in it is not worth a tap either
//     (MIN_ARRIVAL_PRICED_PUBS).
//   • Say where the figures come from. These are the map's own recorded
//     prices, not the citable Index observations, so the strip stamps their
//     source and collection date once, underneath.

import { canonicalBorough, slugifyBorough } from "@/lib/boroughs";
import type { Venue } from "@/lib/venues";

/** Below this the map view is too thin to be worth a tap. */
export const MIN_ARRIVAL_PRICED_PUBS = 8;

/** How many areas the strip offers before deferring to the full borough list. */
export const ARRIVAL_AREA_LIMIT = 8;

/** The query param a Pint Index arrival carries onto the map. */
export const ARRIVAL_PARAM = "from";
export const ARRIVAL_PARAM_VALUE = "pint-index";

export type ArrivalArea = {
  slug: string;
  name: string;
  /** Pubs in the area carrying a price on the map. */
  pricedCount: number;
  /** The cheapest of them, and the pub the tap opens on. */
  cheapestGbp: number;
  cheapestVenueId: string;
};

/**
 * The areas worth offering, busiest priced first. Only boroughs the dataset
 * actually prices are eligible; a borough with pubs but no prices would open a
 * map with nothing to read. Ties on price break on venue id so the pub a chip
 * opens is stable between renders.
 */
export function arrivalAreas(venues: readonly Venue[], limit = ARRIVAL_AREA_LIMIT): ArrivalArea[] {
  const areas = new Map<string, ArrivalArea>();
  for (const venue of venues) {
    const price = venue.cheapestPrice;
    if (typeof price !== "number" || !venue.id) continue;
    const name = canonicalBorough(venue);
    if (!name) continue;
    const slug = slugifyBorough(name);
    const entry = areas.get(slug)
      ?? { slug, name, pricedCount: 0, cheapestGbp: price, cheapestVenueId: venue.id };
    entry.pricedCount += 1;
    if (price < entry.cheapestGbp || (price === entry.cheapestGbp && venue.id < entry.cheapestVenueId)) {
      entry.cheapestGbp = price;
      entry.cheapestVenueId = venue.id;
    }
    areas.set(slug, entry);
  }
  return [...areas.values()]
    .filter((area) => area.pricedCount >= MIN_ARRIVAL_PRICED_PUBS)
    .sort((a, b) => b.pricedCount - a.pricedCount || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

/**
 * Where a chip goes: the map, opened on that area's cheapest recorded pint
 * with its sheet up, plus the arrival marker the map reads to record that the
 * tap landed. `sel` is deliberate rather than the `?q=` area browse the
 * borough pages use: a selection owns the camera and frames a real street, and
 * a phone that arrives looking at the whole of London has not answered
 * "what about my area" at all.
 */
export function arrivalMapHref(area: ArrivalArea): string {
  const params = new URLSearchParams({
    sel: area.cheapestVenueId,
    [ARRIVAL_PARAM]: ARRIVAL_PARAM_VALUE,
  });
  return `/map?${params.toString()}`;
}

/**
 * The marker that tells a first arrival from a return. One key, one value,
 * written only after analytics consent (same rule as the daily activity pulse)
 * and holding nothing but "this browser has been here before".
 */
export const ARRIVAL_VISIT_STORAGE_KEY = "pubmaxx:pint-index-seen:v1";
export const ARRIVAL_VISIT_MARKER = "seen";

export function visitFromMarker(stored: string | null): "first" | "repeat" {
  return stored === ARRIVAL_VISIT_MARKER ? "repeat" : "first";
}

/** Did this map view come from the Pint Index? Reads a raw `location.search`. */
export function isPintIndexArrival(search: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get(ARRIVAL_PARAM) === ARRIVAL_PARAM_VALUE;
}
