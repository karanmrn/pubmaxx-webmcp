import {
  DEFAULT_CITY_ID,
  parseCityId,
  type CityId,
} from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/cityMapHref";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import type { AltCrawlStyle } from "@/lib/crawlUrl";
import type { CrawlStyle } from "@/lib/venues";

// Named "generational" curated crawls — hand-picked routes through pubs that
// genuinely cluster in a themed patch of London, so an older drinker's pub
// knowledge becomes a walkable, shareable route for the next generation.
//
// venueId values are the content-hashed stable ids for the real dataset rows
// (stableVenueIdFromKey(venueGroupingKey(row)), see lib/venues.ts). They are
// pinned against public/data/pint_prices_app_dataset.json by
// __tests__/curatedCrawls.test.ts, which recomputes each id from the dataset —
// so a re-export that moves a venue is caught instead of silently 404-ing.

export type CuratedCrawl = {
  id: string;
  name: string;
  blurb: string;
  crawlStyle: CrawlStyle;
  venueIds: string[];
  /**
   * Optional landmark id (lib/landmarks) the crawl starts at — the crawls page
   * shows a "starts at Big Ben"-style origin chip when set (story 27). Left
   * undefined for a crawl with no obvious single landmark start.
   */
  startLandmarkId?: string;
  /**
   * Optional alt "kind of night" style (issue #31). Undefined reads as a
   * classic pint crawl ("pint"). Only shapes copy — the scoring crawlStyle is
   * unchanged — and a "mocktail" crawl nudges the non-alcoholic filter on.
   */
  altStyle?: AltCrawlStyle;
  /**
   * Optional Place story corridor id (lib/storyBands) this crawl packages
   * (Wave F2). When set, Crawls / Lore can deep-link the corridor + route.
   */
  placeStoryBandId?: string;
};

