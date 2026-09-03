// Runtime loader for the observed price-update overlays.
//
// public/data/{drink,food}_price_updates/latest.json are ~2 MB and ~1.5 MB of
// JSON. They used to be statically imported by lib/venueMenu.ts /
// lib/venueFoodMenu.ts, which bundled BOTH files into the map's first-load
// client JS (a single ~3 MB chunk, the largest in the app). They are already
// public assets, so the browser can fetch them as data instead of shipping
// them as parsed-and-evaluated JavaScript.
//
// This module fetches each file once per session (module-level promise cache,
// shared across every venue sheet open), parses through the same validating
// parsers as before, and fails soft to [] — a missing overlay renders the
// seed/app-dataset menu, never an error. Server/test callers that want the
// overlays pass them to the menu seams explicitly.

import {
  parseDrinkPriceUpdates,
  type DrinkPriceUpdate,
} from "@/lib/drinkPriceUpdates";
import {
  parseFoodPriceUpdates,
  type FoodPriceUpdate,
} from "@/lib/foodPriceUpdates";
import { fetchPublicJson, hasPublicJsonRows } from "@/lib/publicJsonLoader";

function generatedAtOf(raw: unknown): number {
  const stamp = Date.parse(
    String((raw as { generatedAt?: unknown })?.generatedAt ?? ""),
  );
  return Number.isFinite(stamp) ? stamp : Date.now();
}

let drinkPromise: Promise<DrinkPriceUpdate[]> | null = null;
let foodPromise: Promise<FoodPriceUpdate[]> | null = null;

export function loadDrinkPriceUpdates(): Promise<DrinkPriceUpdate[]> {
  drinkPromise ??= fetchPublicJson("/data/drink_price_updates/latest.json").then(
    (raw) => {
      if (raw === null || !hasPublicJsonRows(raw, "updates")) {
        drinkPromise = null;
        return [];
      }
      return parseDrinkPriceUpdates(raw, generatedAtOf(raw));
    },
  );
  return drinkPromise;
}

export function loadFoodPriceUpdates(): Promise<FoodPriceUpdate[]> {
  foodPromise ??= fetchPublicJson("/data/food_price_updates/latest.json").then(
    (raw) => {
      if (raw === null || !hasPublicJsonRows(raw, "updates")) {
        foodPromise = null;
        return [];
      }
      return parseFoodPriceUpdates(raw, generatedAtOf(raw));
    },
  );
  return foodPromise;
}

/** Test seam: forget the cached fetches. */
export function resetPriceUpdatesLoader(): void {
  drinkPromise = null;
  foodPromise = null;
}
