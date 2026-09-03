// Glasgow curated crawls — venueIds are real ids from
// public/data/cities/glasgow/venues_slim.json (OSM-derived slim index).
// No invented coordinates or prices. Selected via curatedCrawlsForCity.

import type { CuratedCrawl } from "@/lib/curatedCrawls";

export const glasgowCuratedCrawls: CuratedCrawl[] = [
  {
    id: "subcrawl-starter",
    name: "Subcrawl starter",
    blurb:
      "A six-stop take on Subcrawl folklore, with one pub near Hillhead, Kelvinbridge, St George's Cross, Buchanan Street, St Enoch and Bridge Street. Drink responsibly and know when to hop off the Clockwork Orange.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-glw-dsoj3p", // The Curler's Rest — Hillhead
      "venue-glw-1lwwpt2", // Inn Deep — Kelvinbridge
      "venue-glw-jpq1lt", // The Hug and Pint — St George's Cross
      "venue-glw-1totd41", // Dow's — Buchanan Street
      "venue-glw-1041rct", // The Imperial — St Enoch
      "venue-glw-1jlfquv", // The Laurieston Bar — Bridge Street
    ],
    startLandmarkId: "hillhead-subway",
    placeStoryBandId: "subcrawl",
  },
  {
    id: "west-end-first-night",
    name: "West End first night",
    blurb:
      "A walkable first night on Byres Road and Ashton Lane. Tennent's, the Chip lane, Curlers, Jinty's, and the Three Judges. Hillhead Subway as the last-ride escape hatch.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-glw-rapd3s", // Tennent's Bar
      "venue-glw-dsoj3p", // The Curler's Rest
      "venue-glw-7hh7m2", // Ubiquitous Chip - The Pub
      "venue-glw-zg2tp4", // Jinty McGinty's
      "venue-glw-s58nsc", // The Three Judges
    ],
    startLandmarkId: "ashton-lane",
    placeStoryBandId: "west-end-byres",
  },
  {
    id: "merchant-city-tiles",
    name: "Merchant City tiles",
    blurb:
      "Merchant City and the High Street fringe. Babbity Bowster, Blackfriars, Empire, Scotia, and the Horseshoe. Warehouse streets and tiled city-centre bars without inventing a stop that isn't on the map.",
    crawlStyle: "heritage",
    venueIds: [
      "venue-glw-q76zv1", // Babbity Bowster
      "venue-glw-1xhgge4", // Blackfriars of Bell St
      "venue-glw-1qeurf9", // Empire Bar
      "venue-glw-1jbgokr", // The Scotia Bar
      "venue-glw-19kw9ly", // The Horseshoe Bar
    ],
    startLandmarkId: "merchant-city",
    placeStoryBandId: "merchant-city-high-street",
  },
];
