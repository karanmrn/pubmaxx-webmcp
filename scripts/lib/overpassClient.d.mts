export interface OverpassRawResponse {
  elements: unknown[];
  remark?: string;
  osm3s?: { timestamp_osm_base?: string };
}

export const OVERPASS_PRIMARY_ENDPOINTS: string[];
export const OVERPASS_FALLBACK_ENDPOINTS: string[];
export const OVERPASS_ENDPOINTS: string[];
export const PRIMARY_ATTEMPTS: number;
export const REQUEST_TIMEOUT_MS: number;
export function endpointForAttempt(attempt: number): string;
export const INTER_CHUNK_DELAY_MS: number;
export const INTER_CHUNK_DELAY_STALE_MS: number;
export const MAX_ATTEMPTS: number;
export const MAX_BACKOFF_MS: number;
export const QUERY_TIMEOUT_S: number;
export const MAX_SOURCE_AGE_MS: number;
export const MAX_FUTURE_CLOCK_SKEW_MS: number;
export const COMMIT_SIZE_LIMIT_BYTES: number;
export const USER_AGENT: string;

export function sleep(ms: number): Promise<void>;
export function isRetryableStatus(status: number): boolean;
export function backoffMs(attempt: number, retryAfterHeader: string | null): number;
export function isValidOverpassRaw(raw: unknown): boolean;
export function parseOverpassRawText(text: string): OverpassRawResponse | null;
export function isFreshOverpassSnapshot(
  raw: OverpassRawResponse | null,
  nowMs?: number,
): boolean;
export function fetchOverpass(
  query: string,
  options?: { allowStale?: boolean },
): Promise<OverpassRawResponse>;
export function writeJsonAtomic(filePath: string, content: string): Promise<void>;
export function writeCompact(filePath: string, value: unknown): Promise<void>;
export function writePretty(filePath: string, value: unknown): Promise<void>;
export function formatMb(bytes: number): string;
