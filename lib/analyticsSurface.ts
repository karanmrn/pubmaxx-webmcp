import { safeAnalyticsPathname } from "@/lib/analyticsPath";

const PRODUCT_EVENT_STATIC_SURFACES = new Set([
  "/",
  "/map",
  "/moment",
  "/out",
  "/pal",
  "/plan",
  "/social",
  "/tonight",
  "/you",
]);

const PRODUCT_EVENT_DYNAMIC_SURFACES: readonly [RegExp, string][] = [
  [/^\/messages\/[^/]+$/, "/messages/[id]"],
  [/^\/plan\/[^/]+$/, "/plan/[id]"],
  [/^\/rounds\/[^/]+$/, "/rounds/[code]"],
  [/^\/u\/[^/]+$/, "/u/[handle]"],
];

/**
 * Original closed path vocabulary for registry-known product events.
 * Pageview work must not widen which product-event paths leave the browser.
 */
export function analyticsSurfaceFromPath(path: unknown): string | null {
  const pathname = safeAnalyticsPathname(path);
  if (!pathname) return null;
  if (PRODUCT_EVENT_STATIC_SURFACES.has(pathname)) return pathname;
  return PRODUCT_EVENT_DYNAMIC_SURFACES
    .find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
