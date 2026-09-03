import "server-only";

import {
  defaultVenuePhotoServeDeps,
  VENUE_PHOTO_SERVE_CACHE_CONTROL,
  type VenuePhotoServeDeps,
} from "@/lib/venuePhotoServe.server";

export const VENUE_PHOTO_CACHE_CONTROL = VENUE_PHOTO_SERVE_CACHE_CONTROL;

let testDeps: Partial<VenuePhotoServeDeps> | null = null;

export function __setVenuePhotoServeRouteDepsForTest(
  deps: Partial<VenuePhotoServeDeps> | null,
): void {
  testDeps = deps;
}

export function venuePhotoServeRouteDeps(): VenuePhotoServeDeps {
  return { ...defaultVenuePhotoServeDeps, ...testDeps };
}
