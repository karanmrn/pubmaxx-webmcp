import { getCity, parseCityId } from "@/lib/cities";
import { cityMapShareUrl } from "@/lib/cityShare";
import { takeEarlyWarmJson } from "@/lib/mapEarlyWarm";

export type MapWarmConnection = {
  saveData?: boolean;
  effectiveType?: string;
};

export type MapWarmFetchInit = {
  cache?: "force-cache";
};

export type MapWarmDeps = {
  fetch: (url: string, init?: MapWarmFetchInit) => Promise<unknown>;
  navigator: unknown;
  paths?: readonly string[];
  seen?: Set<string>;
};

export type MapCanvasWarmState = {
  status: "idle" | "scheduled" | "loaded";
};

export type MapCanvasWarmDeps = {
  navigator: unknown;
  schedule: (callback: () => void) => void;
  load: () => Promise<unknown>;
  state: MapCanvasWarmState;
};

export const MAP_INTENT_WARM_PATHS = [
  // Intent warmup can prepare the core before navigation. The document's own
  // first-paint warmup uses only the manifest and opening cells.
  "/data/venues_slim.manifest.json",
  "/data/venues_slim.core.json",
  "/data/london_pois.json",
  "/data/tfl_lines.json",
] as const;

const BLOCKED_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);
const sessionSeen = new Set<string>();

/**
 * Split by what the paths are FOR: the venue index is what makes pins exist on
 * the first frame; POIs and transit lines are overlays the canvas deliberately
 * defers past that frame. A reader heading TO the map wants both warmed; a
 * reader already ON it must only be handed the first pair, or the warm competes
 * with the paint it is meant to help.
 */
function mapWarmPathsFor(href: string): { venueIndex: string[]; overlays: string[] } {
  const path = href.split("?")[0] || href;
  const londonDefault = {
    venueIndex: ["/data/venues_slim.manifest.json", "/data/venues_slim.core.json"],
    overlays: ["/data/london_pois.json", "/data/tfl_lines.json"],
  };
  if (path === "/map" || path === "/map/") return londonDefault;
  const match = /^\/map\/([^/]+)\/?$/.exec(path);
  if (!match) return londonDefault;
  const cityId = parseCityId(match[1]);
  if (!cityId) return londonDefault;
  const city = getCity(cityId);
  const overlays: string[] = [];
  if (city.poisPath) overlays.push(city.poisPath);
  if (city.transitLinesPath) overlays.push(city.transitLinesPath);
  return { venueIndex: [city.slimVenuesPath], overlays };
}

/** Slim (+ optional POI/transit) paths to warm for a map href. */
export function warmPathsForMapHref(href: string): readonly string[] {
  const { venueIndex, overlays } = mapWarmPathsFor(href);
  return [...venueIndex, ...overlays];
}

/** Only the venue index: what the map's FIRST frame reads. */
export function mapFirstPaintWarmPaths(href: string): readonly string[] {
  const path = href.split("?")[0] || href;
  if (path === "/map" || path === "/map/") {
    return ["/data/venues_slim.manifest.json"];
  }
  return mapWarmPathsFor(href).venueIndex;
}

export function shouldWarmMapIntent(nav: unknown): boolean {
  if (!nav || typeof nav !== "object") return false;

  const connection = (nav as { connection?: unknown }).connection;
  if (!connection) return true;
  if (typeof connection !== "object") return true;

  const { saveData, effectiveType } = connection as MapWarmConnection;
  if (saveData === true) return false;
  return !(
    typeof effectiveType === "string" && BLOCKED_EFFECTIVE_TYPES.has(effectiveType)
  );
}

export function warmMapIntentData({
  fetch: doFetch,
  navigator: nav,
  paths = MAP_INTENT_WARM_PATHS,
  seen,
}: MapWarmDeps): void {
  if (!shouldWarmMapIntent(nav)) return;

  for (const path of paths) {
    if (seen?.has(path)) continue;
    if (takeEarlyWarmJson(path) !== undefined) {
      seen?.add(path);
      continue;
    }
    seen?.add(path);

    try {
      void Promise.resolve(doFetch(path, { cache: "force-cache" })).catch(() => {
        // Best-effort warmup only. Navigation must never depend on it.
      });
    } catch {
      // Best-effort warmup only. Navigation must never depend on it.
    }
  }
}

/**
 * Loads the large MapLibre canvas chunk during idle time on connections that
 * have not asked us to conserve data. State lives outside this helper so a
 * failed chunk request can be retried by a later map intent.
 */
