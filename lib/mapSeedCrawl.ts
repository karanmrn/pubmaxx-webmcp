// Curated crawl hydration for map mount seed — split from @/lib/pubMap so the
// eager map shell does not static-import the crawl catalog on a plain /map open.

import type { Filters } from "@/lib/venues";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { curatedCrawlsForCityAsync } from "@/lib/cityStoryCatalog.async";
import { seedCrawlState } from "@/lib/crawlUrl";
import { isDrinkShapeArrival } from "@/lib/mapArrival";
import { filtersForCuratedCrawl, type MapSeed } from "@/lib/pubMap";
import { mapSeedNeedsCuratedCrawlLookup } from "@/lib/mapSeedCrawlPolicy";

export { mapSeedNeedsCuratedCrawlLookup };

function matchBuiltIds(crawls: CuratedCrawl[], builtIds: string[]): CuratedCrawl | null {
  if (builtIds.length < 2) return null;
  return (
    crawls.find(
      (crawl) =>
        crawl.venueIds.length === builtIds.length &&
        crawl.venueIds.every((id, i) => id === builtIds[i]),
    ) ?? null
  );
}

/** Resolve a curated crawl from ?crawl= or an exact pubs= stop list match. */
export async function resolveSeededCuratedCrawl(
  cityId: CityId,
  crawlId: string | undefined,
  builtIds: string[],
): Promise<CuratedCrawl | null> {
  const crawls = await curatedCrawlsForCityAsync(cityId);
  if (crawlId) {
    const byId = crawls.find((crawl) => crawl.id === crawlId);
    if (byId) return byId;
  }
  return matchBuiltIds(crawls, builtIds);
}

/**
 * Full mount seed including curated crawl hydration. Used by tests and by the
 * async PubMap layout effect — not the eager map shell chunk.
 */
export async function buildMapSeedWithCuratedCrawl(
  search: string,
  cityId: CityId = DEFAULT_CITY_ID,
): Promise<MapSeed> {
  const seeded = seedCrawlState(search);
  if (isDrinkShapeArrival(search)) {
    return { ...seeded, activeCrawl: null, routeMapped: false };
  }
  const activeCrawl = await resolveSeededCuratedCrawl(cityId, seeded.crawlId, seeded.builtIds);
  if (activeCrawl) {
    return {
      ...seeded,
      filters: filtersForCuratedCrawl(seeded.filters, activeCrawl),
      altStyle: activeCrawl.altStyle ?? seeded.altStyle,
      crawlId: activeCrawl.id,
      activeCrawl,
      routeMapped: true,
    };
  }
  return {
    ...seeded,
    activeCrawl: null,
    routeMapped: seeded.builtIds.length >= 2,
  };
}

export type CuratedCrawlHydration = {
  crawl: CuratedCrawl;
  filters: Filters;
  altStyle: MapSeed["altStyle"];
  crawlId: string;
  routeMapped: boolean;
};

export type CuratedCrawlHydrationSnapshot = Pick<
  MapSeed,
  "mode" | "builtIds" | "activeCrawl" | "filters" | "altStyle" | "routeMapped"
>;

export function sameCuratedCrawlHydrationSnapshot(
  expected: CuratedCrawlHydrationSnapshot,
  current: CuratedCrawlHydrationSnapshot,
): boolean {
  return (
    expected.mode === current.mode &&
    expected.builtIds.length === current.builtIds.length &&
    expected.builtIds.every((id, index) => id === current.builtIds[index]) &&
    expected.activeCrawl?.id === current.activeCrawl?.id &&
    expected.filters === current.filters &&
    expected.altStyle === current.altStyle &&
    expected.routeMapped === current.routeMapped
  );
}

/** Apply a resolved crawl onto live PubMap state after the catalog chunk loads. */
export async function curatedCrawlHydrationFromSeed(
  search: string,
  cityId: CityId,
): Promise<CuratedCrawlHydration | null> {
  if (!mapSeedNeedsCuratedCrawlLookup(search)) return null;
  const seeded = seedCrawlState(search);
  const crawl = await resolveSeededCuratedCrawl(cityId, seeded.crawlId, seeded.builtIds);
  if (!crawl) return null;
  return {
    crawl,
    filters: filtersForCuratedCrawl(seeded.filters, crawl),
    altStyle: crawl.altStyle ?? seeded.altStyle,
    crawlId: crawl.id,
    routeMapped: true,
  };
}
