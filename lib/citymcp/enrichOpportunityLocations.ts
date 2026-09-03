// Attach lat/lng to things_to_do opportunities that only have a place name.
// Live CityMCP often omits `place.location` / `place.id`; we resolve them via
// `search_places` so map pins can render. Fail-soft: any search error skips
// that row and never fails the parent request.

import {
  searchCityPlaces,
  type CityMcpCallOptions,
  type ThingsToDoOpportunity,
} from "@/lib/citymcp/client";

const DEFAULT_CAP = 8;
const CONCURRENCY = 2;

export type EnrichOpportunityLocationsOpts = CityMcpCallOptions & {
  /** Max opportunities to attempt enrichment for (default 8). */
  cap?: number;
};

function missingLocation(op: ThingsToDoOpportunity): boolean {
  const loc = op.place?.location;
  if (
    loc &&
    typeof loc.lat === "number" &&
    typeof loc.lng === "number" &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lng)
  ) {
    return false;
  }
  return true;
}

/**
 * For each opportunity missing coordinates but having `place.name`, search
 * CityMCP places and attach the first hit's location (and id when present).
 * Processes at most `cap` candidates with concurrency 2.
 */
export async function enrichOpportunityLocations(
  opportunities: readonly ThingsToDoOpportunity[],
  opts: EnrichOpportunityLocationsOpts = {},
): Promise<ThingsToDoOpportunity[]> {
  const cap = opts.cap ?? DEFAULT_CAP;
  const out: ThingsToDoOpportunity[] = opportunities.map((op) => ({
    ...op,
    ...(op.place ? { place: { ...op.place } } : {}),
  }));

  const indices: number[] = [];
  for (let i = 0; i < out.length && indices.length < cap; i++) {
    const op = out[i]!;
    if (missingLocation(op) && op.place?.name) {
      indices.push(i);
    }
  }

  if (indices.length === 0) return out;

  let next = 0;
  async function worker(): Promise<void> {
    while (next < indices.length) {
      const idx = indices[next++]!;
      const op = out[idx]!;
      const name = op.place!.name!;
      const area = op.place?.area ?? "";
      const query = `${name} ${area}`.trim();
      try {
        const places = await searchCityPlaces(query, {
          limit: 1,
          timeoutMs: opts.timeoutMs,
          endpoint: opts.endpoint,
          fetchImpl: opts.fetchImpl,
        });
        const hit = places[0];
        const loc = hit?.location;
        if (
          !hit ||
          !loc ||
          typeof loc.lat !== "number" ||
          typeof loc.lng !== "number" ||
          !Number.isFinite(loc.lat) ||
          !Number.isFinite(loc.lng)
        ) {
          continue;
        }
        out[idx] = {
          ...op,
          place: {
            ...op.place,
            ...(hit.id ? { id: hit.id } : {}),
            location: { lat: loc.lat, lng: loc.lng },
          },
        };
      } catch {
        // Skip this opportunity; leave it without coords.
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, indices.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return out;
}
