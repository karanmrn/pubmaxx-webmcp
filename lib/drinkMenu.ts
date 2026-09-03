import {
  legacyPricesToDrinks,
  type Drink,
  type LegacyPintPrice,
} from "@/lib/drinks";
import { demoContentEnabled } from "@/lib/demoContent";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { demoDrinksFor } from "@/lib/drinkSeeds";

// The venue Menu read path (PRD E1). ONE pure function that composes a venue's
// full drink menu from two honest sources, WITHOUT touching the pint-drop store
// or lib/venues.ts:
//   1. the venue's existing legacy pint prices (VenuePrice[]) viewed as beer
//      Drinks — this is how today's beer shows in the menu unchanged;
//   2. the seeded demo menu for the curated heritage pubs (a wine, a whisky, a
//      gin, a cocktail), provenance-tagged {source:"seed"}.
//
// Provenance never flattens: each drink keeps its own {source, licence,
// observedAt}, so a seeded demo pour can never masquerade as a first-party
// price. Deterministic order (beer first — the app's spine) so the caller can
// hand the result straight to groupDrinksByCategory for the Menu UI.
//
// Pure + browser-safe: takes the legacy prices as a prop (VenuePrice[] satisfies
// LegacyPintPrice[]) rather than reaching into a store, so it composes on the
// server or the client with no fetch.

// Registry-owned collection stamp for legacy beer rows. App dataset is a
// first-party price on record, not a live feed; update overlays keep their own
// per-observation stamps.
export function venueDrinkMenu(
  venueId: string,
  legacyPrices: LegacyPintPrice[] = [],
  seeds: (id: string) => Drink[] = demoDrinksFor,
): Drink[] {
  const beer = legacyPricesToDrinks(
    legacyPrices,
    PINT_DATASET_OBSERVED_AT.toISOString(),
  );
  const seeded = demoContentEnabled() ? seeds(venueId) : [];
  // Beer (legacy pints) first, then the seeded non-beer menu. Dedupe by id so a
  // re-run or an overlapping source never doubles a row.
  const seen = new Set<string>();
  const merged: Drink[] = [];
  for (const drink of [...beer, ...seeded]) {
    if (seen.has(drink.id)) continue;
    seen.add(drink.id);
    merged.push(drink);
  }
  return merged;
}

// True when a venue has any menu BEYOND its pint rows (i.e. a seeded/real
// non-beer drink). The Menu UI uses this to decide the "just pints so far"
// empty state versus a full grouped menu. Pure.
export function hasMenuBeyondPints(drinks: Drink[]): boolean {
  return drinks.some((drink) => drink.category !== "beer");
}
