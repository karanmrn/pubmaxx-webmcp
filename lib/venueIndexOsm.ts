import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { canonicalOsmId } from "@/lib/harvestFold";
import { cityVenueIdForPub } from "@/lib/cityVenueId.mjs";
import { outerLondonOwnerForPub } from "@/lib/outerLondonOwnership.mjs";
import { UK_OSM_PUBS_FILE } from "@/lib/ukOsmPubsFile.mjs";
import {
  lookupCanonicalVenueFromIndex,
  readCityVenueIndex,
  type CanonicalVenueLookup,
  type IndexedVenue,
} from "@/lib/venueIndex";

const cityOsmCache = new Map<string, Map<string, IndexedVenue>>();

async function attachCityOsmIds(
  cityId: string,
  index: Map<string, IndexedVenue>,
): Promise<boolean> {
  try {
    const sourcePath =
      cityId === "london"
        ? path.join(process.cwd(), UK_OSM_PUBS_FILE)
        : path.join(process.cwd(), "data", "cities", cityId, "osm_pubs.json");
    const raw = await fs.readFile(/* turbopackIgnore: true */ sourcePath, "utf8");
    const pubs = JSON.parse(raw)?.pubs;
    if (!Array.isArray(pubs)) return false;
    const londonVenues =
      cityId === "london"
        ? [...index.values()].map(({ venue }) => ({
            id: venue.id,
            name: venue.name,
            lat: venue.lat,
            lng: venue.lng,
          }))
        : [];
    for (const pub of pubs) {
      const venueId =
        cityId === "london"
          ? pub?.curatedRef?.source === "curated-london-slim" &&
            typeof pub.curatedRef.id === "string"
            ? pub.curatedRef.id
            : pub?.curatedRef?.source === "outer-london-osm-seed"
              ? outerLondonOwnerForPub(pub, londonVenues)
              : ""
          : cityVenueIdForPub(cityId, pub);
      if (typeof pub?.osmId !== "string") continue;
      const osmId = canonicalOsmId(pub.osmId);
      if (!venueId || !osmId) continue;
      const entry = index.get(venueId);
      if (entry) {
        const osmIds = entry.venue.osmIds ?? [];
        if (!osmIds.includes(osmId)) osmIds.push(osmId);
        entry.venue.osmIds = osmIds;
        if (!entry.venue.osmId) entry.venue.osmId = osmId;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function getCityVenueIndex(
  city: { id: string; slimVenuesPath: string },
): Promise<Map<string, IndexedVenue> | null> {
  const publicPath = city.slimVenuesPath;
  const existing = cityOsmCache.get(publicPath);
  if (existing) return existing;
  const baseIndex = await readCityVenueIndex(city);
  if (!baseIndex) return null;
  const index = new Map<string, IndexedVenue>();
  for (const [id, entry] of baseIndex) {
    index.set(id, { venue: { ...entry.venue }, slimVenue: entry.slimVenue });
  }
  if (!(await attachCityOsmIds(city.id, index))) return null;
  cityOsmCache.set(publicPath, index);
  return index;
}

export function resetVenueOsmIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cityOsmCache.clear();
  }
}

export async function lookupCanonicalVenueWithOsm(
  id: string,
): Promise<CanonicalVenueLookup> {
  return lookupCanonicalVenueFromIndex(id, getCityVenueIndex);
}
