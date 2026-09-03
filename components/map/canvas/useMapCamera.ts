import { useCallback, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import * as maplibregl from "maplibre-gl";
import type { Venue } from "@/lib/venues";
import { LONG_JUMP_CURVE, easeOutCubic } from "./easing";
import { createCameraIntentCoordinator, type CameraIntentKind } from "@/lib/cameraIntent";
import { mapVisibleBand, nearMeCameraFrame, nearestVenueKm } from "@/lib/nearMeMapFrame";

type MapView = { center: [number, number]; zoom: number; pitch: number; bearing: number };

// Chrome the near-me camera must stay clear of. The top values are only a
// FALLBACK: the phone chrome stack is being reworked, and a hardcoded height
// would drift the reader silently under a changed chip row. Measure it.
const PHONE_TOP_INSET = 190;
const PHONE_BOTTOM_INSET = 190;
const DESKTOP_TOP_INSET = 150;
const DESKTOP_BOTTOM_INSET = 110;

const PHONE_ROUTE_PADDING = { top: 160, right: 28, bottom: 200, left: 28 };
const MIN_ROUTE_CONTENT_PX = 48;

function routeFitPadding(
  map: maplibregl.Map,
  isPhone: boolean,
): number | maplibregl.PaddingOptions {
  if (!isPhone) return 90;
  const container = map.getContainer();
  const verticalScale = Math.min(
    1,
    Math.max(0, (container.clientHeight - MIN_ROUTE_CONTENT_PX)
      / (PHONE_ROUTE_PADDING.top + PHONE_ROUTE_PADDING.bottom)),
  );
  const horizontalScale = Math.min(
    1,
    Math.max(0, (container.clientWidth - MIN_ROUTE_CONTENT_PX)
      / (PHONE_ROUTE_PADDING.left + PHONE_ROUTE_PADDING.right)),
  );
  return {
    top: Math.floor(PHONE_ROUTE_PADDING.top * verticalScale),
    right: Math.floor(PHONE_ROUTE_PADDING.right * horizontalScale),
    bottom: Math.floor(PHONE_ROUTE_PADDING.bottom * verticalScale),
    left: Math.floor(PHONE_ROUTE_PADDING.left * horizontalScale),
  };
}

/** The one sheet class that can cover the map on a phone. */
const BOTTOM_SHEET_SELECTOR = ".mobileSharedSheet.open";

/** The floating chrome stack above the map on a phone. */
const TOP_CHROME_SELECTOR = ".mobileMapChrome";

/** Breathing room between the lowest chrome and the reader's own band. */
const TOP_CHROME_GAP_PX = 12;

/**
 * Bottom edge of the map's own floating chrome, in map-container pixels.
 *
 * Measured for the same reason the sheet is: it is a stack whose rows come and
 * go (a query chip, a rail, a search row), so its height is a fact about the
 * moment rather than a constant. Falls back to the inset above when it cannot
 * be read.
 */
function measureTopChromeBottom(containerTop: number, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const chrome = document.querySelector(TOP_CHROME_SELECTOR);
  if (!chrome) return fallback;
  const rect = chrome.getBoundingClientRect();
  if (rect.height <= 0) return fallback;
  return rect.bottom - containerTop + TOP_CHROME_GAP_PX;
}

// Long enough to read as travel between two places, short enough that the
// answer does not feel withheld. Matches the pub-select fly-to.
const NEAR_ME_CAMERA_DURATION_MS = 700;

/** Give up waiting for the sheet after this; a stuck sheet must not strand the camera. */
const SHEET_SETTLE_TIMEOUT_MS = 900;

/** Frames the sheet edge must hold still before its geometry is trusted. */
const SHEET_SETTLE_STABLE_FRAMES = 4;

/**
 * Less cover than this is a sheet that has not grown yet, not a band. The
 * near-me sheet mounts at full height of nothing and springs open, so its first
 * frame reports an edge at the bottom of the screen.
 */
const SHEET_UNGROWN_COVER_PX = 64;

/**
 * Top edge of an open bottom sheet, in map-container pixels, or null when no
 * sheet covers the map. Measured because a contextual sheet is content-height:
 * its snap cap is a maximum, not the height it settles at, so no constant can
 * stand in for it.
 */
function measureBottomSheetTop(containerTop: number): number | null {
  if (typeof document === "undefined") return null;
  const sheet = document.querySelector(BOTTOM_SHEET_SELECTOR);
  if (!sheet) return null;
  const rect = sheet.getBoundingClientRect();
  if (rect.height <= 0) return null;
  return rect.top - containerTop;
}

/**
 * Call back with the sheet's resting top edge, once it has one.
 *
 * The camera aims ONCE, from here. An earlier version aimed immediately and
 * then re-aimed when the sheet settled, which looked like the camera missing
 * and correcting itself on every single open: the first reading is taken while
 * the sheet is still a sliver at the bottom of the screen, so the correction
 * was the norm and it was worth about 180px of pan. Under reduced motion it was
 * worse still, because both moves were instant jumps.
 *
 * Waiting costs about a third of a second before the camera starts, and nothing
 * is withheld in that time: the sheet and its list are what the reader is
 * watching. Watching the edge needs no knowledge of the sheet's own spring,
 * which is why it is done this way.
 */
function whenBottomSheetSettles(
  containerTop: number,
  done: (coverTop: number | null) => void,
): void {
  const measure = (): number | null => {
    const top = measureBottomSheetTop(containerTop);
    if (top === null) return null;
    // Still growing. Not a band yet, and not "no sheet" either.
    return top;
  };
  if (typeof requestAnimationFrame === "undefined" || typeof document === "undefined") {
    done(measure());
    return;
  }
  const containerHeight = document.documentElement.clientHeight;
  const grown = (top: number | null): boolean =>
    top !== null && containerHeight - top >= SHEET_UNGROWN_COVER_PX;
  // No sheet at all (desktop, or a near-me answer with no sheet host): there is
  // nothing to wait for, so do not spend the timeout finding that out.
  if (!document.querySelector(BOTTOM_SHEET_SELECTOR)) {
    done(null);
    return;
  }
  const startedAt = performance.now();
  let previous = measure();
  let stableFrames = 0;
  const step = () => {
    const current = measure();
    stableFrames = current === previous ? stableFrames + 1 : 0;
    previous = current;
    const settled = grown(current) && stableFrames >= SHEET_SETTLE_STABLE_FRAMES;
    if (settled || performance.now() - startedAt > SHEET_SETTLE_TIMEOUT_MS) {
      // A sheet that never grew is treated as no cover rather than as a band
      // pinned to the bottom of the screen.
      done(grown(current) ? current : null);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

type CameraRefs = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  reducedRef: MutableRefObject<boolean>;
  mapViewRef: MutableRefObject<MapView>;
  cityBoundsRef: MutableRefObject<[[number, number], [number, number]]>;
  routeRef: MutableRefObject<Venue[]>;
  venuesRef: MutableRefObject<Venue[]>;
};

// The four camera helpers, extracted verbatim from PubMapCanvas. Each reads live
// refs and keeps EMPTY dep arrays — that is intentional and load-bearing: the
// helpers must always act on the latest map/route/venues without being recreated
// (recreating them would re-fire the arrival/refit effects that consume them).
export function useMapCamera(refs: CameraRefs) {
  const { mapRef, reducedRef, mapViewRef, cityBoundsRef, routeRef, venuesRef } = refs;
  const coordinator = useMemo(() => createCameraIntentCoordinator({
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    onRun: (kind, sequence) => {
      performance.mark(`pubmax:camera-intent:${kind}`);
      window.dispatchEvent(new CustomEvent("pubmax:camera-intent", {
        detail: { kind, sequence },
      }));
    },
  }), []);

  // Every camera intent passes through this single lane. A newer intent
  // coalesces a still-pending move and interrupts any active MapLibre
  // animation before it begins, so route, nearby, cluster, and venue moves
  // cannot fight each other on screen.
  const scheduleCamera = useCallback((kind: CameraIntentKind, key: string, move: (map: maplibregl.Map) => void) => {
    const run = () => {
      const map = mapRef.current;
      if (!map) return;
      map.stop();
      move(map);
    };
    coordinator.schedule(kind, key, run);
  }, [coordinator, mapRef]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  // Explicit camera move for venue, route, and city navigation.
  const cinematic = useCallback((options: maplibregl.EaseToOptions, kind: CameraIntentKind = "venue") => {
    const duration = reducedRef.current ? 0 : (options.duration ?? 1000);
    const center = Array.isArray(options.center)
      ? options.center.join(",")
      : options.center && "lng" in options.center
        ? `${options.center.lng},${options.center.lat}`
        : "current";
    scheduleCamera(kind, `${kind}:${center}:${options.zoom ?? "current"}:${options.pitch ?? "current"}`, (map) => map.easeTo({ ...options, duration }));
  }, [reducedRef, scheduleCamera]);

  const fitRoute = useCallback(() => {
    const current = routeRef.current;
    if (current.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera("route", `route:${current.map((venue) => venue.id).join(">")}`, (map) => map.fitBounds(bounds, {
      padding: routeFitPadding(map, isPhone),
      maxZoom: 15,
      duration: reducedRef.current ? 0 : 800,
      // fitBounds defaults bearing to 0, silently flattening a rotated map on
      // every route fit (and the flat camera then persists via the session
      // snapshot). Preserve the user's current rotation instead.
      bearing: map.getBearing(),
    }));
  }, [reducedRef, routeRef, scheduleCamera]);

  // Fit the active city's bounds (not a city switcher — CitySwitcher owns that).
  const fitCityBounds = useCallback(() => {
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const view = mapViewRef.current;
    // M3: fit-London / city-switch is a "long jump" — fitBounds animates via
    // flyTo by default (linear defaults to false), so `curve` shapes its arc.
    scheduleCamera("city", `city:${cityBoundsRef.current.flat().join(",")}`, (map) => map.fitBounds(cityBoundsRef.current, {
      padding: isPhone
        ? { top: 184, right: 24, bottom: 190, left: 24 }
        : 90,
      maxZoom: 11,
      duration: reducedRef.current ? 0 : 800,
      curve: reducedRef.current ? undefined : LONG_JUMP_CURVE,
      pitch: view.pitch,
      bearing: view.bearing,
    }));
  }, [cityBoundsRef, mapViewRef, reducedRef, scheduleCamera]);

  // Borough browse arrival: frame the filtered venue set once (query owns the
  // camera). Skip if the user already tapped a pin — don't fight selectedVenue
  // fly-to. Padding mirrors fitRoute; maxZoom ~13 keeps outer boroughs readable.
  const fitQueryVenues = useCallback(() => {
    const current = venuesRef.current;
    if (current.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera("query", `query:${current.map((venue) => venue.id).join(">")}`, (map) => map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 13,
      duration: reducedRef.current ? 0 : 800,
      // Same flattening trap as fitRoute: keep the current rotation.
      bearing: map.getBearing(),
    }));
  }, [reducedRef, scheduleCamera, venuesRef]);

  // Near me puts the READER on the map, not a cloud of pubs. A fitBounds over
  // nearby venues centres the cloud, which drops the reader wherever the
  // geometry leaves them — on a phone, under the near-me sheet. `nearMeCameraFrame`
  // keeps the centre on the reader and lets only zoom and screen offset move.
  const fitNearby = useCallback(
    (location: { lat: number; lng: number }, nearbyVenues: Venue[]) => {
      const map = mapRef.current;
      if (!map) return;
      const isPhone = window.matchMedia("(max-width: 640px)").matches;
      const container = map.getContainer().getBoundingClientRect();
      const viewport = { width: container.width, height: container.height };
      const reach = nearestVenueKm(location, nearbyVenues);
      const venueKey = nearbyVenues.map((venue) => venue.id).join(">");
      const locationKey = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
      // One move, aimed at the band the reader actually ends up with. See
      // whenBottomSheetSettles for why this waits rather than aiming twice.
      whenBottomSheetSettles(container.top, (coverTop) => {
        const band = mapVisibleBand({
          height: viewport.height,
          topInset: isPhone
            ? measureTopChromeBottom(container.top, PHONE_TOP_INSET)
            : DESKTOP_TOP_INSET,
          coverTop,
          bottomInset: isPhone ? PHONE_BOTTOM_INSET : DESKTOP_BOTTOM_INSET,
        });
        const frame = nearMeCameraFrame({ location, nearestVenueKm: reach, viewport, band });
        scheduleCamera("nearby", `nearby:${locationKey}:${band.bottom}:${venueKey}`, (target) => target.easeTo({
          center: frame.center,
          zoom: frame.zoom,
          offset: frame.offset,
          // The move has one job: carry the reader's eye from the city to their
          // own street. Ease-out starts fast, so the arrival reads as an answer
          // rather than a slow pan. Reduced motion takes the same frame in one
          // instant jump, which is why there is only ever one move to take.
          duration: reducedRef.current ? 0 : NEAR_ME_CAMERA_DURATION_MS,
          easing: easeOutCubic,
          pitch: isPhone ? 28 : 34,
          // Keep the current rotation (a fit would zero it otherwise).
          bearing: target.getBearing(),
        }));
      });
    },
    [mapRef, reducedRef, scheduleCamera],
  );

  return { cinematic, fitRoute, fitCityBounds, fitQueryVenues, fitNearby };
}
