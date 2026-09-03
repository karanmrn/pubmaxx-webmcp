// Liverpool landmarks for the map's history layer — static, curated, sourced.
// Same Landmark shape as London (lib/landmarks.ts); selected via landmarksForCity.
// Match-day landmarks are orientation / logistics POIs only — not tribal bait.

import type { Landmark } from "@/lib/landmarks";

export const liverpoolLandmarks: Landmark[] = [
  {
    id: "philharmonic-dining-rooms",
    name: "Philharmonic Dining Rooms",
    coordinates: [-2.9705461, 53.4017828],
    icon: "civic",
    history:
      "The Philharmonic Dining Rooms on Hope Street is a Grade II* listed late-Victorian gin palace, built around 1898–1900 for the nearby Philharmonic Hall. Its mosaic floors, carved wood, and famous tiled gents' lavatories put it on CAMRA's National Inventory of Historic Pub Interiors.",
    source: {
      label: "British Listed Buildings: Philharmonic Hotel (1207638)",
      url: "https://britishlistedbuildings.co.uk/101207638-philharmonic-hotel-liverpool",
    },
  },
  {
    id: "the-vines",
    name: "The Vines",
    coordinates: [-2.9781745, 53.405751],
    icon: "civic",
    history:
      "The Vines (also known as the Big House) on Lime Street is a Grade II* listed Edwardian gin palace remodelled around 1907. Its lavish plasterwork, stained glass, and multi-room plan make it one of Liverpool's grandest surviving tiled pubs, a short walk from Lime Street Station.",
    source: {
      label: "British Listed Buildings: The Vines (1355108)",
      url: "https://britishlistedbuildings.co.uk/101355108-the-vines-public-house-liverpool",
    },
  },
  {
    id: "the-crown",
    name: "The Crown Hotel",
    coordinates: [-2.9789385, 53.4066875],
    icon: "civic",
    history:
      "The Crown Hotel on Lime Street is a Grade II listed late-Victorian / Edwardian public house with a richly tiled exterior and ornate interior. It sits in the same station-approach cluster as The Vines, a natural start for a Victorian tiled-pub walk before heading into town.",
    source: {
      label: "British Listed Buildings: Crown Hotel (1068290)",
      url: "https://britishlistedbuildings.co.uk/101068290-crown-hotel-liverpool",
    },
  },
  {
    id: "roscoe-head",
    name: "Roscoe Head",
    coordinates: [-2.9741689, 53.4022377],
    icon: "civic",
    history:
      "The Roscoe Head on Roscoe Street is a small multi-room Victorian pub long celebrated by CAMRA for its unspoilt layout and cask-ale focus. It sits between Hope Street and the Ropewalks, a short walk from the Philharmonic Dining Rooms.",
    source: {
      label: "CAMRA: Roscoe Head, Liverpool",
      url: "https://camra.org.uk/pubs/roscoe-head-liverpool-166037",
    },
  },
  {
    id: "albert-dock",
    name: "Albert Dock",
    coordinates: [-2.9925, 53.4003],
    icon: "canal",
    history:
      "Albert Dock opened in 1846 as a fireproof bonded warehouse complex on Liverpool's waterfront and is now a Grade I listed UNESCO World Heritage component. Museums, restaurants, and the walk toward the Baltic Triangle all radiate from here, a natural first-night orientation point.",
    source: {
      label: "Wikipedia: Albert Dock",
      url: "https://en.wikipedia.org/wiki/Albert_Dock",
    },
  },
  {
    id: "baltic-triangle",
    name: "Baltic Triangle",
    coordinates: [-2.9845, 53.3955],
    icon: "market",
    history:
      "The Baltic Triangle is the warehouse and creative quarter south of the city centre, named for the old Baltic trade routes through Liverpool's docks. Independent bars, breweries, and late venues have clustered here since the 2010s, a short walk from Albert Dock and the Ropewalks.",
    source: {
      label: "Wikipedia: Baltic Triangle",
      url: "https://en.wikipedia.org/wiki/Baltic_Triangle",
    },
  },
  {
    id: "lime-street",
    name: "Lime Street Station",
    coordinates: [-2.9775, 53.4075],
    icon: "civic",
    history:
      "Liverpool Lime Street opened in 1836 as one of the world's earliest mainline termini and remains the city's principal long-distance rail gateway. The station approach, St George's Hall, and the Lime Street gin-palace strip (The Vines, The Crown) frame most visitors' first walk into town.",
    source: {
      label: "Wikipedia: Liverpool Lime Street railway station",
      url: "https://en.wikipedia.org/wiki/Liverpool_Lime_Street_railway_station",
    },
  },
  {
    id: "anfield-stadium",
    name: "Anfield (stadium orientation)",
    coordinates: [-2.9608, 53.4308],
    icon: "civic",
    history:
      "Anfield is Liverpool FC's home ground on Anfield Road, north of the city centre. On match days the Walton Breck / Oakfield corridor fills with pre-kickoff foot traffic. Treat nearby pubs as a logistics strip for timing and Merseyrail home, not a tribal itinerary.",
    source: {
      label: "Wikipedia: Anfield",
      url: "https://en.wikipedia.org/wiki/Anfield",
    },
  },
  {
    id: "goodison-park",
    name: "Goodison Park (stadium orientation)",
    coordinates: [-2.9663, 53.4388],
    icon: "civic",
    history:
      "Goodison Park has been Everton FC's home since 1892, a short walk west of Anfield across Stanley Park. Like Anfield, it is mapped here only as an orientation landmark for match-day walking and last-train timing, not as a club-loyalty crawl.",
    source: {
      label: "Wikipedia: Goodison Park",
      url: "https://en.wikipedia.org/wiki/Goodison_Park",
    },
  },
  {
    id: "ropewalks",
    name: "Ropewalks",
    coordinates: [-2.9785, 53.4025],
    icon: "market",
    history:
      "The Ropewalks district takes its name from the long rope-making yards that once served Liverpool's sailing ships. Today Bold Street, Concert Square, and the surrounding warehouse streets form the city's densest nightlife cluster between Lime Street and the Baltic Triangle.",
    source: {
      label: "Wikipedia: Ropewalks, Liverpool",
      url: "https://en.wikipedia.org/wiki/Ropewalks,_Liverpool",
    },
  },
];
