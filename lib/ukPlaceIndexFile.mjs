// Where the UK place index lives, as ONE string.
//
// /map resolves a ?place= arrival by opening this file at request time
// (lib/ukPlaceIndex.server.ts), so Next cannot see the path statically and
// next.config.mjs has to declare it in outputFileTracingIncludes. Plain ESM
// with no imports so the config can read it while Next loads, and so the file
// the function ships and the file the route opens stay the same string rather
// than two copies that drift.

/** Repo-relative path, as the reader joins it to process.cwd(). */
export const UK_PLACE_INDEX_FILE = "public/data/uk_base/places.json";

/** The same file as Next's outputFileTracingIncludes spells it. */
export const UK_PLACE_INDEX_TRACING_INCLUDE = `./${UK_PLACE_INDEX_FILE}`;
