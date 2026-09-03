import type { AltCrawlStyle } from "@/lib/crawlUrl";

const EAGER_CRAWL_HINTS: Readonly<Record<string, AltCrawlStyle>> = {
  "leicester-mocktail-crawl": "mocktail",
};

const EAGER_BUILT_ID_HINTS: ReadonlyArray<readonly [readonly string[], AltCrawlStyle]> = [
  [
    [
      "venue-11u4gpi",
      "venue-ymqu1w",
      "venue-12bzb84",
      "venue-165ayyi",
      "venue-1jmwk6r",
    ],
    "mocktail",
  ],
];

export function eagerCuratedCrawlAltStyle(crawlId: string): AltCrawlStyle | undefined {
  return Object.prototype.hasOwnProperty.call(EAGER_CRAWL_HINTS, crawlId)
    ? EAGER_CRAWL_HINTS[crawlId]
    : undefined;
}

export function eagerCuratedCrawlAltStyleForBuiltIds(
  builtIds: readonly string[],
): AltCrawlStyle | undefined {
  return EAGER_BUILT_ID_HINTS.find(
    ([venueIds]) =>
      venueIds.length === builtIds.length && venueIds.every((id, index) => id === builtIds[index]),
  )?.[1];
}
