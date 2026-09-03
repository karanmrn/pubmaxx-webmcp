// Oxford landmarks for the map's history layer — static, curated, sourced.
// Same Landmark shape as London (lib/landmarks.ts); selected via landmarksForCity.

import type { Landmark } from "@/lib/landmarks";

export const oxfordLandmarks: Landmark[] = [
  {
    id: "turf-tavern",
    name: "Turf Tavern",
    coordinates: [-1.2527744, 51.7546945],
    icon: "civic",
    history:
      "The Turf Tavern sits down St Helen's Passage off Bath Place, a hidden courtyard pub long claimed by students and visitors as Oxford's cult first-night stop. Its alley approach and outdoor yards make it the usual start of informal Freshers loops through the medieval lanes behind the Bodleian.",
    source: {
      label: "Wikipedia: Turf Tavern",
      url: "https://en.wikipedia.org/wiki/Turf_Tavern",
    },
  },
  {
    id: "lamb-and-flag",
    name: "Lamb & Flag",
    coordinates: [-1.2592888, 51.7574007],
    icon: "civic",
    history:
      "The Lamb & Flag on St Giles' is a college-owned pub opposite St John's, long associated with Oxford's literary drinking culture. It pairs with the Eagle & Child across the road as the classic St Giles' orientation pair for a first night out.",
    source: {
      label: "Wikipedia: Lamb & Flag, Oxford",
      url: "https://en.wikipedia.org/wiki/Lamb_%26_Flag,_Oxford",
    },
  },
  {
    id: "eagle-and-child",
    name: "Eagle & Child",
    coordinates: [-1.2602, 51.7574],
    icon: "civic",
    history:
      "The Eagle & Child on St Giles' is the famous Inklings pub where Tolkien and C. S. Lewis met; the building has been closed for redevelopment in recent years, so treat it as an orientation landmark rather than a guaranteed pint stop. The Lamb & Flag opposite still anchors the same stretch.",
    source: {
      label: "Wikipedia: The Eagle and Child",
      url: "https://en.wikipedia.org/wiki/The_Eagle_and_Child",
    },
  },
  {
    id: "jericho",
    name: "Jericho",
    coordinates: [-1.2665, 51.7598],
    icon: "civic",
    history:
      "Jericho is the Victorian neighbourhood west of St Giles', between Walton Street and the Oxford Canal. Pubs such as the Jericho Tavern, Old Bookbinders, and Rickety Press still define a walkable canal-side night out away from the tourist High Street.",
    source: {
      label: "Wikipedia: Jericho, Oxford",
      url: "https://en.wikipedia.org/wiki/Jericho,_Oxford",
    },
  },
  {
    id: "radcliffe-camera",
    name: "Radcliffe Camera / Bodleian",
    coordinates: [-1.254, 51.7534],
    icon: "dome",
    history:
      "The Radcliffe Camera (1737–49) is the circular reading room at the heart of the Bodleian Libraries, between Brasenose Lane and Catte Street. It is the usual orientation landmark for the medieval lanes that hide the Turf Tavern and the King's Arms.",
    source: {
      label: "Bodleian Libraries: Radcliffe Camera",
      url: "https://www.bodleian.ox.ac.uk/buildings/radcliffe-camera",
    },
  },
  {
    id: "covered-market",
    name: "Covered Market",
    coordinates: [-1.2565, 51.7523],
    icon: "market",
    history:
      "Oxford's Covered Market opened in 1774 between Market Street and the High, still packing butchers, cafés, and independent stalls under one roof. It is the natural daytime orientation point before a city-centre snug crawl toward the Bear, Chequers, and Crown.",
    source: {
      label: "Wikipedia: Covered Market, Oxford",
      url: "https://en.wikipedia.org/wiki/Covered_Market,_Oxford",
    },
  },
  {
    id: "oxford-station",
    name: "Oxford station",
    coordinates: [-1.2701, 51.7535],
    icon: "civic",
    history:
      "Oxford railway station on Park End Street is the usual National Rail arrival for students and visitors. From here it is a short walk east into Jericho or along Hythe Bridge Street toward the city centre and the Freshers pub lanes.",
    source: {
      label: "Network Rail: Oxford",
      url: "https://www.networkrail.co.uk/stations/oxford/",
    },
  },
  {
    id: "cowley-road",
    name: "Cowley Road",
    coordinates: [-1.2365, 51.7475],
    icon: "civic",
    history:
      "Cowley Road is East Oxford's nightlife spine. Student bars, late food, and music venues stretching from The Plain toward Cowley. It is the classic alternative to the tourist centre for a Freshers or second-night crawl.",
    source: {
      label: "Wikipedia: Cowley Road, Oxford",
      url: "https://en.wikipedia.org/wiki/Cowley_Road,_Oxford",
    },
  },
  {
    id: "the-plain",
    name: "The Plain",
    coordinates: [-1.2435, 51.7502],
    icon: "civic",
    history:
      "The Plain is the roundabout east of Magdalen Bridge where St Clement's, Cowley Road, and Iffley Road meet. It is the usual gateway from the college centre into East Oxford's Cowley Road nightlife strip.",
    source: {
      label: "Wikipedia: The Plain, Oxford",
      url: "https://en.wikipedia.org/wiki/The_Plain,_Oxford",
    },
  },
];
