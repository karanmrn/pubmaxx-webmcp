// Hand-written types for the plain-JS UK OSM seed helpers (allowJs is off, so
// tsc needs a declaration to typecheck the unit tests that import it). Keep in
// lockstep with scripts/lib/ukOsmSeed.mjs.

import type { OsmPub } from "./osmPubNormalizer.mjs";

export type UkBbox = [number, number, number, number];

export const UK_BBOX: UkBbox;
export const UK_AREA_ID: number;
export const DEFAULT_LAT_STEP: number;
export const DEFAULT_LON_STEP: number;
export const UK_TAXONOMY: string[];
export const CURATED_MATCH_RADIUS_M: number;

export interface GridChunk {
  id: string;
  bbox: UkBbox;
  row: number;
  col: number;
}

export interface UkOsmPub extends OsmPub {
  curatedRef?: CuratedMatch;
}

export interface CuratedEntry {
  source: string;
  id: string;
  name: string;
  lat: number;
  lng: number;
  osmId?: string | null;
}

export interface CuratedMatch {
  source: string;
  id: string;
  matchType: "osm-id" | "name-distance";
  distanceM?: number;
}

export interface CuratedIndex {
  byOsmId: Map<string, CuratedEntry>;
  byCell: Map<string, Array<CuratedEntry & { normalizedName: string }>>;
  size: number;
}

export interface DedupeSourceStats {
  source: string;
  entries: number;
  matched: number;
}

export interface DedupeReport {
  ukPubs: number;
  matchedTotal: number;
  uniqueToUk: number;
  byMatchType: { "osm-id": number; "name-distance": number };
  matchRadiusM: number;
  sources: DedupeSourceStats[];
  samples: Array<CuratedMatch & { osmId: string; name: string }>;
}

export function buildGrid(options?: {
  bbox?: UkBbox;
  latStep?: number;
  lonStep?: number;
}): GridChunk[];
export function chunkId(bbox: UkBbox): string;
export function chunkFileName(chunk: GridChunk): string;
export function buildUkOverpassQuery(bbox: UkBbox, options?: { timeout?: number }): string;
export function normalizeElements(elements: Iterable<unknown>): UkOsmPub[];
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number;
export function buildCuratedIndex(entries: CuratedEntry[]): CuratedIndex;
export function matchCurated(
  pub: { osmId: string; name: string; lat: number; lng: number },
  index: CuratedIndex,
): CuratedMatch | null;
export function annotateCuratedOverlap(
  pubs: UkOsmPub[],
  curatedEntries: CuratedEntry[],
): { pubs: UkOsmPub[]; report: DedupeReport };
