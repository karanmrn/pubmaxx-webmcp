// Static JSON overlay for curated menu / order / category-tile links.
// Applied on the venue DETAIL path only — never on the slim map index.
// Missing or malformed files degrade to an empty map (never throw).

import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { firstHttp, firstHttps } from "@/lib/httpUrl";
import type { Venue } from "@/lib/venues";
import { VENUE_MENU_ENRICHMENT_FILE } from "@/lib/venueMenuEnrichmentFile.mjs";

export type VenueMenuCategoryTile = {
  id: string;
  label: string;
  hint?: string;
  href?: string;
  imageUrl?: string;
};

export type VenueMenuEnrichmentRecord = {
  source?: string;
  menuUrl?: string;
  orderUrl?: string;
  bookingUrl?: string;
  allergyInfoUrl?: string;
  categoryTiles?: VenueMenuCategoryTile[];
};

export type VenueMenuEnrichmentFile = {
  version: 1;
  venues: Record<string, VenueMenuEnrichmentRecord>;
};

const DEFAULT_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  VENUE_MENU_ENRICHMENT_FILE,
);

let enrichmentPath = DEFAULT_PATH;
let cachedIndex: ReadonlyMap<string, VenueMenuEnrichmentRecord> | undefined;

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  );
}

function sanitizeCategoryTiles(
  tiles: VenueMenuCategoryTile[] | undefined,
): VenueMenuCategoryTile[] | undefined {
  if (!Array.isArray(tiles)) return undefined;
  const out: VenueMenuCategoryTile[] = [];
  for (const tile of tiles) {
    if (!tile || typeof tile !== "object") continue;
    const id = typeof tile.id === "string" ? tile.id.trim() : "";
    const label = typeof tile.label === "string" ? tile.label.trim() : "";
    if (!id || !label) continue;
    const href = firstHttps(tile.href) || undefined;
    const imageUrl = firstHttp(tile.imageUrl) || undefined;
    const hint =
      typeof tile.hint === "string" && tile.hint.trim() ? tile.hint.trim() : undefined;
    out.push({
      id,
      label,
      ...(hint ? { hint } : {}),
      ...(href ? { href } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Load the curated enrichment index. Defensive: missing/malformed → empty Map.
 */
export async function loadVenueMenuEnrichmentIndex(): Promise<
  ReadonlyMap<string, VenueMenuEnrichmentRecord>
> {
  if (cachedIndex) return cachedIndex;
  try {
    const raw = await readFile(
      /* turbopackIgnore: true */ enrichmentPath,
      "utf8",
    );
    const parsed = JSON.parse(raw) as VenueMenuEnrichmentFile;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      typeof parsed.venues !== "object" ||
      parsed.venues === null ||
      Array.isArray(parsed.venues)
    ) {
      // Malformed but readable — don't permanently cache so a corrected file
      // can be picked up on the next call without a server restart.
      return new Map();
    }
    const map = new Map<string, VenueMenuEnrichmentRecord>();
    for (const [id, record] of Object.entries(parsed.venues)) {
      if (record && typeof record === "object" && !Array.isArray(record)) {
        map.set(id, record);
      }
    }
    cachedIndex = map;
    return cachedIndex;
  } catch {
    // Transient read/parse error — don't cache so the next request retries.
    return new Map();
  }
}

/** Merge a single enrichment record onto a venue (pure; never invents URLs). */
export function applyVenueMenuEnrichment(
  venue: Venue,
  record?: VenueMenuEnrichmentRecord | null,
): Venue {
  if (!record) return venue;

  const bookingLink = firstHttp(record.bookingUrl, venue.bookingLink);
  const menuUrl = firstHttps(record.menuUrl, venue.menuUrl) || undefined;
  const orderUrl = firstHttp(record.orderUrl) || undefined;
  const allergyInfoUrl = firstHttp(record.allergyInfoUrl) || undefined;
  const categoryTiles = sanitizeCategoryTiles(record.categoryTiles);

  const next = { ...venue };
  delete next.menuUrl;
  return {
    ...next,
    bookingLink,
    ...(menuUrl ? { menuUrl } : {}),
    ...(orderUrl ? { orderUrl } : {}),
    ...(allergyInfoUrl ? { allergyInfoUrl } : {}),
    ...(categoryTiles ? { categoryTiles } : {}),
  };
}

/** Detail-path helper: load index + apply for this venue id. */
export async function enrichVenueForDetail(venue: Venue): Promise<Venue> {
  const index = await loadVenueMenuEnrichmentIndex();
  return applyVenueMenuEnrichment(venue, index.get(venue.id));
}

export function resetVenueMenuEnrichmentCacheForTests(): void {
  if (!isTestRuntime()) return;
  cachedIndex = undefined;
  enrichmentPath = DEFAULT_PATH;
}

export function setVenueMenuEnrichmentPathForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedIndex = undefined;
  enrichmentPath = file;
}
