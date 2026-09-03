// Issue #35 - staged map load. The map paints from the compact slim index before
// any selected-venue detail request, so the first interactive pin appears fast.
// This module is the pure bridge: it turns a SlimVenue into a minimal,
// Venue-shape-compatible object that PubMapCanvas can render.
//
// The slim row carries geometry, price, venue kind, type-relative band, anchor
// provenance, and fast filter hints. Detail-only fields use inert defaults until
// that venue is opened. In particular, `prices: []` prevents a favourite-pint
// lookup from inventing a beer match, while kind and anchor fields remain
// available so bars and late food never render as pint-priced pubs.

import type { Venue } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";

/**
 * City slim packs embed the OSM address inside filterHints.searchText as
 *   "{name lower} {address lower} {borough lower}"
 * Recover it so drink/food price updates keyed by name|address|lat|lng attach
 * to city venues that have no VenuePrice rows.
 */
export function addressFromSlimSearchText(slim: SlimVenue): string {
  const search = (slim.filterHints?.searchText ?? "").trim().toLowerCase();
  if (!search) return "";
  const name = slim.name.trim().toLowerCase();
  const borough = slim.borough.trim().toLowerCase();
  let rest = search;
  const nameVariants = [name];
  if (name.startsWith("the ")) nameVariants.push(name.slice(4));
  for (const variant of nameVariants) {
    if (variant && rest.startsWith(variant)) {
      rest = rest.slice(variant.length).trim();
      break;
    }
  }
  if (borough && rest.endsWith(borough)) {
    rest = rest.slice(0, rest.length - borough.length).trim();
  }
  // If we couldn't strip the name (London fixtures often use a short searchText),
  // don't invent an address from the whole search blob.
  if (rest === search) return "";
  return rest;
}

// A slim pin is a real Venue value (so the canvas prop type is satisfied) built
// from the compact fields the pin paint and fast filters need; every other field carries a
// safe, inert default so nothing downstream throws before hydration.
export function slimVenueToPin(slim: SlimVenue): Venue {
  return {
    id: slim.id,
    name: slim.name,
    address: addressFromSlimSearchText(slim),
    latitude: slim.lat,
    longitude: slim.lng,
    primaryBorough: slim.borough,
    // Carry the nearest-station fare zone so the zone lens filters slim pins
    // before detail hydrates (undefined stays undefined — honestly unknown).
    ...(slim.zone !== undefined ? { zone: slim.zone } : {}),
    visibleBoroughs: slim.borough ? [slim.borough] : [],
    prices: [],
    cheapestPrice: slim.cheapestPrice,
    cheapestPint: "",
    averagePrice: null,
    // Prefer slim filterHints so heritage rings paint before full detail loads
    // (critical for non-London cities that have no detail artifact yet).
    hasStory: Boolean(slim.filterHints?.curation.hasStory),
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...(slim.filterHints ? { filterHints: slim.filterHints } : {}),
    ...(slim.kind !== undefined ? { kind: slim.kind } : {}),
    ...(slim.priceBand !== undefined ? { priceBand: slim.priceBand } : {}),
    ...(slim.anchorLabel !== undefined ? { anchorLabel: slim.anchorLabel } : {}),
    ...(slim.anchorCourse !== undefined
      ? { anchorCourse: slim.anchorCourse }
      : {}),
    ...(slim.anchorObservedAt !== undefined
      ? { anchorObservedAt: slim.anchorObservedAt }
      : {}),
    ...(slim.anchorSourceUrl !== undefined
      ? { anchorSourceUrl: slim.anchorSourceUrl }
      : {}),
  };
}

export function slimVenuesToPins(slim: SlimVenue[]): Venue[] {
  return slim.map(slimVenueToPin);
}

/** Re-compact resident pins for the optional last-view resume snapshot. */
export function pinToSlimVenue(pin: Venue): SlimVenue {
  return {
    id: pin.id,
    name: pin.name,
    lat: pin.latitude,
    lng: pin.longitude,
    cheapestPrice: pin.cheapestPrice,
    borough: pin.primaryBorough,
    ...(pin.zone !== undefined ? { zone: pin.zone } : {}),
    ...(pin.filterHints ? { filterHints: pin.filterHints } : {}),
    ...(pin.kind !== undefined ? { kind: pin.kind } : {}),
    ...(pin.priceBand !== undefined ? { priceBand: pin.priceBand } : {}),
    ...(pin.anchorLabel !== undefined ? { anchorLabel: pin.anchorLabel } : {}),
    ...(pin.anchorCourse !== undefined ? { anchorCourse: pin.anchorCourse } : {}),
    ...(pin.anchorObservedAt !== undefined
      ? { anchorObservedAt: pin.anchorObservedAt }
      : {}),
    ...(pin.anchorSourceUrl !== undefined
      ? { anchorSourceUrl: pin.anchorSourceUrl }
      : {}),
  };
}

export function pinsToSlimVenues(pins: Venue[]): SlimVenue[] {
  return pins.map(pinToSlimVenue);
}
