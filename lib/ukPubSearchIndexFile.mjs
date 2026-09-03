// Where the national UK pub name-search index lives, as ONE string.
// GET /api/map-search opens this file at request time, so Next must declare it
// in outputFileTracingIncludes via RUNTIME_DATA_PACKS.

/** Repo-relative path, as the reader joins it to process.cwd(). */
export const UK_PUB_SEARCH_INDEX_FILE = "data/generated/uk_pub_search.json";

/** The same file as Next's outputFileTracingIncludes spells it. */
export const UK_PUB_SEARCH_INDEX_TRACING_INCLUDE = `./${UK_PUB_SEARCH_INDEX_FILE}`;
