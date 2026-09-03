// What Near me says when the browser cannot place you.
//
// A silent Near me is the worst outcome: the chip flips to "Try near me" and
// the reader is told neither why nor what to do next. So one module owns the
// two halves of that answer, and every Near me caller reads it:
//
//   - NEAR_ME_LOCATION_OPTIONS — the SAME request options for every call. An
//     options-free getCurrentPosition never times out, so a denied or dead
//     location left the chip on "Locating" for good.
//   - nearMeLocationMessage    — one honest sentence per reason, each naming a
//     way on. The area picker is always reachable, so no failure is a dead end.
//
// The copy sits at the honesty level of the /plan location step, which is the
// house precedent for a denied browser permission.

/** Shared request options. The timeout is what makes a failure ARRIVE. */
export const NEAR_ME_LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 7000,
  maximumAge: 60_000,
};

export type NearMeLocationFailure =
  /** The reader refused the browser prompt, or the site is blocked. */
  | "denied"
  /** The request ran past NEAR_ME_LOCATION_OPTIONS.timeout. */
  | "timeout"
  /** The device answered, but with no usable fix. */
  | "position"
  /** No geolocation in this browser at all. */
  | "unsupported";

/**
 * Reads a GeolocationPositionError into one of our reasons. An unknown code
 * reads as "position": the device answered with something we cannot use, which
 * is the honest floor and never claims a denial that did not happen.
 */
export function nearMeLocationFailure(
  error: Pick<GeolocationPositionError, "code"> | null | undefined,
): NearMeLocationFailure {
  switch (error?.code) {
    case 1:
      return "denied";
    case 3:
      return "timeout";
    default:
      return "position";
  }
}

export function nearMeLocationMessage(failure: NearMeLocationFailure): string {
  switch (failure) {
    case "denied":
      return "Location access was denied. Pick an area or allow location in your browser settings.";
    case "timeout":
      return "We could not get your location in time. Try again or pick an area.";
    case "unsupported":
      return "This browser cannot share your location. Pick an area instead.";
    default:
      return "We could not find your location. Check your signal or pick an area.";
  }
}
