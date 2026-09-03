// Durham curated crawls — venueIds are real ids from
// public/data/cities/durham/venues_slim.json (OSM-derived slim index).
// Durham only ships ~30 pubs — every stop is matched carefully by name.
// No invented coordinates or prices. Selected via curatedCrawlsForCity.

import type { CuratedCrawl } from "@/lib/curatedCrawls";

export const durhamCuratedCrawls: CuratedCrawl[] = [
  {
    id: "bailey-night",
    name: "Bailey night",
    blurb:
      "A compact Bailey peninsula night: Shakespeare and the Library on Saddler Street, Market Tavern in the Market Place, then the Victoria on Hallgarth and Colpitts toward the station. Drink responsibly on the hill.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-dur-libaa7", // The Shakespeare
      "venue-dur-z4nix0", // The Library
      "venue-dur-18i38pg", // Market Tavern
      "venue-dur-1obw62o", // The Victoria
      "venue-dur-19bh3ob", // Colpitts Hotel
    ],
    startLandmarkId: "shakespeare",
    placeStoryBandId: "bailey-crawl",
  },
  {
    id: "elvet-wander",
    name: "Elvet wander",
    blurb:
      "An Elvet-side wander across the bridge: Swan & Three Cygnets, Half Moon, the City, and the Dun Cow, with the Fighting Cocks on South Street if you still have legs back toward Crossgate.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-dur-ffaoxv", // The Swan & Three Cygnets
      "venue-dur-8k48ar", // Half Moon Inn
      "venue-dur-18zuovn", // The City
      "venue-dur-w8te3e", // The Dun Cow
      "venue-dur-12gteqv", // The Fighting Cocks
    ],
    startLandmarkId: "elvet-bridge",
    placeStoryBandId: "elvet-claypath",
  },
];
