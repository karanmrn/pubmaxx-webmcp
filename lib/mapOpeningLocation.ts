import { safeLocalStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "pubmax:map-opening-location:v1";

export type MapOpeningLocation = { lat: number; lng: number };

export type MapOpeningView = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

export type MapOpeningLocationEnvironment = {
  geolocation?: Pick<Geolocation, "getCurrentPosition">;
  permissions?: Pick<Permissions, "query">;
};

export type MapOpeningLocationReadOptions = {
  onPermissionPrompt?: () => void;
};

function validLocation(value: unknown): value is MapOpeningLocation {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.lat === "number" && Number.isFinite(raw.lat) &&
    raw.lat >= -90 && raw.lat <= 90 &&
    typeof raw.lng === "number" && Number.isFinite(raw.lng) &&
    raw.lng >= -180 && raw.lng <= 180
  );
}

function resolveStorage(storage?: Storage | null): Storage | null {
  return storage === undefined ? safeLocalStorage() : storage;
}

export function readMapOpeningLocation(
  storage?: Storage | null,
): MapOpeningLocation | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validLocation(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeMapOpeningLocation(
  location: MapOpeningLocation,
  storage?: Storage | null,
): void {
  if (!validLocation(location)) return;
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Location is an optional speed hint. Storage failure never blocks the map.
  }
}

export function resolveMapOpeningLocation(
  lastKnown: MapOpeningLocation | null,
  cityDefault: MapOpeningLocation,
): MapOpeningLocation {
  return validLocation(lastKnown) ? lastKnown : cityDefault;
}

export function resolveMapOpeningView(
  cityView: MapOpeningView,
  location: MapOpeningLocation | null,
  locationZoom: number,
): MapOpeningView {
  if (!validLocation(location)) return cityView;
  return {
    ...cityView,
    center: [location.lng, location.lat],
    zoom: Math.max(cityView.zoom, locationZoom),
  };
}

export async function readOpeningMapLocation(
  environment: MapOpeningLocationEnvironment | null =
    typeof navigator === "undefined" ? null : navigator,
  options: MapOpeningLocationReadOptions = {},
): Promise<MapOpeningLocation | null> {
  if (!environment?.geolocation) return null;
  const geolocation = environment.geolocation;
  const readCurrentLocation = () => new Promise<MapOpeningLocation | null>((resolve) => {
    const settle = (value: MapOpeningLocation | null) => resolve(value);
    try {
      geolocation.getCurrentPosition(
        (position) => {
          try {
            const location = {
              lat: position?.coords?.latitude,
              lng: position?.coords?.longitude,
            };
            settle(validLocation(location) ? location : null);
          } catch {
            settle(null);
          }
        },
        () => settle(null),
        { enableHighAccuracy: false, timeout: 2_000, maximumAge: 60_000 },
      );
    } catch {
      settle(null);
    }
  });

  if (!environment.permissions || typeof environment.permissions.query !== "function") {
    options.onPermissionPrompt?.();
    return readCurrentLocation();
  }
  try {
    const permission = await environment.permissions.query({ name: "geolocation" });
    if (permission?.state === "denied") return null;
    if (permission?.state === "prompt") {
      options.onPermissionPrompt?.();
      return null;
    }
  } catch {
    options.onPermissionPrompt?.();
  }
  return readCurrentLocation();
}

export const MAP_OPENING_LOCATION_STORAGE_KEY = STORAGE_KEY;
