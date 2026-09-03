export const ODBL_LICENSE: "ODbL-1.0";
export const ODBL_ATTRIBUTION: string;
export const SHARD_SIZE: 500;
export const EXA_SEARCH_URL: string;
export const EXA_CONTENTS_URL: string;
export const EXA_PACE_MS: number;
export const EXA_REQUEST_TIMEOUT_MS: number;
export const EXA_MAX_ATTEMPTS: number;
export const PROGRESS_FILE: string;
export const EXA_SYSTEM_PROMPT: string;
export const EXA_PUB_OUTPUT_SCHEMA: {
  type: "object";
  required: string[];
  properties: Record<string, unknown>;
};
export const EXA_DEPRECATED_PARAM_KEYS: readonly string[];

export type HarvestBbox = [number, number, number, number];

export interface HarvestObservation {
  kind: "website" | "history" | "social" | "menu" | "coverage";
  value: string;
  sourceUrl: string;
  fetchedAt: string;
  snippet?: string;
}

export interface HarvestSeedRow {
  osmId: string;
  name: string;
  amenity: string;
  lat: number;
  lng: number;
  addressTags: Record<string, string>;
  website: { value: string; sourceUrl: string; fetchedAt: string } | null;
  socialTags: Record<string, { value: string; sourceUrl: string; fetchedAt: string }>;
  license: string;
  attribution: string;
  sourceUrl: string;
  fetchedAt: string;
}

export interface HarvestProgress {
  stage: "enumerate" | "enrich" | "done" | "blocked";
  seedCount: number;
  enrichedCount: number;
  completeShards: number;
  lastCompleteShard: number | null;
  startedAt: string;
  updatedAt: string;
  mock?: boolean;
  attribution: string;
  etaIso?: string | null;
  ratePerHour?: number;
  drops?: Record<string, number>;
  blockedReason?: string;
}

export interface ExaHit {
  url?: string;
  title?: string;
  text?: string;
  highlights?: string[];
}

export interface ExaGroundingCitation {
  url?: string;
  title?: string;
}

export interface ExaGroundingEntry {
  field?: string;
  citations?: ExaGroundingCitation[];
  confidence?: string;
}

export interface ExaStructuredOutput {
  content?: Record<string, unknown> | string | null;
  grounding?: ExaGroundingEntry[];
}

export interface ExaPayload {
  results: ExaHit[];
  output?: ExaStructuredOutput;
}

export type ExaPurpose = "lore" | "menu";

export interface ExaClient {
  mock: boolean;
  search(query: string, options?: { purpose?: ExaPurpose }): Promise<ExaPayload>;
  contents(urls: string[], options?: { purpose?: ExaPurpose }): Promise<ExaPayload>;
}

export function isPubLikeBar(tags: Record<string, string> | undefined): boolean;
export function isPlainBar(tags: Record<string, string> | undefined): boolean;
export function isHarvestableTags(tags: Record<string, string> | undefined): boolean;
export type HarvestLane = "pubs" | "plain-bars";
export function buildHarvestOverpassQuery(
  bbox: HarvestBbox,
  options?: { timeout?: number },
): string;
export function osmObjectUrl(type: string, id: number | string): string | null;
export function seedRowFromElement(
  element: unknown,
  options: { fetchedAt: string; lane?: HarvestLane },
): HarvestSeedRow | null;
export function normalizeHarvestElements(
  elements: Iterable<unknown>,
  options: { fetchedAt: string; lane?: HarvestLane },
): {
  rows: HarvestSeedRow[];
  drops: { unnamed: number; plainBar: number; pubOrPubLike: number; noPoint: number };
};
export function pubsEnrichComplete(progress: {
  stage?: string;
  seedCount?: number;
  enrichedCount?: number;
  mock?: boolean;
} | null): boolean;
export function classifyExaHit(hit: ExaHit): { kind: HarvestObservation["kind"]; url: string } | null;
export function observationsFromExaResults(
  pub: { osmId: string; name: string },
  results: ExaHit[] | undefined,
  fetchedAt: string,
): HarvestObservation[];
export function observationsFromExaOutput(
  content: ExaStructuredOutput["content"] | undefined,
  grounding: ExaGroundingEntry[] | undefined,
  fetchedAt: string,
): HarvestObservation[];
export function groundedMenuUrls(output: ExaStructuredOutput | undefined): string[];
export function persistedShardRowCount(dir: string): Promise<number>;
export function isMainModule(metaUrl: string, argv1?: string): boolean;
export function buildExaSearchBody(input: { query: string; purpose?: ExaPurpose }): {
  query: string;
  type: "auto";
  numResults: number;
  systemPrompt: string;
  outputSchema: typeof EXA_PUB_OUTPUT_SCHEMA;
  contents: { highlights: true; maxAgeHours?: number };
};
export function buildExaContentsBody(input: { urls: string[]; purpose?: ExaPurpose }): {
  urls: string[];
  highlights: true;
  maxAgeHours?: number;
};
export function officialWebsiteUrl(pub: { website?: HarvestSeedRow["website"] | null }): string | null;
export function exaApiKey(env?: Record<string, string | undefined>): string | null;
export function isExaConfigured(env?: Record<string, string | undefined>): boolean;
export function backoffMs(attempt: number, retryAfterHeader: string | null): number;
export function mockExaPayload(pub: { name: string; osmId?: string }): ExaPayload;
export function createExaClient(options?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  mock?: boolean;
  requestTimeoutMs?: number;
}): ExaClient | null;
export function enrichPub(
  pub: HarvestSeedRow,
  exaPayload: ExaPayload | undefined,
  fetchedAt: string,
): {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  observations: HarvestObservation[];
  fetchedAt: string;
  output?: ExaStructuredOutput;
};
export function enrichPubWithClient(
  pub: HarvestSeedRow,
  client: ExaClient,
  fetchedAt: string,
): Promise<{
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  observations: HarvestObservation[];
  fetchedAt: string;
  output?: ExaStructuredOutput;
}>;
export function isFatalExaError(error: unknown): boolean;
export function shardFileName(index: number): string;
export function nextShardIndexFromNames(names: string[]): number;
export function nextShardIndex(dirOrNames: string | string[]): number;
export function listCompleteShardIndexes(dir: string): Promise<number[]>;
export function writeJsonlAtomic(filePath: string, rows: unknown[]): Promise<void>;
export function readJsonl(filePath: string): Promise<unknown[]>;
export function writeShardAtomic(dir: string, index: number, rows: unknown[]): Promise<void>;
export function writeProgress(dir: string, progress: HarvestProgress): Promise<void>;
export function loadProgress(dir: string): Promise<HarvestProgress | null>;
export function estimateEta(input: {
  remaining: number;
  elapsedMs: number;
  done: number;
  now?: number;
}): { ratePerHour: number; remainingMs: number | null; etaIso: string | null };
export function harvestSearchQuery(pub: HarvestSeedRow): string;
export function seedSample<T>(rows: T[], limit?: number): T[];
