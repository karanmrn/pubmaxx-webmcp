export declare const COMMON_SITEMAP_URL: string;
export declare const COMMON_SOURCE: { label: "common"; url: string };
export declare const COMMON_USER_AGENT: string;
export declare const COMMON_FETCH_GAP_MS: number;
export declare const COMMON_MAX_FETCHES_PER_RUN: number;
export declare const COMMON_TIME_EVIDENCE: string;

export type CommonOgPrefix = { placeName: string; dateText: string };
export type CommonParsedPost = { title: string; placeName: string; dateText: string };

export declare function parseCommonOgPrefix(text: string): CommonOgPrefix | null;
export declare function parseCommonPostHtml(html: string): CommonParsedPost | null;
export declare function parseCommonSitemap(xml: string): string[];

export type CommonSitemapEntry = { url: string; lastmod: number | null };
export declare function parseCommonSitemapEntries(xml: string): CommonSitemapEntry[];
export declare function commonCrawlOrder(entries: readonly CommonSitemapEntry[]): string[];
export declare function isStaleCommonDate(
  dateText: string,
  todayLondon: string,
  publishedOn?: string | null,
): boolean;
export declare function commonStartsDate(
  dateText: string,
  todayLondon: string,
  publishedOn?: string | null,
): string | null;

export type CommonEventRow = {
  id: string;
  placeName: string;
  kind: "event";
  /** London calendar date the post states. Common publishes no clock time. */
  startsDate: string;
  timeEvidence: string;
  title: string;
  source: { label: "common"; url: string };
  observedAt: string;
  confidence: "listed";
  sourceId: string;
};

export declare function toCommonEventRow(args: {
  url: string;
  parsed: CommonParsedPost;
  observedAt: string;
  todayLondon: string;
  /** The post's own publication day (sitemap lastmod), which resolves the year
   *  the stated day-month belongs to. Absent means "this year, drop if past". */
  publishedOn?: string | null;
}): CommonEventRow | null;

export declare function refreshCommonEvents(opts?: {
  nowMs?: number;
  fetchImpl?: typeof fetch;
  outPath?: string;
  gapMs?: number;
  maxFetches?: number;
  /** Write a run that saw nothing anyway. Off, so a blind run never empties
   *  the rows the file already holds. */
  allowEmpty?: boolean;
}): Promise<{
  rows: CommonEventRow[];
  /** False when the run refused its own write. */
  wrote: boolean;
  /** Why the write was refused, when it was. */
  refused?: string;
  droppedStale: number;
  droppedUnparseable: number;
  droppedFetch: number;
  reusedHeld: number;
  skippedOverBudget: number;
  fetched: number;
}>;
