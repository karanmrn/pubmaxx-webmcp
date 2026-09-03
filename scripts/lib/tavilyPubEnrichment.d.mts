export type OsmPub = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
  postcode?: string | null;
  website?: string | null;
  operator?: string | null;
  brewery?: string | null;
  /** Set by the UK OSM pack when this pub already exists in curated data. */
  curatedRef?: { source: string; id: string } | null;
};

export type TavilyPrice = {
  venueKey: string;
  drinkName: string;
  category: "beer";
  priceGbp: number;
  servingSize: "pint" | "568ml";
  source: { label: string; url: string; licence: string };
  observedAt: string;
};

export type TavilyEnrichmentResult = {
  city: string;
  totalPubs: number;
  startIndex: number;
  nextIndex: number;
  queriesSpent: number;
  creditsSpent: number;
  matchedPubs: number;
  prices: TavilyPrice[];
  pages: Array<Record<string, unknown>>;
  delegatedChains: Array<{ pub: OsmPub; chain: string; harvester: string }>;
  complete: boolean;
};

export const CITY_DEFINITIONS: Readonly<
  Record<string, { id: string; displayName: string; bbox: [number, number, number, number] }>
>;
export const OFFICIAL_SITE_SOURCE_LICENCE: string;

export type SearchProvider = {
  search(options: Record<string, unknown>): Promise<{
    results: Array<Record<string, unknown>>;
    creditsSpent?: number;
  }>;
};

export function venueKeyForOsmPub(pub: OsmPub): string;
export function classifyChainPub(
  pub: OsmPub,
): { chain: string; harvester: string } | null;
export function selectCityPubs(cityId: string, allPubs: OsmPub[]): OsmPub[];
export function isOfficialResult(
  pub: OsmPub,
  result: { title?: string; url?: string; content?: string },
): boolean;
export function extractPintPrices(
  markdown: string,
): Array<{ drinkName: string; priceGbp: number; servingSize: "pint" | "568ml" }>;
export function mergeCanonicalPrices<T extends {
  venueKey: string;
  drinkName: string;
  category: string;
}>(existing: T[], incoming: T[]): T[];
export function runCityEnrichment(options: {
  city: string;
  pubs: OsmPub[];
  apiKey?: string;
  searchProvider?: SearchProvider;
  maxQueries?: number;
  startIndex?: number;
  observedAt?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (state: Record<string, unknown>) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<TavilyEnrichmentResult>;
