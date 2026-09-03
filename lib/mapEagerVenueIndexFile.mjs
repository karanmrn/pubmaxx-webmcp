// Where the map's EAGER slim shard lives, as ONE string.
//
// The map loads this central compatibility shard with the manifest and the
// location cells its opening viewport needs (lib/slimShards.ts). A server
// surface that wants to know whether the map could open a pub reads all
// published cells at request time (lib/mapEagerVenueIndex.server.ts), which
// Next cannot trace statically, so next.config.mjs declares them through
// lib/venueIndexTracing.mjs. Plain ESM with no imports lets the config read
// this path while Next loads, and keeps the shipped and read paths identical.

/** Repo-relative path, as the reader joins it to process.cwd(). */
export const MAP_EAGER_VENUE_INDEX_FILE = "public/data/venues_slim.core.json";

/** The same file as Next's outputFileTracingIncludes spells it. */
export const MAP_EAGER_VENUE_INDEX_TRACING_INCLUDE = `./${MAP_EAGER_VENUE_INDEX_FILE}`;

export const MAP_EAGER_VENUE_INDEX_TRACING_INCLUDES = [
  MAP_EAGER_VENUE_INDEX_TRACING_INCLUDE,
  "./public/data/venues_slim.manifest.json",
  "./public/data/venues_slim.cell.*.json",
];
