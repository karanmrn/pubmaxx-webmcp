// Client-safe scraped-pub types + drink-accent helpers.
// Server listing lives in lib/scrapedPubs.server.ts (fs + enrichment join).

import {
  DRINK_CATEGORIES,
  type DrinkCategory,
} from "@/lib/drinks";

export type ScrapedPubSourceId =
  | "greene-king.co.uk"
  | "nicholsonspubs.co.uk"
  | "youngs.co.uk"
  | "other";

export type ScrapedPub = {
  id: string;
  name: string;
  borough: string;
  source: ScrapedPubSourceId;
  sourceLabel: string;
  menuUrl?: string;
  bookingUrl?: string;
  /** Real scraped/menu photo when present (Greene King tiles, venue image). */
  photoUrl?: string;
  /** Primary drink picture accent for the card art. */
  drinkAccent: DrinkCategory;
  /** Companion drink glyphs for a small shelf under the hero. */
  drinkShelf: DrinkCategory[];
  cheapestPrice: number | null;
  /** Nearest-station TfL fare zone (1–6), or null when unknown. */
  zone: number | null;
};

export const SCRAPED_SOURCE_LABELS: Record<ScrapedPubSourceId, string> = {
  "greene-king.co.uk": "Greene King",
  "nicholsonspubs.co.uk": "Nicholson's",
  "youngs.co.uk": "Young's",
  other: "Other",
};

const ACCENT_POOL: DrinkCategory[] = DRINK_CATEGORIES.filter(
  (category) => category !== "other",
);

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable drink picture accent from venue id — same pub always same drink. */
export function drinkAccentForVenue(venueId: string): DrinkCategory {
  return ACCENT_POOL[hashString(venueId) % ACCENT_POOL.length] ?? "beer";
}

/** Two companion accents (different from the primary) for the drink shelf. */
export function drinkShelfForVenue(
  venueId: string,
  primary: DrinkCategory = drinkAccentForVenue(venueId),
): DrinkCategory[] {
  const start = hashString(`shelf:${venueId}`) % ACCENT_POOL.length;
  const shelf: DrinkCategory[] = [];
  for (let i = 0; shelf.length < 2 && i < ACCENT_POOL.length; i += 1) {
    const next = ACCENT_POOL[(start + i) % ACCENT_POOL.length];
    if (next && next !== primary) shelf.push(next);
  }
  return shelf;
}

export function normaliseScrapedSource(source: string | undefined): ScrapedPubSourceId {
  const value = String(source ?? "")
    .trim()
    .toLowerCase();
  if (value.includes("greene")) return "greene-king.co.uk";
  if (value.includes("nicholson")) return "nicholsonspubs.co.uk";
  if (value.includes("young")) return "youngs.co.uk";
  return "other";
}

export function countScrapedPubsBySource(
  pubs: readonly ScrapedPub[],
): Record<ScrapedPubSourceId, number> {
  const counts: Record<ScrapedPubSourceId, number> = {
    "greene-king.co.uk": 0,
    "nicholsonspubs.co.uk": 0,
    "youngs.co.uk": 0,
    other: 0,
  };
  for (const pub of pubs) counts[pub.source] += 1;
  return counts;
}
