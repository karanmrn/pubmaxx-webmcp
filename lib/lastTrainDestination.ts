import { coarsenViewerPoint } from "@/lib/geo";

// Session-only Last Pint destination label (user stories 14–15, 23).
//
// The drinker's "heading home to …" target never leaves the browser session:
// no DB, no cookie, no query param, no server log. LastTrainCard reads/writes
// this key for display only — /api/last-train is never told the label.

export const LAST_TRAIN_DESTINATION_KEY = "pubmax:last-train-destination:v1";

const MAX_LABEL_LEN = 80;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeLastTrainDestination(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_LABEL_LEN);
}

export function readLastTrainDestination(storage: StorageLike | null | undefined): string {
  if (!storage) return "";
  try {
    return normalizeLastTrainDestination(storage.getItem(LAST_TRAIN_DESTINATION_KEY) ?? "");
  } catch {
    return "";
  }
}

export function writeLastTrainDestination(
  label: string,
  storage: StorageLike | null | undefined,
): string {
  const trimmed = normalizeLastTrainDestination(label);
  if (!storage) return trimmed;
  try {
    if (trimmed) {
      storage.setItem(LAST_TRAIN_DESTINATION_KEY, trimmed);
    } else {
      storage.removeItem(LAST_TRAIN_DESTINATION_KEY);
    }
  } catch {
    // private mode / quota — caller still holds trimmed in React state
  }
  return trimmed;
}

/** Build the Last Pint fetch URL. Destination stays client-only — never sent. */
export function lastTrainFetchUrl(lat: number, lng: number): string {
  const egressPoint = coarsenViewerPoint({ lat, lng });
  const params = new URLSearchParams();
  params.set("lat", String(egressPoint.lat));
  params.set("lng", String(egressPoint.lng));
  return `/api/last-train?${params.toString()}`;
}

// Re-export city-aware URL builder so callers can migrate off the London-only helper.
export { lastRideFetchUrl } from "@/lib/lastRide";
