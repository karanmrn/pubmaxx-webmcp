import { alcoholTypeForDrink, type Drink, type DrinkCategory } from "@/lib/drinks";

// Seeded demo drink menus for the curated heritage pubs (see lib/curation.ts +
// lib/pintDropSeeds.ts for the venue keys/ids). They exist so a venue's Menu
// tab reads as a real bar list on day one — a wine, a whisky, a gin, a cocktail
// beyond the pint rows — and they are provenance-tagged honestly:
//   { source:"seed", licence:"n/a", observedAt } (source:"seed" is the demo
//   marker, mirroring pintDropSeeds' provenance:"demo"). They are NEVER
//   presented as a real permissible price feed.
//
// venueId values are the same content-hashed stable ids pintDropSeeds pins
// against public/data/pint_prices_app_dataset.json — __tests__/drinkSeeds.test.ts
// re-pins each here so a dataset drift is caught. The read path lib/drinkMenu.ts
// merges these AFTER the legacy beer drinks (it never touches the pint-drop
// store or lib/venues.ts).

// When these demo menus were "observed" — a fixed ISO so the seed is
// deterministic (tests and snapshots don't drift with wall-clock time).
const SEED_OBSERVED_AT = "2026-07-01T12:00:00.000Z";

// The honest demo provenance every seeded drink carries.
const SEED_PROVENANCE = {
  source: "seed",
  licence: "n/a",
  observedAt: SEED_OBSERVED_AT,
} as const;

// A seed row before provenance/id are stamped on — one realistic menu item.
type DrinkSeedSpec = {
  id: string;
  venueId: string;
  category: DrinkCategory;
  name: string;
  producer?: string;
  abv?: number;
  style?: string;
  region?: string;
  servingSize?: string;
  priceGbp: number;
};

