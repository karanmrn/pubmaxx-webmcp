import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  isWorkFriendlyVenueKind,
  type WorkFriendlyVenueKind,
} from "@/lib/ask/conciergeTools";
import { getCity, type CityId } from "@/lib/cities";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

// The work-friendly half of the city pack, read for `find_desk` alone.
//
// `lib/concierge/venues.server.ts` deliberately drops every non-pub row: the
// concierge and the planner reason in pints, and an anchor price is not one.
// A desk answer reasons in seats, so it needs the rows that loader throws away
// - and it must never reach the pub rows, because a pub carries no seating,
// plug or wifi fact and offering one as a desk would be a recommendation we
// cannot back.
//
// Today the London pack holds none of these kinds (the widened extraction lane
// lands them). This returns an empty list, `find_desk` says "no seat data yet",
// and nothing changes for pubs when the rows arrive.

export type DeskVenue = {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  kind: WorkFriendlyVenueKind;
};

export type DeskVenueRead = {
  venues: DeskVenue[];
  /** `unavailable` = the pack could not be read. Never "nobody is here". */
  status: "ready" | "unavailable";
};

const cache = new Map<CityId, DeskVenueRead>();
const inflight = new Map<CityId, Promise<DeskVenueRead>>();

function toDeskVenue(value: unknown): DeskVenue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isWorkFriendlyVenueKind(row.kind)) return null;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.name !== "string" || !row.name) return null;
  if (typeof row.lat !== "number" || !Number.isFinite(row.lat)) return null;
  if (typeof row.lng !== "number" || !Number.isFinite(row.lng)) return null;
  const area = typeof row.borough === "string" ? row.borough : "";
  return {
    id: row.id,
    name: row.name,
    area,
    lat: row.lat,
    lng: row.lng,
    kind: row.kind,
  };
}

/** Read the city pack's work-friendly rows. A failed read says so. */
export async function loadDeskVenues(cityId: CityId): Promise<DeskVenueRead> {
  const hit = cache.get(cityId);
  if (hit) return hit;
  const pending = inflight.get(cityId);
  if (pending) return pending;

  const load = (async (): Promise<DeskVenueRead> => {
    try {
      const publicPath = getCity(cityId).slimVenuesPath.replace(/^\//, "");
      const raw = await readFile(
        path.join(
          /* turbopackIgnore: true */ process.cwd(),
          "public",
          publicPath,
        ),
        "utf8",
      );
      const parsed: unknown = JSON.parse(raw);
      const rows = rowsFromSlimPayload(parsed) ?? [];
      const venues = rows
        .map(toDeskVenue)
        .filter((venue): venue is DeskVenue => venue !== null);
      const result: DeskVenueRead = { venues, status: "ready" };
      cache.set(cityId, result);
      return result;
    } catch {
      // A read we could not run is not an empty city.
      return { venues: [], status: "unavailable" };
    }
  })();
  inflight.set(cityId, load);
  try {
    return await load;
  } finally {
    if (inflight.get(cityId) === load) inflight.delete(cityId);
  }
}

export function resetDeskVenuesForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cache.clear();
    inflight.clear();
  }
}
