// Bristol landmarks for the map's history layer — static, curated, sourced.
// Same Landmark shape as London (lib/landmarks.ts); selected via landmarksForCity.

import type { Landmark } from "@/lib/landmarks";

export const bristolLandmarks: Landmark[] = [
  {
    id: "llandoger-trow",
    name: "The Llandoger Trow",
    coordinates: [-2.5931322, 51.4518683],
    icon: "civic",
    history:
      "The Llandoger Trow on King Street is one of Bristol's most famous historic pubs, a timber-framed room long tied to harbour lore and the classic King Street first-night strip beside the Old Duke and the Royal Navy Volunteer.",
    source: {
      label: "Wikipedia: Llandoger Trow",
      url: "https://en.wikipedia.org/wiki/Llandoger_Trow",
    },
  },
  {
    id: "royal-navy-volunteer",
    name: "The Famous Royal Navy Volunteer",
    coordinates: [-2.5946134, 51.451612],
    icon: "civic",
    history:
      "The Famous Royal Navy Volunteer on King Street is a long-running craft and cider room on the same historic lane as the Llandoger Trow and Old Duke. A natural mid-strip stop on a King Street classic crawl.",
    source: {
      label: "Wikipedia: King Street, Bristol",
      url: "https://en.wikipedia.org/wiki/King_Street,_Bristol",
    },
  },
  {
    id: "king-street-brew-house",
    name: "King Street Brew House",
    coordinates: [-2.5929108, 51.4521668],
    icon: "civic",
    history:
      "King Street Brew House sits on Welsh Back at the harbour edge of King Street. A brewpub orientation stop between the historic timber pubs and the floating harbour pontoons toward No.1 Harbourside.",
    source: {
      label: "Wikipedia: King Street, Bristol",
      url: "https://en.wikipedia.org/wiki/King_Street,_Bristol",
    },
  },
  {
    id: "the-albion",
    name: "The Albion (Clifton)",
    coordinates: [-2.6179176, 51.4550335],
    icon: "civic",
    history:
      "The Albion on Boyces Avenue is a Clifton village pub in the OSM slim index. A useful hillside orientation stop near the Coronation Tap when you leave the harbour for a Clifton night.",
    source: {
      label: "Wikipedia: Clifton, Bristol",
      url: "https://en.wikipedia.org/wiki/Clifton,_Bristol",
    },
  },
  {
    id: "harbourside",
    name: "Harbourside",
    coordinates: [-2.598, 51.4505],
    icon: "ship",
    history:
      "Bristol Harbourside is the regenerated floating harbour waterfront. Watershed, M Shed, and pubs such as No.1 Harbourside and the Ostrich frame a first-night walk from King Street along the water.",
    source: {
      label: "Wikipedia: Bristol Harbour",
      url: "https://en.wikipedia.org/wiki/Bristol_Harbour",
    },
  },
  {
    id: "stokes-croft",
    name: "Stokes Croft",
    coordinates: [-2.59, 51.464],
    icon: "civic",
    history:
      "Stokes Croft is Bristol's mural-lined independent strip north of the centre. The Croft, Pipe & Slippers, and neighbouring Cheltenham Road rooms define a walkable alternative to the tourist harbour pubs.",
    source: {
      label: "Wikipedia: Stokes Croft",
      url: "https://en.wikipedia.org/wiki/Stokes_Croft",
    },
  },
  {
    id: "pipe-and-slippers",
    name: "The Pipe & Slippers",
    coordinates: [-2.5896016, 51.4646134],
    icon: "civic",
    history:
      "The Pipe & Slippers on Cheltenham Road sits at the north end of the Stokes Croft strip. A useful indie-room orientation stop beside The Croft when the harbour pubs feel too touristy.",
    source: {
      label: "Wikipedia: Stokes Croft",
      url: "https://en.wikipedia.org/wiki/Stokes_Croft",
    },
  },
  {
    id: "temple-meads",
    name: "Bristol Temple Meads",
    coordinates: [-2.5801, 51.4491],
    icon: "civic",
    history:
      "Bristol Temple Meads is Brunel's Great Western terminus and the usual National Rail arrival. From here it is a short walk west toward the harbour, King Street, and the Old City pub lanes.",
    source: {
      label: "Network Rail: Bristol Temple Meads",
      url: "https://www.networkrail.co.uk/stations/bristol-temple-meads/",
    },
  },
  {
    id: "old-duke",
    name: "The Old Duke",
    coordinates: [-2.5932132, 51.4521742],
    icon: "civic",
    history:
      "The Old Duke on King Street is Bristol's famous jazz pub. Live music most nights and a fixed point on the same historic strip as the Llandoger Trow. It is the usual soundtrack stop on a King Street classic.",
    source: {
      label: "Wikipedia: The Old Duke",
      url: "https://en.wikipedia.org/wiki/The_Old_Duke",
    },
  },
  {
    id: "clifton-suspension-bridge",
    name: "Clifton Suspension Bridge",
    coordinates: [-2.6278, 51.4549],
    icon: "civic",
    history:
      "Brunel's Clifton Suspension Bridge spans the Avon Gorge west of Clifton village. The usual hillside orientation landmark when a harbour first night continues up to the Albion and Coronation Tap.",
    source: {
      label: "Wikipedia: Clifton Suspension Bridge",
      url: "https://en.wikipedia.org/wiki/Clifton_Suspension_Bridge",
    },
  },
];
