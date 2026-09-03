const PAGEVIEW_STATIC_SURFACES = new Set([
  "/",
  "/about",
  "/activity",
  "/borough",
  "/choose-city",
  "/contributors",
  "/crawls",
  "/historic",
  "/map",
  "/messages",
  "/moment",
  "/near",
  "/onboarding",
  "/out",
  "/pal",
  "/pal/chat",
  "/pint-index",
  "/plan",
  "/privacy",
  "/profile",
  "/pubs",
  "/rounds",
  "/social",
  "/terms",
  "/today",
  "/tonight",
  "/we-are-out",
  "/you",
]);

const PAGEVIEW_DYNAMIC_SURFACES: readonly [RegExp, string][] = [
  [/^\/add\/[^/]+$/, "/add/[handle]"],
  [/^\/bar-tab\/[^/]+$/, "/bar-tab/[id]"],
  [/^\/borough\/[^/]+$/, "/borough/[slug]"],
  [/^\/crawls\/[^/]+$/, "/crawls/[slug]"],
  [/^\/historic\/[^/]+$/, "/historic/[slug]"],
  [/^\/landmark\/[^/]+$/, "/landmark/[id]"],
  [/^\/ledger\/[^/]+$/, "/ledger/[id]"],
  [/^\/map\/[^/]+$/, "/map/[city]"],
  [/^\/messages\/[^/]+$/, "/messages/[id]"],
  [/^\/p\/[^/]+$/, "/p/[id]"],
  [/^\/pint-index\/[^/]+$/, "/pint-index/[month]"],
  [/^\/plan\/[^/]+$/, "/plan/[id]"],
  [/^\/plan\/[^/]+\/recap$/, "/plan/[id]/recap"],
  [/^\/recap\/[^/]+$/, "/recap/[storyId]"],
  [/^\/rounds\/[^/]+$/, "/rounds/[code]"],
  [/^\/u\/[^/]+$/, "/u/[handle]"],
  [/^\/u\/[^/]+\/lists\/[^/]+$/, "/u/[handle]/lists/[listType]"],
];

function analyticsHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function analyticsUrlWithoutQuery(value: unknown): string | null {
  const url = analyticsHttpUrl(value);
  return url ? `${url.origin}${url.pathname}` : null;
}

export function analyticsReferrerFromUrl(value: unknown, currentUrl: unknown): string | null {
  const referrer = analyticsHttpUrl(value);
  if (!referrer) return null;
  const current = analyticsHttpUrl(currentUrl);
  if (!current || referrer.origin !== current.origin) return referrer.origin;
  const surface = analyticsPageviewSurfaceFromPath(referrer.pathname);
  return surface ? `${referrer.origin}${surface}` : null;
}

/**
 * Validate the path shape shared by analytics sinks. Unknown encoded values
 * fail closed before either purpose-specific vocabulary is applied.
 */
export function safeAnalyticsPathname(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 120) return null;
  const pathname = path.split("?")[0];
  if (
    pathname.includes("#")
    || pathname.includes("%")
    || /[\u0000-\u001f\u007f]/.test(pathname)
  ) return null;
  return pathname;
}

/** Closed pageview vocabulary with every dynamic value replaced by a template. */
export function analyticsPageviewSurfaceFromPath(path: unknown): string | null {
  const pathname = safeAnalyticsPathname(path);
  if (!pathname) return null;
  if (PAGEVIEW_STATIC_SURFACES.has(pathname)) return pathname;
  return PAGEVIEW_DYNAMIC_SURFACES
    .find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
