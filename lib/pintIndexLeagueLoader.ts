// Browser loader for the public Pint Index league rows used by the venue
// Overview area-price compare line. The snapshot is already a public asset, so
// we fetch it once per session (module-level promise) rather than bundling it
// into the map chunk. Fails soft to an empty league — silence, never a crash.

import {
  buildLeagueTable,
  validatePintIndexSnapshot,
  type LeagueRow,
} from "@/lib/pintIndex";
import { fetchPublicJson } from "@/lib/publicJsonLoader";

/** Public URL for the live Pint Index snapshot (mirrors public/data/...). */
export const PINT_INDEX_SNAPSHOT_PUBLIC_PATH = "/data/pint_index_snapshot.json";

let leaguePromise: Promise<LeagueRow[]> | null = null;

export function loadPintIndexLeagueRows(): Promise<LeagueRow[]> {
  leaguePromise ??= fetchPublicJson(PINT_INDEX_SNAPSHOT_PUBLIC_PATH).then((raw) => {
    if (raw === null) {
      leaguePromise = null;
      return [];
    }
    const result = validatePintIndexSnapshot(raw);
    if (!result.ok) {
      leaguePromise = null;
      return [];
    }
    return buildLeagueTable(result.snapshot);
  });
  return leaguePromise;
}

/** Test seam: forget the cached fetch. */
export function resetPintIndexLeagueLoader(): void {
  leaguePromise = null;
}
