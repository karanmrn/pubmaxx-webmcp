// Hand-maintained declarations for editorialRss.mjs (allowJs is false).

export const EDITORIAL_USER_AGENT: string;
export const EDITORIAL_EXCERPT_MAX: number;
export const EDITORIAL_BACKOFF_MS: number;
export const EDITORIAL_FETCH_TIMEOUT_MS: number;
export const EDITORIAL_ITEM_KEYS: readonly string[];

export type EditorialLicence = "rss-std" | "ogl";

export type EditorialFeed = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly site: string;
  readonly cadenceHours: number;
  readonly licence: EditorialLicence;
};

export const EDITORIAL_FEEDS: readonly EditorialFeed[];

export type EditorialItem = {
  source_id: string;
  title: string;
  canonical_url: string;
  published_at: string;
  excerpt: string;
  attribution_label: string;
};

export function decodeXmlEntities(value: string): string;
export function excerptFromDescription(raw: string): string;
export function canonicalEditorialUrl(raw: string): string | null;
export function storedEditorialItem(
  item: EditorialItem,
  attributionLabel?: string,
): EditorialItem;
export function parseEditorialFeedXml(
  xml: string,
  sourceId: string,
): { itemCount: number; items: EditorialItem[] };
export function dedupeEditorialItems(items: readonly EditorialItem[]): EditorialItem[];
export function interpretEditorialResponse(
  status: number,
  itemCount: number,
): { status: "ready" | "degraded" | "backoff" | "not-modified" };
export function feedIsDue(
  feed: EditorialFeed,
  feedState?: {
    lastFetchedAt?: number;
    lastModified?: string;
    backoffUntil?: number;
  },
  now?: number,
  options?: { force?: boolean },
): boolean;
export function licenceForSource(sourceId: string): EditorialLicence;
export function attributionLabelForSource(sourceId: string): string | null;
