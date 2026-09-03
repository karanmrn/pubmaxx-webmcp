// Manchester Place-story corridors — same StoryBand shape as London
// (lib/storyBands.ts). Anchors are Manchester landmark ids from
// lib/cities/manchester/landmarks.ts; selected via storyBandsForCity.

import type { StoryBand } from "@/lib/storyBands";

export const manchesterStoryBands: StoryBand[] = [
  {
    id: "northern-quarter",
    title: "Northern Quarter crawl corridor",
    copy:
      "The Northern Quarter grew from the old Smithfield markets and warehouse streets into Manchester's creative nightlife strip. Oldham Street, Tib Street, and the Afflecks block still thread indie pubs, music rooms, and late bars between Piccadilly and Ancoats.",
    kind: "modern",
    anchorLandmarkIds: ["afflecks", "castle-hotel", "piccadilly-gardens"],
    colourToken: "amber",
    radiusKm: 0.55,
    sources: [
      {
        label: "Wikipedia: Northern Quarter, Manchester",
        url: "https://en.wikipedia.org/wiki/Northern_Quarter,_Manchester",
      },
    ],
  },
  {
    id: "castlefield-canal",
    title: "Castlefield / canal basin",
    copy:
      "Castlefield is where Roman Mamucium, the Bridgewater Canal, and later railway viaducts stacked into one industrial landscape. The basin pubs and towpaths still sit under the iron bridges, a short walk from Deansgate and the Briton's Protection tiled strip.",
    kind: "industrial",
    anchorLandmarkIds: [
      "castlefield-basin",
      "britons-protection",
      "john-rylands-library",
      "peveril-of-the-peak",
    ],
    colourToken: "river",
    radiusKm: 0.7,
    sources: [
      {
        label: "Wikipedia: Castlefield",
        url: "https://en.wikipedia.org/wiki/Castlefield",
      },
      {
        label: "Historic England: Manchester historic pub walk",
        url: "https://historicengland.org.uk/campaigns/visit/walking-tours/historic-pub-walks-north-west-england/manchester/",
      },
    ],
  },
  {
    id: "oxford-road-strip",
    title: "Oxford Road student strip",
    copy:
      "Oxford Road is Manchester's university spine. From the city-centre stations south toward the campuses, lined with student pubs, music venues, and late bars. The Lass O'Gowrie, Sandbar, and the Salutation have long poured for students walking the corridor between lectures and the last tram.",
    kind: "modern",
    anchorLandmarkIds: ["peveril-of-the-peak", "circus-tavern", "piccadilly-gardens"],
    colourToken: "brass",
    radiusKm: 0.85,
    sources: [
      {
        label: "Wikipedia: Oxford Road, Manchester",
        url: "https://en.wikipedia.org/wiki/Oxford_Road,_Manchester",
      },
    ],
  },
];
