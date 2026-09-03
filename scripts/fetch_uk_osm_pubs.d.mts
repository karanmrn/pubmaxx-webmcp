export interface OverpassRawResponse {
  elements: unknown[];
  osm3s?: {
    timestamp_osm_base?: string;
  };
}

export function parseOverpassRawText(text: string): OverpassRawResponse | null;
export function isFreshOverpassSnapshot(
  raw: OverpassRawResponse,
  nowMs?: number,
): boolean;
