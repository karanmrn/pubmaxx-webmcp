// Preferred city for Map nav / Drop — localStorage-backed, SSR-safe.
//
// When unset, Map links stay on `/map` (London back-compat). CitySwitcher and
// the geolocation suggest banner write here so the next Map tab tap opens the
// city the viewer last chose (or was near).

import { getCity, parseCityId, type CityId } from "@/lib/cities";
import { cityAwareMapPath, cityMapShareUrl } from "@/lib/cityMapHref";
import { safeLocalStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "pubmax:preferredCity:v1";
/** Same-tab notify so useSyncExternalStore clients re-read after a write. */
const CHANGE_EVENT = "pubmax:preferred-city";

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

function notifyPreferredCityChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Ignore — older environments without Event ctor still keep storage writes.
  }
}

function enabledCityId(raw: string | null | undefined): CityId | null {
  const id = parseCityId(raw);
  if (!id) return null;
  return getCity(id).enabled ? id : null;
}

/** Stored preferred city id, or null on SSR / unset / disabled / unreadable. */
export function readPreferredCity(): CityId | null {
  if (!hasStorage()) return null;
  try {
    return enabledCityId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Persist a preferred city for Map nav. No-op on SSR / storage failure. */
export function writePreferredCity(cityId: CityId | string): void {
  if (!hasStorage()) return;
  const id = enabledCityId(cityId);
  if (!id) return;
  try {
    // Skip no-op writes so Map mount (always re-asserts cityId) does not
    // notify useSyncExternalStore subscribers on every visit.
    if (window.localStorage.getItem(STORAGE_KEY) === id) return;
    window.localStorage.setItem(STORAGE_KEY, id);
    notifyPreferredCityChange();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/** Clear preferred city (Map nav falls back to London `/map`). */
export function clearPreferredCity(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    notifyPreferredCityChange();
  } catch {
    // ignore
  }
}

/** Canonical map path for a city (London stays `/map`). */
export function mapHrefForCity(cityId: CityId | string | null | undefined): string {
  return cityMapShareUrl(cityId);
}

/**
 * Subscribe to preferred-city changes (same-tab writes + cross-tab `storage`).
 * For `useSyncExternalStore` in Map nav clients.
 */
export function subscribePreferredCity(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/**
 * Map href for the viewer's preferred city. Null preference → `/map`.
 * Optional query (e.g. `log=1` for Drop) is appended when non-empty.
 */
export function preferredCityMapHref(
  query?: URLSearchParams | string | null,
): string {
  return cityAwareMapPath(readPreferredCity(), query);
}
