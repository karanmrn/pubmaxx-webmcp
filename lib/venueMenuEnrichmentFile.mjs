// Where the curated menu-enrichment overlay lives, as ONE string.
//
// lib/venueMenuEnrichment.ts joins this to process.cwd() on the venue detail
// path, so the file the reader opens and the file next.config.mjs declares in
// outputFileTracingIncludes stay the same string. Plain ESM with no imports so
// the config can read it while Next loads.

/** Repo-relative path, as the reader joins it to process.cwd(). */
export const VENUE_MENU_ENRICHMENT_FILE = "public/data/venue_menu_enrichment.json";

/** The same file as Next's outputFileTracingIncludes spells it. */
export const VENUE_MENU_ENRICHMENT_TRACING_INCLUDE = `./${VENUE_MENU_ENRICHMENT_FILE}`;
