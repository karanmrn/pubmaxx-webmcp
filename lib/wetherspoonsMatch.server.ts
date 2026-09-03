import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { WetherspoonsPub } from "@/lib/wetherspoonsDirectory";
import {
  matchedWetherspoonsVenueIds as matchedWetherspoonsVenueIdsSync,
  type WetherspoonsMatchVenue,
} from "@/lib/wetherspoonsMatch";

export {
  WETHERSPOONS_MATCH_MAX_KM,
  matchWetherspoonsDirectoryPub,
  normalizeWetherspoonsMatchName,
  type WetherspoonsMatchVenue,
} from "@/lib/wetherspoonsMatch";

let directoryPubs: Promise<WetherspoonsPub[]> | null = null;

export async function loadWetherspoonsDirectoryPubs(): Promise<WetherspoonsPub[]> {
  directoryPubs ??= (async () => {
    try {
      const raw = JSON.parse(
        await readFile(path.join(process.cwd(), "public/data/wetherspoons/pubs.json"), "utf8"),
      ) as { pubs?: unknown };
      return Array.isArray(raw.pubs) ? (raw.pubs as WetherspoonsPub[]) : [];
    } catch {
      return [];
    }
  })();
  return directoryPubs;
}

/** Venue ids that join the first-party directory under the shared name+distance rule. */
export async function matchedWetherspoonsVenueIds(
  venues: readonly WetherspoonsMatchVenue[],
): Promise<ReadonlySet<string>> {
  const pubs = await loadWetherspoonsDirectoryPubs();
  return matchedWetherspoonsVenueIdsSync(venues, pubs);
}
