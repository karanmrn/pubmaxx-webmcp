// Durham Place-story corridors — same StoryBand shape as London
// (lib/storyBands.ts). Anchors are Durham landmark ids from
// lib/cities/durham/landmarks.ts; selected via storyBandsForCity.
// Deep link: ?band=bailey-crawl

import type { StoryBand } from "@/lib/storyBands";

export const durhamStoryBands: StoryBand[] = [
  {
    id: "bailey-crawl",
    title: "Bailey crawl",
    copy:
      "The Bailey crawl is Durham's compact peninsula loop. Saddler Street rooms below the cathedral, the Market Place, and the short walk toward Elvet Bridge. It is student folklore on a UNESCO hill, not a sanctioned challenge; drink responsibly on the steep streets.",
    kind: "modern",
    anchorLandmarkIds: [
      "shakespeare",
      "victoria",
      "durham-cathedral",
      "market-place",
      "durham-station",
    ],
    colourToken: "amber",
    radiusKm: 0.5,
    sources: [
      {
        label: "Wikipedia: The Bailey, Durham",
        url: "https://en.wikipedia.org/wiki/The_Bailey",
      },
      {
        label: "UNESCO: Durham Castle and Cathedral",
        url: "https://whc.unesco.org/en/list/370/",
      },
    ],
  },
  {
    id: "elvet-claypath",
    title: "Elvet / Claypath",
    copy:
      "Elvet and the Claypath approach sit across Elvet Bridge from the peninsula. Dun Cow, Half Moon, and the Swan & Three Cygnets frame a short riverside wander when the Bailey rooms feel full. Colpitts and the station sit west for the walk home.",
    kind: "modern",
    anchorLandmarkIds: ["dun-cow", "elvet-bridge", "colpitts", "durham-station"],
    colourToken: "river",
    radiusKm: 0.55,
    sources: [
      {
        label: "Wikipedia: Elvet",
        url: "https://en.wikipedia.org/wiki/Elvet",
      },
      {
        label: "Wikipedia: Elvet Bridge",
        url: "https://en.wikipedia.org/wiki/Elvet_Bridge",
      },
    ],
  },
];
