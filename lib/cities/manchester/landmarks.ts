// Manchester landmarks for the map's history layer — static, curated, sourced.
// Same Landmark shape as London (lib/landmarks.ts); selected via landmarksForCity.

import type { Landmark } from "@/lib/landmarks";

export const manchesterLandmarks: Landmark[] = [
  {
    id: "peveril-of-the-peak",
    name: "Peveril of the Peak",
    coordinates: [-2.244632, 53.4749522],
    icon: "civic",
    history:
      "The Peveril of the Peak is a Grade II listed public house on a triangular plot between Chepstow Street and Great Bridgewater Street. Remodelled around 1900, it is famous for its green glazed-tile exterior and a largely intact Victorian interior that CAMRA rates of outstanding national historic importance.",
    source: {
      label: "Historic England: list entry 1293058",
      url: "https://historicengland.org.uk/listing/the-list/list-entry/1293058",
    },
  },
  {
    id: "britons-protection",
    name: "The Briton's Protection",
    coordinates: [-2.2472863, 53.4749551],
    icon: "civic",
    history:
      "The Briton's Protection on Great Bridgewater Street is a Grade II listed early-19th-century pub, first recorded under that name by 1820. Its interior was remodelled around 1930 and still shows the long front bar, tiled corridor, and snug back rooms that put it on CAMRA's National Inventory of Historic Pub Interiors.",
    source: {
      label: "Historic England: list entry 1292050",
      url: "https://historicengland.org.uk/listing/the-list/list-entry/1292050",
    },
  },
  {
    id: "circus-tavern",
    name: "Circus Tavern",
    coordinates: [-2.2399811, 53.4777837],
    icon: "civic",
    history:
      "The Circus Tavern on Portland Street is a Grade II listed beerhouse adapted from a late-18th-century dwelling, often cited as one of Manchester's smallest pubs. A single plot wide, it keeps two tiny rooms with plain wooden seats and partitions. A rare city-centre survival of a basic 19th-century beerhouse.",
    source: {
      label: "Historic England: list entry 1247057",
      url: "https://historicengland.org.uk/listing/the-list/list-entry/1247057",
    },
  },
  {
    id: "castle-hotel",
    name: "Castle Hotel",
    coordinates: [-2.2338462, 53.4837138],
    icon: "civic",
    history:
      "The Castle Hotel on Oldham Street is a Northern Quarter landmark pub and live-music room, long associated with Manchester's indie and alternative scenes. It sits on the Tib Street / Oldham Street spine that stitches the creative quarter together between Piccadilly and the former Smithfield markets.",
    source: {
      label: "Wikipedia: Castle Hotel, Manchester",
      url: "https://en.wikipedia.org/wiki/Castle_Hotel,_Manchester",
    },
  },
  {
    id: "john-rylands-library",
    name: "John Rylands Library",
    coordinates: [-2.2486, 53.4803],
    icon: "civic",
    history:
      "The John Rylands Library on Deansgate was founded by Enriqueta Rylands in memory of her husband and opened to readers in 1900. Basil Champneys' neo-Gothic building is Grade I listed and now forms part of the University of Manchester Library, anchoring the Deansgate heritage strip.",
    source: {
      label: "University of Manchester: John Rylands Library",
      url: "https://www.library.manchester.ac.uk/rylands/",
    },
  },
  {
    id: "manchester-cathedral",
    name: "Manchester Cathedral",
    coordinates: [-2.2441, 53.4851],
    icon: "dome",
    history:
      "Manchester Cathedral stands beside the River Irwell on the site of a medieval parish church that became a cathedral in 1847. Around it, the Corn Exchange and the Shambles pubs (including the Old Wellington Inn) mark the historic core of the medieval town.",
    source: {
      label: "Manchester Cathedral: Our history",
      url: "https://www.manchestercathedral.org/history/",
    },
  },
  {
    id: "castlefield-basin",
    name: "Castlefield canal basin",
    coordinates: [-2.2535, 53.4748],
    icon: "canal",
    history:
      "Castlefield is where the Bridgewater Canal met the River Irwell and later the Rochdale Canal, forming one of Britain's earliest industrial canal basins. Roman Mamucium once stood nearby; today the listed warehouses, viaducts, and towpaths frame a waterside quarter of pubs and museums.",
    source: {
      label: "Wikipedia: Castlefield",
      url: "https://en.wikipedia.org/wiki/Castlefield",
    },
  },
  {
    id: "afflecks",
    name: "Afflecks",
    coordinates: [-2.2355, 53.4835],
    icon: "market",
    history:
      "Afflecks (formerly Affleck's Palace) is an indoor market of independent stalls in the Northern Quarter, opened in 1982 in a former department-store building. It became a symbol of Manchester's DIY creative culture. Vintage clothes, records, and craft stalls a short walk from Oldham Street's pubs.",
    source: {
      label: "Wikipedia: Afflecks",
      url: "https://en.wikipedia.org/wiki/Afflecks",
    },
  },
  {
    id: "old-wellington-inn",
    name: "The Old Wellington Inn",
    coordinates: [-2.2440387, 53.484684],
    icon: "civic",
    history:
      "The Old Wellington Inn in the Shambles is a timber-framed building dating from the mid-16th century, among Manchester's oldest surviving pubs. It was dismantled and rebuilt a short distance away during the 1970s Arndale redevelopment, then restored again after the 1996 IRA bomb.",
    source: {
      label: "Historic England: Old Wellington Inn",
      url: "https://historicengland.org.uk/listing/the-list/list-entry/1270698",
    },
  },
  {
    id: "marble-arch-inn",
    name: "The Marble Arch Inn",
    coordinates: [-2.232339, 53.4882145],
    icon: "civic",
    history:
      "The Marble Arch Inn on Rochdale Road is a Grade II listed late-Victorian tiled pub, long linked with Manchester's cask-ale culture and later the Marble Brewery. Its glazed-brick exterior and ornate interior make it a northern counterpart to the city's other tiled heritage houses.",
    source: {
      label: "Historic England: Marble Arch Inn (1247604)",
      url: "https://historicengland.org.uk/listing/the-list/list-entry/1247604",
    },
  },
  {
    id: "piccadilly-gardens",
    name: "Piccadilly Gardens",
    coordinates: [-2.2365, 53.4808],
    icon: "civic",
    history:
      "Piccadilly Gardens is the civic square at the heart of Manchester's transport hub, rebuilt several times since the Victorian Infirmary gardens. Metrolink trams, buses, and the walk into the Northern Quarter all radiate from here. A natural orientation point for a first night out.",
    source: {
      label: "Wikipedia: Piccadilly Gardens",
      url: "https://en.wikipedia.org/wiki/Piccadilly_Gardens",
    },
  },
];
