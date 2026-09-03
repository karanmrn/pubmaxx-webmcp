// UK city rivalry leaderboard — ranks cities by community energy, not fake
// price catalogues. Score = demo Pint Drops × 3 + curated crawl packs × 5 +
// min(venues, 200) / 10. Organic drop counts are never invented: only demo
// seeds that already ship (London + Manchester) contribute drop energy;
// Glasgow and other cities stay at 0 until seeded.

import "server-only";

import { readFileSync } from "fs";
import path from "path";

import { CITIES, listEnabledCities, type CityId } from "@/lib/cities";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
import { demoPintDropsForCity } from "@/lib/pintDropSeeds";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

export type CityRivalryEntry = {
  cityId: CityId;
  displayName: string;
  dropCount: number;
  crawlPackCount: number; // curated crawls shipped
  venueCount: number; // slim venues
  score: number; // drops*3 + crawls*5 + min(venues,200)/10
  tagline: string;
};

export type CityRivalryInput = {
  cityId: CityId;
  dropCount: number;
  crawlPackCount: number;
  venueCount: number;
  tagline: string;
  displayName?: string;
};

/** Weighted energy score — pure, testable. */
export function rivalryScore(input: {
  dropCount: number;
  crawlPackCount: number;
  venueCount: number;
}): number {
  const drops = Math.max(0, input.dropCount);
  const crawls = Math.max(0, input.crawlPackCount);
  const venues = Math.max(0, input.venueCount);
  return drops * 3 + crawls * 5 + Math.min(venues, 200) / 10;
}

/**
 * Rank injected city rows by score (desc), then display name.
 * Pure — no filesystem. Prefer this in unit tests.
 */
export function rankCities(input: CityRivalryInput[]): CityRivalryEntry[] {
  return input
    .map((row) => {
      const displayName = row.displayName ?? CITIES[row.cityId]?.displayName ?? row.cityId;
      return {
        cityId: row.cityId,
        displayName,
        dropCount: Math.max(0, row.dropCount),
        crawlPackCount: Math.max(0, row.crawlPackCount),
        venueCount: Math.max(0, row.venueCount),
        score: rivalryScore(row),
        tagline: row.tagline,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.displayName.localeCompare(b.displayName);
    });
}

/** Resolve slim JSON path on disk from a CityConfig.slimVenuesPath. */
export function slimVenuesDiskPath(slimVenuesPath: string): string {
  const rel = slimVenuesPath.replace(/^\//, "");
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "public",
    rel.replace(/^data\//, "data/"),
  );
}

/**
 * Count rows in a slim venues JSON array. Returns 0 on missing/malformed files.
 * Accepts an optional override map for tests (cityId → count).
 */
export function countSlimVenues(
  cityId: CityId,
  overrides?: Partial<Record<CityId, number>>,
): number {
  if (overrides && cityId in overrides) {
    return overrides[cityId] ?? 0;
  }
  const city = CITIES[cityId];
  if (!city) return 0;
  try {
    const file = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "public",
      city.slimVenuesPath.replace(/^\//, ""),
    );
    const raw = readFileSync(
      /* turbopackIgnore: true */ file,
      "utf8",
    );
    return rowsFromSlimPayload(JSON.parse(raw))?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Demo Pint Drop count for a city — seeds only, never invented organics.
 * London + Manchester ship seeds; Glasgow and others are 0 until seeded.
 */
export function demoDropCountForCity(cityId: CityId): number {
  return demoPintDropsForCity(cityId).length;
}

/**
 * Curated crawl packs actually shipped for a city. Browse-only cities
 * (e.g. Bath) return an empty catalog from `curatedCrawlsForCity`.
 */
export function crawlPackCountForCity(cityId: CityId): number {
  switch (cityId) {
    case "london":
    case "manchester":
    case "glasgow":
    case "liverpool":
    case "oxford":
    case "cambridge":
    case "durham":
    case "bristol":
      return curatedCrawlsForCity(cityId).length;
    default:
      return 0;
  }
}

/**
 * Build the live rivalry snapshot from demo seeds, curated crawl packs, and
 * slim venue lengths. Optional venueOverrides keep Node filesystem out of tests.
 */
export function buildCityRivalrySnapshot(
  venueOverrides?: Partial<Record<CityId, number>>,
): CityRivalryEntry[] {
  const rows: CityRivalryInput[] = listEnabledCities().map((city) => ({
    cityId: city.id,
    displayName: city.displayName,
    dropCount: demoDropCountForCity(city.id),
    crawlPackCount: crawlPackCountForCity(city.id),
    venueCount: countSlimVenues(city.id, venueOverrides),
    tagline: city.tagline,
  }));
  return rankCities(rows);
}

/** Alias matching the product brief. */
export function cityRivalryLeaderboard(
  venueOverrides?: Partial<Record<CityId, number>>,
): CityRivalryEntry[] {
  return buildCityRivalrySnapshot(venueOverrides);
}