export const curatedCrawls: CuratedCrawl[] = [
  {
    id: "victorian-soho",
    name: "Victorian Soho",
    blurb:
      "Five Dean Street–era snugs the old Soho hands drank in. Pass the round on to whoever's next.",
    crawlStyle: "heritage",
    // Tight cluster around Dean St / Greek St, W1D — every leg under 200m.
    venueIds: [
      "venue-1ufn31x", // The Nellie Dean — 89 Dean St
      "venue-1t8siin", // The Crown & Two Chairmen — 31-32 Dean St
      "venue-xiesdn", // The Dog & Duck — 18 Bateman St
      "venue-phqazo", // The Coach & Horses — 29 Greek St
      "venue-15i2wst", // Golden Lion (Soho) — 51 Dean Street
    ],
    startLandmarkId: "piccadilly-circus",
    // No placeStoryBandId: Soho is not on the Westminster royal-civic corridor.
  },
  {
    id: "fleet-street-writers",
    name: "Fleet Street & the Writers",
    blurb:
      "The old press strip, Strand to Fleet Street, where a generation of hacks filed copy, then drank it back.",
    crawlStyle: "writerTrail",
    // Walkable west→east along the Strand and Fleet St, WC2/EC4.
    venueIds: [
      "venue-dbukrn", // The Coal Hole — 91-92 Strand
      "venue-q9lryg", // The Lyceum Tavern — 354 Strand
      "venue-11n82fd", // The Seven Stars — 53 Carey St
      "venue-lrlyh8", // The Old Bank of England — 194 Fleet St
      "venue-1sx1vco", // Ye Olde Cock Tavern — 22 Fleet Street
      "venue-1r447i7", // The Tipperary — 66 Fleet St
    ],
    startLandmarkId: "somerset-house",
    placeStoryBandId: "fleet-street-writers",
  },
  {
    id: "bloomsbury-literary",
    name: "Bloomsbury Literary",
    blurb:
      "From the Museum Tavern down Lamb's Conduit Street, the reading-room-and-a-pint round handed down since the British Museum days.",
    crawlStyle: "writerTrail",
    // British Museum → Lamb's Conduit St spine, WC1.
    venueIds: [
      "venue-fr71bp", // Museum Tavern — 49 Great Russell Street
      "venue-1yd70c7", // The Lamb — 94 Lamb's Conduit St
      "venue-erabed", // The Perseverance — 63 Lamb's Conduit St
      "venue-1kbl05l", // The Rugby Tavern — 19 Great James St
      "venue-12ino21", // The Dolphin Tavern — 44 Red Lion St
    ],
    startLandmarkId: "british-museum",
  },
  {
    id: "riverside-heritage",
    name: "Riverside Heritage",
    blurb:
      "St Katharine Docks east to Limehouse, the Thames-side taverns watermen and their grandkids still drink in at the turn of the tide.",
    crawlStyle: "heritage",
    // Along the river west→east, Wapping to Limehouse — a proper riverside walk.
    venueIds: [
      "venue-xvusrx", // The Dickens Inn — St Katharine's Way
      "venue-1d8a5xb", // The Captain Kidd — 108 Wapping High St
      "venue-16pnwmm", // Prospect of Whitby — 57 Wapping Wall
      "venue-ekvkuv", // The Grapes — 76 Narrow St, Limehouse
    ],
    startLandmarkId: "tower-bridge",
    placeStoryBandId: "thames-industrial",
  },
  {
    id: "pint-park-view",
    name: "A pint, a park, a view",
    blurb:
      "A City-fringe loop past Leadenhall Market that climbs to a free rooftop garden with one of London's best skyline views. A pint at each end of the climb.",
    crawlStyle: "beerGarden",
    // Bishopsgate/Cornhill cluster, EC2/EC3 — every leg under 550m, all inside
    // the 22 Bishopsgate viewpoint's "on the way" radius via lib/routeLegs.
    venueIds: [
      "venue-1dosq7b", // Kings Arms (beer garden) — 27-28 Wormwood Street
      "venue-25y8c7", // The Counting House — 50 Cornhill
      "venue-zottpx", // The Crosse Keys — 9 Gracechurch Street
      "venue-6r6xa3", // The Lord Aberconway — 72 Old Broad Street
      "venue-10mil9j", // Railway (beer garden) — 15 Liverpool Street
    ],
    startLandmarkId: "leadenhall-market",
    placeStoryBandId: "coding-pint",
  },
  {
    id: "borough-market-crawl",
    name: "Borough Market crawl",
    blurb:
      "A tight loop through the stalls and railway arches of Borough Market, London's oldest food market, trading since at least the 13th century, threaded between five pubs.",
    crawlStyle: "balanced",
    // Southwark St / Borough High St, SE1 — every leg under 250m.
    venueIds: [
      "venue-133uf6h", // Katzenjammers — The Hop Exchange, 24 Southwark St
      "venue-fpmfjs", // The Rake — 14A Winchester Walk
      "venue-16ze6b1", // The George — 75-77 Borough High Street
      "venue-1ywc2og", // The Old King's Head — King's Head Yard
      "venue-2e3otf", // The Barrowboy & Banker — 6-8 Borough High St
    ],
    startLandmarkId: "borough-market",
    placeStoryBandId: "markets-theatre",
  },
  {
    id: "bankside-riverside",
    name: "Bankside riverside walk",
    blurb:
      "Straight along the Thames path from Clink Street to the South Bank, the old wharves and a working riverside pub, with Tate Modern and the river the whole way.",
    crawlStyle: "heritage",
    // Along the river, Bankside/Southwark, SE1 — every leg under 550m.
    venueIds: [
      "venue-1x50b6d", // The Old Thameside Inn — Pickfords Wharf, Clink St
      "venue-1bb3t97", // The Mudlark — Montague Close
      "venue-gv8lwa", // Anchor — 34 Park Street
      "venue-1pvqxca", // Lord Clyde — 27 Clennam Street
    ],
    startLandmarkId: "tate-modern",
    placeStoryBandId: "river-history",
  },
  {
    id: "camden-market-crawl",
    name: "Camden Market crawl",
    blurb:
      "From the lock down Camden High Street, market stalls, canal views, and the pubs that have watched Camden's music scene since punk.",
    crawlStyle: "sports",
    // Camden Lock down Camden High St, NW1 — every leg under 400m.
    venueIds: [
      "venue-17u2i1w", // The Ice Wharf (JD Wetherspoon) — 28A Jamestown Rd
      "venue-t20n94", // The Oxford Arms — 265 Camden High St
      "venue-11wwbzz", // The Elephants Head — 224 Camden High St
      "venue-1d1tez", // The Dublin Castle — 94 Parkway
    ],
    startLandmarkId: "camden-lock",
    placeStoryBandId: "markets-theatre",
  },
  {
    id: "soho-food-crawl",
    name: "Soho small plates",
    blurb:
      "A kitchen-first loop through Dean Street's food pubs. Proper plates between the pints, so nobody drinks on an empty stomach.",
    crawlStyle: "balanced",
    altStyle: "food",
    // Every stop serves food; tight Dean St / Bateman St cluster, W1D — legs
    // all under 200m.
    venueIds: [
      "venue-1ufn31x", // The Nellie Dean — 89 Dean St (food)
      "venue-1t8siin", // The Crown & Two Chairmen — 31-32 Dean St (food)
      "venue-xiesdn", // The Dog & Duck — 18 Bateman St (food)
      "venue-phqazo", // The Coach & Horses — 29 Greek St (food)
      "venue-15i2wst", // Golden Lion (Soho) — 51 Dean Street (food)
    ],
    startLandmarkId: "piccadilly-circus",
  },
  {
    id: "westminster-civic",
    name: "Westminster & Whitehall",
    blurb:
      "From the Admiralty to Trafalgar Square, the pubs civil servants and tourists share when Parliament is in session and the bells are ringing.",
    crawlStyle: "heritage",
    venueIds: [
      "venue-1t2cfa2", // The Admiralty
      "venue-698bu3", // The Old Spades
      "venue-gk2fp9", // Sherlock Holmes
      "venue-11iolkd", // The Lemon Tree
    ],
    startLandmarkId: "big-ben",
    placeStoryBandId: "royal-civic",
  },
  {
    id: "barbican-coding-pint",
    name: "Barbican coding pint",
    blurb:
      "A Barbican-to-Old-Street loop through the City fringe, the after-work standup pint between the Square Mile studios and Silicon Roundabout.",
    crawlStyle: "balanced",
    venueIds: [
      "venue-1h8gb3j", // The Jugged Hare
      "venue-qtavbf", // The Two Brewers
      "venue-1pq1x5j", // The Shakespeare
      "venue-myhgdk", // The Artillery Arms
      "venue-10ilrk3", // The Masque Haunt
    ],
    startLandmarkId: "barbican",
    placeStoryBandId: "coding-pint",
  },
  {
    id: "leicester-mocktail-crawl",
    name: "Leicester Square soft round",
    blurb:
      "A cocktail-bar loop off Leicester Square. Every stop mixes drinks, so it's an easy one to run alcohol-free: order the mocktail version of the round.",
    crawlStyle: "dateNight",
    altStyle: "mocktail",
    // All stops list cocktails (so a mocktail is on the menu); tight cluster
    // around Leicester Square / Charing Cross, WC2 — legs all under 120m.
    venueIds: [
      "venue-11u4gpi", // Imperial — 5 Leicester Street (cocktails)
      "venue-ymqu1w", // Hippodrome Casino — Cranbourn St (cocktails)
      "venue-12bzb84", // Brewmaster — 37 Cranbourn Street (cocktails)
      "venue-165ayyi", // Garrick Arms — 8-10 Charing Cross (cocktails)
      "venue-1jmwk6r", // Round Table — 26-27 St Martins Court (cocktails)
    ],
    startLandmarkId: "piccadilly-circus",
    placeStoryBandId: "royal-civic",
  },
  {
    id: "eating-europe-london-pubs",
    name: "Historic pubs (Eating Europe guide)",
    blurb:
      "Seven stops from Eating Europe's London pubs guide. Heritage notes and stories only, never prices. A city-wide greatest-hits loop, not one tight walk.",
    crawlStyle: "heritage",
    venueIds: [
      "venue-1lcgpd9", // The Mayflower — Rotherhithe
      "venue-hbtda7", // Lord Wargrave — Marylebone
      "venue-68ns7y", // Ye Old Mitre — Holborn
      "venue-1wgjxs6", // The Albion — Barnsbury
      "venue-1snxfi3", // The Spaniards Inn — Hampstead
      "venue-806vol", // The Ship Soho — West End
      "venue-1ha28jc", // The Grenadier — Belgravia
    ],
  },
  {
    id: "youngs-beer-gardens",
    name: "Young's beer gardens",
    blurb:
      "Garden pubs from Young's own regional guides that match our London map. Official microsite links, beer-garden story, no invented prices.",
    crawlStyle: "beerGarden",
    // Guide-derived set across London (not one tight walk). Prefer garden-flagged
    // matches; Lamb / Castle stay as Young's hits even when the garden flag is soft.
    venueIds: [
      "venue-1lf3cw", // The Founder's Arms — Southbank
      "venue-1yd70c7", // The Lamb — Bloomsbury
      "venue-1dafrop", // The Narrowboat — Islington
      "venue-jxen6y", // The Castle — Islington
      "venue-17nbxyh", // The Coborn — Mile End
      "venue-x2hh3d", // The Old Ship — Hammersmith
      "venue-t3ii33", // The Owl & The Pussycat — Shoreditch
      "venue-1e0mpj3", // The Windmill — Mayfair
      "venue-fejqqd", // The Constitution — Camden
      "venue-1v1wfs4", // The Woolpack — Bermondsey
    ],
  },
  {
    id: "nicholsons-west-end",
    name: "Nicholson's West End",
    blurb:
      "A walkable Mayfair–Soho–Strand loop through Nicholson's historic pubs. Official menu and book links, no invented prices.",
    crawlStyle: "heritage",
    // West → east: Mayfair / Oxford Circus → Soho → Strand.
    venueIds: [
      "venue-1c2pk99", // The Clarence — Mayfair
      "venue-ru7vbr", // The Argyll Arms — Oxford Circus
      "venue-4pqtn7", // The Clachan — Kingly St
      "venue-1ozggok", // The Crown — Brewer St
      "venue-xiesdn", // The Dog & Duck — Soho
      "venue-14mrz2z", // The Three Greyhounds — Soho
      "venue-u0ox5x", // The Cambridge — Cambridge Circus
      "venue-dbukrn", // The Coal Hole — Strand
    ],
    startLandmarkId: "piccadilly-circus",
  },
];

