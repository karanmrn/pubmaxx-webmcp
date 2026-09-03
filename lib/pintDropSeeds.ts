import { demoContentEnabled } from "@/lib/demoContent";
import type { CityId } from "@/lib/cities";
import { manchesterDemoPintDrops } from "@/lib/cities/manchester/pintDropSeeds";
import type { PintDrop } from "@/lib/pintDropShared";
import type { LastPintDecisionKind } from "@/lib/tfl";

// Seeded demo Pint Drops for the curated heritage pubs (lib/curation.ts,
// seeds/heritage.md). They exist so the community layer reads as alive on
// day one — and they are provenance-tagged "demo" so that liveliness never
// masquerades as organic (PRD "Implementation decisions"):
// - the UI renders a distinct Demo badge (never Contributor/Anecdote);
// - mergeVenueDrops ignores them for derived signals (prices, hasStory);
// - they are merged into BOTH store read paths (in-memory and Supabase), so
//   there is exactly one Pint-Drop render path and no writes to live storage.
//
// venueId values are the content-hashed stable ids for the dataset rows
// (stableVenueIdFromKey(venueGroupingKey(row))). __tests__/pintDropSeeds.test.ts
// pins each London id against public/data/pint_prices_app_dataset.json.
// Manchester seeds live in lib/cities/manchester/pintDropSeeds.ts and are
// pinned against public/data/cities/manchester/venues_slim.json.

type SeedSpec = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number;
  passedDownNote: string;
  era: string;
  minutesAgo: number;
  /** Optional honest Last Train context for feed stamps (Wave F0). */
  leaveByIso?: string;
  lastTrainDecision?: LastPintDecisionKind;
};

const MINUTE_MS = 60_000;
const DEMO_NOW_MS = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

function demoCreatedAt(minutesAgo: number): string {
  return new Date(DEMO_NOW_MS - minutesAgo * MINUTE_MS).toISOString();
}

const seeds: SeedSpec[] = [
  // Prospect of Whitby — 57 Wapping Wall (Tudor riverside)
  {
    id: "seed-prospect-1",
    venueId: "venue-16pnwmm",
    handle: "@wapping_wall_ted",
    drink: "London Pride",
    priceGbp: 6.4,
    passedDownNote:
      "My old man swore the flagstone floor by the bar was laid when the watermen still drank here. Take your pint out to the terrace at low tide and listen. The river knocks on the wall like it wants letting in.",
    era: "Told since the 1960s",
    minutesAgo: 18,
    // Demo Last Train stamp: posted with time to spare (leave-by ~30 min after post).
    leaveByIso: new Date(DEMO_NOW_MS - 18 * MINUTE_MS + 30 * MINUTE_MS).toISOString(),
    lastTrainDecision: "order_one_more",
  },
  {
    id: "seed-prospect-2",
    venueId: "venue-16pnwmm",
    handle: "@tessa_of_shadwell",
    drink: "Guinness",
    priceGbp: 6.1,
    passedDownNote:
      "Nan cleaned here in the fifties and said the pewter bar top was older than anyone who ever leaned on it. She tapped it twice for luck before closing, so I do too.",
    era: "Nan's shift, 1950s",
    minutesAgo: 42,
  },
  // The Grapes — 76 Narrow St, Limehouse
  {
    id: "seed-grapes-1",
    venueId: "venue-ekvkuv",
    handle: "@limehouse_reach",
    drink: "Cask bitter",
    priceGbp: 5.8,
    passedDownNote:
      "Dad always took the window seat over the water and said Dickens put this room in a book before any of us were born. Order the bitter, watch the tide turn, say nothing.",
    era: "Dad's rule, 1980s",
    minutesAgo: 68,
    // Posted after leave-by — honest "after the last train" stamp for demos.
    leaveByIso: new Date(DEMO_NOW_MS - 68 * MINUTE_MS - 15 * MINUTE_MS).toISOString(),
    lastTrainDecision: "train_risk",
  },
  {
    id: "seed-grapes-2",
    venueId: "venue-ekvkuv",
    handle: "@narrowstreet_nell",
    drink: "Carlsberg",
    priceGbp: 5.6,
    passedDownNote:
      "Grandma said at a proper high tide the balcony feels like the deck of a barge. She was right. Hold your glass with both hands the first time.",
    era: "High-tide advice",
    minutesAgo: 95,
  },
  // The Dove — 19 Upper Mall, Hammersmith
  {
    id: "seed-dove-1",
    venueId: "venue-1p5ftm3",
    handle: "@hammersmith_oar",
    drink: "Asahi",
    priceGbp: 7.2,
    passedDownNote:
      "Grandad rowed off the Mall and called the front snug the smallest bar in England long before the record people agreed. Two of you fit. Three is a friendship test.",
    era: "Rowing club lore",
    minutesAgo: 127,
  },
  // The Lamb — 94 Lamb's Conduit St, Bloomsbury
  {
    id: "seed-lamb-1",
    venueId: "venue-1yd70c7",
    handle: "@conduit_st_kit",
    drink: "Cask ale",
    priceGbp: 6.5,
    passedDownNote:
      "Mum said her grandmother could order a port here without the saloon ever seeing her face. You swivel the etched snob screen and a whole century turns with it.",
    era: "Great-grandmother's trick",
    minutesAgo: 163,
  },
  // The Old Pack Horse — 434 Chiswick High Rd
  {
    id: "seed-packhorse-1",
    venueId: "venue-1yylwyg",
    handle: "@chiswick_wheeler",
    drink: "Amstel",
    priceGbp: 5.9,
    passedDownNote:
      "My grandfather drank here when the trams still ran up the High Road. Same green tiles outside, same corner seat inside. He said the brewery built it to outlast the lot of us, and so far it has.",
    era: "Since the trams",
    minutesAgo: 201,
  },
  // The Sun Tavern — 441 Bethnal Green Rd
  {
    id: "seed-suntavern-1",
    venueId: "venue-ndc1rt",
    handle: "@bethnal_iris",
    drink: "House lager",
    priceGbp: 5.2,
    passedDownNote:
      "Grandad came in after his market shifts and always said the same thing: a small room keeps the talk honest. Ask about the Irish whiskey shelf and settle in.",
    era: "Market-day habit",
    minutesAgo: 247,
  },
  // The Queens Arms — 11 Warwick Way, Pimlico
  {
    id: "seed-queensarms-1",
    venueId: "venue-19211ib",
    handle: "@pimlico_arch",
    drink: "Cask ale",
    priceGbp: 5.4,
    passedDownNote:
      "It says 1846 above the door, but for our family the date that matters is 1971. My aunt's wedding party filled the back room and nobody went home before the bell.",
    era: "The wedding, 1971",
    minutesAgo: 286,
  },
  // The Queens Head — 66 Acton St, WC1X
  {
    id: "seed-queenshead-1",
    venueId: "venue-1u82rds",
    handle: "@actonst_bell",
    drink: "Pilsner",
    priceGbp: 6.0,
    passedDownNote:
      "My father-in-law calls this his thinking pub. Piano in the corner, a proper cellar, and the same quiet at five o'clock he remembers from forty years back.",
    era: "Forty years of five o'clocks",
    minutesAgo: 312,
  },
  // Demo place-story blurbs (Wave E) — same heritage venues, still provenance: demo.
  {
    id: "seed-prospect-place-1",
    venueId: "venue-16pnwmm",
    handle: "@wapping_demo",
    drink: "London Pride",
    priceGbp: 6.3,
    passedDownNote:
      "Demo note: this stretch of Wapping Wall sits on the Thames-side industrial Place story. Watermen's stairs, warehouse walls, and the tide still knocking. (Seeded demo, not a live report.)",
    era: "Place story demo",
    minutesAgo: 340,
  },
  {
    id: "seed-dove-place-1",
    venueId: "venue-1p5ftm3",
    handle: "@mall_demo",
    drink: "Asahi",
    priceGbp: 7.0,
    passedDownNote:
      "Demo note: Upper Mall is a quiet river-history stop. Smallest bar, biggest tide view. (Seeded demo, not a live report.)",
    era: "Place story demo",
    minutesAgo: 355,
  },
];