const seeds: DrinkSeedSpec[] = [
  // ── Prospect of Whitby — venue-16pnwmm (Tudor riverside, Wapping) ──────────
  {
    id: "drink-prospect-wine",
    venueId: "venue-16pnwmm",
    category: "wine",
    name: "House Malbec",
    region: "Mendoza, Argentina",
    style: "Red, full-bodied",
    abv: 13.5,
    servingSize: "175ml glass",
    priceGbp: 7.5,
  },
  {
    id: "drink-prospect-whisky",
    venueId: "venue-16pnwmm",
    category: "whisky",
    name: "Talisker 10",
    producer: "Talisker",
    region: "Isle of Skye",
    style: "Single malt, peated",
    abv: 45.8,
    servingSize: "25ml",
    priceGbp: 5.8,
  },
  {
    id: "drink-prospect-gin",
    venueId: "venue-16pnwmm",
    category: "gin",
    name: "Sipsmith London Dry",
    producer: "Sipsmith",
    region: "London",
    style: "London Dry",
    abv: 41.6,
    servingSize: "25ml + tonic",
    priceGbp: 8.2,
  },
  {
    id: "drink-prospect-cocktail",
    venueId: "venue-16pnwmm",
    category: "cocktail",
    name: "Wapping Old Fashioned",
    style: "Bourbon, bitters, orange",
    abv: 32,
    servingSize: "single",
    priceGbp: 11.5,
  },

  // ── The Grapes — venue-ekvkuv (Georgian riverside, Limehouse) ──────────────
  {
    id: "drink-grapes-wine",
    venueId: "venue-ekvkuv",
    category: "wine",
    name: "Picpoul de Pinet",
    region: "Languedoc, France",
    style: "White, crisp",
    abv: 12.5,
    servingSize: "175ml glass",
    priceGbp: 8.0,
  },
  {
    id: "drink-grapes-whisky",
    venueId: "venue-ekvkuv",
    category: "whisky",
    name: "Redbreast 12",
    producer: "Midleton",
    region: "Ireland",
    style: "Single pot still",
    abv: 40,
    servingSize: "25ml",
    priceGbp: 6.5,
  },
  {
    id: "drink-grapes-gin",
    venueId: "venue-ekvkuv",
    category: "gin",
    name: "Beefeater 24",
    producer: "Beefeater",
    region: "London",
    style: "London Dry",
    abv: 45,
    servingSize: "25ml + tonic",
    priceGbp: 7.8,
  },
  {
    id: "drink-grapes-cocktail",
    venueId: "venue-ekvkuv",
    category: "cocktail",
    name: "Narrow Street Negroni",
    style: "Gin, Campari, vermouth",
    abv: 28,
    servingSize: "single",
    priceGbp: 10.5,
  },

  // ── The Dove — venue-1p5ftm3 (Georgian riverside, Hammersmith) ─────────────
  {
    id: "drink-dove-wine",
    venueId: "venue-1p5ftm3",
    category: "wine",
    name: "Rioja Crianza",
    region: "Rioja, Spain",
    style: "Red, oaked",
    abv: 13.5,
    servingSize: "175ml glass",
    priceGbp: 7.2,
  },
  {
    id: "drink-dove-whisky",
    venueId: "venue-1p5ftm3",
    category: "whisky",
    name: "Glenmorangie Original",
    producer: "Glenmorangie",
    region: "Highlands",
    style: "Single malt",
    abv: 40,
    servingSize: "25ml",
    priceGbp: 5.5,
  },
  {
    id: "drink-dove-gin",
    venueId: "venue-1p5ftm3",
    category: "gin",
    name: "Hendrick's",
    producer: "Hendrick's",
    region: "Scotland",
    style: "Cucumber & rose",
    abv: 41.4,
    servingSize: "25ml + tonic",
    priceGbp: 8.5,
  },
  {
    id: "drink-dove-cocktail",
    venueId: "venue-1p5ftm3",
    category: "cocktail",
    name: "Upper Mall Spritz",
    style: "Aperol, prosecco, soda",
    abv: 11,
    servingSize: "single",
    priceGbp: 9.5,
  },

  // ── The Lamb — venue-1yd70c7 (Victorian, Bloomsbury) ───────────────────────
  {
    id: "drink-lamb-wine",
    venueId: "venue-1yd70c7",
    category: "wine",
    name: "Chianti Classico",
    region: "Tuscany, Italy",
    style: "Red, medium",
    abv: 13,
    servingSize: "175ml glass",
    priceGbp: 7.8,
  },
  {
    id: "drink-lamb-whisky",
    venueId: "venue-1yd70c7",
    category: "whisky",
    name: "Laphroaig 10",
    producer: "Laphroaig",
    region: "Islay",
    style: "Single malt, heavily peated",
    abv: 40,
    servingSize: "25ml",
    priceGbp: 6.2,
  },
  {
    id: "drink-lamb-gin",
    venueId: "venue-1yd70c7",
    category: "gin",
    name: "Tanqueray No. Ten",
    producer: "Tanqueray",
    region: "Scotland",
    style: "Citrus-forward",
    abv: 47.3,
    servingSize: "25ml + tonic",
    priceGbp: 8.0,
  },
  {
    id: "drink-lamb-cocktail",
    venueId: "venue-1yd70c7",
    category: "cocktail",
    name: "Conduit Street Martini",
    style: "Gin or vodka, dry vermouth",
    abv: 30,
    servingSize: "single",
    priceGbp: 10.0,
  },

  // ── The Old Pack Horse — venue-1yylwyg (Edwardian, Chiswick) ───────────────
  {
    id: "drink-packhorse-wine",
    venueId: "venue-1yylwyg",
    category: "wine",
    name: "Sauvignon Blanc",
    region: "Marlborough, New Zealand",
    style: "White, aromatic",
    abv: 12.5,
    servingSize: "175ml glass",
    priceGbp: 7.0,
  },
  {
    id: "drink-packhorse-whisky",
    venueId: "venue-1yylwyg",
    category: "whisky",
    name: "Monkey Shoulder",
    producer: "William Grant & Sons",
    region: "Speyside",
    style: "Blended malt",
    abv: 40,
    servingSize: "25ml",
    priceGbp: 5.4,
  },
  {
    id: "drink-packhorse-gin",
    venueId: "venue-1yylwyg",
    category: "gin",
    name: "Bombay Sapphire",
    producer: "Bombay",
    region: "England",
    style: "London Dry",
    abv: 40,
    servingSize: "25ml + tonic",
    priceGbp: 7.2,
  },
  {
    id: "drink-packhorse-cocktail",
    venueId: "venue-1yylwyg",
    category: "cocktail",
    name: "High Road Espresso Martini",
    style: "Vodka, coffee, liqueur",
    abv: 20,
    servingSize: "single",
    priceGbp: 9.8,
  },

  // ── The Sun Tavern — venue-ndc1rt (East End, Bethnal Green) ────────────────
  {
    id: "drink-suntavern-wine",
    venueId: "venue-ndc1rt",
    category: "wine",
    name: "Côtes du Rhône",
    region: "Rhône, France",
    style: "Red, peppery",
    abv: 14,
    servingSize: "175ml glass",
    priceGbp: 6.8,
  },
  {
    id: "drink-suntavern-whisky",
    venueId: "venue-ndc1rt",
    category: "whisky",
    name: "Green Spot",
    producer: "Mitchell & Son",
    region: "Ireland",
    style: "Single pot still",
    abv: 40,
    servingSize: "25ml",
    priceGbp: 6.8,
  },
  {
    id: "drink-suntavern-gin",
    venueId: "venue-ndc1rt",
    category: "gin",
    name: "East London Liquor Co. Dry",
    producer: "East London Liquor Company",
    region: "Bow, London",
    style: "London Dry",
    abv: 40,
    servingSize: "25ml + tonic",
    priceGbp: 7.5,
  },
  {
    id: "drink-suntavern-cocktail",
    venueId: "venue-ndc1rt",
    category: "cocktail",
    name: "Bethnal Green Daiquiri",
    style: "Rum, lime, sugar",
    abv: 24,
    servingSize: "single",
    priceGbp: 9.0,
  },
];

// The full seeded menu, provenance-stamped. Exported as Drink[] so callers get
// the canonical shape (no separate seed type leaks out).
export const demoDrinks: Drink[] = seeds.map((seed) => ({
  id: seed.id,
  category: seed.category,
  name: seed.name,
  producer: seed.producer,
  abv: seed.abv,
  alcoholType: alcoholTypeForDrink({ name: seed.name, abv: seed.abv }),
  style: seed.style,
  region: seed.region,
  servingSize: seed.servingSize,
  priceGbp: seed.priceGbp,
  provenance: { ...SEED_PROVENANCE },
}));

// Map of venueId → the demo id it belongs to, kept for the pin test.
export const demoDrinkVenueIds: string[] = Array.from(
  new Set(seeds.map((seed) => seed.venueId)),
);

/** The seeded demo drinks for one venue — merged after legacy beer in the read
 *  path (lib/drinkMenu.ts). Empty array for a venue with no seeded menu. */
export function demoDrinksFor(venueId: string): Drink[] {
  return demoDrinks.filter((drink) =>
    seedVenueId(drink.id) === venueId,
  );
}

// Resolve a demo drink id back to its venueId via the seed table (the id itself
// doesn't encode the venue, so we look it up).
const idToVenue = new Map(seeds.map((seed) => [seed.id, seed.venueId]));
function seedVenueId(drinkId: string): string | undefined {
  return idToVenue.get(drinkId);
}
