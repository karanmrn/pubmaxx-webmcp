export type KeenableResult = {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  published_at?: string | number;
  [key: string]: unknown;
};

export type KeenablePage = KeenableResult & {
  content?: string;
};

export type AreaNewsFact = {
  area: string;
  kind: string;
  title: string;
  detail: string;
};

export type AreaNewsEntry = AreaNewsFact & {
  id: string;
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
};

export const KEENABLE_API_BASE: string;
export const KEENABLE_TITLE: string;
export const KNOWN_AREA_SLUGS: ReadonlySet<string>;
export const AREA_NEWS_EXTRACT_PROMPT: string;
export function areaNewsExtractPrompt(year?: number): string;
export function areaNewsRefreshQueries(now?: number | string): string[];

export function searchKeenable(
  query: string,
  options?: Record<string, unknown>,
): Promise<KeenableResult[]>;
export function fetchKeenable(sourceUrl: string, options?: Record<string, unknown>): Promise<KeenablePage>;
export function parseExtractedFact(
  payload: KeenablePage | null,
  options?: { knownAreas?: ReadonlySet<string>; currentYear?: number; now?: number | string },
): AreaNewsFact | null;
export function buildAreaNewsEntry(input: {
  result?: KeenableResult;
  page?: KeenablePage;
  fact?: AreaNewsFact | null;
  now?: number | string;
  knownAreas?: ReadonlySet<string>;
}): AreaNewsEntry | null;
