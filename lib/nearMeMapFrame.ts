import { haversineKm } from "@/lib/haversine";
import { nearbyVenuesForMap } from "@/lib/nearby";
import { WALKABLE_RADIUS_KM } from "@/lib/nearMeAnswer";
import type { Venue } from "@/lib/venues";

/**
 * Near me answers one question: what is around ME, right now.
 *
 * The reader is the subject of that answer, so the reader owns the centre of
 * the map. A camera that fits a BOUNDS of nearby pubs answers a different
 * question: it centres the pub cloud and leaves the reader wherever the cloud's
 * geometry drops them. On a phone that is under the near-me sheet, so a reader
 * standing in Victoria was shown Mayfair. Everything here exists to stop that.
 *
 * Two rules, both stated rather than implied:
 *
 * 1. The map's near-me set is the SAME ring the sheet names, so the chip count
 *    and the sheet's sentence are one claim instead of two.
 * 2. The camera centres the reader inside the band of map the reader can SEE,
 *    and picks a zoom at which their own street is readable.
 */

/**
 * The ring the map answers from. Shared with the sheet's own sentence
 * ("Within about a 12-minute walk"), because a chip that counts a 2.5 km ring
 * beside a sentence naming a 1 km one is a contradiction the reader can see.
 */
export const NEAR_ME_MAP_RADIUS_KM = WALKABLE_RADIUS_KM;

/**
 * A thin area can hold no pub inside the ring at all. Top the set up to the
 * nearest few rather than answering with nothing. The sheet prints each pub's
 * real distance, so a topped-up pub never passes as walkable.
 */
export const NEAR_ME_MAP_MIN_VENUES = 20;

/**
 * Street level. The reader asked where THEY are, so the camera lands close
 * enough to read the street under their feet.
 */
export const NEAR_ME_MAX_ZOOM = 16;

/**
 * The floor a thin area may fall back to. It reaches a few streets out, and it
 * is far tighter than the city: the near-me camera never frames London.
 */
export const NEAR_ME_MIN_ZOOM = 13.5;

/**
 * The ground the camera shows even when a pub stands on the reader's doorstep.
 * Without it a 0 m nearest pub would ask for infinite zoom.
 */
export const NEAR_ME_MIN_REACH_KM = 0.12;

/**
 * The reader may never be squeezed into a sliver. If measured chrome leaves
 * less than this, the band is re-cut from the top of the map instead.
 */
export const NEAR_ME_MIN_BAND_PX = 96;

/** Metres per pixel at the equator, zoom 0 — MapLibre's Web Mercator constant. */
const EQUATOR_METRES_PER_PIXEL = 156543.03392;

const METRES_PER_DEGREE_LAT = 111320;

/** The strip of the map container the reader can actually see, in CSS pixels. */
export type MapVisibleBand = { top: number; bottom: number };

export type NearMeCameraFrame = {
  center: [number, number];
  zoom: number;
  /**
   * MapLibre easeTo `offset` in pixels: where the target sits relative to the
   * container centre. Measured on the shipped map, positive y puts the target
   * BELOW the centre, so lifting the reader above a bottom sheet needs a
   * negative y.
   */
  offset: [number, number];
};

/** Ground resolution in metres per pixel at a zoom and latitude. */
export function metresPerPixel(zoom: number, latitudeDeg: number): number {
  return (EQUATOR_METRES_PER_PIXEL * Math.cos((latitudeDeg * Math.PI) / 180)) / 2 ** zoom;
}

/** The zoom whose ground resolution is `metres` per pixel at this latitude. */
export function zoomForMetresPerPixel(metres: number, latitudeDeg: number): number {
  const safe = Math.max(metres, 1e-6);
  return Math.log2((EQUATOR_METRES_PER_PIXEL * Math.cos((latitudeDeg * Math.PI) / 180)) / safe);
}

/**
 * The band of map left between the top chrome and any open bottom sheet.
 *
 * `coverTop` is measured, never assumed: the phone's contextual sheet is sized
 * by its own content, so no constant can stand in for it.
 */
export function mapVisibleBand(input: {
  height: number;
  topInset: number;
  coverTop: number | null;
  bottomInset: number;
}): MapVisibleBand {
  const height = Math.max(0, input.height);
  const top = Math.min(Math.max(0, input.topInset), height);
  const covered = input.coverTop === null || !Number.isFinite(input.coverTop)
    ? height - Math.max(0, input.bottomInset)
    : Math.min(Math.max(0, input.coverTop), height);
  const bottom = Math.max(top, covered);
  if (bottom - top >= NEAR_ME_MIN_BAND_PX) return { top, bottom };
  // Too little room left. Give the reader the tallest strip the chrome allows,
  // measured DOWN from the top inset, rather than a band they cannot read.
  return { top, bottom: Math.min(height, top + NEAR_ME_MIN_BAND_PX) };
}

