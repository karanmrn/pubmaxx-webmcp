
import { safeLocalStorage } from "@/lib/safeStorage";
import {
  NEAR_MODE_STORAGE_KEY,
  parseNearModeParam,
  type NearMode,
} from "@/lib/nearDesk";

const CHANGE_EVENT = "pubmax:near-mode";

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

function notifyNearModeChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without Event still keep the write.
  }
}

export function readRememberedNearMode(): NearMode | null {
  if (!hasStorage()) return null;
  try {
    return parseNearModeParam(window.localStorage.getItem(NEAR_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeRememberedNearMode(mode: NearMode): void {
  if (!hasStorage()) return;
  if (!parseNearModeParam(mode)) return;
  try {
    if (window.localStorage.getItem(NEAR_MODE_STORAGE_KEY) === mode) return;
    window.localStorage.setItem(NEAR_MODE_STORAGE_KEY, mode);
    notifyNearModeChange();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

export function subscribeRememberedNearMode(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === NEAR_MODE_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}
