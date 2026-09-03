/**
 * The reader for the LONDON VENUE layer - the kind-tagged shards of everywhere
 * in Greater London a drinker or a laptop could sit
 * (`scripts/build_london_venue_shards.mjs`, `public/data/london_venues/`).
 *
 * This is a PARSER and nothing else: no fetching, no map, no component. It sits
 * beside `lib/ukBasePubs.ts` rather than inside it, because that module is the
 * country-wide `amenity=pub` layer whose row tuple ends in a curated venue id
 * and whose every reader draws a PUB. A library is not a pub, so it gets its own
 * id prefix, its own row shape and its own decoder.
 *
 * WHAT A ROW MAY SAY: name, address, position and kind - the four things OSM
 * stated. There is no price field, no band and no opening claim, by
 * construction. `isPubVenueKind` answers false for every non-pub kind here, so
 * nothing on this layer can reach a price band, a pin figure, a cheapest bucket
 * or the Pint Index.
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import { parseShardManifest, type ShardEntry, type ShardManifest } from "@/lib/slimShards";
import { isVenueKind, type VenueKind } from "@/lib/venues";

export const LONDON_VENUE_SHARD_VERSION = 1;

const LONDON_VENUE_URL_PREFIX = /^\/data\/london_venues\/(?:packs\/[a-f0-9]{16}\/)?$/;

/**
 * Venue ids are salted apart from BOTH the curated `venue-…` convention and the
 * base layer's `venue-uk-…`, so no reader can mistake a cafe for either a
 * curated venue or an unpriced pub. A shared prefix is how a kind-neutral row
 * would end up inside a pub system.
 */
export const LONDON_VENUE_ID_PREFIX = "venue-osm-";

/** One place on the London venue layer. No price field exists. */
export type LondonVenue = {
  /** `venue-osm-<osm ref>`, e.g. `venue-osm-n251829660`. Stable across refreshes. */
  id: string;
  name: string;
  /** OSM address, or "" when the pack had none. Never invented. */
  address: string;
  lat: number;
  lng: number;
  kind: VenueKind;
};

export function londonVenueIdFor(osmRef: string): string {
  return `${LONDON_VENUE_ID_PREFIX}${osmRef}`;
}

export function isLondonVenueId(id: string): boolean {
  return id.startsWith(LONDON_VENUE_ID_PREFIX);
}

/**
 * One shard row is a tuple, not an object, for the reason the base layer's is:
 * the bodies are machine-generated and fetched while the user pans.
 * `[osmRef, name, address, lat, lng, kind]`.
 */
type ShardRow = [string, string, string, number, number, string];

function isShardRow(value: unknown): value is ShardRow {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    typeof value[1] === "string" &&
    value[1].length > 0 &&
    typeof value[2] === "string" &&
    typeof value[3] === "number" &&
    Number.isFinite(value[3]) &&
    typeof value[4] === "number" &&
    Number.isFinite(value[4]) &&
    isVenueKind(value[5])
  );
}

/**
 * Parse a shard body into venues, dropping malformed rows rather than letting a
 * drifted refresh poison a reader. A row whose kind the vocabulary does not
 * hold is malformed: a venue with no honest kind has no honest label either.
 */
export function parseLondonVenueShard(value: unknown): LondonVenue[] {
  if (typeof value !== "object" || value === null) return [];
  const rows = (value as Record<string, unknown>).venues;
  if (!Array.isArray(rows)) return [];
  const venues: LondonVenue[] = [];
  for (const row of rows) {
    if (!isShardRow(row)) continue;
    venues.push({
      id: londonVenueIdFor(row[0]),
      name: row[1],
      address: row[2],
      lat: row[3],
      lng: row[4],
      kind: row[5] as VenueKind,
    });
  }
  return venues;
}

export function parseLondonVenueShardForEntry(
  value: unknown,
  entry: ShardEntry,
): LondonVenue[] | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== LONDON_VENUE_SHARD_VERSION ||
    record.cell !== entry.id ||
    !Array.isArray(record.venues) ||
    record.venues.length !== entry.count
  ) {
    return null;
  }
  const venues = parseLondonVenueShard(value);
  return venues.length === entry.count ? venues : null;
}

export function parseLondonVenueManifest(value: unknown): ShardManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.urlPrefix !== "string" ||
    !LONDON_VENUE_URL_PREFIX.test(manifest.urlPrefix) ||
    !Array.isArray(manifest.shards)
  ) {
    return null;
  }
  const shards: Record<string, unknown>[] = [];
  for (const raw of manifest.shards) {
    if (typeof raw !== "object" || raw === null || "url" in raw) return null;
    const shard = raw as Record<string, unknown>;
    if (
      typeof shard.id !== "string" ||
      !shard.id ||
      shard.id.includes("/") ||
      shard.id.includes("\\") ||
      shard.id.includes("..")
    ) {
      return null;
    }
    shards.push({ ...shard, url: `${manifest.urlPrefix}${shard.id}.json` });
  }
  return parseShardManifest({ ...manifest, shards });
}

/**
 * Narrow a decoded shard to the kinds a caller asked for. A caller that wants
 * pubs is better served by the curated layer and the base layer; this exists so
 * a work-spot reader can ask for cafes, coworking and libraries without every
 * such reader restating the set.
 */
export function londonVenuesOfKind(
  venues: readonly LondonVenue[],
  kinds: readonly VenueKind[],
): LondonVenue[] {
  const wanted = new Set(kinds);
  return venues.filter((venue) => wanted.has(venue.kind));
}

/** The work-spot kinds: somewhere with a table, a socket and a reason to stay. */
export const WORK_SPOT_KINDS: readonly VenueKind[] = ["cafe", "coworking", "library"];
