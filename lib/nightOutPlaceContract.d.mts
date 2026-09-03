export const NIGHT_OUT_PLACE_CATEGORIES: readonly ["restaurant", "attraction", "bar", "late_food"];
export const NIGHT_OUT_PLACE_JOBS: readonly ["near_pub_food", "pre_pub_attraction", "late_night_bar", "crawl_ending_food"];
export const NIGHT_OUT_PLACE_MAX_AGE_HOURS: number;
export const NIGHT_OUT_PLACE_MAX_AGE_MS: number;
export const NIGHT_OUT_PLACE_PROVENANCE_REGISTRY_VERSION: 1;
export const NIGHT_OUT_PLACE_LONDON_BOUNDS: Readonly<{
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}>;
export const NIGHT_OUT_PLACE_SLOP_PHRASES: readonly string[];

export function isNightOutPlaceSlopDescription(
  value: string | null | undefined,
): boolean;
export function presentableNightOutPlaceDescription(value: unknown): string | null;
export function isNightOutPlaceJob(value: unknown): boolean;
export function categoryForNightOutJob(
  value: unknown,
): "restaurant" | "attraction" | "bar" | "late_food" | null;
export function jobForNightOutPlaceCategory(
  value: unknown,
): "near_pub_food" | "pre_pub_attraction" | "late_night_bar" | "crawl_ending_food" | null;
export function isLondonNightOutPlaceCoordinates(
  lat: unknown,
  lng: unknown,
): boolean;
export function isLondonNightOutPlaceLocation(value: unknown): boolean;
export function nightOutPlaceRowValidationErrors(value: unknown): string[];
export function isValidNightOutPlace(value: unknown): boolean;
export function nightOutPlaceSnapshotValidationErrors(value: unknown): string[];
export function isValidNightOutPlaceSnapshot(value: unknown): boolean;
export function nightOutPlaceProvenanceRegistryValidationErrors(
  registry: unknown,
  snapshot: unknown,
): string[];
export function isCurrentNightOutPlace(place: unknown, now: Date | number): boolean;
