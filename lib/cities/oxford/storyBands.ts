// Oxford Place-story corridors — same StoryBand shape as London
// (lib/storyBands.ts). Anchors are Oxford landmark ids from
// lib/cities/oxford/landmarks.ts; selected via storyBandsForCity.
// Deep link: ?band=freshers-first-night

import type { StoryBand } from "@/lib/storyBands";

export const oxfordStoryBands: StoryBand[] = [
  {
    id: "freshers-first-night",
    title: "Freshers first night",
    copy:
      "The cult Oxford Freshers loop threads the medieval lanes behind the Bodleian. Turf Tavern down St Helen's Passage, then out toward St Giles' for the Lamb & Flag and the Eagle & Child orientation pair. It is student folklore, not a sanctioned challenge; drink responsibly and know when to call it.",
    kind: "modern",
    anchorLandmarkIds: [
      "turf-tavern",
      "lamb-and-flag",
      "eagle-and-child",
      "radcliffe-camera",
      "covered-market",
    ],
    colourToken: "amber",
    radiusKm: 0.55,
    sources: [
      {
        label: "Wikipedia: Turf Tavern",
        url: "https://en.wikipedia.org/wiki/Turf_Tavern",
      },
      {
        label: "Wikipedia: Lamb & Flag, Oxford",
        url: "https://en.wikipedia.org/wiki/Lamb_%26_Flag,_Oxford",
      },
    ],
  },
  {
    id: "jericho-canal",
    title: "Jericho / canal",
    copy:
      "Jericho sits between Walton Street and the Oxford Canal. Victorian terraces, the old Press neighbourhood, and a compact run of pubs from the Jericho Tavern to the Old Bookbinders. It is the walkable west-side alternative to the tourist High Street, a short stroll from Oxford station.",
    kind: "modern",
    anchorLandmarkIds: ["jericho", "oxford-station"],
    colourToken: "river",
    radiusKm: 0.65,
    sources: [
      {
        label: "Wikipedia: Jericho, Oxford",
        url: "https://en.wikipedia.org/wiki/Jericho,_Oxford",
      },
      {
        label: "Network Rail: Oxford",
        url: "https://www.networkrail.co.uk/stations/oxford/",
      },
    ],
  },
  {
    id: "cowley-road",
    title: "Cowley Road",
    copy:
      "Cowley Road is East Oxford's student nightlife strip. Bars, late food, and music rooms from The Plain out toward Cowley. It is the classic second-night corridor when the city-centre snugs feel too touristy.",
    kind: "modern",
    anchorLandmarkIds: ["cowley-road", "the-plain"],
    colourToken: "brass",
    radiusKm: 0.7,
    sources: [
      {
        label: "Wikipedia: Cowley Road, Oxford",
        url: "https://en.wikipedia.org/wiki/Cowley_Road,_Oxford",
      },
    ],
  },
];