export function scheduleMapCanvasWarmup({
  navigator: nav,
  schedule,
  load,
  state,
}: MapCanvasWarmDeps): void {
  if (state.status !== "idle" || !shouldWarmMapIntent(nav)) return;
  state.status = "scheduled";
  try {
    schedule(() => {
      if (!shouldWarmMapIntent(nav)) {
        state.status = "idle";
        return;
      }
      try {
        void Promise.resolve(load()).then(
          () => {
            state.status = "loaded";
          },
          () => {
            state.status = "idle";
          },
        );
      } catch {
        state.status = "idle";
      }
    });
  } catch {
    state.status = "idle";
  }
}

export function warmMapIntent(): void {
  warmMapIntentData({
    fetch: (url, init) =>
      typeof fetch === "function"
        ? fetch(url, init)
        : Promise.reject(new Error("fetch unavailable")),
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    seen: sessionSeen,
  });
}

/** Session-deduped route prefetch + slim-data warm (landing CTAs + tab bar). */
const warmedRoutes = new Set<string>();
const mapCanvasWarmState: MapCanvasWarmState = { status: "idle" };

function warmMapCanvasModule(): void {
  if (typeof window === "undefined") return;
  scheduleMapCanvasWarmup({
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    schedule: (callback) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(callback, { timeout: 2_000 });
        return;
      }
      // Browsers without requestIdleCallback still get a background window
      // rather than competing with source-page hydration.
      globalThis.setTimeout(callback, 2_000);
    },
    load: () => import("@/components/PubMapCanvas"),
    state: mapCanvasWarmState,
  });
}

export type MapRoutePrefetcher = {
  prefetch: (href: string) => void;
};

/**
 * Prefetch any App Router href once per session. Map destinations also warm
 * the slim venue (+ POI/transit) payloads the canvas will request next.
 * Best-effort only — navigation never depends on success.
 */
export function warmNavRoute(
  router: MapRoutePrefetcher,
  href: string,
  seen: Set<string> = warmedRoutes,
): void {
  // A fragment never reaches the server, so it is no part of what to warm.
  // Prefetching the hash-bearing URL also keyed the router cache under an
  // address the click then had to reconcile, and the landed URL lost its
  // fragment: the price receipt's "See your impact" link stopped scrolling to
  // the contribution card it names.
  const prefetchHref = href.split("#")[0]?.split("?")[0] || href;
  const isMapRoute = prefetchHref === "/map" || prefetchHref.startsWith("/map/");
  if (isMapRoute) warmMapCanvasModule();
  if (!prefetchHref || seen.has(prefetchHref)) return;
  try {
    router.prefetch(prefetchHref);
    // Only mark warmed AFTER a successful prefetch call — a throw here (dev
    // HMR, router-not-mounted, transient) must let the next intent retry
    // rather than get silently deduped forever.
    seen.add(prefetchHref);
  } catch {
    // Best-effort — navigation must never depend on prefetch. Leave `seen`
    // untouched so a follow-up hover/touch can try again.
    return;
  }
  // Only warm slim/POI payloads for map routes (not Discover etc.).
  if (isMapRoute) {
    warmMapIntentData({
      fetch: (url, init) =>
        typeof fetch === "function"
          ? fetch(url, init)
          : Promise.reject(new Error("fetch unavailable")),
      navigator: typeof navigator !== "undefined" ? navigator : undefined,
      paths: warmPathsForMapHref(prefetchHref),
      seen: sessionSeen,
    });
  }
}

/**
 * Wave K2 — warm map navigation on intent.
 * Prefetches the Next.js route chunk and the city slim (+ POI/transit) payloads
 * once per session. Does not prefetch full venue detail.
 */
export function warmMapRoute(
  router: MapRoutePrefetcher,
  href = "/map",
  seen: Set<string> = warmedRoutes,
): void {
  warmNavRoute(router, href, seen);
}

/**
 * Arriving ON the map: warm only the MapLibre canvas module.
 *
 * The map loader owns its foreground manifest and shard requests. Data and
 * service-worker warmup wait until first pins are visible, so cold navigation
 * keeps the same request path as main. The deferred overlays (POIs, transit)
 * stay out of this foreground path.
 */
export function warmMapFirstPaint(): void {
  if (typeof window === "undefined") return;
  scheduleMapCanvasWarmup({
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    // No idle wait: this IS the foreground work.
    schedule: (callback) => callback(),
    load: () => import("@/components/PubMapCanvas"),
    state: mapCanvasWarmState,
  });
}

/** Convenience: first-paint warm for a known city id. */
export function warmCityMapFirstPaint(cityId: string): void {
  void cityId;
  warmMapFirstPaint();
}

/** Convenience: warm the share URL for a known city id. */
export function warmCityMapRoute(
  router: MapRoutePrefetcher,
  cityId: string,
  seen?: Set<string>,
): void {
  warmMapRoute(router, cityMapShareUrl(cityId), seen);
}
