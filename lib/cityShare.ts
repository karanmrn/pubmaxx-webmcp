// City map share / OG helpers — pure URL + copy for `/map` and `/map/[city]`
// deep links (including cult Place-story bands like Subcrawl / Freshers and
// curated crawl shares via `?crawl=` / `?pubs=`).

import {
  getCity,
  parseCityId,
  type CityId,
  DEFAULT_CITY_ID,
} from "@/lib/cities";
import { curatedCrawlByIdForCity } from "@/lib/cityCuratedCrawls";
import { bandByIdForCity } from "@/lib/cityStoryBands";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import type { CityMapHrefOptions } from "@/lib/cityMapHref";

/** Cult / viral Place-story band ids called out in the multi-city PRD. */
export const CULT_STORY_BAND_IDS = [
  "subcrawl",
  "freshers-first-night",
  "king-street-run",
  "bailey-crawl",
  "match-day-anfield",
  "harbourside",
] as const;

export type CultStoryBandId = (typeof CULT_STORY_BAND_IDS)[number];

export type CityMapShareOptions = CityMapHrefOptions & {
  /**
   * Stop count from `?pubs=` (comma-separated venue ids). When omitted and a
   * curated crawl resolves, OG copy falls back to that crawl's venueIds length.
   */
  stopCount?: number | null;
};

function resolveCityId(cityId: CityId | string | null | undefined): CityId {
  return parseCityId(cityId) ?? DEFAULT_CITY_ID;
}

function normalizeBandId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const id = raw.trim().toLowerCase();
  return id || undefined;
}

function normalizeCrawlId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const id = raw.trim().toLowerCase();
  return id || undefined;
}

/** Count stops from a `pubs=` query value (comma-separated venue ids). */
export function stopCountFromPubsParam(
  pubs: string | null | undefined,
): number | undefined {
  if (!pubs) return undefined;
  const n = pubs
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
  return n > 0 ? n : undefined;
}

function resolveCrawl(
  cityId: CityId,
  options: CityMapShareOptions,
): CuratedCrawl | undefined {
  const crawlId = normalizeCrawlId(options.crawl ?? undefined);
  if (!crawlId) return undefined;
  return curatedCrawlByIdForCity(cityId, crawlId);
}

function resolveStopCount(
  options: CityMapShareOptions,
  crawl: CuratedCrawl | undefined,
): number | undefined {
  const raw = options.stopCount;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (crawl?.venueIds.length) return crawl.venueIds.length;
  return undefined;
}

/** First string value from Next `searchParams` (string | string[] | undefined). */
export function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export { cityMapShareUrl } from "@/lib/cityMapHref";

/**
 * OG / document title for a city map. Curated crawl wins when it resolves;
 * otherwise cult band title; else city display name + short map label.
 * Layout template appends `| PUBMAXXING`.
 */
export function cityMapOgTitle(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  const id = resolveCityId(cityId);
  const city = getCity(id);
  const crawl = resolveCrawl(id, options);
  if (crawl) return `${crawl.name} · ${city.displayName}`;
  const bandId = normalizeBandId(options.band ?? undefined);
  const band = bandId ? bandByIdForCity(id, bandId) : undefined;
  if (band) return `${band.title} · ${city.displayName}`;
  return `${city.displayName} pub map`;
}

/**
 * OG / meta description. Prefer crawl + stop count when known; else band blurb;
 * else city tagline.
 */
export function cityMapOgDescription(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  const id = resolveCityId(cityId);
  const city = getCity(id);
  const crawl = resolveCrawl(id, options);
  if (crawl) {
    const stops = resolveStopCount(options, crawl);
    if (stops) {
      return `${stops}-stop crawl: ${crawl.name} in ${city.displayName}. Open it on PUBMAXXING.`;
    }
    return `${crawl.name} crawl in ${city.displayName}. Open it on PUBMAXXING.`;
  }
  const bandId = normalizeBandId(options.band ?? undefined);
  const band = bandId ? bandByIdForCity(id, bandId) : undefined;
  if (band) {
    const blurb = band.copy.trim().replace(/\s+/g, " ");
    // Keep social previews snappy; full copy lives on the map chip.
    if (blurb.length <= 200) return blurb;
    const cut = blurb.slice(0, 199);
    const lastSpace = cut.lastIndexOf(" ");
    const base = lastSpace > 80 ? cut.slice(0, lastSpace) : cut;
    return `${base.replace(/[.,;:\s]+$/u, "")}…`;
  }
  return `${city.tagline}. Plan a crawl on PUBMAXXING.`;
}

/**
 * Dynamic OG image URL. Query-aware so crawlers that hit `?band=` / `?crawl=`
 * get a cult / crawl card (opengraph-image.tsx cannot read searchParams).
 */
export function cityMapOgImageUrl(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  const id = resolveCityId(cityId);
  const params = new URLSearchParams();
  params.set("city", id);
  const band = normalizeBandId(options.band ?? undefined);
  if (band) params.set("band", band);
  const crawl = normalizeCrawlId(options.crawl ?? undefined);
  if (crawl) params.set("crawl", crawl);
  return `/api/city-map-card?${params.toString()}`;
}

export function cityMapOgAlt(
  cityId: CityId | string | null | undefined,
  options: CityMapShareOptions = {},
): string {
  return `${cityMapOgTitle(cityId, options)} · PUBMAXXING`;
}