/** Curated crawls that package a given Place story corridor (Wave F2). */
export function curatedCrawlsForBand(
  bandId: string | null | undefined,
  crawls: readonly CuratedCrawl[] = curatedCrawls,
): CuratedCrawl[] {
  if (!bandId) return [];
  return crawls.filter((crawl) => crawl.placeStoryBandId === bandId);
}

/** Look up one curated crawl by id. */
export function curatedCrawlById(id: string | null | undefined): CuratedCrawl | undefined {
  if (!id) return undefined;
  return curatedCrawls.find((crawl) => crawl.id === id);
}

export { cityAwareMapPath };

function resolveHrefCity(
  cityId: CityId | string | null | undefined,
  venueIds: readonly string[],
): CityId {
  const explicit = parseCityId(cityId);
  if (explicit) return explicit;
  for (const venueId of venueIds) {
    const fromVenue = cityIdFromVenueId(venueId);
    if (fromVenue) return fromVenue;
  }
  return DEFAULT_CITY_ID;
}

/** Map deep-link that opens a Place story corridor (and optional crawl stops). */
export function placeStoryMapHref(
  bandId: string,
  crawlId?: string,
  cityId?: CityId | string | null,
  crawls: readonly CuratedCrawl[] = curatedCrawls,
): string {
  const crawl = crawlId
    ? crawls.find((c) => c.id === crawlId) ??
      (cityId ? undefined : curatedCrawlById(crawlId))
    : undefined;
  if (crawl) {
    const params = new URLSearchParams();
    params.set("mode", "build");
    params.set("pubs", crawl.venueIds.join(","));
    params.set("crawl", crawl.id);
    params.set("band", bandId);
    return cityAwareMapPath(resolveHrefCity(cityId, crawl.venueIds), params);
  }
  const params = new URLSearchParams({ band: bandId });
  return cityAwareMapPath(cityId, params);
}

