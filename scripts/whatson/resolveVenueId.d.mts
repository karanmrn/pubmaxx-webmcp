// Hand-maintained declarations for resolveVenueId.mjs so the vitest suite
// (__tests__/resolveVenueId.test.ts and the generator tests) type-checks
// under the repo's allowJs:false tsconfig. Keep in sync with the runtime
// module.

export interface CanonicalDatasetRow {
  pub_name?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  [key: string]: unknown;
}

export interface VenueResolverCandidate {
  venueId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  postcode: string | null;
}

export interface VenueResolverIndex {
  exactByKey: Map<string, string>;
  byNormalizedName: Map<string, VenueResolverCandidate[]>;
}

export interface VenueResolverSourceRow {
  name: string;
  address?: string | null;
  postcode?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
}

export declare const VENUE_MATCH_PROXIMITY_METERS: 75;

export declare function buildVenueResolverIndex(
  canonicalRows: CanonicalDatasetRow[],
): VenueResolverIndex;

export declare function resolveVenueId(
  row: VenueResolverSourceRow | null | undefined,
  index: VenueResolverIndex | null | undefined,
): string | null;

export declare function loadCanonicalVenueIndex(datasetPath?: string): VenueResolverIndex;

export declare function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number;

export declare function normaliseVenueKeyPart(value: unknown): string;
