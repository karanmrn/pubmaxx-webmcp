import { parseUkPlaceMapArrival } from "@/lib/ukPlaceSearch";
import { isUkNationalBrowse } from "@/lib/ukNationalBrowse";

export const CITY_SUGGEST_DISMISS_KEY = "pubmax:citySuggestDismiss:v1";

const CITY_SUGGEST_DISMISS_EVENT = "pubmax:city-suggest-dismiss";
const DESKTOP_MAP_MEDIA_QUERY = "(min-width: 641px)";

export type CitySuggestClientFlags = {
  geoAvailable: boolean;
  saveData: boolean;
};

export const CITY_SUGGEST_SERVER_FLAGS: CitySuggestClientFlags = {
  geoAvailable: false,
  saveData: true,
};

let cachedClientFlags: CitySuggestClientFlags | null = null;
let citySuggestDismissedInMemory = false;

export function saveDataPreferred(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    mozConnection?: { saveData?: boolean };
    webkitConnection?: { saveData?: boolean };
  };
  const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  return Boolean(conn?.saveData);
}

export function readCitySuggestClientFlags(): CitySuggestClientFlags {
  if (cachedClientFlags) return cachedClientFlags;
  if (typeof navigator === "undefined") {
    cachedClientFlags = CITY_SUGGEST_SERVER_FLAGS;
    return cachedClientFlags;
  }
  cachedClientFlags = {
    geoAvailable: Boolean(navigator.geolocation),
    saveData: saveDataPreferred(),
  };
  return cachedClientFlags;
}

function readCitySuggestDismissed(): boolean {
  if (citySuggestDismissedInMemory) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(CITY_SUGGEST_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissCitySuggest(): void {
  if (typeof window === "undefined") return;
  citySuggestDismissedInMemory = true;
  try {
    window.sessionStorage.setItem(CITY_SUGGEST_DISMISS_KEY, "1");
  } catch {
    // Storage may be unavailable while the page remains usable.
  }
  try {
    window.dispatchEvent(new Event(CITY_SUGGEST_DISMISS_EVENT));
  } catch {
    // Older environments re-evaluate on the next render.
  }
}

function isDesktopMap(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  if (
    window.location.pathname !== "/map" &&
    !window.location.pathname.startsWith("/map/")
  ) {
    return false;
  }
  if (parseUkPlaceMapArrival(window.location.search)) return false;
  if (isUkNationalBrowse(window.location.search)) return false;
  return window.matchMedia(DESKTOP_MAP_MEDIA_QUERY).matches;
}

export function getMapLocationControlAvailable(): boolean {
  if (!isDesktopMap() || readCitySuggestDismissed()) return false;
  const flags = readCitySuggestClientFlags();
  return flags.geoAvailable && !flags.saveData;
}

export function getMapLocationControlServerSnapshot(): boolean {
  return false;
}

export function subscribeMapLocationControl(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  const media = window.matchMedia?.(DESKTOP_MAP_MEDIA_QUERY);
  window.addEventListener(CITY_SUGGEST_DISMISS_EVENT, handler);
  window.addEventListener("popstate", handler);
  media?.addEventListener("change", handler);
  return () => {
    window.removeEventListener(CITY_SUGGEST_DISMISS_EVENT, handler);
    window.removeEventListener("popstate", handler);
    media?.removeEventListener("change", handler);
  };
}
