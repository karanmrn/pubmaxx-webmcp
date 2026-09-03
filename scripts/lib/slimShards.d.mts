// Hand-written types for the plain-JS shard-plan module (allowJs is off, so
// tsc needs a declaration to typecheck the unit tests that import it). Keep in
// lockstep with scripts/lib/slimShards.mjs.

export const OUTER_MAX_PRICED_RATIO: number;
export const OUTER_MIN_VENUES: number;
export const LAZY_KIND_SHARDS: Record<string, string>;
export const MANIFEST_FILE: string;
export const CORE_FILE: string;
export const SHARD_VERSION: number;
export const SPATIAL_SHARD_VERSION: number;
export const DATA_REVISION: string;

export interface SpatialGrid {
  originLat: number;
  originLon: number;
  latStep: number;
  lonStep: number;
}

export const SPATIAL_GRID: SpatialGrid;
export const SPATIAL_SHARD_PREFIX: string;

export interface SlimShardRow {
  id: string;
  name?: unknown;
  lat?: unknown;
  lng?: unknown;
  cheapestPrice?: number | null;
  borough?: unknown;
  [key: string]: unknown;
}

export type ShardBbox = [number, number, number, number];

export interface OuterShard {
  borough?: string;
  venues: SlimShardRow[];
}

export interface ShardPlan {
  core: SlimShardRow[];
  outer: Map<string, OuterShard>;
}

export interface ShardManifestEntry {
  id: string;
  core: boolean;
  url: string;
  count: number;
  bbox: ShardBbox;
  partition?: "borough" | "kind" | "grid";
  borough?: string;
}

export interface ShardManifest {
  version: number;
  revision?: string;
  grid?: SpatialGrid;
  shards: ShardManifestEntry[];
}

export interface SpatialCell {
  lat: number;
  lon: number;
  venues: SlimShardRow[];
}

export function dataUrl(fileName: string): string;
export function buildShardPayload(rows: SlimShardRow[]): { revision: string; rows: SlimShardRow[] };
export function slugifyBorough(borough: unknown): string;
export function shardFileForSlug(slug: string): string;
export function spatialCellIndex(
  lat: number,
  lng: number,
  grid?: SpatialGrid,
): { lat: number; lon: number };
export function spatialCellId(
  latIndex: number,
  lonIndex: number,
  grid?: SpatialGrid,
): string;
export function spatialShardFile(
  latIndex: number,
  lonIndex: number,
  grid?: SpatialGrid,
): string;
export function classifySpatialShards(
  slim: SlimShardRow[],
  grid?: SpatialGrid,
): Map<string, SpatialCell>;
export function buildSpatialShardManifest(
  cells: Map<string, SpatialCell>,
  grid?: SpatialGrid,
  coreId?: string | null,
): ShardManifest;
export function computeBbox(venues: Array<{ lat?: unknown; lng?: unknown }>): ShardBbox;
export function classifySlimShards(slim: SlimShardRow[]): ShardPlan;
export function buildShardManifest(plan: ShardPlan): ShardManifest;
