// Maps a raw pathname to the app's ROUTE TEMPLATE (e.g. /plan/abc-123 →
// /plan/[id]) for privacy-safe per-route RUM. The output is ALWAYS one of the
// known templates below or the "/other" fallback — a raw id, slug, handle, or
// query string can never appear in it. This is the sanitizer the field-vitals
// beacon (and the analytics registry validator) rely on so no venue id or free
// text ever reaches telemetry.

/** Every page route template in the app. Kept in sync with the app-router pages. */
export const ROUTE_PATTERNS = [
  "/",
  "/about",
  "/activity",
  "/add/[handle]",
  "/admin",
  "/bar-tab/[id]",
  "/borough",
  "/borough/[slug]",
  "/choose-city",
  "/crawls",
  "/crawls/[slug]",
  "/discover",
  "/drinks",
  "/feed",
  "/historic",
  "/historic/[slug]",
  "/landmark/[id]",
  "/ledger/[id]",
  "/map",
  "/map/[city]",
  "/messages",
  "/messages/[id]",
  "/moment",
  "/near",
  "/onboarding",
  "/out",
  "/p/[id]",
  "/pal",
  "/pal/chat",
  "/pint-index",
  "/plan",
  "/plan/[id]",
  "/plan/[id]/recap",
  "/profile",
  "/pubs",
  "/recap/[storyId]",
  "/rounds",
  "/rounds/[code]",
  "/social",
  "/today",
  "/tonight",
  "/u/[handle]",
  "/u/[handle]/lists/[listType]",
  "/we-are-out",
] as const;

/** Fallback for any path that matches no known template. Never a raw path. */
export const ROUTE_PATTERN_OTHER = "/other";

function segments(path: string): string[] {
  return path.replace(/\/+$/, "").split("/").filter(Boolean);
}

const TEMPLATES = ROUTE_PATTERNS.map((pattern) => ({ pattern, segs: segments(pattern) }));

/**
 * Normalise a pathname to its route template. Query and hash are stripped
 * defensively; a dynamic template segment (`[id]`, `[slug]`, …) matches any one
 * path segment. Returns "/other" when nothing matches, so the result is always
 * a bounded, id-free label.
 */
export function toRoutePattern(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] || "/").toLowerCase();
  const segs = segments(path);
  if (segs.length === 0) return "/";
  for (const template of TEMPLATES) {
    if (template.segs.length !== segs.length) continue;
    const matches = template.segs.every(
      (segment, index) => segment.startsWith("[") || segment === segs[index],
    );
    if (matches) return template.pattern;
  }
  return ROUTE_PATTERN_OTHER;
}
