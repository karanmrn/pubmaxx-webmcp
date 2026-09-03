// Bristol curated crawls — venueIds are real ids from
// public/data/cities/bristol/venues_slim.json (OSM-derived slim index).
// No invented coordinates or prices. Selected via curatedCrawlsForCity.

import type { CuratedCrawl } from "@/lib/curatedCrawls";

export const bristolCuratedCrawls: CuratedCrawl[] = [
  {
    id: "king-street-classic",
    name: "King Street classic",
    blurb:
      "The classic King Street strip. Llandoger Trow, Old Duke, Famous Royal Navy Volunteer, King Street Brew House, and The Apple on Welsh Back. Timber pubs and harbour edge without inventing a stop.",
    crawlStyle: "heritage",
    venueIds: [
      "venue-bri-ycukpj", // The Llandoger Trow
      "venue-bri-9v0o6k", // The Old Duke
      "venue-bri-1hfhmmm", // The Famous Royal Navy Volunteer
      "venue-bri-1upjyrx", // King Street Brew House
      "venue-bri-1gp3wzl", // The Apple
    ],
    startLandmarkId: "llandoger-trow",
    placeStoryBandId: "king-street",
  },
  {
    id: "harbourside-first-night",
    name: "Harbourside first night",
    blurb:
      "A harbourside first night. No.1 Harbourside, Hole in the Wall, Ostrich Inn, Grain Barge, and Left Handed Giant. Waterfront rooms from Canons Road along the floating harbour.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-bri-1hjegsw", // No.1 Harbourside
      "venue-bri-rmeu3z", // The Hole in the Wall
      "venue-bri-rlkklh", // The Ostrich Inn
      "venue-bri-1fim986", // Grain Barge
      "venue-bri-1xv6kk3", // Left Handed Giant Brewpub
    ],
    startLandmarkId: "harbourside",
    placeStoryBandId: "harbourside",
  },
  {
    id: "clifton-hillside",
    name: "Clifton hillside",
    blurb:
      "A short Clifton hillside loop. The Albion on Boyces Avenue, Coronation Tap, and The Clifton, when the harbour first night continues up toward the suspension bridge.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-bri-1cnty5o", // The Albion
      "venue-bri-27y6qh", // The Coronation Tap
      "venue-bri-d6oad4", // The Clifton
    ],
    startLandmarkId: "the-albion",
    placeStoryBandId: "harbourside",
  },
];
