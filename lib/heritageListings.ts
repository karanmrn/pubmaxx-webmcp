// Server-side reader for the listed-building dataset built from Historic
// England's National Heritage List for England (NHLE) — see
// scripts/build_heritage_listings.mjs. The file is committed and keyed by the
// SAME venue-… id the app links by (stableVenueIdFromKey), so a lookup is exact
// per pub, never by ambiguous name — two different "The Crown" pubs can never
// borrow each other's listing.
//
// Provenance-honest: every field is copied from the committed dataset, which is
// itself a conservative match against the official register. Nothing is
// invented here; a missing file or unknown venue degrades to null.
//
// Node-backed (reads the shipped JSON) — import only from server code, like
// lib/heritage. The client bundle uses lib/heritageFacts for the wire shape.

import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

export type ListedBuilding = {
  /** Official NHLE list entry number (the stable public identifier). */
  listEntry: number;
  /** Statutory grade: "I", "II*" or "II". */
  grade: string;
  /** Year the building was DESIGNATED (never a construction date). */
  listedYear: number | null;
  /** Human-readable official listing name, title-cased. */
  name: string;
  /** Plain one-line fact, e.g. "Grade II listed public house.". */
  fact: string;
  /** Canonical list-entry URL on historicengland.org.uk (attribution + proof). */
  url: string;
  /** Metres between the pub and the listed point (match confidence). */
  distanceM: number;
};

const LISTINGS_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "heritage_listings.json",
);

// Module-level cache — the file is immutable at runtime, so read it once.
let cache: Record<string, ListedBuilding> | null = null;

async function loadListings(): Promise<Record<string, ListedBuilding>> {
  if (cache) return cache;
  try {
    const raw = await readFile(LISTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { listings?: unknown };
    cache =
      parsed && typeof parsed.listings === "object" && parsed.listings
        ? (parsed.listings as Record<string, ListedBuilding>)
        : {};
  } catch {
    cache = {};
  }
  return cache;
}

// The listed-building record for a venue id, or null when the pub is not on the
// list (the common case — most pubs are not listed, and that is correct).
export async function getListedBuilding(
  venueId: string | undefined,
): Promise<ListedBuilding | null> {
  if (!venueId) return null;
  const listings = await loadListings();
  const record = listings[venueId];
  if (!record || typeof record.fact !== "string" || !record.fact.trim()) {
    return null;
  }
  return record;
}

// Test-only: drop the in-memory cache between cases.
export function __resetListedBuildingCache(): void {
  cache = null;
}
