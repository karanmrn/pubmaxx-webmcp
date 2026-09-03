// Glasgow Place-story corridors — same StoryBand shape as London
// (lib/storyBands.ts). Anchors are Glasgow landmark ids from
// lib/cities/glasgow/landmarks.ts; selected via storyBandsForCity.
// Deep link: ?band=subcrawl

import type { StoryBand } from "@/lib/storyBands";

export const glasgowStoryBands: StoryBand[] = [
  {
    id: "subcrawl",
    title: "Subcrawl: Clockwork Orange loop",
    copy:
      "The Subcrawl is Glasgow folklore: ride the circular Subway (the Clockwork Orange), hop off near each station for a pint, then ride on. Organised versions are usually dated to the mid-1980s after the orange-train modernisation, cult product, not a sanctioned challenge. Drink responsibly; most groups never finish all fifteen stops.",
    kind: "modern",
    anchorLandmarkIds: [
      "hillhead-subway",
      "st-enoch-subway",
      "buchanan-street",
      "laurieston-bar",
      "star-bar",
      "ashton-lane",
    ],
    colourToken: "amber",
    // Wide enough to catch pubs near several Subway stops without swallowing the whole city.
    radiusKm: 0.75,
    sources: [
      {
        label: "Glasgow Live: How the Subcrawl started",
        url: "https://www.glasgowlive.co.uk/news/history/glasgow-subcrawl-famous-subway-history-17737439",
      },
      {
        label: "BBC News: History of the Clockwork Orange",
        url: "http://news.bbc.co.uk/2/hi/uk_news/scotland/2410943.stm",
      },
    ],
  },
  {
    id: "west-end-byres",
    title: "West End / Byres Road",
    copy:
      "Byres Road and Ashton Lane form Glasgow's classic West End nightlife strip, student pubs, tenement bars, and Hillhead Subway a few minutes' walk away. Tennent's Bar, the Chip lane, and the Kelvinhall / Partick edge still set the tone for a first night out.",
    kind: "modern",
    anchorLandmarkIds: [
      "tennents-bar",
      "ashton-lane",
      "hillhead-subway",
    ],
    colourToken: "brass",
    radiusKm: 0.65,
    sources: [
      {
        label: "Wikipedia: Byres Road",
        url: "https://en.wikipedia.org/wiki/Byres_Road",
      },
      {
        label: "Wikipedia: Ashton Lane",
        url: "https://en.wikipedia.org/wiki/Ashton_Lane",
      },
    ],
  },
  {
    id: "merchant-city-high-street",
    title: "Merchant City / High Street",
    copy:
      "East of the High Street, the Merchant City's restored warehouses and market streets frame a compact bar quarter, Babbity Bowster, Blackfriars, and the walk up toward Glasgow Cathedral. The historic mercantile core makes a compact first-night route.",
    kind: "civic",
    anchorLandmarkIds: [
      "merchant-city",
      "glasgow-cathedral",
      "glasgow-central",
    ],
    colourToken: "brick",
    radiusKm: 0.7,
    sources: [
      {
        label: "Wikipedia: Merchant City",
        url: "https://en.wikipedia.org/wiki/Merchant_City",
      },
      {
        label: "Historic Environment Scotland: Glasgow Cathedral",
        url: "https://www.historicenvironment.scot/visit-a-place/places/glasgow-cathedral/",
      },
    ],
  },
];
