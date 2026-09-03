import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { getCity, type CityId } from "@/lib/cities";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

type SlimRow = Record<string, unknown>;

const cache = new Map<CityId, ConciergeVenue[]>();
const inflight = new Map<CityId, Promise<ConciergeVenue[]>>();

function bool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function optionalBool(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] as boolean : undefined;
}

function toVenue(value: unknown): ConciergeVenue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as SlimRow;
  if (typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name) return null;
  // Non-pub venues carry type-specific anchor prices (a cocktail, a doner),
  // not pint prices. Concierge/plan surfaces reason in pints, so they must
  // never see these rows.
  if (row.kind !== undefined && row.kind !== "pub") return null;
  if (typeof row.lat !== "number" || !Number.isFinite(row.lat) || typeof row.lng !== "number" || !Number.isFinite(row.lng)) return null;
  if (typeof row.borough !== "string") return null;
  if (row.cheapestPrice !== null && (typeof row.cheapestPrice !== "number" || !Number.isFinite(row.cheapestPrice))) return null;
  const hints = row.filterHints && typeof row.filterHints === "object" && !Array.isArray(row.filterHints)
    ? row.filterHints as Record<string, unknown>
    : {};
  const amenities = hints.amenities && typeof hints.amenities === "object" && !Array.isArray(hints.amenities)
    ? hints.amenities as Record<string, unknown>
    : {};
  const curation = hints.curation && typeof hints.curation === "object" && !Array.isArray(hints.curation)
    ? hints.curation as Record<string, unknown>
    : {};
  const nonAlcoholic = optionalBool(amenities, "nonAlcoholic");

  return {
    id: row.id,
    name: row.name,
    area: row.borough,
    lat: row.lat,
    lng: row.lng,
    cheapestPrice: row.cheapestPrice as number | null,
    amenities: {
      beerGarden: bool(amenities, "beerGarden"),
      cocktails: bool(amenities, "cocktails"),
      food: bool(amenities, "food"),
      liveSports: bool(amenities, "liveSports"),
      liveMusic: bool(amenities, "liveMusic"),
      ...(nonAlcoholic === undefined ? {} : { nonAlcoholic }),
    },
    nearWater: bool(curation, "nearWater"),
    hasStory: bool(curation, "hasStory"),
    canonical: hints.canonical === true,
    ...(typeof hints.searchText === "string" ? { searchText: hints.searchText } : {}),
    // Future datasets may carry placements. Preserve only the exclusion flag;
    // never pass placement metadata into ranking or the response.
    ...(row.promoted === true || hints.promoted === true ? { promoted: true } : {}),
  };
}

/** Read and defensively normalise the server-owned city venue index. */
export async function loadConciergeVenues(cityId: CityId): Promise<ConciergeVenue[]> {
  const hit = cache.get(cityId);
  if (hit) return hit;
  const pending = inflight.get(cityId);
  if (pending) return pending;

  const load = (async () => {
    try {
      const publicPath = getCity(cityId).slimVenuesPath.replace(/^\//, "");
      const raw = await readFile(
        path.join(
          /* turbopackIgnore: true */ process.cwd(),
          "public",
          publicPath,
        ),
        "utf8",
      );
      const parsed: unknown = JSON.parse(raw);
      const rows = rowsFromSlimPayload(parsed) ?? [];
      const venues = rows.map(toVenue).filter((venue): venue is ConciergeVenue => venue !== null);
      cache.set(cityId, venues);
      return venues;
    } catch {
      // Missing/corrupt data must degrade to an honest empty result, never 500.
      return [];
    }
  })();
  inflight.set(cityId, load);
  try {
    return await load;
  } finally {
    if (inflight.get(cityId) === load) inflight.delete(cityId);
  }
}