/** London heritage demo seeds only (excludes Manchester). */
export const londonDemoPintDrops: PintDrop[] = seeds.map((seed) => ({
  id: seed.id,
  venueId: seed.venueId,
  handle: seed.handle,
  drink: seed.drink,
  priceGbp: seed.priceGbp,
  passedDownNote: seed.passedDownNote,
  era: seed.era,
  createdAt: demoCreatedAt(seed.minutesAgo),
  provenance: "demo",
  status: "visible",
  ...(seed.leaveByIso ? { leaveByIso: seed.leaveByIso } : {}),
  ...(seed.lastTrainDecision ? { lastTrainDecision: seed.lastTrainDecision } : {}),
}));

export { manchesterDemoPintDrops };

/**
 * All city demo seeds — used for per-venue lookups (`demoDropsFor`) and
 * id resolution. Unscoped public feeds should prefer `demoPintDropsForCity`
 * so Manchester seeds do not noise the London landing/feed.
 */
export const demoPintDrops: PintDrop[] = [
  ...londonDemoPintDrops,
  ...manchesterDemoPintDrops,
];

/** Manchester slim-index venue ids are prefixed `venue-mcr-`. */
export const MANCHESTER_VENUE_ID_PREFIX = "venue-mcr-";

export function isManchesterVenueId(venueId: string): boolean {
  return venueId.startsWith(MANCHESTER_VENUE_ID_PREFIX);
}

/**
 * City-scoped demo seeds for unscoped list reads (feed, landing, map layer).
 * Defaults to London so Manchester demo drops never appear as London feed noise.
 * Pass `manchester` on the Manchester map so pins can pick up community prices.
 */
export function demoPintDropsForCity(cityId?: CityId | null): PintDrop[] {
  if (!demoContentEnabled()) return [];
  switch (cityId) {
    case "manchester":
      return manchesterDemoPintDrops;
    case "london":
    case undefined:
    case null:
      return londonDemoPintDrops;
    default:
      // Other UK cities have no demo seeds yet — return empty rather than
      // leaking London/Manchester liveliness onto the wrong map.
      return [];
  }
}

/** Seeds for one venue — appended after organic drops in the read paths. */
export function demoDropsFor(venueId: string): PintDrop[] {
  if (!demoContentEnabled()) return [];
  return demoPintDrops.filter((drop) => drop.venueId === venueId);
}
