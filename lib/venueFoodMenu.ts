import {
  applyFoodPriceUpdatesToMenu,
  type FoodPriceUpdate,
} from "@/lib/foodPriceUpdates";
import { isFoodCategory, type FoodItem } from "@/lib/food";
import { venueMenuLookupKeys, type VenueMenuVenue } from "@/lib/venueMenu";

// Like lib/venueMenu.ts, the observed food-price updates
// (public/data/food_price_updates/latest.json, ~1.5 MB) are loaded at runtime
// via lib/priceUpdatesLoader.ts and passed in, never statically imported —
// a static import bundled the whole file into the map's client JS.

function applyFoodUpdatesForKeys(
  base: FoodItem[],
  keys: string[],
  updates: FoodPriceUpdate[],
): FoodItem[] {
  if (keys.length === 0) return base;
  const keySet = new Set(keys);
  const scoped = updates.filter((u) => keySet.has(u.venueKey));
  if (scoped.length === 0) return base;
  const canonical = keys[0];
  const remapped = scoped.map((u) =>
    u.venueKey === canonical ? u : { ...u, venueKey: canonical },
  );
  return applyFoodPriceUpdatesToMenu(canonical, base, remapped);
}

function anchorFoodItem(venue: VenueMenuVenue): FoodItem[] {
  if (
    venue.kind !== "restaurant" ||
    typeof venue.anchorLabel !== "string" ||
    !venue.anchorLabel.trim() ||
    !isFoodCategory(venue.anchorCourse) ||
    typeof venue.cheapestPrice !== "number" ||
    !Number.isFinite(venue.cheapestPrice) ||
    typeof venue.anchorObservedAt !== "string" ||
    !venue.anchorObservedAt.trim() ||
    typeof venue.anchorSourceUrl !== "string" ||
    !venue.anchorSourceUrl.startsWith("https://")
  ) {
    return [];
  }
  return [
    {
      id: `anchor-${venue.id}`,
      name: venue.anchorLabel,
      category: venue.anchorCourse,
      priceGbp: venue.cheapestPrice,
      provenance: {
        source: "Official venue menu",
        licence: "venue menu",
        observedAt: venue.anchorObservedAt,
      },
      source: venue.anchorSourceUrl,
    },
  ];
}

/** Food menu for the venue inspector, seeded by a sourced restaurant anchor. */
export function venueFoodMenuForInspector(
  venue: VenueMenuVenue,
  updates: FoodPriceUpdate[] = [],
): FoodItem[] {
  return applyFoodUpdatesForKeys(
    anchorFoodItem(venue),
    venueMenuLookupKeys(venue),
    updates,
  );
}
