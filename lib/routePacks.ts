import {
  curatedCrawlById,
  curatedCrawlMapHref,
  curatedCrawls,
  type CuratedCrawl,
} from "@/lib/curatedCrawls";

// Named route packs — thematic groupings of curated crawls for the /crawls
// page. Packs may share crawl ids; membership is by curated crawl `id` only
// (never invents venues). Packs that cannot be fully filled from today's
// curated set still ship with the best available crawlIds so the UI stays
// honest rather than fabricating routes.

export type RoutePack = {
  id: string;
  title: string;
  blurb: string;
  /** Curated crawl ids from lib/curatedCrawls — may overlap across packs. */
  crawlIds: string[];
};

const CURATED_IDS = new Set(curatedCrawls.map((c) => c.id));

function pack(
  id: string,
  title: string,
  blurb: string,
  crawlIds: string[],
): RoutePack {
  // Drop unknown ids so a renamed curated crawl never 404s a pack link.
  return { id, title, blurb, crawlIds: crawlIds.filter((cid) => CURATED_IDS.has(cid)) };
}

export const routePacks: RoutePack[] = [
  pack(
    "old-london",
    "Old London",
    "Heritage corridors. Victorian Soho snugs, riverside wharves, and the South Bank tide.",
    ["victorian-soho", "riverside-heritage", "bankside-riverside", "westminster-civic"],
  ),
  pack(
    "thames",
    "Thames-side",
    "River walks and waterside taverns. Bankside to Limehouse along the tide.",
    ["riverside-heritage", "bankside-riverside"],
  ),
  pack(
    "writers",
    "Writers & Fleet Street",
    "Press-strip snugs and Bloomsbury reading-room rounds for the literary crawl.",
    ["fleet-street-writers", "bloomsbury-literary"],
  ),
  pack(
    "music-theatre",
    "Music & theatre",
    "Market arches, Camden lock, and West End soft rounds. Playhouse nights with a pint between acts.",
    ["camden-market-crawl", "borough-market-crawl", "leicester-mocktail-crawl"],
  ),
  pack(
    "markets-late-trains",
    "Markets & late trains",
    "Market loops and tight central clusters when the night should stay loud and you still need the last train.",
    ["borough-market-crawl", "camden-market-crawl", "victorian-soho", "leicester-mocktail-crawl"],
  ),
  pack(
    "coding-pint",
    "Coding pint",
    "City-fringe rounds from Leadenhall to Liverpool Street. The after-work pint between the Square Mile and the East End.",
    ["pint-park-view", "barbican-coding-pint"],
  ),
  pack(
    "cheap-chaos",
    "Cheap chaos",
    "Market loops and high-street energy when the night should stay loud and affordable.",
    ["borough-market-crawl", "camden-market-crawl", "victorian-soho"],
  ),
  pack(
    "late-train",
    "Late train",
    "Tight central clusters near major stations. Finish the round and still catch the last one.",
    ["victorian-soho", "leicester-mocktail-crawl", "soho-food-crawl"],
  ),
  pack(
    "quiet-table",
    "Quiet table",
    "Softer nights: food-first Soho plates, a soft round, and a skyline garden climb.",
    ["soho-food-crawl", "leicester-mocktail-crawl", "pint-park-view"],
  ),
  pack(
    "civic-west",
    "Civic west",
    "Whitehall bells to Leicester soft rounds and the old press strip. The west-of-centre civic corridor.",
    ["westminster-civic", "leicester-mocktail-crawl", "fleet-street-writers"],
  ),
  pack(
    "southwark-tide",
    "Southwark tide",
    "Borough market arches to the South Bank path, then east with the tide. Southwark to Wapping energy.",
    ["borough-market-crawl", "bankside-riverside", "riverside-heritage"],
  ),
];

/** Look up a pack by id, or undefined when unknown. */
export function getRoutePack(id: string): RoutePack | undefined {
  return routePacks.find((p) => p.id === id);
}

/** Lead curated crawl for a pack (first crawlId that still resolves). */
export function routePackPrimaryCrawl(pack: RoutePack): CuratedCrawl | undefined {
  for (const crawlId of pack.crawlIds) {
    const crawl = curatedCrawlById(crawlId);
    if (crawl) return crawl;
  }
  return undefined;
}

/** Map-first deep-link for a pack's lead crawl (Old London → Victorian Soho). */
export function routePackMapHref(pack: RoutePack): string {
  const primary = routePackPrimaryCrawl(pack);
  return primary ? curatedCrawlMapHref(primary) : "/map";
}

/** Every curated crawl id that appears in at least one pack. */
export function allPackCrawlIds(): string[] {
  return [...new Set(routePacks.flatMap((p) => p.crawlIds))];
}
