import type { PintDrop } from "@/lib/pintDropShared";

// Seeded demo Pint Drops for iconic Manchester pubs that exist in
// public/data/cities/manchester/venues_slim.json. Same honesty rules as London
// (lib/pintDropSeeds.ts): provenance "demo", never invent organic prices, never
// invent venues — every venueId was matched by name against the slim index.
//
// Notes are honest seed copy ("Seeded demo Drop — replace with a real Spill")
// so liveliness never masquerades as a community Spill. Prices sit in a
// plausible Northern £ range (£3.80–£6.50).

type SeedSpec = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number;
  passedDownNote: string;
  era: string;
  minutesAgo: number;
};

const MINUTE_MS = 60_000;
const DEMO_NOW_MS = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

function demoCreatedAt(minutesAgo: number): string {
  return new Date(DEMO_NOW_MS - minutesAgo * MINUTE_MS).toISOString();
}

const SEED_NOTE_SUFFIX = " Seeded demo Drop. Replace with a real Spill.";

const seeds: SeedSpec[] = [
  // Peveril of the Peak — venue-mcr-1lwo5lo
  {
    id: "seed-mcr-peveril-1",
    venueId: "venue-mcr-1lwo5lo",
    handle: "@chepstow_tiles",
    drink: "Cask bitter",
    priceGbp: 4.6,
    passedDownNote:
      "Green tiles on the triangle plot. Stand outside once before you go in." + SEED_NOTE_SUFFIX,
    era: "Victorian tile lore",
    minutesAgo: 22,
  },
  // The Briton's Protection — venue-mcr-trsz1v
  {
    id: "seed-mcr-britons-1",
    venueId: "venue-mcr-trsz1v",
    handle: "@bridgewater_snug",
    drink: "Guinness",
    priceGbp: 5.2,
    passedDownNote:
      "Long front bar, tiled corridor, snug at the back. Ask for the quiet room." +
      SEED_NOTE_SUFFIX,
    era: "1930s remodel habit",
    minutesAgo: 48,
  },
  // Circus Tavern — venue-mcr-1fsnlnf
  {
    id: "seed-mcr-circus-1",
    venueId: "venue-mcr-1fsnlnf",
    handle: "@portland_pocket",
    drink: "House lager",
    priceGbp: 3.9,
    passedDownNote:
      "One of the smallest rooms in town, two stools and an honest pint." + SEED_NOTE_SUFFIX,
    era: "Beerhouse survival",
    minutesAgo: 71,
  },
  // Castle Hotel — venue-mcr-1rcu4en
  {
    id: "seed-mcr-castle-1",
    venueId: "venue-mcr-1rcu4en",
    handle: "@oldham_st_amp",
    drink: "Craft IPA",
    priceGbp: 5.8,
    passedDownNote:
      "Northern Quarter music room energy. Check the gig board before you settle." +
      SEED_NOTE_SUFFIX,
    era: "Indie night tip",
    minutesAgo: 96,
  },
  // The Marble Arch Inn — venue-mcr-16ub7ks
  {
    id: "seed-mcr-marble-1",
    venueId: "venue-mcr-16ub7ks",
    handle: "@rochdale_rd_pint",
    drink: "Marble Pint",
    priceGbp: 4.8,
    passedDownNote:
      "Marble's own house pour under the vaulted ceiling. Start here on a Rochdale Road crawl." +
      SEED_NOTE_SUFFIX,
    era: "Brewery tap lore",
    minutesAgo: 124,
  },
  // The Old Monkey — venue-mcr-1ptpgof
  {
    id: "seed-mcr-monkey-1",
    venueId: "venue-mcr-1ptpgof",
    handle: "@princess_st_ape",
    drink: "Cask ale",
    priceGbp: 4.4,
    passedDownNote:
      "City-centre tiled classic, a quick half before the next stop." + SEED_NOTE_SUFFIX,
    era: "City-centre habit",
    minutesAgo: 151,
  },
  // Port Street Beer House — venue-mcr-1dl8yg5
  {
    id: "seed-mcr-portst-1",
    venueId: "venue-mcr-1dl8yg5",
    handle: "@port_st_tap",
    drink: "Guest pale",
    priceGbp: 5.5,
    passedDownNote:
      "Northern Quarter tap list changes often. Ask what's on cask tonight." + SEED_NOTE_SUFFIX,
    era: "Guest-ale tip",
    minutesAgo: 183,
  },
  // The Lass O'Gowrie — venue-mcr-xwczi4
  {
    id: "seed-mcr-lass-1",
    venueId: "venue-mcr-xwczi4",
    handle: "@oxford_rd_lass",
    drink: "Session bitter",
    priceGbp: 4.2,
    passedDownNote:
      "Oxford Road student spine staple, cheap enough for a second round." + SEED_NOTE_SUFFIX,
    era: "Student stagger",
    minutesAgo: 214,
  },
  // The City Arms — venue-mcr-t7hytn
  {
    id: "seed-mcr-cityarms-1",
    venueId: "venue-mcr-t7hytn",
    handle: "@kennedy_st_arms",
    drink: "Cask bitter",
    priceGbp: 4.0,
    passedDownNote:
      "Compact city-centre local, a proper Northern pint before the train." + SEED_NOTE_SUFFIX,
    era: "After-work round",
    minutesAgo: 248,
  },
  // Mr Thomas's Chop House — venue-mcr-1j1ysik
  {
    id: "seed-mcr-chophouse-1",
    venueId: "venue-mcr-1j1ysik",
    handle: "@cross_st_chop",
    drink: "Premium lager",
    priceGbp: 6.2,
    passedDownNote:
      "Victorian chop-house room. Dress the pint up a notch for Cross Street." + SEED_NOTE_SUFFIX,
    era: "Chop-house tip",
    minutesAgo: 281,
  },
];

/** Manchester-only demo seeds (venue ids are `venue-mcr-…`). */
export const manchesterDemoPintDrops: PintDrop[] = seeds.map((seed) => ({
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
}));
