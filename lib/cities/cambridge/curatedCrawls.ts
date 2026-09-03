// Cambridge curated crawls — venueIds are real ids from
// public/data/cities/cambridge/venues_slim.json (OSM-derived slim index).
// No invented coordinates or prices. Selected via curatedCrawlsForCity.

import type { CuratedCrawl } from "@/lib/curatedCrawls";

export const cambridgeCuratedCrawls: CuratedCrawl[] = [
  {
    id: "king-street-run-starter",
    name: "King Street Run starter",
    blurb:
      "A short King Street folklore starter: St Radegund, King Street Run, Champion of the Thames, and the Cambridge Brew House. Then the Eagle on Bene't Street if you still have legs. Drink responsibly; this is student lore, not a timed challenge.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-cam-1k0qcn7", // St Radegund
      "venue-cam-cm7ii7", // King Street Run
      "venue-cam-1ma4vz0", // Champion of the Thames
      "venue-cam-atipkp", // The Cambridge Brew House
      "venue-cam-911f57", // The Eagle
    ],
    startLandmarkId: "st-radegund",
    placeStoryBandId: "king-street-run",
  },
  {
    id: "mill-road-indie-night",
    name: "Mill Road indie night",
    blurb:
      "An east-side Mill Road night: Devonshire Arms, Live & Let Live, the Empress, the Free Press, and the Elm Tree. Independent rooms between the station and the Petersfield terraces without inventing a stop that isn't on the map.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-cam-tsvssa", // Devonshire Arms
      "venue-cam-jd66wz", // Live & Let Live
      "venue-cam-14m3mie", // The Empress
      "venue-cam-1ewzgfh", // The Free Press
      "venue-cam-q2lf4s", // The Elm Tree
    ],
    startLandmarkId: "mill-road",
    placeStoryBandId: "mill-road",
  },
];
