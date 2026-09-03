import "server-only";

// Server-only: join enrichment overlay + dataset into ScrapedPub[].
// Import from Server Components / route handlers only — uses node:fs.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { cache } from "react";

import { loadVenueMenuEnrichmentIndex } from "@/lib/venueMenuEnrichment";
import { proxiedVenueImageUrl } from "@/lib/venueImages";
import { firstHttp, firstHttps } from "@/lib/httpUrl";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import {
  drinkAccentForVenue,
  drinkShelfForVenue,
  normaliseScrapedSource,
  SCRAPED_SOURCE_LABELS,
  type ScrapedPub,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";

/** id → nearest-station fare zone, from the slim index (single source of truth). */
async function loadZonesById(): Promise<Map<string, number>> {
  const byId = new Map<string, number>();
  try {
    const file = path.join(process.cwd(), "public", "data", "venues_slim.json");
    const payload = JSON.parse(await readFile(file, "utf8")) as unknown;
    const rows = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { rows?: unknown }).rows)
        ? (payload as { rows: unknown[] }).rows
        : [];
    if (rows.length > 0) {
      for (const row of rows as { id?: unknown; zone?: unknown }[]) {
        if (typeof row.id === "string" && typeof row.zone === "number" && Number.isInteger(row.zone)) {
          byId.set(row.id, row.zone);
        }
      }
    }
  } catch {
    // No slim index → every scraped pub reads zone: null (honestly unknown).
  }
  return byId;
}

export type ScrapedPubsRead = {
  pubs: ScrapedPub[];
  complete: boolean;
};

/** All scraped enrichment pubs, newest sources first within name sort. */
async function readScrapedPubs(): Promise<ScrapedPubsRead> {
  const [index, venues, zonesById] = await Promise.all([
    loadVenueMenuEnrichmentIndex(),
    // The SHARED priced-venue index rather than a second parse of the same
    // 6.7 MB file: lib/venuePriceIndex.ts already holds exactly this grouping
    // for every other surface that needs it.
    getPricedVenues(),
    loadZonesById(),
  ]);
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const pubs: ScrapedPub[] = [];

  for (const [id, record] of index.entries()) {
    const venue = byId.get(id);
    const source = normaliseScrapedSource(record.source);
    const drinkAccent = drinkAccentForVenue(id);
    const tilePhoto = record.categoryTiles?.find((tile) => tile.imageUrl)?.imageUrl;
    const venuePhoto = venue ? proxiedVenueImageUrl(venue.imageUrl) : "";
    const photoUrl = proxiedVenueImageUrl(tilePhoto ?? "") || venuePhoto || undefined;

    pubs.push({
      id,
      name: venue?.name ?? id,
      borough: venue?.primaryBorough ?? "",
      source,
      sourceLabel: SCRAPED_SOURCE_LABELS[source],
      menuUrl: firstHttps(record.menuUrl) || undefined,
      bookingUrl: firstHttp(record.bookingUrl) || undefined,
      photoUrl,
      drinkAccent,
      drinkShelf: drinkShelfForVenue(id, drinkAccent),
      cheapestPrice: venue?.cheapestPrice ?? null,
      zone: zonesById.get(id) ?? null,
    });
  }

  const sourceRank: Record<ScrapedPubSourceId, number> = {
    "nicholsonspubs.co.uk": 0,
    "youngs.co.uk": 1,
    "greene-king.co.uk": 2,
    other: 3,
  };

  pubs.sort((a, b) => {
    const bySource = sourceRank[a.source] - sourceRank[b.source];
    if (bySource !== 0) return bySource;
    return a.name.localeCompare(b.name);
  });

  return {
    pubs,
    complete: index.size > 0 && venues.length > 0 && zonesById.size > 0,
  };
}

// Healthy inputs are bundled with the deployment and cannot change between two
// requests to one instance. Hold the promise so concurrent first requests share
// the 6.7 MB parse. A fail-soft read is incomplete and must leave the next
// request free to retry its dependency.
let cachedRead: Promise<ScrapedPubsRead> | null = null;

function memoisedRead(): Promise<ScrapedPubsRead> {
  if (cachedRead) return cachedRead;

  const attempt = readScrapedPubs().then(
    (read) => {
      if (!read.complete) cachedRead = null;
      return read;
    },
    (error: unknown) => {
      cachedRead = null;
      throw error;
    },
  );
  cachedRead = attempt;
  return attempt;
}

/**
 * Chains page read: pubs plus whether the bundled inputs answered completely.
 * Read once per instance, and once per request through React's cache as well,
 * so `generateMetadata` and the render share one read even when a degraded
 * answer has just dropped the instance cache for the next request to retry.
 */
export const readScrapedPubsForPage: () => Promise<ScrapedPubsRead> =
  cache(memoisedRead);
