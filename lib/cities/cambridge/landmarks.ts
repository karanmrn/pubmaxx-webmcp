// Cambridge landmarks for the map's history layer — static, curated, sourced.
// Same Landmark shape as London (lib/landmarks.ts); selected via landmarksForCity.

import type { Landmark } from "@/lib/landmarks";

export const cambridgeLandmarks: Landmark[] = [
  {
    id: "st-radegund",
    name: "St Radegund",
    coordinates: [0.1266612, 52.2076333],
    icon: "civic",
    history:
      "St Radegund on King Street is the usual eastern anchor of Cambridge's King Street Run folklore, a short, dense strip of pubs students have long treated as a timed crawl. Treat it as orientation and local lore, not a sanctioned challenge; drink responsibly.",
    source: {
      label: "Wikipedia: King Street Run",
      url: "https://en.wikipedia.org/wiki/King_Street_Run",
    },
  },
  {
    id: "king-street-run-pub",
    name: "King Street Run (pub)",
    coordinates: [0.1252435, 52.2072285],
    icon: "civic",
    history:
      "The King Street Run pub sits mid-strip on King Street and shares its name with the student folklore crawl that threads this lane. It is a useful mid-run orientation stop between St Radegund and the Cambridge Brew House end of the street.",
    source: {
      label: "Wikipedia: King Street Run",
      url: "https://en.wikipedia.org/wiki/King_Street_Run",
    },
  },
  {
    id: "champion-of-the-thames",
    name: "Champion of the Thames",
    coordinates: [0.1244397, 52.2073062],
    icon: "civic",
    history:
      "The Champion of the Thames is a compact King Street pub long folded into the same student folklore strip as St Radegund and the Cambridge Brew House. It is one of the densest mid-street rooms on the classic King Street Run orientation.",
    source: {
      label: "Wikipedia: King Street Run",
      url: "https://en.wikipedia.org/wiki/King_Street_Run",
    },
  },
  {
    id: "the-eagle",
    name: "The Eagle",
    coordinates: [0.1179926, 52.2040769],
    icon: "civic",
    history:
      "The Eagle on Bene't Street is Cambridge's most famous historic pub. RAF graffiti in the RAF Bar and the 1953 Watson–Crick DNA announcement both keep it on every first-night map. It sits a short walk west of King Street toward King's Parade.",
    source: {
      label: "Wikipedia: The Eagle, Cambridge",
      url: "https://en.wikipedia.org/wiki/The_Eagle,_Cambridge",
    },
  },
  {
    id: "mill-road",
    name: "Mill Road",
    coordinates: [0.139, 52.199],
    icon: "civic",
    history:
      "Mill Road is Cambridge's independent nightlife and food spine east of the station. Devonshire Arms, Live & Let Live, and the Empress sit in the terraces off the main road. It is the classic alternative corridor when King Street feels too student-touristy.",
    source: {
      label: "Wikipedia: Mill Road, Cambridge",
      url: "https://en.wikipedia.org/wiki/Mill_Road,_Cambridge",
    },
  },
  {
    id: "cambridge-station",
    name: "Cambridge station",
    coordinates: [0.1374, 52.194],
    icon: "civic",
    history:
      "Cambridge railway station is the usual National Rail arrival south-east of the centre. From here it is a short walk north into Mill Road or west toward the Backs and the city-centre pub lanes around King Street and Bene't Street.",
    source: {
      label: "Network Rail: Cambridge",
      url: "https://www.networkrail.co.uk/stations/cambridge/",
    },
  },
  {
    id: "the-backs",
    name: "The Backs / River Cam",
    coordinates: [0.1145, 52.2045],
    icon: "canal",
    history:
      "The Backs are the college lawns and river meadows west of King's, Clare, and Trinity, the classic Cambridge orientation for punts, bridges, and riverside pubs such as the Anchor, the Mill, and the Pickerel on Magdalene Street.",
    source: {
      label: "Wikipedia: The Backs",
      url: "https://en.wikipedia.org/wiki/The_Backs",
    },
  },
  {
    id: "quayside",
    name: "Quayside",
    coordinates: [0.1165, 52.2095],
    icon: "civic",
    history:
      "Quayside by Magdalene Bridge is the northern river landing where the Cam meets the tourist punt fleet. The Pickerel on Magdalene Street anchors the same stretch as a walkable riverside first stop before heading into the centre.",
    source: {
      label: "Wikipedia: River Cam",
      url: "https://en.wikipedia.org/wiki/River_Cam",
    },
  },
];
