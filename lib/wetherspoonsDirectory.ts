/**
 * Loader for the Firecrawl-sourced J D Wetherspoon pub directory.
 * Data: public/data/wetherspoons/pubs.json (see data/wetherspoons/README.md).
 *
 * Honest: this directory has venue identity + hours/facilities, NOT per-item
 * food/drink prices (those are not on the first-party website).
 *
 * Provenance is non-negotiable and mirrors the app-wide {source, observedAt}
 * invariant: every pub carries a `source` object and an `observedAt` ISO
 * stamp. This is SCRAPED/observed directory data — it is never presented as
 * community-contributed data.
 */

import { discardBody } from "@/lib/responseBody";

/** Attribution for a scraped fact — mirrors the repo's sourced-price shape. */
export type WetherspoonsSource = {
  label: string;
  url: string;
  licence: string;
};

export type WetherspoonsPub = {
  wpId: number;
  jdwPubId: string | null;
  slug: string;
  name: string;
  pageUrl: string;
  menuUrl: string | null;
  phone: string | null;
  fullAddress: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  townCity: string | null;
  county: string | null;
  postcode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  bookATableLink: string | null;
  regularOpeningTimes: Array<{
    day_of_the_week?: string;
    opening_time?: string;
    closing_time?: string;
  }>;
  facilities: string[];
  regions: string[];
  statuses: string[];
  menuPricesAvailableOnWeb: boolean;
  /** Where this record was scraped from (never community data). */
  source: WetherspoonsSource;
  /** ISO-8601 timestamp of when the directory was observed/scraped. */
  observedAt: string;
};

export type WetherspoonsDirectory = {
  generatedAt: string;
  count: number;
  notes: string[];
  pubs: WetherspoonsPub[];
};

export const WETHERSPOONS_DIRECTORY_URL = "/data/wetherspoons/pubs.json";
export const WETHERSPOONS_GEOJSON_URL = "/data/wetherspoons/pubs.geojson";

export async function loadWetherspoonsDirectory(
  signal?: AbortSignal,
): Promise<WetherspoonsDirectory> {
  const res = await fetch(WETHERSPOONS_DIRECTORY_URL, { signal });
  if (!res.ok) {
    discardBody(res);
    throw new Error(`Failed to load Wetherspoon directory (${res.status})`);
  }
  return (await res.json()) as WetherspoonsDirectory;
}
