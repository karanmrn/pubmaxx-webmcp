import { seedCrawlState } from "@/lib/crawlUrl";
import { isDrinkShapeArrival } from "@/lib/mapArrival";

/** Whether a map arrival needs the deferred curated-crawl catalog. */
export function mapSeedNeedsCuratedCrawlLookup(search: string): boolean {
  if (isDrinkShapeArrival(search)) return false;
  const seeded = seedCrawlState(search);
  return Boolean(seeded.crawlId) || seeded.builtIds.length >= 2;
}
