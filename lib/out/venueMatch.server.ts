import "server-only";

import { venueIdMatchesCity } from "@/lib/cityVenueIds";
import type { CityId } from "@/lib/cities";
import { buildOutVenueMatchIndex, type OutVenueMatchIndex } from "@/lib/out/venueMatch";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { getVenueIndexSnapshot, type VenueIndexSnapshot } from "@/lib/venueIndex";

const built = new Map<CityId, OutVenueMatchIndex>();
const building = new Map<CityId, Promise<OutVenueMatchIndex | null>>();
let snapshotPromise: Promise<VenueIndexSnapshot> | null = null;

async function loadSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = getVenueIndexSnapshot().catch((error) => {
      snapshotPromise = null;
      throw error;
    });
  }
  const snapshot = await snapshotPromise;
  if (!snapshot.complete) snapshotPromise = null;
  return snapshot;
}

async function buildCityIndex(city: CityId): Promise<OutVenueMatchIndex | null> {
  const snapshot = await loadSnapshot();
  if (!snapshot.loadedCities.has(city)) return null;
  return buildOutVenueMatchIndex(
    [...snapshot.index.values()].filter(
      (venue) => venueIdMatchesCity(venue.id, city) && isPubVenueKind(venue.kind),
    ),
  );
}

export function loadOutVenueMatchIndex(city: CityId = "london"): Promise<OutVenueMatchIndex | null> {
  const held = built.get(city);
  if (held) return Promise.resolve(held);
  const existing = building.get(city);
  if (existing) return existing;

  const promise = buildCityIndex(city).then((index) => {
    if (index) built.set(city, index);
    return index;
  });
  building.set(city, promise);
  return promise.finally(() => {
    if (building.get(city) === promise) building.delete(city);
  });
}
