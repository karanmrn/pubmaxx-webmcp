// Manchester curated crawls — venueIds are real ids from
// public/data/cities/manchester/venues_slim.json (OSM-derived slim index).
// No invented coordinates or prices. Selected via curatedCrawlsForCity.

import type { CuratedCrawl } from "@/lib/curatedCrawls";

export const manchesterCuratedCrawls: CuratedCrawl[] = [
  {
    id: "northern-quarter-first-night",
    name: "Northern Quarter first night",
    blurb:
      "A first-night loop through the Northern Quarter: Castle Hotel, Gullivers, Port Street Beer House, and the Smithfield edge. Indie pubs and music rooms between Piccadilly and Afflecks.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-mcr-1rcu4en", // Castle Hotel
      "venue-mcr-2hfahy", // Gullivers
      "venue-mcr-1dl8yg5", // Port Street Beer House
      "venue-mcr-1m53n95", // The Smithfield Market Tavern
      "venue-mcr-aji7iu", // The Crown & Kettle
    ],
    startLandmarkId: "afflecks",
    placeStoryBandId: "northern-quarter",
  },
  {
    id: "victorian-tiled-pubs",
    name: "Victorian tiled pubs",
    blurb:
      "Manchester's glazed-tile heritage houses: Peveril of the Peak, Briton's Protection, Circus Tavern, and the Old Monkey. The Historic England pub-walk strip in a single round.",
    crawlStyle: "heritage",
    venueIds: [
      "venue-mcr-1lwo5lo", // Peveril of the Peak
      "venue-mcr-trsz1v", // The Briton's Protection
      "venue-mcr-1fsnlnf", // Circus Tavern
      "venue-mcr-1ptpgof", // The Old Monkey
      "venue-mcr-16ub7ks", // The Marble Arch Inn
    ],
    startLandmarkId: "peveril-of-the-peak",
    placeStoryBandId: "castlefield-canal",
  },
  {
    id: "oxford-road-student-stagger",
    name: "Oxford Road student stagger",
    blurb:
      "The student spine south of the stations: Lass O'Gowrie, Sandbar, Salutation, and Salisbury. A walkable stagger along Oxford Road without inventing a stop that isn't in the map.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-mcr-xwczi4", // The Lass O'Gowrie
      "venue-mcr-2o6k5l", // Sandbar
      "venue-mcr-2emoeo", // The Salutation
      "venue-mcr-10kb2ym", // Salisbury Ale House
      "venue-mcr-c09j4d", // The Temple
    ],
    startLandmarkId: "peveril-of-the-peak",
    placeStoryBandId: "oxford-road-strip",
  },
];
