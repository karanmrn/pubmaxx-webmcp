// How many crawls one page of an author's public listing may hold.
//
// ONE owner for the two bounds, imported by the store that applies them, the
// route that parses `?limit=`, and the profile that pages through them. This
// module imports NOTHING so the browser can read the ceiling without pulling the
// server-only crawl-story store in behind it (the same rule lib/handleNormalize
// and lib/formatGbp follow).

export const AUTHOR_CRAWL_LIST_DEFAULT_LIMIT = 10;
export const AUTHOR_CRAWL_LIST_MAX_LIMIT = 25;

/**
 * The page size a caller asked for, clamped into the published range. Anything
 * unparseable is the default rather than an error: a listing is a read, and a
 * junk `?limit=` should show the ordinary first page.
 */
export function clampAuthorCrawlListLimit(
  value: string | number | null | undefined,
): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return AUTHOR_CRAWL_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), AUTHOR_CRAWL_LIST_MAX_LIMIT);
}

/**
 * What the owner's unlisted crawls are called on their own profile, and why
 * only they can see them. It is the one line that explains why the published
 * tally on the passport is larger than the public Crawls figure beside it, so
 * it names the number rather than leaving a bare second figure to be guessed
 * at, and the rows it heads are the door to what it counts.
 *
 * The number it names is the WHOLE total, never the length of the page under
 * it: a page is capped at AUTHOR_CRAWL_LIST_MAX_LIMIT, and a capped figure here
 * would fail to reconcile with the passport tally it exists to explain.
 *
 * TRI-STATE by way of null, like every count on this lane: a total the read
 * could not measure is named as nothing rather than as the rows that happened
 * to come back, because those rows are a page and not a count.
 */
export function ownUnlistedCrawlsLabel(total: number | null): string {
  if (total === null) return "Your unlisted crawls (only you see these)";
  return total === 1
    ? "1 unlisted crawl (only you see this)"
    : `${total} unlisted crawls (only you see these)`;
}