/**
 * Map deep-link for a named curated crawl — map-first arrival (polyline + chip,
 * planner closed). Carries crawl= so PubMap can hydrate the curated blurb.
 */
export function curatedCrawlMapHref(
  crawl: CuratedCrawl,
  cityId?: CityId | string | null,
): string {
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", crawl.venueIds.join(","));
  params.set("crawl", crawl.id);
  if (crawl.crawlStyle) params.set("style", crawl.crawlStyle);
  if (crawl.altStyle && crawl.altStyle !== "pint") params.set("alt", crawl.altStyle);
  if (crawl.placeStoryBandId) params.set("band", crawl.placeStoryBandId);
  return cityAwareMapPath(resolveHrefCity(cityId, crawl.venueIds), params);
}

/**
 * Shareable map URL for a completed crawl (Wave H1).
 * Same shape the map already seeds: mode=build&pubs=… (+ band= for Place stories).
 */
const SHARE_MAP_STOP_CAP = 12;

export function crawlShareMapHref(input: {
  venueIds: readonly string[];
  placeStoryBandId?: string | null;
  crawlId?: string | null;
  cityId?: CityId | string | null;
  /** Optional city crawl pack for band lookup when crawlId is set. */
  crawls?: readonly CuratedCrawl[];
}): string {
  const ids = input.venueIds
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, SHARE_MAP_STOP_CAP);
  const city = resolveHrefCity(input.cityId, ids);
  if (ids.length === 0) {
    const band = input.placeStoryBandId?.trim();
    return band
      ? cityAwareMapPath(city, new URLSearchParams({ band }))
      : cityAwareMapPath(city);
  }
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", ids.join(","));
  const crawlId = input.crawlId?.trim();
  if (crawlId) params.set("crawl", crawlId);
  const pack = input.crawls ?? curatedCrawls;
  const band =
    input.placeStoryBandId?.trim() ||
    (crawlId ? pack.find((c) => c.id === crawlId)?.placeStoryBandId : undefined) ||
    (crawlId && !input.crawls ? curatedCrawlById(crawlId)?.placeStoryBandId : undefined);
  if (band) params.set("band", band);
  return cityAwareMapPath(city, params);
}
