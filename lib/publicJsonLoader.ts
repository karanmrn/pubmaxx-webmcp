// Shared browser-only fetch for the public JSON assets the venue sheet's
// loaders pull in on demand (price history, price-update overlays, the Pint
// Index snapshot). Every caller wants the same contract: browser-only (a
// server render never blocks on it), fail-soft to null on a non-2xx or a
// thrown fetch, and a drained body either way so an unread stream never
// leaves the request open. Previously duplicated verbatim across
// lib/priceHistoryLoader.ts, lib/priceUpdatesLoader.ts and
// lib/pintIndexLeagueLoader.ts.

import { discardBody } from "@/lib/responseBody";

export function hasPublicJsonRows(raw: unknown, field: string): boolean {
  return Array.isArray(raw)
    || (typeof raw === "object"
      && raw !== null
      && Array.isArray((raw as Record<string, unknown>)[field]));
}

export async function fetchPublicJson(path: string): Promise<unknown | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}
