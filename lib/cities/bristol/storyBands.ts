// Bristol Place-story corridors — same StoryBand shape as London
// (lib/storyBands.ts). Anchors are Bristol landmark ids from
// lib/cities/bristol/landmarks.ts; selected via storyBandsForCity.
// Deep link: ?band=harbourside

import type { StoryBand } from "@/lib/storyBands";

export const bristolStoryBands: StoryBand[] = [
  {
    id: "harbourside",
    title: "Harbourside",
    copy:
      "Bristol Harbourside threads the floating harbour from Welsh Back and King Street toward Canons Road. No.1 Harbourside, the Ostrich, and the Grain Barge sit on the water while Temple Meads anchors the eastern arrival. It is the classic first-night waterfront orientation.",
    kind: "modern",
    anchorLandmarkIds: [
      "harbourside",
      "king-street-brew-house",
      "llandoger-trow",
      "temple-meads",
    ],
    colourToken: "river",
    radiusKm: 0.75,
    sources: [
      {
        label: "Wikipedia: Bristol Harbour",
        url: "https://en.wikipedia.org/wiki/Bristol_Harbour",
      },
      {
        label: "Network Rail: Bristol Temple Meads",
        url: "https://www.networkrail.co.uk/stations/bristol-temple-meads/",
      },
    ],
  },
  {
    id: "king-street",
    title: "King Street",
    copy:
      "King Street is Bristol's densest historic pub lane. Llandoger Trow, Old Duke, and the Royal Navy Volunteer sit timber-to-timber above the harbour. It is the cult first-strip crawl before you spill onto Welsh Back or up toward Stokes Croft.",
    kind: "modern",
    anchorLandmarkIds: [
      "llandoger-trow",
      "royal-navy-volunteer",
      "king-street-brew-house",
      "old-duke",
    ],
    colourToken: "amber",
    radiusKm: 0.4,
    sources: [
      {
        label: "Wikipedia: King Street, Bristol",
        url: "https://en.wikipedia.org/wiki/King_Street,_Bristol",
      },
      {
        label: "Wikipedia: Llandoger Trow",
        url: "https://en.wikipedia.org/wiki/Llandoger_Trow",
      },
    ],
  },
  {
    id: "stokes-croft",
    title: "Stokes Croft",
    copy:
      "Stokes Croft runs north from the Bearpit as Bristol's mural and indie strip. The Croft and Pipe & Slippers anchor a walkable night away from the harbour tourist rooms. It pairs naturally with a second evening after King Street.",
    kind: "modern",
    anchorLandmarkIds: ["stokes-croft", "pipe-and-slippers"],
    colourToken: "brass",
    radiusKm: 0.55,
    sources: [
      {
        label: "Wikipedia: Stokes Croft",
        url: "https://en.wikipedia.org/wiki/Stokes_Croft",
      },
    ],
  },
];
