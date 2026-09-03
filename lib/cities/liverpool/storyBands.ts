// Liverpool Place-story corridors — same StoryBand shape as London
// (lib/storyBands.ts). Anchors are Liverpool landmark ids from
// lib/cities/liverpool/landmarks.ts; selected via storyBandsForCity.
// Match-day copy is logistics framing only — no tribal football bait.

import type { StoryBand } from "@/lib/storyBands";

export const liverpoolStoryBands: StoryBand[] = [
  {
    id: "match-day-anfield",
    title: "Match-day Anfield corridor",
    copy:
      "On match days the walk from the city centre toward Anfield and Goodison fills with pre-kickoff foot traffic along Walton Breck, Oakfield, and the stadium approaches. This corridor is mapped for timing and Merseyrail home, pubs as waypoints, not a club-loyalty itinerary. Check kickoff and last-train boards before you settle in.",
    kind: "modern",
    anchorLandmarkIds: ["anfield-stadium", "goodison-park"],
    colourToken: "amber",
    radiusKm: 0.85,
    sources: [
      {
        label: "Wikipedia: Anfield",
        url: "https://en.wikipedia.org/wiki/Anfield",
      },
      {
        label: "Merseyrail: network map",
        url: "https://www.merseyrail.org/plan-your-journey/network-map/",
      },
    ],
  },
  {
    id: "ropewalks-baltic",
    title: "Ropewalks / Baltic Triangle",
    copy:
      "South of Lime Street, the Ropewalks warehouse streets spill into the Baltic Triangle's brewery and late-bar quarter. Bold Street, the Dispensary edge, and the walk toward Albert Dock and the Baltic Fleet still frame a first-night loop that stays walkable without inventing stops.",
    kind: "modern",
    anchorLandmarkIds: [
      "ropewalks",
      "baltic-triangle",
      "albert-dock",
      "roscoe-head",
    ],
    colourToken: "brass",
    radiusKm: 0.75,
    sources: [
      {
        label: "Wikipedia: Ropewalks, Liverpool",
        url: "https://en.wikipedia.org/wiki/Ropewalks,_Liverpool",
      },
      {
        label: "Wikipedia: Baltic Triangle",
        url: "https://en.wikipedia.org/wiki/Baltic_Triangle",
      },
    ],
  },
  {
    id: "victorian-opulence",
    title: "Victorian tiled giants",
    copy:
      "Liverpool's late-Victorian and Edwardian gin palaces, the Philharmonic Dining Rooms, The Vines, and The Crown, still show the tiled opulence of the city's shipping boom. Hope Street and Lime Street stitch them into a short heritage corridor a few minutes from the station.",
    kind: "civic",
    anchorLandmarkIds: [
      "philharmonic-dining-rooms",
      "the-vines",
      "the-crown",
      "lime-street",
      "roscoe-head",
    ],
    colourToken: "brick",
    radiusKm: 0.55,
    sources: [
      {
        label: "British Listed Buildings: Philharmonic Hotel",
        url: "https://britishlistedbuildings.co.uk/101207638-philharmonic-hotel-liverpool",
      },
      {
        label: "British Listed Buildings: The Vines",
        url: "https://britishlistedbuildings.co.uk/101355108-the-vines-public-house-liverpool",
      },
    ],
  },
];
