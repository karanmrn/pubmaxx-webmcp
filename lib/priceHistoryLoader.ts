// Runtime loader for the price-archaeology file.
//
// Mirrors lib/priceUpdatesLoader.ts: the file is already a public asset, so the
// browser fetches it as data once per session (module-level promise cache,
// shared by every venue sheet open) instead of it being bundled into the map's
// client JS. Fails soft to an empty map — a missing file renders the sheet
// exactly as it did before this layer existed, never an error.
//
// This module is the ONLY runtime path to historical prices, and it feeds the
// venue sheet alone. See the hard rule at the top of lib/priceHistory.ts.

import {
  groupPriceHistoryByVenue,
  parsePriceHistory,
  type PriceHistoryObservation,
} from "@/lib/priceHistory";
import { fetchPublicJson, hasPublicJsonRows } from "@/lib/publicJsonLoader";

export const PRICE_HISTORY_PATH = "/data/price_history/london.json";

let historyPromise: Promise<Map<string, PriceHistoryObservation[]>> | null = null;

export function loadPriceHistory(): Promise<Map<string, PriceHistoryObservation[]>> {
  historyPromise ??= fetchPublicJson(PRICE_HISTORY_PATH).then((raw) => {
    if (raw === null || !hasPublicJsonRows(raw, "observations")) {
      historyPromise = null;
      return new Map<string, PriceHistoryObservation[]>();
    }
    return groupPriceHistoryByVenue(parsePriceHistory(raw));
  });
  return historyPromise;
}

/** Test seam: forget the cached fetch. */
export function resetPriceHistoryLoader(): void {
  historyPromise = null;
}
