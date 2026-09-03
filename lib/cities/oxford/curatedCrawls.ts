// Oxford curated crawls — venueIds are real ids from
// public/data/cities/oxford/venues_slim.json (OSM-derived slim index).
// No invented coordinates or prices. Selected via curatedCrawlsForCity.

import type { CuratedCrawl } from "@/lib/curatedCrawls";

export const oxfordCuratedCrawls: CuratedCrawl[] = [
  {
    id: "freshers-first-night",
    name: "Freshers first night",
    blurb:
      "The cult first-night loop: Turf Tavern down the alley, King's Arms by the Bodleian, White Horse on Broad Street, then St Giles' for the Lamb & Flag, with the Bear as a city-centre snug if you still have legs. Drink responsibly; this is folklore, not a challenge.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-oxf-16404bl", // Turf Tavern
      "venue-oxf-n2un97", // King's Arms
      "venue-oxf-wj2baw", // White Horse (Broad Street)
      "venue-oxf-h2bp3m", // Lamb and Flag
      "venue-oxf-dgav2w", // The Bear
    ],
    startLandmarkId: "turf-tavern",
    placeStoryBandId: "freshers-first-night",
  },
  {
    id: "jericho-wander",
    name: "Jericho wander",
    blurb:
      "A walkable Jericho night: Jericho Tavern, Jude the Obscure, Rickety Press, Old Bookbinders, and the Victoria. Canal-side pubs west of St Giles' without inventing a stop that isn't on the map.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-oxf-z97rrk", // Jericho Tavern
      "venue-oxf-1t80020", // Jude the Obscure
      "venue-oxf-1asi47c", // The Rickety Press
      "venue-oxf-1thaxso", // The Old Bookbinders
      "venue-oxf-1ca6s1i", // The Victoria
    ],
    startLandmarkId: "jericho",
    placeStoryBandId: "jericho-canal",
  },
  {
    id: "city-centre-snugs",
    name: "City centre snugs",
    blurb:
      "Tight city-centre rooms around the Covered Market: the Bear, Chequers, Crown, Wheatsheaf, and St Aldate's Tavern. A short heritage loop when you want snugs over the Freshers alley run.",
    crawlStyle: "heritage",
    venueIds: [
      "venue-oxf-dgav2w", // The Bear
      "venue-oxf-1wlo52t", // The Chequers
      "venue-oxf-1duoisr", // The Crown
      "venue-oxf-1pz3ec3", // The Wheatsheaf
      "venue-oxf-s6016p", // St Aldate's Tavern
    ],
    startLandmarkId: "covered-market",
    placeStoryBandId: "freshers-first-night",
  },
];
