import type { OsmVenue } from "./osmPubNormalizer.d.mts";

export type Bbox = [number, number, number, number];

export interface UkVenueTaxonomyRow {
  key: string;
  kind: string;
  group: string;
  selectors: string[];
  match: (tags: Record<string, string>) => boolean;
  note: string;
}

export const UK_VENUE_TAXONOMY: UkVenueTaxonomyRow[];
export const UK_VENUE_GROUPS: string[];
export const UK_VENUE_QUERY_SCOPES: string[];
export const UK_VENUE_KINDS: string[];

export function taxonomyForScope(scope: string): UkVenueTaxonomyRow[];
export function classifyVenueTags(
  tags: Record<string, string> | undefined,
): UkVenueTaxonomyRow | null;
export function buildUkVenueQuery(
  bbox: Bbox,
  scope?: string,
  options?: { timeout?: number },
): string;
export function normalizeVenueElements(elements: Iterable<unknown>): {
  venues: OsmVenue[];
  unclassified: number;
  unnamed: number;
};
export function countVenues(venues: OsmVenue[]): {
  byKind: Record<string, number>;
  byTaxonomyKey: Record<string, number>;
};
