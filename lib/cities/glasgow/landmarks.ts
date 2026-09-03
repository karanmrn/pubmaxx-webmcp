// Glasgow landmarks for the map's history layer — static, curated, sourced.
// Same Landmark shape as London (lib/landmarks.ts); selected via landmarksForCity.

import type { Landmark } from "@/lib/landmarks";

export const glasgowLandmarks: Landmark[] = [
  {
    id: "laurieston-bar",
    name: "The Laurieston Bar",
    coordinates: [-4.2590505, 55.8528833],
    icon: "civic",
    history:
      "The Laurieston Bar at 58 Bridge Street is a Category C listed pub whose comprehensive 1960s remodelling, black-and-white tiling, Formica, and island bar, survives almost intact. A short walk from Bridge Street Subway, it is a south-bank landmark on informal Subcrawl folklore.",
    source: {
      label: "British Listed Buildings: The Laurieston Bar",
      url: "https://britishlistedbuildings.co.uk/200400455-the-laurieston-bar-58-bridge-street-and-2-and-4-nelson-street-glasgow",
    },
  },
  {
    id: "star-bar",
    name: "The Star Bar",
    coordinates: [-4.2620416, 55.843468],
    icon: "civic",
    history:
      "The Star Bar sits on Glasgow's south side near the Subway's southern arc, a neighbourhood public house of the kind that grew up around industrial Tradeston and Kingston rather than a tourist strip. Subcrawl parties often treat south-side stops like this as the harder half of the Clockwork Orange loop.",
    source: {
      label: "Scotsman Food and Drink: Glasgow Subcrawl",
      url: "https://foodanddrink.scotsman.com/drink/glasgow-pub-crawl-suggestion-the-subcrawl/",
    },
  },
  {
    id: "tennents-bar",
    name: "Tennent's Bar",
    coordinates: [-4.2950893, 55.8742251],
    icon: "civic",
    history:
      "Tennent's Bar on Byres Road takes its name from Glasgow's famous Wellpark brewing family and anchors the West End nightlife strip between Hillhead Subway and Ashton Lane. It is a natural first-night orientation point for students and visitors walking the university quarter.",
    source: {
      label: "Wikipedia: Byres Road",
      url: "https://en.wikipedia.org/wiki/Byres_Road",
    },
  },
  {
    id: "ashton-lane",
    name: "Ashton Lane",
    coordinates: [-4.293, 55.8747],
    icon: "market",
    history:
      "Ashton Lane is a cobbled West End lane of pubs, restaurants, and the Ubiquitous Chip, a short walk from Hillhead Subway. It became a nightlife landmark as the university quarter grew around Byres Road in the late 20th century.",
    source: {
      label: "Wikipedia: Ashton Lane",
      url: "https://en.wikipedia.org/wiki/Ashton_Lane",
    },
  },
  {
    id: "glasgow-cathedral",
    name: "Glasgow Cathedral",
    coordinates: [-4.2345, 55.863],
    icon: "dome",
    history:
      "Glasgow Cathedral is the city's medieval high church on the High Street ridge above the Molendinar Burn. Around it, the Necropolis and the Merchant City mark the historic core that later nightlife streets still orbit.",
    source: {
      label: "Historic Environment Scotland: Glasgow Cathedral",
      url: "https://www.historicenvironment.scot/visit-a-place/places/glasgow-cathedral/",
    },
  },
  {
    id: "merchant-city",
    name: "Merchant City",
    coordinates: [-4.244, 55.8575],
    icon: "civic",
    history:
      "The Merchant City grew from 18th-century tobacco and sugar warehouses east of the High Street into Glasgow's restored loft-and-bar quarter. Candleriggs, Bell Street, and the old markets still frame pubs such as Babbity Bowster and Blackfriars.",
    source: {
      label: "Wikipedia: Merchant City",
      url: "https://en.wikipedia.org/wiki/Merchant_City",
    },
  },
  {
    id: "glasgow-central",
    name: "Glasgow Central Station",
    coordinates: [-4.258, 55.859],
    icon: "civic",
    history:
      "Glasgow Central opened in 1879 as the Caledonian Railway's city terminus and remains Scotland's busiest station. Its grand concourse and Argyle Street bridge are the usual arrival point before a West End or Subway night out.",
    source: {
      label: "Network Rail: Glasgow Central",
      url: "https://www.networkrail.co.uk/stations/glasgow-central/",
    },
  },
  {
    id: "buchanan-street",
    name: "Buchanan Street",
    coordinates: [-4.2535, 55.8605],
    icon: "civic",
    history:
      "Buchanan Street is Glasgow's main pedestrian shopping spine, running from Argyle Street up to Sauchiehall Street. Buchanan Street Subway sits beneath it, a central interchange on the Clockwork Orange loop and a natural city-centre orientation landmark.",
    source: {
      label: "Wikipedia: Buchanan Street",
      url: "https://en.wikipedia.org/wiki/Buchanan_Street",
    },
  },
  {
    id: "hillhead-subway",
    name: "Hillhead Subway",
    coordinates: [-4.2934, 55.8759],
    icon: "civic",
    history:
      "Hillhead is the West End's principal Subway stop, opened with the Glasgow District Subway in 1896 and rebuilt in the late-1970s modernisation. It is the usual gateway to Byres Road, Ashton Lane, and the university pubs that feed Subcrawl folklore.",
    source: {
      label: "Wikipedia: Hillhead subway station",
      url: "https://en.wikipedia.org/wiki/Hillhead_subway_station",
    },
  },
  {
    id: "st-enoch-subway",
    name: "St Enoch Subway",
    coordinates: [-4.2555, 55.857],
    icon: "civic",
    history:
      "St Enoch is a city-centre Subway station beside the former St Enoch railway terminus site on Argyle Street. On the circular Clockwork Orange it is a common Subcrawl start. Hop off, find a nearby pub, then ride on to the next stop.",
    source: {
      label: "Wikipedia: St Enoch subway station",
      url: "https://en.wikipedia.org/wiki/St_Enoch_subway_station",
    },
  },
];
