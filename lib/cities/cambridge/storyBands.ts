// Cambridge Place-story corridors — same StoryBand shape as London
// (lib/storyBands.ts). Anchors are Cambridge landmark ids from
// lib/cities/cambridge/landmarks.ts; selected via storyBandsForCity.
// Deep link: ?band=king-street-run

import type { StoryBand } from "@/lib/storyBands";

export const cambridgeStoryBands: StoryBand[] = [
  {
    id: "king-street-run",
    title: "King Street Run",
    copy:
      "The King Street Run is Cambridge student folklore, a short, dense strip of pubs along King Street that generations have treated as a timed crawl. It is local lore, not a sanctioned challenge: drink responsibly, know your limits, and treat St Radegund through the Cambridge Brew House as orientation rather than a race.",
    kind: "modern",
    anchorLandmarkIds: [
      "st-radegund",
      "king-street-run-pub",
      "champion-of-the-thames",
      "the-eagle",
    ],
    colourToken: "amber",
    radiusKm: 0.45,
    sources: [
      {
        label: "Wikipedia: King Street Run",
        url: "https://en.wikipedia.org/wiki/King_Street_Run",
      },
      {
        label: "Wikipedia: The Eagle, Cambridge",
        url: "https://en.wikipedia.org/wiki/The_Eagle,_Cambridge",
      },
    ],
  },
  {
    id: "mill-road",
    title: "Mill Road",
    copy:
      "Mill Road is the independent east-side corridor between the station and Romsey. Food, late rooms, and pubs such as the Devonshire Arms, Live & Let Live, and the Empress. It is the classic second-night strip when the centre feels too touristy.",
    kind: "modern",
    anchorLandmarkIds: ["mill-road", "cambridge-station"],
    colourToken: "brass",
    radiusKm: 0.7,
    sources: [
      {
        label: "Wikipedia: Mill Road, Cambridge",
        url: "https://en.wikipedia.org/wiki/Mill_Road,_Cambridge",
      },
      {
        label: "Network Rail: Cambridge",
        url: "https://www.networkrail.co.uk/stations/cambridge/",
      },
    ],
  },
  {
    id: "quayside",
    title: "Quayside / the Backs",
    copy:
      "Quayside and the Backs frame the River Cam west of the colleges. Punt landings, bridges, and riverside pubs from the Pickerel to the Anchor and the Mill. It is the walkable water orientation for a first Cambridge evening before cutting inland to King Street.",
    kind: "modern",
    anchorLandmarkIds: ["quayside", "the-backs"],
    colourToken: "river",
    radiusKm: 0.6,
    sources: [
      {
        label: "Wikipedia: The Backs",
        url: "https://en.wikipedia.org/wiki/The_Backs",
      },
      {
        label: "Wikipedia: River Cam",
        url: "https://en.wikipedia.org/wiki/River_Cam",
      },
    ],
  },
];
