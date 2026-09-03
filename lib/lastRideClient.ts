import type { CityId } from "@/lib/cities";
import {
  lastRideFetchUrl,
  type LastRideResult,
} from "@/lib/lastRide";

const STABLE_CACHE_TTL_MS = 60_000;
const CLIENT_CACHE_LIMIT = 32;

export type LastRidePayload = Partial<LastRideResult> & { error?: string };
type CacheEntry = {
  expiresAt: number;
  promise: Promise<LastRidePayload>;
};

const stableResultCache = new Map<string, CacheEntry>();
const liveRequests = new Map<string, Promise<LastRidePayload>>();

function trimCache(): void {
  while (stableResultCache.size > CLIENT_CACHE_LIMIT) {
    const oldestKey = stableResultCache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    stableResultCache.delete(oldestKey);
  }
}

function fetchLastRide(url: string): Promise<LastRidePayload> {
  return fetch(url)
    .then((response) =>
      response.ok
        ? response.json()
        : Promise.reject(new Error(String(response.status))),
    )
    .then((data: LastRidePayload) => data);
}

function stablePayload(data: LastRidePayload): LastRidePayload {
  const stable = { ...data };
  delete stable.decision;
  stable.departures = data.departures?.map((departure) => ({
    ...departure,
    live: false,
  }));
  return stable;
}

export function loadStableLastRide(
  cityId: CityId,
  lat: number,
  lng: number,
): Promise<LastRidePayload> | null {
  if (cityId !== "london") return null;
  const liveUrl = lastRideFetchUrl(cityId, lat, lng);
  if (!liveUrl) return null;
  const url = `${liveUrl}&scope=stable`;
  const now = Date.now();
  const cached = stableResultCache.get(url);
  if (cached && cached.expiresAt > now) {
    stableResultCache.delete(url);
    stableResultCache.set(url, cached);
    return cached.promise;
  }
  if (cached) stableResultCache.delete(url);

  const promise = fetchLastRide(url)
    .then(stablePayload)
    .catch((error: unknown) => {
      stableResultCache.delete(url);
      throw error;
    });
  stableResultCache.set(url, { expiresAt: now + STABLE_CACHE_TTL_MS, promise });
  trimCache();
  return promise;
}

export function loadLastRide(
  cityId: CityId,
  lat: number,
  lng: number,
): Promise<LastRidePayload> | null {
  const url = lastRideFetchUrl(cityId, lat, lng);
  if (!url) return null;
  const pending = liveRequests.get(url);
  if (pending) return pending;

  const promise = fetchLastRide(url).then(
    (data) => {
      if (liveRequests.get(url) === promise) liveRequests.delete(url);
      return data;
    },
    (error: unknown) => {
      if (liveRequests.get(url) === promise) liveRequests.delete(url);
      throw error;
    },
  );
  liveRequests.set(url, promise);
  return promise;
}

export function prefetchLastRide(cityId: CityId, lat: number, lng: number): void {
  void loadStableLastRide(cityId, lat, lng)?.catch(() => {
    // Prefetch is opportunistic. LastTrainCard owns the visible fallback.
  });
}

export function __resetLastRideClientCache(): void {
  stableResultCache.clear();
  liveRequests.clear();
}
