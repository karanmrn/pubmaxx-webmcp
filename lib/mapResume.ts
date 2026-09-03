import type { CityId } from "@/lib/cities";
import type { MapViewportSnapshot } from "@/lib/mobileShell";
import { validateMapViewport } from "@/lib/mobileShell";
import { offlineCache } from "@/lib/offlineCache";
import { safeLocalStorage } from "@/lib/safeStorage";
import type { SlimVenue } from "@/lib/venuesSlim";

const MAP_RESUME_VERSION = 1;
const MAP_RESUME_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAP_RESUME_KEY_PREFIX = "map-resume:v1:";

export type MapResumeSnapshot = {
  version: 1;
  cityId: CityId;
  savedAt: number;
  viewport: MapViewportSnapshot;
  rows: SlimVenue[];
};

export function isPersistableMapResumeViewport(
  viewport: MapViewportSnapshot,
  openingLocationResolved: boolean,
  cameraSettled: boolean,
): boolean {
  return (
    openingLocationResolved &&
    cameraSettled &&
    !(viewport.center[0] === 0 && viewport.center[1] === 0 && viewport.zoom === 0)
  );
}

function keyFor(cityId: CityId): string {
  return `${MAP_RESUME_KEY_PREFIX}${cityId}`;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  return storage === undefined ? safeLocalStorage() : storage;
}

function validRow(value: unknown): value is SlimVenue {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" && row.id.length > 0 &&
    typeof row.name === "string" && row.name.length > 0 &&
    typeof row.lat === "number" && Number.isFinite(row.lat) &&
    typeof row.lng === "number" && Number.isFinite(row.lng) &&
    typeof row.borough === "string" &&
    (row.cheapestPrice === null ||
      (typeof row.cheapestPrice === "number" && Number.isFinite(row.cheapestPrice)))
  );
}

function parseSnapshot(value: unknown, cityId: CityId, now: number): MapResumeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<MapResumeSnapshot>;
  const viewport = validateMapViewport(raw.viewport);
  if (
    raw.version !== MAP_RESUME_VERSION ||
    raw.cityId !== cityId ||
    typeof raw.savedAt !== "number" ||
    !Number.isFinite(raw.savedAt) ||
    raw.savedAt > now ||
    now - raw.savedAt > MAP_RESUME_MAX_AGE_MS ||
    !viewport ||
    !Array.isArray(raw.rows)
  ) return null;
  const rows = raw.rows.filter(validRow);
  if (rows.length !== raw.rows.length) return null;
  return {
    version: 1,
    cityId,
    savedAt: raw.savedAt,
    viewport,
    rows,
  };
}

export function readMapResumeSync(
  cityId: CityId,
  now = Date.now(),
  storage?: Storage | null,
): MapResumeSnapshot | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(keyFor(cityId));
    return raw ? parseSnapshot(JSON.parse(raw), cityId, now) : null;
  } catch {
    return null;
  }
}

export async function readMapResume(
  cityId: CityId,
  now = Date.now(),
): Promise<MapResumeSnapshot | null> {
  try {
    return parseSnapshot(await offlineCache.get(keyFor(cityId)), cityId, now);
  } catch {
    return null;
  }
}

export function writeMapResume(
  value: Omit<MapResumeSnapshot, "version" | "savedAt">,
  now = Date.now(),
  storage?: Storage | null,
): void {
  const snapshot = {
    ...value,
    version: 1 as const,
    savedAt: now,
  };
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(keyFor(value.cityId), JSON.stringify(snapshot));
    } catch {
      // IndexedDB remains available if the synchronous mirror is full.
    }
  }
  try {
    void offlineCache.set(keyFor(value.cityId), snapshot);
  } catch {
    // IndexedDB is an optional speed layer. A blocked or full store never stops the map.
  }
}

export const MAP_RESUME_MAX_AGE = MAP_RESUME_MAX_AGE_MS;

export type MapResumeLiveLoadStatus = "pending" | "ready" | "unavailable";

export function isCurrentMapResumeRefresh(
  liveLoadStatus: MapResumeLiveLoadStatus,
  liveRowsCommitted: boolean,
  currentVersion: number,
  refreshVersion: number,
): boolean {
  const liveResultBlocksResume =
    liveRowsCommitted &&
    (liveLoadStatus === "ready" || liveLoadStatus === "unavailable");
  return !liveResultBlocksResume && currentVersion === refreshVersion;
}
