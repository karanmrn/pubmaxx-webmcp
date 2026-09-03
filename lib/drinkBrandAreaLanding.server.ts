import "server-only";

import {
  buildDrinkBrandAreaLanding,
  listDrinkBrandAreaLandings,
  listDrinkBrandAreaLandingsForBrand,
  type DrinkBrandAreaLanding,
} from "@/lib/drinkBrandAreaLanding";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { pricedLandingJsonLd, type PricedLandingJsonLdNode } from "@/lib/pricedLanding";

export function drinkBrandAreaLandingRoute(landing: DrinkBrandAreaLanding): string {
  return `/area/${encodeURIComponent(landing.areaSlug)}/drink/${encodeURIComponent(landing.brandSlug)}`;
}

export async function loadDrinkBrandAreaLandings(): Promise<DrinkBrandAreaLanding[]> {
  return listDrinkBrandAreaLandings(await loadPintPriceLandingVenues());
}

export async function loadDrinkBrandAreaLandingsForBrand(
  brandSlug: string,
): Promise<DrinkBrandAreaLanding[]> {
  return listDrinkBrandAreaLandingsForBrand(
    brandSlug,
    await loadPintPriceLandingVenues(),
  );
}

export async function loadDrinkBrandAreaLanding(
  areaSlug: string,
  brandSlug: string,
): Promise<DrinkBrandAreaLanding | null> {
  return buildDrinkBrandAreaLanding(
    areaSlug,
    brandSlug,
    await loadPintPriceLandingVenues(),
  );
}

// The parent crumb is the brand's own London page, never `/area/<slug>`: that
// family is held (captain decision, see specs/governed-priced-landings/PRODUCT.md),
// so the path exists as a segment and nothing renders at it.
export function drinkBrandAreaLandingJsonLd(
  landing: DrinkBrandAreaLanding,
): PricedLandingJsonLdNode[] {
  return pricedLandingJsonLd({
    breadcrumb: [
      { name: "Map", path: "/map" },
      { name: landing.brandLabel, path: `/drink/${encodeURIComponent(landing.brandSlug)}` },
      {
        name: `${landing.brandLabel} in ${landing.areaName}`,
        path: drinkBrandAreaLandingRoute(landing),
      },
    ],
    listName: `Cheapest ${landing.brandLabel} pints in ${landing.areaName}`,
    rows: landing.rows,
  });
}
