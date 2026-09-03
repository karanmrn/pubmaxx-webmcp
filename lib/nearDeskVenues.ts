/**
 * Reader for the London desk pack (`public/data/london_desks/desks.json`).
 *
 * The kind-tagged shards carry name, address, position and kind only. Desk
 * mode needs the OSM amenity tags those shards strip, so this pack is cut
 * from the same UK venue packs with wifi, laptop and hours retained. It is
 * a PARSER and a FETCH, not a ranker: ranking lives in `lib/nearDesk.ts`.
 *
 * The pack has its OWN directory rather than sitting beside the shards it is
 * cut from. `publishStagedDirectory` sweeps the shard directory's root and
 * deletes every `*.json` there that is not `manifest.json`, so the next
 * `npm run build:london-venues` would have taken the desk pack with it.
 *
 * A failed read is not an empty city. The loader reports `failed` rather
 * than `ready` with zero rows, so the surface cannot say no desks exist
 * when it could not look.
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import { discardBody } from "@/lib/responseBody";
import {
  isDeskEligible,
  laptopFromOsm,
  parseOsmOpeningHours,
  wifiFromOsm,
  type DeskPoint,
} from "@/lib/nearDesk";
import { londonVenueIdFor } from "@/lib/londonVenueShards";
import { isVenueKind, type VenueKind } from "@/lib/venues";

export const DESK_PACK_PATH = "/data/london_desks/desks.json";
export const DESK_PACK_VERSION = 1;

export type DeskPackJson = {
  version?: unknown;
  source?: unknown;
  observedAt?: unknown;
  venues?: unknown;
};

export type DeskVenueLoad = {
  status: "ready" | "failed";
  venues: DeskPoint[];
  observedAt: string | null;
  source: "osm";
};

type DeskPackRow = [
  osmRef: string,
  name: string,
  address: string,
  lat: number,
  lng: number,
  kind: string,
  internetAccess: string,
  laptop: string,
  hours: string,
];

function isDeskPackRow(value: unknown): value is DeskPackRow {
  return (
    Array.isArray(value)
    && value.length === 9
    && typeof value[0] === "string"
    && value[0].length > 0
    && typeof value[1] === "string"
    && value[1].length > 0
    && typeof value[2] === "string"
    && typeof value[3] === "number"
    && Number.isFinite(value[3])
    && typeof value[4] === "number"
    && Number.isFinite(value[4])
    && isVenueKind(value[5])
    && typeof value[6] === "string"
    && typeof value[7] === "string"
    && typeof value[8] === "string"
  );
}

function coveringStamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : null;
}

function toDeskPoint(row: DeskPackRow): DeskPoint | null {
  const kind = row[5] as VenueKind;
  const wifi = wifiFromOsm(row[6]);
  const laptop = laptopFromOsm(row[7], null);
  if (!isDeskEligible({ kind, wifi })) return null;
  const hoursRaw = row[8].trim();
  return {
    id: londonVenueIdFor(row[0]),
    name: row[1],
    address: row[2],
    lat: row[3],
    lng: row[4],
    kind,
    wifi,
    laptop,
    hoursRaw: hoursRaw || null,
    openingHours: parseOsmOpeningHours(hoursRaw),
  };
}

export function parseDeskPack(value: unknown): DeskVenueLoad {
  if (typeof value !== "object" || value === null) {
    return { status: "failed", venues: [], observedAt: null, source: "osm" };
  }
  const record = value as DeskPackJson;
  const venues: DeskPoint[] = [];
  if (Array.isArray(record.venues)) {
    for (const row of record.venues) {
      if (!isDeskPackRow(row)) continue;
      const point = toDeskPoint(row);
      if (point) venues.push(point);
    }
  }
  return {
    status: "ready",
    venues,
    observedAt: coveringStamp(record.observedAt),
    source: "osm",
  };
}

export async function loadDeskVenues(): Promise<DeskVenueLoad> {
  try {
    const response = await fetch(DESK_PACK_PATH);
    if (!response.ok) {
      discardBody(response);
      return { status: "failed", venues: [], observedAt: null, source: "osm" };
    }
    const data: unknown = await response.json();
    return parseDeskPack(data);
  } catch {
    return { status: "failed", venues: [], observedAt: null, source: "osm" };
  }
}
