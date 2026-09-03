// Where the venue-id alias artifact lives, as ONE string.
//
// lib/venueAliases.ts joins this to process.cwd() on every server-side
// lookup-by-id, so the file the reader opens and the file next.config.mjs
// declares in outputFileTracingIncludes stay the same string. Plain ESM with no
// imports so the config can read it while Next loads.

/** Repo-relative path, as the reader joins it to process.cwd(). */
export const VENUE_ALIASES_FILE = "public/data/venue_id_aliases.json";

/** The same file as Next's outputFileTracingIncludes spells it. */
export const VENUE_ALIASES_TRACING_INCLUDE = `./${VENUE_ALIASES_FILE}`;