/**
 * Where the near-me camera lands.
 *
 * The centre is the reader, always. Only the zoom and the on-screen offset
 * respond to what is around them, so no venue geometry can move the reader off
 * the map.
 */
export function nearMeCameraFrame(input: {
  location: { lat: number; lng: number };
  /** Great-circle km to the closest venue in the answer; null when there is none. */
  nearestVenueKm: number | null;
  viewport: { width: number; height: number };
  band: MapVisibleBand;
}): NearMeCameraFrame {
  const { location, band, viewport } = input;
  const bandHeight = Math.max(1, band.bottom - band.top);
  const reach = Math.max(
    NEAR_ME_MIN_REACH_KM,
    input.nearestVenueKm !== null && Number.isFinite(input.nearestVenueKm)
      ? Math.max(0, input.nearestVenueKm)
      : NEAR_ME_MIN_REACH_KM,
  );
  // Reach out far enough to put the nearest pub on screen, measured against the
  // band's SHORT side. The band is what the reader sees; the canvas is not.
  const needed = (reach * 2 * 1000) / Math.min(bandHeight, Math.max(1, viewport.width));
  const zoom = Math.min(
    NEAR_ME_MAX_ZOOM,
    Math.max(NEAR_ME_MIN_ZOOM, zoomForMetresPerPixel(needed, location.lat)),
  );
  const bandCentre = (band.top + band.bottom) / 2;
  const offsetY = Math.round(bandCentre - viewport.height / 2);
  return {
    center: [location.lng, location.lat],
    zoom,
    offset: [0, offsetY],
  };
}

/**
 * The geographic box the reader can SEE under a frame — the visible band, not
 * the whole canvas.
 *
 * A flat (unpitched) approximation. It exists so the promise "the reader is on
 * screen, and the screen is not the city" can be asserted as a number.
 */
export function nearMeVisibleBounds(
  frame: NearMeCameraFrame,
  viewport: { width: number; height: number },
  band: MapVisibleBand,
): [[number, number], [number, number]] {
  const [centreLng, centreLat] = frame.center;
  const resolution = metresPerPixel(frame.zoom, centreLat);
  // Screen y grows downward, so a reader sitting BELOW the band centre means
  // the band shows ground to the north of them. A negative offset lifts the
  // reader up the screen, which is what closes that gap.
  const readerScreenY = viewport.height / 2 + frame.offset[1];
  const bandCentreGapPx = readerScreenY - (band.top + band.bottom) / 2;
  const halfWidthM = (viewport.width / 2) * resolution;
  const halfHeightM = ((band.bottom - band.top) / 2) * resolution;
  const centreShiftM = bandCentreGapPx * resolution;
  const latPerMetre = 1 / METRES_PER_DEGREE_LAT;
  const lngPerMetre = 1 / (METRES_PER_DEGREE_LAT * Math.cos((centreLat * Math.PI) / 180));
  const bandCentreLat = centreLat + centreShiftM * latPerMetre;
  return [
    [centreLng - halfWidthM * lngPerMetre, bandCentreLat - halfHeightM * latPerMetre],
    [centreLng + halfWidthM * lngPerMetre, bandCentreLat + halfHeightM * latPerMetre],
  ];
}

/**
 * The venues the near-me answer is about: every venue inside the walk ring, or
 * the nearest few when the ring is thin.
 *
 * The ring is NOT truncated. A cap would make the chip's count smaller than the
 * ring it names, which is the kind of quiet shortfall a reader cannot detect.
 */
export function nearMeMapVenues(lat: number, lng: number, venues: Venue[]): Venue[] {
  return nearbyVenuesForMap(lat, lng, venues, {
    radiusKm: NEAR_ME_MAP_RADIUS_KM,
    minCount: NEAR_ME_MAP_MIN_VENUES,
    maxCount: Math.max(NEAR_ME_MAP_MIN_VENUES, venues.length),
  });
}

/** Great-circle km to the closest of `venues`, or null when there is none. */
export function nearestVenueKm(
  location: { lat: number; lng: number },
  venues: Venue[],
): number | null {
  let closest: number | null = null;
  for (const venue of venues) {
    const km = haversineKm([location.lng, location.lat], [venue.longitude, venue.latitude]);
    if (closest === null || km < closest) closest = km;
  }
  return closest;
}

/** How many of `venues` sit inside the ring the chip and the sheet both name. */
export function withinNearMeRing(
  location: { lat: number; lng: number },
  venues: Venue[],
): number {
  return venues.filter(
    (venue) =>
      haversineKm([location.lng, location.lat], [venue.longitude, venue.latitude]) <=
      NEAR_ME_MAP_RADIUS_KM,
  ).length;
}
