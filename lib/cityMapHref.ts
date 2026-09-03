// Thin city map href builder — no story-band or crawl catalog imports.
// PubMap's shell chunk only needs the path; OG copy lives in cityShare.ts.

import { parseCityId, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";

export type CityMapHrefOptions = {
  band?: string | null;
  /** Curated crawl id from `?crawl=` share links. */
  crawl?: string | null;
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

/**
 * Canonical share path for a city map. London stays `/map` for back-compat;
 * other cities use `/map/{id}`. Optional `band` / `crawl` become query params.
 */
export function cityMapShareUrl(
  cityId: CityId | string | null | undefined,
  options: CityMapHrefOptions = {},
): string {
  const id = resolveCityId(cityId);
  const path = id === "london" ? "/map" : `/map/${id}`;
  const params = new URLSearchParams();
  const band = normalizeBandId(options.band ?? undefined);
  const crawl = normalizeCrawlId(options.crawl ?? undefined);
  if (band) params.set("band", band);
  if (crawl) params.set("crawl", crawl);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * City-aware map path with arbitrary query. London stays `/map` for back-compat.
 */
export function cityAwareMapPath(
  cityId: CityId | string | null | undefined,
  query?: URLSearchParams | string | null,
): string {
  const id = resolveCityId(cityId);
  const base = id === "london" ? "/map" : `/map/${id}`;
  const qs =
    typeof query === "string"
      ? query.replace(/^\?/, "")
      : query && [...query.keys()].length > 0
        ? query.toString()
        : "";
  return qs ? `${base}?${qs}` : base;
}
