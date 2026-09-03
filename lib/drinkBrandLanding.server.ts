import "server-only";

import {
  buildDrinkBrandLanding,
  listDrinkBrandLandings,
  type DrinkBrandLanding,
} from "@/lib/drinkBrandLanding";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { pricedLandingJsonLd, type PricedLandingJsonLdNode } from "@/lib/pricedLanding";

export async function loadDrinkBrandLandings(): Promise<DrinkBrandLanding[]> {
  return listDrinkBrandLandings(await loadPintPriceLandingVenues());
}

export async function loadDrinkBrandLanding(
  slug: string,
): Promise<DrinkBrandLanding | null> {
  return buildDrinkBrandLanding(slug, await loadPintPriceLandingVenues());
}

export function drinkBrandLandingJsonLd(
  landing: DrinkBrandLanding,
): PricedLandingJsonLdNode[] {
  return pricedLandingJsonLd({
    breadcrumb: [
      { name: "Map", path: "/map" },
      { name: landing.brandLabel, path: `/drink/${encodeURIComponent(landing.slug)}` },
    ],
    listName: `Cheapest ${landing.brandLabel} pints in London`,
    rows: landing.rows,
  });
}
