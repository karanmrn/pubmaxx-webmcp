// Liverpool curated crawls — venueIds are real ids from
// public/data/cities/liverpool/venues_slim.json (OSM-derived slim index).
// No invented coordinates or prices. Selected via curatedCrawlsForCity.
// Match-day crawl is logistics / warm-up framing only — not tribal bait.

import type { CuratedCrawl } from "@/lib/curatedCrawls";

export const liverpoolCuratedCrawls: CuratedCrawl[] = [
  {
    id: "match-day-warm-up",
    name: "Match-day warm-up",
    blurb:
      "A pre-kickoff logistics stagger along the Anfield approach, Sandon, Arkles, The Park, The Albert, and The Twelfth Man, walkable waypoints for timing, not a club-loyalty crawl. Check kickoff and Merseyrail last trains before you settle.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-liv-1b242v8", // The Sandon
      "venue-liv-2fjhuh", // Arkles
      "venue-liv-1iikia7", // The Park
      "venue-liv-huc91w", // The Albert
      "venue-liv-1y9whcs", // The Twelfth Man
    ],
    startLandmarkId: "anfield-stadium",
    placeStoryBandId: "match-day-anfield",
  },
  {
    id: "victorian-tiled-giants",
    name: "Victorian tiled giants",
    blurb:
      "Liverpool's glazed-tile heritage houses, Philharmonic Dining Rooms, Roscoe Head, The Vines, Crown Hotel, and Doctor Duncan's, the Hope Street / Lime Street gin-palace strip in a single round.",
    crawlStyle: "heritage",
    venueIds: [
      "venue-liv-12byxft", // Philharmonic Dining Rooms
      "venue-liv-ibqm7p", // Roscoe Head
      "venue-liv-3c9aaf", // The Vines
      "venue-liv-99jtxp", // Crown Hotel
      "venue-liv-1h4f4xn", // Doctor Duncan's
    ],
    startLandmarkId: "philharmonic-dining-rooms",
    placeStoryBandId: "victorian-opulence",
  },
  {
    id: "baltic-first-night",
    name: "Baltic first night",
    blurb:
      "A first-night loop through the Ropewalks into the Baltic Triangle, Dispensary, Shipping Forecast, Kazimier Garden, Monro, and Baltic Fleet, warehouse bars and dockside pints without inventing a stop that isn't on the map.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-liv-dv1qd1", // The Dispensary
      "venue-liv-1h6x6u0", // The Shipping Forecast
      "venue-liv-uw4qva", // Kazimier Garden
      "venue-liv-1t2i7oo", // The Monro
      "venue-liv-1247ajz", // Baltic Fleet
    ],
    startLandmarkId: "ropewalks",
    placeStoryBandId: "ropewalks-baltic",
  },
];
