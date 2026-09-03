// Durham landmarks for the map's history layer — static, curated, sourced.
// Same Landmark shape as London (lib/landmarks.ts); selected via landmarksForCity.

import type { Landmark } from "@/lib/landmarks";

export const durhamLandmarks: Landmark[] = [
  {
    id: "shakespeare",
    name: "The Shakespeare",
    coordinates: [-1.5750058, 54.7759822],
    icon: "civic",
    history:
      "The Shakespeare on Saddler Street sits on the Bailey approach below the cathedral peninsula, a compact city-centre room long used as a first stop on student Bailey nights. It anchors the medieval street that climbs toward Palace Green.",
    source: {
      label: "Wikipedia: The Bailey, Durham",
      url: "https://en.wikipedia.org/wiki/The_Bailey",
    },
  },
  {
    id: "dun-cow",
    name: "The Dun Cow",
    coordinates: [-1.5685586, 54.7750948],
    icon: "civic",
    history:
      "The Dun Cow on Old Elvet is a classic Elvet-side pub across the river from the peninsula, a natural pair with the Half Moon and Swan & Three Cygnets for an Elvet wander after a Bailey night.",
    source: {
      label: "Wikipedia: Elvet",
      url: "https://en.wikipedia.org/wiki/Elvet",
    },
  },
  {
    id: "colpitts",
    name: "Colpitts Hotel",
    coordinates: [-1.5853309, 54.7759356],
    icon: "civic",
    history:
      "Colpitts Hotel on Colpitts Terrace is a Samuel Smiths house west of the station approach, a useful orientation stop between Durham railway station and the Crossgate / Bailey climb into the peninsula pubs.",
    source: {
      label: "Wikipedia: Durham, England",
      url: "https://en.wikipedia.org/wiki/Durham,_England",
    },
  },
  {
    id: "victoria",
    name: "The Victoria",
    coordinates: [-1.5704571, 54.7720607],
    icon: "civic",
    history:
      "The Victoria on Hallgarth Street is a well-known real-ale room south of the peninsula, often folded into Bailey and Hallgarth loops as a quieter alternative to the Market Place crush.",
    source: {
      label: "Wikipedia: Durham, England",
      url: "https://en.wikipedia.org/wiki/Durham,_England",
    },
  },
  {
    id: "durham-cathedral",
    name: "Durham Cathedral / Bailey",
    coordinates: [-1.5761, 54.7734],
    icon: "dome",
    history:
      "Durham Cathedral and the Bailey form the UNESCO peninsula above the Wear, the usual orientation landmark for the compact student pub loop along Saddler Street, the Market Place, and down toward Elvet Bridge.",
    source: {
      label: "UNESCO: Durham Castle and Cathedral",
      url: "https://whc.unesco.org/en/list/370/",
    },
  },
  {
    id: "durham-station",
    name: "Durham station",
    coordinates: [-1.5814, 54.7794],
    icon: "civic",
    history:
      "Durham railway station on North Road is the usual East Coast Main Line arrival. From here it is a short downhill walk toward Crossgate and the Market Place, or a climb onto the Bailey toward the cathedral pubs.",
    source: {
      label: "Network Rail: Durham",
      url: "https://www.networkrail.co.uk/stations/durham/",
    },
  },
  {
    id: "elvet-bridge",
    name: "Elvet Bridge",
    coordinates: [-1.5732, 54.7757],
    icon: "civic",
    history:
      "Elvet Bridge links the Market Place peninsula to Old Elvet across the Wear, the usual crossing between Bailey pubs and the Elvet / Claypath side. The Swan & Three Cygnets sits at the Elvet end of the span.",
    source: {
      label: "Wikipedia: Elvet Bridge",
      url: "https://en.wikipedia.org/wiki/Elvet_Bridge",
    },
  },
  {
    id: "market-place",
    name: "Market Place",
    coordinates: [-1.5755, 54.7768],
    icon: "market",
    history:
      "Durham's Market Place sits at the foot of the Bailey between Saddler Street and the river bridges, the natural daytime orientation point before a compact peninsula crawl toward the Shakespeare, Library, and Elvet Bridge pubs.",
    source: {
      label: "Wikipedia: Durham, England",
      url: "https://en.wikipedia.org/wiki/Durham,_England",
    },
  },
];
