"use client";

import dynamic from "next/dynamic";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map/mapColor.css";

import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import {
  Crosshair,
  ExternalLink,
  Landmark as LandmarkIcon,
  MapPinned,
  Navigation2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { nearestStoryPubs } from "@/lib/landmarkVenueProximity";
import type { Landmark } from "@/lib/landmarks";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import { bandMemberPubs } from "@/lib/storyBandVenueProximity";
import type { StoryBand } from "@/lib/storyBands";
import {
  loadPoisFromPath,
  LONDON_POIS_PATH,
  POI_CATEGORY_META,
  type PoiCategory,
} from "@/lib/pois";
import {
  defaultPoiHidden,
  defaultPoiHiddenForViewport,
  defaultPoiHiddenMobile,
  type PoiHiddenChange,
} from "@/lib/poiToggleGroups";
const MapLayersControl = dynamic(() => import("@/components/map/MapLayersControl"), {
  ssr: false,
});
import LandmarkPhotoCredit from "@/components/LandmarkPhotoCredit";
import MapHeroCard from "@/components/map/MapHeroCard";
import type { CityId } from "@/lib/cities";
import { cityMaxBounds, DEFAULT_CITY_ID, getCity } from "@/lib/cities";
import {
  mapCameraFocusKey,
  mapCameraFocusMoves,
  type MapCameraFocus,
} from "@/lib/mapCameraFocus";
import { resolveCompassAction } from "@/lib/mapCompass";
import { selectMapFallbackPubs } from "@/lib/mapFallbackVenues";
import {
  createIdleOrbit,
  orbitBearingStep,
  ORBIT_DEG_PER_SEC,
  ORBIT_FIRST_DELAY_MS,
  ORBIT_FRAME_INTERVAL_MS,
  ORBIT_INTERACTION_DELAY_MS,
  ORBIT_MAX_BEARING_STEP_DEG,
  ORBIT_VIEWPORT_PUBLISH_INTERVAL_MS,
  shouldPublishOrbitViewport,
  type IdleOrbit,
} from "@/lib/mapOrbit";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { opportunitiesToGeoJSON } from "@/lib/thingsToDoMap";
import { formatPrice, type Venue } from "@/lib/venues";
import type {
  CategoryPriceIndexStatus,
  MapLensPrice,
} from "@/lib/mapExperienceLens";
import { projectedItemIdsInViewport } from "@/lib/mapVenueList";
import type { VenueSignal, HoveredVenue, VenueDetailResponse, FailedHoverImage } from "@/components/map/canvas/types";
import {
  MAP_STYLES, FALLBACK_STYLES, STYLE_LOAD_TIMEOUT_MS, LONDON_VIEW, UK_BOUNDS,
  OSM_ATTRIBUTION,
  DASH_SEQ,
  GLOW_BASE_STROKE_OPACITY, GLOW_BASE_STROKE_WIDTH,
  PIN_ENTRANCE_BUCKETS, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS, PIN_ENTRANCE_TOTAL_MS,
  readTokens,
  type Tokens,
} from "@/components/map/canvas/tokens";
import {
  pubsToGeoJSON, poisToGeoJSON, routeToLine, routeToStops,
  bandCorridorGeoJSON, landmarksToGeoJSON,
} from "@/components/map/canvas/geojson";
import type { VenueWhatsOnSummary } from "@/lib/whatsOnBadges";
import {
  applyPoiCategoryVisibility,
  TONIGHT_OPPORTUNITY_LAYERS, pubIconOpacityExpr, glowPulsePaint,
  pinEntranceIconSizeExpr, pinEntranceIconOpacityExpr,
  selectedPinIconSizeExpr, selectedPinFilter, pinSortKeyExpr, pinPriceLabelExpr,
  clusterEntranceProgress,
} from "@/components/map/canvas/filters";
import {
  HOVER_CARD_VIEWPORT_GUTTER_PX, HOVER_CARD_WIDTH_PX, HOVER_CARD_HEIGHT_PX,
  HOVER_CARD_MIN_TOP_PX, HOVER_CARD_X_OFFSET_PX, HOVER_CARD_Y_OFFSET_PX,
  withBoundedHoverDetailCache, hoverCardCopy, hoverImageUrlFor,
} from "@/components/map/canvas/hoverCard";
import {
  assembleSceneCritical,
  assembleSceneDeferred,
  applySelectionState,
  buildLandmarks,
  buildTransitLines,
  CLUSTER_FILL_OPACITY,
  CLUSTER_STROKE_OPACITY,
  UK_BASE_MIN_ZOOM,
  type SceneCtx,
} from "@/components/map/canvas/buildScene";
import { createDonutClusterSync, type DonutClusterSync } from "@/components/map/canvas/donutClusters";
import {
  BASEMAP_RETRY_NOTICE,
  PIN_PAINT_RETRY_NOTICE,
  createPinRevealCoordinator,
  pinRetryPendingNotice,
  pinRetrySpentNotice,
  revealTimeoutNotice,
  venueDataFailureNotice,
  venueRetryMayDispatch,
  venueRetrySettleNotice,
  venueRetrySpentAfterRead,
  type BasemapNoticeOwner,
  type PinRevealNoticeKind,
} from "@/components/map/canvas/pinRevealCoordinator";
import { applySelectionMute } from "@/lib/mapBasemapTaste";
import { MAP_PIN_REVEAL_EVENT } from "@/lib/mapPinRevealEvent";
import {
  wireClickRouting, wireHoverPrefetch, wirePubHover, wireCursor,
} from "@/components/map/canvas/interactions";
import { installPaintedPinProbe } from "@/components/map/canvas/paintedPinProbe";
import { useMapCamera } from "@/components/map/canvas/useMapCamera";
import { easeOutCubic, PUB_SELECT_PITCH, PUB_SELECT_PITCH_MOBILE, PUB_SELECT_DURATION_MS } from "@/components/map/canvas/easing";
import { mobileSelectCameraOffset } from "@/lib/sheetSnap";
import { nearMeMapVenues } from "@/lib/nearMeMapFrame";
import {
  isUkBaseId,
  type UkBasePub,
  type UkBaseStreamStatus,
} from "@/lib/ukBasePubs";
import { useUkBaseStreaming } from "@/components/map/pubmap/useUkBaseStreaming";
import type { MapViewportSnapshot } from "@/lib/mobileShell";
import {
  PAINT_WATCHDOG_INTERVAL_MS,
  PAINT_WATCHDOG_MAX_RETRIES,
  shouldRecoverPaint,
} from "@/lib/mapPaintWatchdog";
import {
  INITIAL_TILE_FAILURE_SPEND,
  areBasemapTilesLoaded as readBasemapTilesLoaded,
  basemapFailureSurface,
  classifyTileFailure,
  createBasemapTileFailureTracker,
  isCriticalBasemapFailure,
  markTileFailureSurfaced,
  markTileRetrySpent,
  pruneTileFailures,
  spendTileFailureDecision,
  tileFailureRecheckDelay,
} from "@/lib/mapTileFailure";
import {
  CONTEXT_LOST_RECOVERY_MS,
  contextHealthAction,
  isMapWebGlContextLost,
  snapshotMapCamera,
  type MapCameraSnapshot,
} from "@/components/map/canvas/webglRecovery";
import {
  deriveMapRenderedState,
  EMPTY_MAP_RENDERED_STATE,
  sameMapRenderedState,
  type MapRenderedState,
} from "@/lib/mapRenderedState";
import { markPubmaxTiming } from "@/lib/performanceMarks";

// MapLibre 6 is ESM-only. Its worker imports a sibling shared module, which
// Next's asset URL transform does not emit beside the worker. The predev and
// prebuild copy step preserves that pair under one same-origin public path.
maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

type PubMapCanvasProps = {
  venues: Venue[];
  /** First-visit choice owns interaction while the map stays visibly ready. */
  interactionLocked?: boolean;
  /** Parent's slim venue read has settled for the active city. */
  venueDataReady: boolean;
  route: Venue[];
  selectedVenueId: string;
  onVenueClick: (id: string) => void;
  /**
   * A tap on the UK base layer — an OSM pub with no price and no venue record.
   * Handed up whole (it exists nowhere else in the app) so PubMap can open the
   * unverified sheet without a lookup. Absent = base taps do nothing.
   */
  onUkBasePubClick?: (pub: UkBasePub) => void;
  onUkBasePubsChange?: (pubs: UkBasePub[]) => void;
  onUkBaseStatusChange?: (status: UkBaseStreamStatus) => void;
  /**
   * Every drawable base pub currently resident from useUkBaseStreaming (padded
   * viewport shards in memory). Distinct from onUkBasePubsChange, which is the
   * visible-on-canvas subset for the list and provisional marks. Map search
   * matches names against this set — never the country-wide pack.
   */
  onUkBaseResidentPubsChange?: (pubs: UkBasePub[]) => void;
  /**
   * Exact DOM-list membership, derived by projecting coordinates into the
   * rendered canvas. Geographic bounds overstate a pitched or rotated view.
   */
  onVisibleVenueIdsChange?: (membership: {
    curatedVenueIds: string[];
    ukBasePubIds: string[];
  }) => void;
  onRenderedStateChange?: (state: MapRenderedState) => void;
  /**
   * Keep exact DOM-list membership in step with each camera frame while its
   * operable list is open. Closed-list counts settle on moveend.
   */
  venueListOpen?: boolean;
  /**
   * A restored `?sel=venue-uk-*` arrival: the base pub's id plus the `at=`
   * location hint the selecting tap wrote alongside it. Seeds the selection
   * camera (the id names no venue record, so nothing else knows where to fly)
   * and asks the base stream to hand the whole record up once its cell loads,
   * so the unverified sheet reopens like a curated ?sel= does. Null when the
   * arrival named no base pub or the link carried no hint (older links
   * degrade to the selection ring only).
   */
  ukBaseRestore?: { id: string; lat: number; lng: number } | null;
  onRouteStopClick: (id: string) => void;
  /** Speculative warm of `/api/venue/[id]` on press-start / hover intent. */
  onVenuePrefetch?: (id: string) => void;
  venueSignals?: Map<string, VenueSignal>;
  /** Canonical beer id (lib/beers). When set, pins re-price to it; non-serving pubs dim. */
  favoritePint?: string | null;
  /** Active drink category. Its trusted category lens owns pin colour and label. */
  drinkCategory?: string | null;
  /**
   * W1: venueId-joined What's-On summary per venue (quiz/sport/deal/music on
   * tonight). Drives pin BADGES through the existing pin pipeline. Absent =
   * no badges.
   */
  whatsOnByVenue?: Map<string, VenueWhatsOnSummary> | null;
  /**
   * Venues carrying an in-window pint report that has not earned the map yet.
   * Paints the provisional badge and nothing else — the price a pin claims
   * still arrives only through `venueSignals`
   * (components/map/communityPriceSignals.ts).
   */
  provisionalVenueIds?: ReadonlySet<string> | null;
  /** Dedicated no-alcohol or food figures, separate from pint signals. */
  lensPrices?: ReadonlyMap<string, MapLensPrice> | null;
  /** What the active lens is called inside a sentence ("whisky"). */
  lensNoun?: string | null;
  /** How complete the lens's cross-venue read was, for the hover card's line. */
  lensIndexStatus?: CategoryPriceIndexStatus;
  /** Optional: lets PubMap render the history card in its own panel instead. */
  onLandmarkSelect?: (landmark: Landmark | null) => void;
  /** Issue #15 story bands — active band id ("" = none), synced to the URL by PubMap. */
  activeBandId?: string;
  /** Called when the band picker changes the active band. */
  onBandChange?: (bandId: string) => void;
  /** "Start a crawl here" from a landmark card — receives 2-3 nearest pub ids. */
  onStartCrawl?: (pubIds: string[]) => void;
  /** "Ask the PUBMAXXER" from a landmark card — receives the nearest story pub id. */
  onAskPubmaxxer?: (venueId: string) => void;
  /** Deep-link a landmark history card open on arrival (`?landmark=`). */
  initialLandmarkId?: string;
  /** Reports when the canvas can replace the parent's loading chrome. */
  onMapReady?: (ready: boolean) => void;
  /**
   * Called with `true` the moment the canvas commits to its user-facing error
   * fallback (WebGL failure, tiles down, context-lost, zero-size, …), and
   * `false` when a Retry click clears the error. Parents use this to drop any
   * loading skeleton that would otherwise hide the honest error card — the
   * `onMapReady(true)` we ALSO emit on error only lifts the "waiting for
   * scene" branch; a separate signal is needed when slim pins are still in
   * flight so the skeleton doesn't linger on top of the fallback.
   */
  onMapErrored?: (errored: boolean) => void;
  /**
   * Opening camera from CityConfig.mapView. Defaults to London for back-compat
   * when the multi-city router has not wired a city yet.
   */
  mapView?: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  };
  /** IndexedDB last-view camera, applied after its async read completes. */
  resumeViewport?: MapViewportSnapshot | null;
  /**
   * MapLibre maxBounds [[west, south], [east, north]]. Defaults to the UK pack
   * boundary while mapView continues to own the city-specific opening frame.
   */
  maxBounds?: [[number, number], [number, number]];
  /**
   * Optional POI JSON path from CityConfig.poisPath. `null` skips the London
   * POI fetch so non-London cities do not 404 on `/data/london_pois.json`.
   * Omit / undefined keeps the London default for back-compat.
   */
  poisPath?: string | null;
  /**
   * Optional transit GeoJSON path from CityConfig.transitLinesPath. `null`
   * skips TfL tube-line layers. Omit / undefined keeps London TfL default.
   */
  transitLinesPath?: string | null;
  /**
   * City landmark catalog (from landmarksForCity). Defaults to London.
   * Empty array skips the landmark layer entirely.
   */
  cityLandmarks?: Landmark[];
  /**
   * City Place-story corridors (from storyBandsForCity). Defaults to London.
   */
  cityStoryBands?: StoryBand[];
  /**
   * Active city — gates London-only hero tie-break (Prospect of Whitby) and
   * city-aware Layers chrome. Defaults to london for back-compat.
   */
  cityId?: CityId;
  /** CityMCP tonight opportunities (London). Drawn when tonightOverlayVisible. */
  tonightOpportunities?: ThingsToDoOpportunity[];
  tonightOverlayVisible?: boolean;
  onTonightOpportunityClick?: (op: ThingsToDoOpportunity) => void;
  /**
   * Borough browse arrival (`?q=`): fit the filtered venue set once after
   * style/load so outer-London places land framed, not on the city default.
   */
  fitQueryOnArrival?: boolean;
  /**
   * Reactive search framing. When a live search narrows to more than one match
   * the parent bumps this token; each new value re-frames the camera onto the
   * current (filtered) venue set so a query never dead-ends on vanished pins.
   * A single match is handled by selection (the cinematic fly-to below), not
   * this token. Starts at 0 (no-op) so first paint is untouched.
   */
  searchFitToken?: number;
  /** Precise location retained only in memory after explicit permission. */
  userLocation?: { lat: number; lng: number } | null;
  poiHidden?: Record<PoiCategory, boolean>;
  onPoiHiddenChange?: (next: PoiHiddenChange) => void;
  hideLayersControl?: boolean;
  /** Price key, price cap and list live in Layers, not as floating chrome. */
  layersReaderKey?: ReactNode;
  layersReaderPriceFilter?: (close: () => void) => ReactNode;
  /**
   * Re-run the owner's venue-index load. The canvas holds no fetcher of its
   * own, so a ceiling that named the pub list has no honest Retry without it.
   */
  onReloadVenueData?: () => void;
  /**
   * The owner's venue-index read REFUSED. Distinct from `venueDataReady`, which
   * settles either way so a failed read still gets the honest empty state.
   */
  venueDataFailed?: boolean;
  listOpen?: boolean;
  onListOpenChange?: (open: boolean) => void;
  listCount?: number;
  onSoftRetryChange?: (active: boolean) => void;
  /**
   * Area button fly-to: bump `token` to fly the camera to `center` (a Night
   * Area centre). Reduced-motion is honoured by the shared `cinematic` helper
   * (it jumps at duration 0). Null / an unchanged token is a no-op.
   */
  focusPoint?: MapCameraFocus | null;
  onViewportChange?: (viewport: MapViewportSnapshot) => void;
  /**
   * Fired once the reader moves the camera themselves — a drag, a pinch, a
   * wheel zoom. Programmatic flights carry no originalEvent, so they never
   * fire it. Ambient banners use this to step off the map (design judgement
   * 2026-08-01, finding 2.15).
   */
  onUserCameraMove?: () => void;
  /**
   * Emitted (on first idle + every moveend) with the current viewport edges so
   * the map can lazily load the slim-index shards it intersects (Cycle-5).
   */
  onBoundsChange?: (bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  }) => void;
};


// Short fallback that un-gates local pins when the normal handoff stalls, so
// the pub layers cannot hang hidden indefinitely. This runs behind the
// still-present parent skeleton and never lifts the chrome.
const PIN_REVEAL_TIMEOUT_MS = 3000;
// Honest upper bound for the visible-map handoff. Desktop and phone both
// degrade to the existing basemap retry toast; neither unmounts the canvas.
// Phone still requires a confirmed visible frame before a successful reveal.
// Keep the ceiling above the measured slow stream. The phone can reveal local
// pins from their own painted source before basemap tiles settle; this ceiling
// remains only for the honest parent loading handoff when that signal fails.
const PIN_READY_CEILING_MS = 12_000;
// How long a spent pin Retry is given before it reports back. Long enough for a
// re-fetched venue index plus a MapLibre source settle, short enough that the
// reader is not left watching an empty map with nothing to read.
const PIN_RETRY_WAIT_MS = 6_000;
// MapLibre's GeoJSON worker and render events can lead the phone compositor by
// several frames. Keep honest loading chrome through that observed handoff.
const PHONE_PIN_COMPOSITE_HOLD_MS = 500;
// First-painted-frame watchdog. `style.load` is a network/parse event — it can
// fire (and retire the parent's loading chrome) in a browser whose WebGL
// context was GRANTED but whose render loop never produces a frame (dead
// software rasterizer, stalled rAF, GPU-process crash after context creation).
// Without this, that browser sits on a permanently blank canvas with no
// fallback: sceneSettled=true cleared the hang guard, and no error ever fires.
// MapLibre's "render" event only fires from a real frame, so its absence for
// this long after construction is the honest "the map never drew" signal.
const FIRST_FRAME_TIMEOUT_MS = 10_000;
// How many venues the no-map fallback lists so the venue content stays
// reachable without a single WebGL frame.
const FALLBACK_VENUE_COUNT = 6;
// Every pub-source layer, gated together through the basemap gate on desktop
// and the stricter source-aware visible-frame handoff on phone.
const PUB_PIN_LAYERS = [
  "pubs-drops-halo",
  "pubs-whatson-badge",
  "band-members-halo",
  "pubs-point",
  "pubs-point-selected",
  "pubs-selected-glow",
  "pubs-selected",
  "pubs-provisional-badge",
  "clusters",
  "cluster-count",
] as const;

function probeWebGl2(): { hasContext: boolean; status: string } {
  let status = "";
  try {
    const canvas = document.createElement("canvas");
    canvas.addEventListener(
      "webglcontextcreationerror",
      (event) => {
        status = (event as WebGLContextEvent).statusMessage || status;
      },
      { once: true },
    );
    const context = canvas.getContext("webgl2");
    const hasContext = Boolean(context);
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return { hasContext, status };
  } catch {
    return { hasContext: false, status };
  }
}



export default function PubMapCanvas({
  venues,
  interactionLocked = false,
  venueDataReady,
  route,
  selectedVenueId,
  onVenueClick,
  onUkBasePubClick,
  onUkBasePubsChange,
  onUkBaseStatusChange,
  onUkBaseResidentPubsChange,
  onVisibleVenueIdsChange,
  onRenderedStateChange,
  venueListOpen = false,
  ukBaseRestore = null,
  onRouteStopClick,
  onVenuePrefetch,
  venueSignals = new Map(),
  favoritePint = null,
  drinkCategory = null,
  whatsOnByVenue = null,
  provisionalVenueIds = null,
  lensPrices = null,
  lensNoun = null,
  lensIndexStatus = "ready",
  onLandmarkSelect,
  activeBandId = "",
  onBandChange,
  onStartCrawl,
  onAskPubmaxxer,
  initialLandmarkId = "",
  onMapReady,
  onMapErrored,
  mapView = LONDON_VIEW,
  resumeViewport = null,
  maxBounds = UK_BOUNDS,
  poisPath = LONDON_POIS_PATH,
  transitLinesPath = "/data/tfl_lines.json",
  cityLandmarks = [],
  cityStoryBands = [],
  cityId = DEFAULT_CITY_ID,
  tonightOpportunities = [],
  tonightOverlayVisible = false,
  onTonightOpportunityClick,
  fitQueryOnArrival = false,
  searchFitToken = 0,
  userLocation = null,
  poiHidden: controlledPoiHidden,
  onPoiHiddenChange,
  hideLayersControl = false,
  layersReaderKey,
  layersReaderPriceFilter,
  onReloadVenueData,
  venueDataFailed = false,
  listOpen = false,
  onListOpenChange,
  listCount = 0,
  onSoftRetryChange,
  focusPoint = null,
  onViewportChange,
  onUserCameraMove,
  onBoundsChange,
}: PubMapCanvasProps) {
  const showLandmarks = cityLandmarks.length > 0;
  const landmarkById = useCallback(
    (id: string | null | undefined) =>
      id ? cityLandmarks.find((lm) => lm.id === id) : undefined,
    [cityLandmarks],
  );
  const bandById = useCallback(
    (id: string | null | undefined) =>
      id ? cityStoryBands.find((band) => band.id === id) : undefined,
    [cityStoryBands],
  );
  const activeBand = useMemo(
    () => bandById(activeBandId),
    [activeBandId, bandById],
  );
  const landmarksGeoJSON = useMemo(
    () => landmarksToGeoJSON(cityLandmarks),
    [cityLandmarks],
  );
  // Same selector the near-me chip counts, so the highlighted pins and the
  // chip's number can never drift apart.
  const nearbyMapVenues = useMemo(
    () => (userLocation ? nearMeMapVenues(userLocation.lat, userLocation.lng, venues) : []),
    [userLocation, venues],
  );
  const userLocationGeoJSON = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: userLocation
        ? [{
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [userLocation.lng, userLocation.lat] },
        }]
        : [],
    }),
    [userLocation],
  );
  const cityBounds = useMemo(
    () => cityMaxBounds(getCity(cityId)),
    [cityId],
  );
  // Refs for camera/bounds + landmark seed so the MapLibre mount effect does not
  // tear down on parent re-renders that only change object identity.
  const mapViewRef = useRef(mapView);
  const maxBoundsRef = useRef(maxBounds);
  const cityBoundsRef = useRef(cityBounds);
  const landmarksGeoJSONRef = useRef(landmarksGeoJSON);
  const showLandmarksRef = useRef(showLandmarks);
  useEffect(() => {
    mapViewRef.current = mapView;
    maxBoundsRef.current = maxBounds;
    cityBoundsRef.current = cityBounds;
    landmarksGeoJSONRef.current = landmarksGeoJSON;
    showLandmarksRef.current = showLandmarks;
  }, [mapView, maxBounds, cityBounds, landmarksGeoJSON, showLandmarks]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userCameraInteractionRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(() => mapView.bearing ?? 0);
  const orbitRef = useRef<IdleOrbit | null>(null);
  const lastOrbitViewportPublishAtRef = useRef(0);
  const publishCurrentViewportRef = useRef<(() => void) | null>(null);
  // Keep the latest parent callback without reading/writing refs during render
  // (react-hooks/refs). Build/event handlers + error paths read this when ready flips.
  const onMapReadyRef = useRef(onMapReady);
  const onMapErroredRef = useRef(onMapErrored);
  const onRenderedStateChangeRef = useRef(onRenderedStateChange);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
    onMapErroredRef.current = onMapErrored;
    onRenderedStateChangeRef.current = onRenderedStateChange;
  }, [onMapReady, onMapErrored, onRenderedStateChange]);
  const publishMapReady = useCallback((ready: boolean) => {
    setMapReady(ready);
    onMapReadyRef.current?.(ready);
  }, []);
  const publishMapErrored = useCallback((errored: boolean) => {
    onMapErroredRef.current?.(errored);
  }, []);
  // The fallback is a real user-facing dead end, so it carries enough to be
  // honest about *why*: `kind` drives the copy (only "constructor" with a
  // confirmed-dead probe may claim "needs WebGL"), `detail` surfaces the raw
  // browser diagnostic, and it never fires on a transient GPU hiccup because
  // the mount effect auto-retries once before ever setting this.
  const [mapError, setMapError] = useState<{
    message: string;
    detail?: string;
    kind: "constructor" | "zero-size" | "context-lost" | "tiles" | "no-frame";
    // true only when the detached-canvas probe returned no context at all, so
    // Retry would be pointless — this is the sole case that hides the button.
    noWebgl?: boolean;
  } | null>(null);
  // Whether the collapsed technical-diagnostic disclosure is expanded. A plain
  // React-controlled toggle rather than native <details>/<summary>: this mount
  // effect's RAF loop (pin entrance / dash / pulse) never tears down just
  // because mapError is set, and that continuous rendering activity raced
  // native <details> click-activation in headless/CDP-driven clicks often
  // enough to be a real flake (native toggle occasionally missed the click
  // entirely). A controlled button+conditional-render has no such race.
  const [detailOpen, setDetailOpen] = useState(false);
  const reportMapError = useCallback(
    (error: NonNullable<typeof mapError>) => {
      // Lift the parent's loading chrome so this honest error card is visible
      // (Wave K2 kept the overlay until mapReady — failures must still resolve it).
      // Also broadcast a distinct errored signal so a parent whose skeleton
      // still has other gates (e.g. slim pins in flight) can drop it and let
      // the fallback show through.
      publishMapReady(true);
      publishMapErrored(true);
      // First writer wins. Several independent watchdogs can lapse inside the
      // same dead episode, and the LATER one is the vaguer one: a tile source
      // that refused is diagnosed by `surfaceBasemapFailure` at 8s, and the
      // first-frame watchdog would overwrite it at 10s with "this browser
      // cannot show the map", blaming the device for an unreachable server.
      // Retry clears mapError, so the next episode reports freely.
      setMapError((current) => current ?? error);
    },
    [publishMapErrored, publishMapReady],
  );
  // Bumped to re-run the mount effect: once silently (auto-retry after a
  // constructor throw) and again on the user's Retry click. The cleanup fully
  // tears the map down, so each bump is a clean re-init.
  const [initAttempt, setInitAttempt] = useState(0);
  // Soft, non-destructive retry chip for recoverable basemap failures (dead
  // WebGL after iOS app-switch, accumulated tile errors after first paint).
  // Keeps DOM overlays alive instead of replacing the whole canvas with the
  // full fallback card — silent grey is the defect we refuse to ship.
  const [softRetry, setSoftRetry] = useState<{
    kind: "context-lost" | "tiles" | PinRevealNoticeKind;
    message: string;
  } | null>(null);
  // The pin lanes' Retry lives inside the mount effect, beside the signals it
  // spends and the wait it arms; the button only calls through this seam.
  const pinRetryRef = useRef<((kind: PinRevealNoticeKind) => void) | null>(null);
  const onReloadVenueDataRef = useRef(onReloadVenueData);
  useEffect(() => {
    onReloadVenueDataRef.current = onReloadVenueData;
  }, [onReloadVenueData]);
  const venueDataFailedRef = useRef(venueDataFailed);
  useEffect(() => {
    venueDataFailedRef.current = venueDataFailed;
  }, [venueDataFailed]);
  // Arms the mount effect's pin-notice ownership from outside it, so a notice
  // raised by the owner's read can still be cleared by the render/idle pair
  // that watches for recovery.
  const armPinNoticeRef = useRef<(() => void) | null>(null);
  const venueRetrySpentRef = useRef(false);
  const venueRetryInFlightRef = useRef(false);
  // The ask resets with the failure it describes: a later refusal, on this city
  // or the next, is that read's FIRST ask and may not be worded as a second.
  // A Retry dispatch is not a read, so spent stays put while the live index
  // fetch is still in flight.
  useEffect(() => {
    if (venueRetryInFlightRef.current) return;
    if (venueDataReady && !venueDataFailed) venueRetrySpentRef.current = false;
  }, [venueDataReady, venueDataFailed]);
  // Venue Retry follows the dispatched index read, never a clock. Extra taps
  // while that read is live start no second fetch.
  useEffect(() => {
    if (!venueRetryInFlightRef.current) return;
    const outcome = !venueDataReady
      ? "pending"
      : venueDataFailed
        ? "failed"
        : "ready";
    if (outcome === "pending") return;
    venueRetryInFlightRef.current = false;
    venueRetrySpentRef.current = venueRetrySpentAfterRead(
      venueRetrySpentRef.current,
      outcome,
    );
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setSoftRetry((current) => {
        if (current && current.kind !== "venues" && current.kind !== "pins") {
          return current;
        }
        return venueRetrySettleNotice(outcome);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [venueDataReady, venueDataFailed]);
  // A venue index that REFUSED owes its own notice. It cannot wait for the
  // readiness ceiling, because a refused read still settles the source, so the
  // reveal happens on time over an empty `pubs` layer and no ceiling ever
  // fires - which is how a failed pub list became a silent empty map. This is a
  // DERIVATION rather than an edge, so a basemap notice that outranks it and
  // then retires hands the surface back rather than taking the message with it.
  useEffect(() => {
    if (venueRetryInFlightRef.current) return;
    if (!venueDataFailed) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      armPinNoticeRef.current?.();
      setSoftRetry((current) => {
        if (current && current.kind !== "venues" && current.kind !== "pins") {
          return current;
        }
        return venueDataFailureNotice(venueRetrySpentRef.current);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [venueDataFailed, softRetry]);
  // The full fallback card replaces this canvas, toast included, so a surface
  // that budgets one toast must not keep hiding its own notice behind a toast
  // nobody can see.
  useEffect(() => {
    onSoftRetryChange?.(softRetry !== null && mapError === null);
  }, [softRetry, mapError, onSoftRetryChange]);
  // Camera snapshot restored after a context-loss re-init so selection/camera
  // state survives the tear-down (selection is React state; camera is MapLibre).
  const recoveryViewRef = useRef<MapCameraSnapshot | null>(null);
  // Component-scoped budget: one silent auto re-init per dead-context episode.
  // Construct-scoped flags reset on every effect re-run and would loop forever
  // if the new canvas is also dead. User Retry (soft toast / full card) resets.
  const contextAutoReinitSpentRef = useRef(false);
  const appliedResumeViewportKeyRef = useRef<string | null>(null);
  const [activeLandmark, setActiveLandmark] = useState<Landmark | null>(() =>
    initialLandmarkId ? landmarkById(initialLandmarkId) ?? null : null,
  );
  const initialLandmarkConsumedRef = useRef<string | null>(null);
  const [heroDismissed, setHeroDismissed] = useState(false);
  const [hoveredVenue, setHoveredVenue] = useState<HoveredVenue | null>(null);
  const hoveredVenueId = hoveredVenue?.id ?? null;
  const [hoverDetails, setHoverDetails] = useState<Map<string, Venue | null>>(
    () => new Map(),
  );
  const hoverDetailsRef = useRef(hoverDetails);
  const [failedHoverImage, setFailedHoverImage] = useState<FailedHoverImage | null>(null);
  // POI layer visibility — seed from the live viewport so desktop doesn't flash
  // all-hidden, while mobile first paint stays clean (all categories off).
  // Only rewrite defaults when the viewport band actually changes — never on
  // every mount tick (a fresh object would re-filter layers and look like flicker).
  const [internalPoiHidden, setInternalPoiHidden] = useState<Record<PoiCategory, boolean>>(
    defaultPoiHiddenForViewport,
  );
  const poiHidden = controlledPoiHidden ?? internalPoiHidden;
  const setPoiHidden = useCallback((next: PoiHiddenChange) => {
    if (onPoiHiddenChange) onPoiHiddenChange(next);
    else setInternalPoiHidden(next);
  }, [onPoiHiddenChange]);
  const poiViewportMobileRef = useRef<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => {
      const isMobile = mq.matches;
      if (poiViewportMobileRef.current === isMobile) return;
      poiViewportMobileRef.current = isMobile;
      const next = isMobile ? defaultPoiHiddenMobile() : defaultPoiHidden();
      // Defer setState out of the effect body (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => setPoiHidden(next));
    };
    // Record the mount band without dispatching: both state owners already
    // seed viewport defaults (or a restored session) at init, and a mount
    // dispatch here would wipe restored layer choices on every canvas mount.
    if (poiViewportMobileRef.current === null) {
      poiViewportMobileRef.current = mq.matches;
    } else {
      sync();
    }
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [setPoiHidden]);
  // Open when a band is already active (e.g. `?band=` deep link). Layers owns
  // the corridor picker UI; canvas only paints the active corridor.
  const [activePoi, setActivePoi] = useState<{ name: string; category: PoiCategory } | null>(null);

  const onVenueClickRef = useRef(onVenueClick);
  const onUkBasePubClickRef = useRef<((pub: UkBasePub) => void) | undefined>(undefined);
  // The last base pub a tap resolved, so the selection camera has coordinates
  // for a pin that exists in no venue list. Keyed by id: a stale entry can
  // never move the camera for a different selection. Seeded from a restored
  // ?sel= arrival's `at=` hint so the selection fly-to works before (and
  // without) any tap.
  const ukBaseSelectionRef = useRef<{ id: string; center: [number, number] } | null>(
    ukBaseRestore
      ? { id: ukBaseRestore.id, center: [ukBaseRestore.lng, ukBaseRestore.lat] }
      : null,
  );
  /** Resident base pubs for search/list selection fly-to (not a tap-resolved ref). */
  const ukBaseResidentPubsRef = useRef<UkBasePub[]>([]);
  const onRouteStopClickRef = useRef(onRouteStopClick);
  const onVenuePrefetchRef = useRef(onVenuePrefetch);
  const onLandmarkSelectRef = useRef(onLandmarkSelect);
  const onTonightOpportunityClickRef = useRef(onTonightOpportunityClick);
  const onViewportChangeRef = useRef(onViewportChange);
  const onUserCameraMoveRef = useRef(onUserCameraMove);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const cityLandmarksRef = useRef(cityLandmarks);
  const tonightOpportunitiesRef = useRef(tonightOpportunities);
  const tonightOverlayVisibleRef = useRef(tonightOverlayVisible);
  const hoverDetailLoadingRef = useRef<Set<string>>(new Set());
  const rememberHoverDetail = useCallback((id: string, venue: Venue | null) => {
    const next = withBoundedHoverDetailCache(hoverDetailsRef.current, id, venue);
    hoverDetailsRef.current = next;
    setHoverDetails(next);
  }, []);
  useEffect(() => {
    onVenueClickRef.current = onVenueClick;
    onUkBasePubClickRef.current = onUkBasePubClick
      ? (pub) => {
          ukBaseSelectionRef.current = { id: pub.id, center: [pub.lng, pub.lat] };
          onUkBasePubClick(pub);
        }
      : undefined;
    onRouteStopClickRef.current = onRouteStopClick;
    onVenuePrefetchRef.current = onVenuePrefetch;
    onLandmarkSelectRef.current = onLandmarkSelect;
    onTonightOpportunityClickRef.current = onTonightOpportunityClick;
    onViewportChangeRef.current = onViewportChange;
    onUserCameraMoveRef.current = onUserCameraMove;
    onBoundsChangeRef.current = onBoundsChange;
    cityLandmarksRef.current = cityLandmarks;
  }, [
    onVenueClick,
    onUkBasePubClick,
    onRouteStopClick,
    onVenuePrefetch,
    onLandmarkSelect,
    onTonightOpportunityClick,
    onViewportChange,
    onUserCameraMove,
    onBoundsChange,
    cityLandmarks,
  ]);

  useEffect(() => {
    if (!resumeViewport) {
      appliedResumeViewportKeyRef.current = null;
      return;
    }
    const resumeKey = `${resumeViewport.center[0]},${resumeViewport.center[1]},${resumeViewport.zoom},${resumeViewport.pitch},${resumeViewport.bearing}`;
    if (
      appliedResumeViewportKeyRef.current === resumeKey ||
      !mapReady ||
      !mapRef.current
    ) return;
    const map = mapRef.current;
    if (userCameraInteractionRef.current || map.isMoving()) return;
    try {
      map.jumpTo({
        center: resumeViewport.center,
        zoom: resumeViewport.zoom,
        pitch: resumeViewport.pitch,
        bearing: resumeViewport.bearing,
      });
      appliedResumeViewportKeyRef.current = resumeKey;
      publishCurrentViewportRef.current?.();
      map.triggerRepaint();
    } catch {
      // A resume is an optimisation. A map that is still constructing can ignore it.
    }
  }, [mapReady, resumeViewport]);

  // Latest data lives in refs so buildScene can reseed sources after a
  // theme-driven setStyle wipes them.
  const pubsDataRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  // Empty until the reader grants a position, so a style rebuild always has a
  // payload to hand the source.
  const userLocationDataRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const venueDataReadyRef = useRef(venueDataReady);
  useLayoutEffect(() => {
    venueDataReadyRef.current = venueDataReady;
  }, [venueDataReady]);
  // UK base pubs for the CURRENT viewport only (useUkBaseStreaming refills it
  // on every settled camera). Held as a ref like every other source payload so
  // a theme setStyle can reseed the layer without a refetch.
  const ukBaseDataRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const poisDataRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const routeLineRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const routeStopsRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const tonightDataRef = useRef<GeoJSON.FeatureCollection>(
    opportunitiesToGeoJSON([]),
  );
  // Story-band corridor (a tinted line through the anchors); reseeded after a
  // theme setStyle wipes sources, same pattern as the other data refs.
  const bandCorridorRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  // The active band's token colour, read into the corridor + member-halo paint
  // on each build (a setStyle rebuild re-reads it from the live tokens).
  const bandColorRef = useRef<string>("#4f9ec4");
  const activeBandColourTokenRef = useRef(
    activeBand?.colourToken ?? null,
  );
  const renderedStateRef = useRef<MapRenderedState>(
    EMPTY_MAP_RENDERED_STATE,
  );
  // Member pub ids of the active band under the CURRENT filters — drives the
  // halo layer's filter. Empty = no halo (and the picker shows the honest
  // "no pubs visible" fallback).
  const bandMemberIdsRef = useRef<string[]>([]);
  const venuesRef = useRef(venues);
  useEffect(() => {
    venuesRef.current = venues;
  }, [venues]);
  const selectedIdRef = useRef(selectedVenueId);
  // M7 pin entrance — armed once per mount at the first ACTUAL pin reveal
  // (settleSceneReady when the D2 tile-paint gate never armed, else that
  // gate's revealPins), and driven off the shared entrance/dash/pulse RAF loop
  // below. `active` gates the per-frame work; `startedAt` anchors elapsed
  // time. Never re-armed by a theme swap or filter change — see
  // startPinEntrance's own fire-once `pinEntranceFired` guard.
  const pinEntranceActiveRef = useRef(false);
  const pinEntranceStartRef = useRef(0);
  // buildScene reads this on every (re)build so a theme swap keeps the toggles.
  const poiHiddenRef = useRef(poiHidden);
  // M2 — pre-mute paint originals for the POI-at-initiation selection mute
  // (layerId::prop → value). Owned here so it survives buildScene rebuilds; a
  // theme setStyle wipes the live layers, so buildScene clears + re-applies it.
  const selectionMuteStoreRef = useRef<Map<string, unknown>>(new Map());
  const publishRenderedState = useCallback((tokens: Tokens) => {
    const next = deriveMapRenderedState(
      pubsDataRef.current,
      tokens,
      activeBandColourTokenRef.current,
    );
    // A band without its own story colour rings in river, never coral —
    // coral rings belong to selection alone (design judgement 2026-08-01).
    bandColorRef.current = next.storyColour ?? tokens.riverBright;
    if (sameMapRenderedState(renderedStateRef.current, next)) return next;
    renderedStateRef.current = next;
    onRenderedStateChangeRef.current?.(next);
    return next;
  }, []);

  // Structural style gate for mutations that depend on the style graph
  // resources. Effects fire on their own React cadence, including during a
  // theme setStyle({diff:false}) swap while `mapReady` remains true. Queue those
  // writes by key and flush the latest mutation on style.load. Existing GeoJSON
  // sources use structural-readiness paths instead because isStyleLoaded() also
  // waits for tiles and images; their setData calls are safe once the source
  // exists and must not wait for another style.load that may never arrive.
  // Structural style readiness owned by this component. MapLibre's public
  // style.load event fires after the style graph is ready for source/layer
  // mutations, while isStyleLoaded() also waits for source tiles and images.
  // Every app-owned setStyle clears this first; the accepted style.load sets it.
  const styleStructureReadyRef = useRef(false);
  const pendingUpdatesRef = useRef<Map<string, (map: maplibregl.Map) => void>>(new Map());
  const applyToMap = useCallback(
    (key: string, fn: (map: maplibregl.Map) => void) => {
      const map = mapRef.current;
      if (!map) return;
      if (styleStructureReadyRef.current) {
        fn(map);
      } else {
        pendingUpdatesRef.current.set(key, fn);
      }
    },
    [],
  );

  // Route sources (route-line + route-stops) get a MORE PERMISSIVE readiness gate
  // than applyToMap. `isStyleLoaded()` also waits on basemap tiles/sprite, which
  // can stay in flight for seconds AFTER `style.load` — and updating an existing
  // GeoJSON source with setData is safe in that window (it touches source data,
  // not style structure). The crawl route survives the stricter gate only because
  // the user keeps mutating stops (each edit re-fires the write, and by a later
  // one the tiles have loaded). The active-plan route is set ONCE and never
  // re-triggered, so a single write that landed mid-tiles got queued for a
  // `style.load` that may never come again — and the overlay silently never
  // painted. Gate on our style.load lifecycle state so a
  // set-once route paints as soon as the style is structurally ready; queue for
  // the next style.load only while the style itself is still swapping (buildScene
  // re-seeds these sources from the refs on that load, so nothing is lost).
  const applyRouteData = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const run = (m: maplibregl.Map) => {
      (m.getSource("route-line") as maplibregl.GeoJSONSource | undefined)?.setData(
        routeLineRef.current,
      );
      (m.getSource("route-stops") as maplibregl.GeoJSONSource | undefined)?.setData(
        routeStopsRef.current,
      );
    };
    if (styleStructureReadyRef.current && map.getSource("route-stops")) {
      run(map);
    } else {
      // Style still swapping: the imminent style.load re-seeds these sources from
      // the refs AND flushes this fn — either path draws the latest route.
      pendingUpdatesRef.current.set("route:data", run);
    }
  }, []);

  const reducedRef = useRef(false);
  const blurredRef = useRef(false);
  const themeRef = useRef<"dark" | "light">("dark");
  const textFontRef = useRef<string[]>(["Noto Sans Bold"]);
  const hoverCapableRef = useRef(false);

  // Live route mirror so the camera helpers (and the Recenter control) read the
  // latest ordered stops from a ref without needing a fresh closure.
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  // Camera helpers (cinematic + fit*) — extracted to useMapCamera; empty-dep
  // callbacks over live refs (see the hook for why the deps must stay empty).
  const { cinematic, fitRoute, fitCityBounds, fitQueryVenues, fitNearby } = useMapCamera({
    mapRef,
    reducedRef,
    mapViewRef,
    cityBoundsRef,
    routeRef,
    venuesRef,
  })

  const selectLandmark = useCallback((landmark: Landmark | null) => {
    setActiveLandmark(landmark);
    onLandmarkSelectRef.current?.(landmark);
  }, []);

  // Deep-link ?landmark= may arrive before the city's landmark catalog loads.
  // Open the history card once the catalog can resolve the id, not only on mount.
  useEffect(() => {
    if (
      !initialLandmarkId ||
      initialLandmarkConsumedRef.current === initialLandmarkId
    ) {
      return;
    }
    const landmark = landmarkById(initialLandmarkId);
    if (!landmark) return;
    initialLandmarkConsumedRef.current = initialLandmarkId;
    if (activeLandmark) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) selectLandmark(landmark);
    });
    return () => {
      cancelled = true;
    };
  }, [initialLandmarkId, activeLandmark, landmarkById, selectLandmark]);

  useEffect(() => {
    if (!initialLandmarkId || !mapReady) return;
    const landmark = landmarkById(initialLandmarkId);
    if (!landmark) return;
    cinematic({ center: landmark.coordinates, zoom: 15, duration: 800 }, "landmark");
  }, [initialLandmarkId, mapReady, landmarkById, cinematic]);

  // Every deliberate camera move arrives here: the opening-location answer and
  // the area lane (choose-area pick, "go somewhere else", a map-search select).
  // The identity is the SOURCE plus its own counter, because a bare number let
  // one owner's first move look like the other's and swallowed the pick
  // (lib/mapCameraFocus.ts). cinematic honours reduced-motion (it jumps at
  // duration 0), so this needs no extra guard here.
  const focusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapReady || !focusPoint) return;
    if (!mapCameraFocusMoves(focusPoint, focusKeyRef.current)) return;
    focusKeyRef.current = mapCameraFocusKey(focusPoint);
    cinematic(
      { center: focusPoint.center, zoom: focusPoint.zoom, duration: 900 },
      "area",
    );
  }, [mapReady, focusPoint, cinematic]);

  useEffect(() => {
    if (!hoveredVenueId) return;
    const id = hoveredVenueId;
    if (
      hoverDetailsRef.current.has(id) ||
      hoverDetailLoadingRef.current.has(id)
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    hoverDetailLoadingRef.current.add(id);

    fetch(`/api/venue/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as VenueDetailResponse;
        return payload.venue ?? null;
      })
      .then((venue) => {
        rememberHoverDetail(id, venue);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        rememberHoverDetail(id, null);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        hoverDetailLoadingRef.current.delete(id);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hoveredVenueId, rememberHoverDetail]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    styleStructureReadyRef.current = false;
    themeRef.current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";

    // R3 — .maplibreMap's CSS background (app/globals.css) is a flat
    // `var(--ink-deep)`, matched to dark mode only. It shows through in the
    // window before the canvas has painted anything: initial construct
    // (pre style.load), and every theme swap (setStyle drops the old style's
    // painted frame, and the new style's own "background" layer repaint —
    // applySceneTaste in buildScene.ts — only lands once style.load fires).
    // In dark theme ink-deep IS the right colour so that gap is invisible;
    // in light theme it renders a dark-navy field instead of the warm
    // paper tone, which reads as a broken/un-tiled basemap. An inline style
    // (higher specificity than the class rule, no globals.css edit needed)
    // keeps the container itself theme-correct through that gap — belt to
    // the D2 tile-paint gate's suspenders, not a replacement for it.
    const paintContainerBase = (theme: "light" | "dark") => {
      if (containerRef.current) {
        containerRef.current.style.background = theme === "dark" ? "var(--ink-deep)" : "var(--paper)";
      }
    };
    paintContainerBase(themeRef.current);
    hoverCapableRef.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const phoneFirstImpression = window.matchMedia("(max-width: 640px)").matches;
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = reducedQuery.matches;
    performance.clearMarks("pubmax:pin-entrance-settled");
    const onReducedChange = () => {
      reducedRef.current = reducedQuery.matches;
      orbitRef.current?.refreshGate();
    };
    reducedQuery.addEventListener("change", onReducedChange);

    // Window blur pauses motivated map animation, matching document.hidden.
    // Some browsers blur without hiding the tab.
    const onBlur = () => {
      blurredRef.current = true;
    };
    const onFocus = () => {
      blurredRef.current = false;
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    // Timers/observers this effect owns; cleanup below tears them all down so a
    // re-run (theme dep change, auto-retry, or Retry click) starts clean.
    let sizeObserver: ResizeObserver | undefined;
    let sizeProceedTimer: ReturnType<typeof setTimeout> | undefined;
    let autoRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let contextLostTimer: ReturnType<typeof setTimeout> | undefined;
    let didConstruct = false;
    let constructCleanup: (() => void) | undefined;
    let deferredSceneIdleId: number | null = null;
    let deferredSceneFrameId: number | null = null;
    let deferredTransitFallbackTimer: number | null = null;
    let deferredTransitHandler: (() => void) | null = null;

    // --- Size gate. `.mapStage` is `absolute inset:0` inside a 100dvh shell, so
    // it should be sized at mount — but if the shell hasn't laid out yet MapLibre
    // would build against a 0×0 canvas and paint nothing. Rather than construct
    // blind, wait (briefly) for a real box. This eliminates the 0-size hypothesis
    // entirely: we only construct once the container has area, or after a short
    // proceed-anyway timeout (so a genuinely-hidden container never hangs).
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      sizeObserver = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box && box.width > 0 && box.height > 0) {
          sizeObserver?.disconnect();
          sizeObserver = undefined;
          if (sizeProceedTimer) clearTimeout(sizeProceedTimer);
          if (!didConstruct) construct();
        }
      });
      sizeObserver.observe(container);
      sizeProceedTimer = setTimeout(() => {
        sizeObserver?.disconnect();
        sizeObserver = undefined;
        if (!didConstruct) {
          console.warn(
            "[pubmap] constructing map in 0-size container",
            container.getBoundingClientRect(),
          );
          construct();
        }
      }, 2000);
    } else {
      construct();
    }

    // The full construct-and-wire body lives in a local function so the size
    // gate can defer it. `container`/timers above are closed over; everything
    // this function creates (the map, its listeners) is torn down in cleanup.
    function construct() {
      if (didConstruct) return;
      didConstruct = true;

    // MapLibre 6 emits GPUInitializationError instead of throwing when WebGL2
    // context creation fails. That event fires inside the constructor, before
    // callers can attach a listener, so use a supported browser capability
    // probe first and route failure through the existing bounded retry.
    const lowPower = initAttempt >= 1;
    let map: maplibregl.Map;
    try {
      const webgl2 = probeWebGl2();
      if (!webgl2.hasContext) {
        throw new Error(webgl2.status || "WebGL2 context unavailable");
      }
      map = new maplibregl.Map({
        container,
        style: MAP_STYLES[themeRef.current],
        ...mapViewRef.current,
        maxBounds: maxBoundsRef.current,
        // ODbL credit for the pub layers we draw ourselves. Set on the map, not
        // on a source, so it survives every style swap (theme toggle, fallback
        // styles) and shows in every city - the rail-lines source's own
        // attribution only exists in London (buildScene).
        attributionControl: {
          compact: true,
          customAttribution: OSM_ATTRIBUTION,
        },
        // Attempt 2 drops to low-power: some drivers refuse a
        // high-performance context under load but grant the integrated GPU.
        ...(lowPower ? { canvasContextAttributes: { powerPreference: "low-power" } } : {}),
      });
      // MapLibre creates a forced-compact attribution control in its expanded
      // state. Start with the native info affordance closed; later taps still
      // use MapLibre's own disclosure and keep every credit readable.
      container
        .querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button")
        ?.click();
    } catch (error) {
      reducedQuery.removeEventListener("change", onReducedChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);

      // MapLibre's constructor inserts its canvas-container DOM into
      // `container` BEFORE it validates/creates a GL context — so a throw
      // here still leaves those (now-orphaned, absolutely-positioned) nodes
      // behind. `constructCleanup` is only wired up on success, so nothing
      // else ever removes them; left alone, they silently overlay every
      // future render into this same container element — including, once
      // this reaches the honest fallback below, sitting on top of and
      // swallowing clicks meant for the fallback's own disclosure/Retry
      // controls. Strip them now so this attempt (auto-retry or the
      // fallback that follows) always starts from a clean container.
      container.replaceChildren();

      // Diagnostic probe on a throwaway canvas: does *any* WebGL context exist?
      // This distinguishes a truly WebGL-less browser (honest dead end, no
      // Retry) from a transient failure (worth retrying). We capture the
      // browser's own statusMessage via the webglcontextcreationerror event.
      const probe = probeWebGl2();
      const probeStatus = probe.status;
      const probeHasContext = probe.hasContext;

      // MapLibre embeds the browser's statusMessage as JSON in error.message.
      let embedded = "";
      const rawMessage =
        error instanceof Error ? error.message : "Map could not start in this browser.";
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed && typeof parsed.message === "string") embedded = parsed.message;
      } catch {
        // Not JSON — rawMessage is already human-ish.
      }

      const detail = [probeStatus, embedded, embedded ? "" : rawMessage]
        .filter(Boolean)
        .join(" · ");

      console.error("[pubmap] map init failed", {
        attempt: initAttempt,
        lowPower,
        probeHasContext,
        probeStatus,
        embedded,
        rawMessage,
      });

      // First failure gets one silent auto-retry — the common real-browser
      // cause is a transient context miss that a beat later succeeds.
      if (initAttempt === 0) {
        autoRetryTimer = setTimeout(() => setInitAttempt(1), 1500);
        return;
      }

      // Attempt 2 also threw. If the probe confirmed no context at all, be
      // honest that this browser lacks WebGL; otherwise it's a stubborn
      // constructor failure the user can Retry.
      queueMicrotask(() =>
        reportMapError(
          probeHasContext
              ? {
                kind: "constructor",
                message: "The map couldn't start.",
                detail: detail || undefined,
              }
            : {
                kind: "constructor",
                noWebgl: true,
                message: "This browser can't run the map. It needs WebGL.",
                detail: detail || undefined,
              },
        ),
      );
      return;
    }
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
      "top-right",
    );
    mapRef.current = map;
    let styleGeneration = 0;
    const cancelDeferredWork = () => {
      if (deferredSceneIdleId !== null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(deferredSceneIdleId);
        deferredSceneIdleId = null;
      }
      if (deferredSceneFrameId !== null) {
        cancelAnimationFrame(deferredSceneFrameId);
        deferredSceneFrameId = null;
      }
      if (deferredTransitHandler) {
        map.off("idle", deferredTransitHandler);
        deferredTransitHandler = null;
      }
      if (deferredTransitFallbackTimer !== null) {
        window.clearTimeout(deferredTransitFallbackTimer);
        deferredTransitFallbackTimer = null;
      }
    };
    // Sync the GL viewport to the laid-out container before the first tile
    // fetch. A missed or early resize leaves half the canvas on the pre-tile
    // backbuffer while the other half paints (captain screenshot, Aug 2026).
    const syncMapSize = () => {
      if (mapRef.current !== map) return;
      map.resize();
      map.triggerRepaint();
    };
    syncMapSize();
    requestAnimationFrame(syncMapSize);
    requestAnimationFrame(() => requestAnimationFrame(syncMapSize));
    map.once("load", syncMapSize);
    // Context-loss re-init: restore the pre-teardown camera so selection fly-ins
    // and the user's place on the map survive the rebuild. Selection/landmark
    // state is React-owned and already live across the effect re-run.
    const pendingRecovery = recoveryViewRef.current;
    if (pendingRecovery) {
      recoveryViewRef.current = null;
      const applyRecoveryCamera = () => {
        try {
          map.jumpTo({
            center: pendingRecovery.center,
            zoom: pendingRecovery.zoom,
            pitch: pendingRecovery.pitch,
            bearing: pendingRecovery.bearing,
          });
          map.triggerRepaint();
        } catch {
          /* ignore */
        }
      };
      if (map.loaded()) applyRecoveryCamera();
      else map.once("load", applyRecoveryCamera);
    }
    // A successful construct clears any soft-retry chip from the previous life.
    queueMicrotask(() => setSoftRetry(null));
    const emitBounds = () => {
      if (!onBoundsChangeRef.current) return;
      const b = map.getBounds();
      onBoundsChangeRef.current({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    };
    const publishCurrentViewport = () => {
      const center = map.getCenter();
      onViewportChangeRef.current?.({
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
      emitBounds();
    };
    publishCurrentViewportRef.current = publishCurrentViewport;
    // Start the location-scoped venue read as soon as MapLibre knows its
    // opening frame. Waiting for style or tile idle made the data request pay
    // for the basemap, which is the slower and independent lane.
    queueMicrotask(publishCurrentViewport);
    // A gesture carries an originalEvent; a programmatic fly does not. That is
    // the whole test: a banner steps off the map when the READER moves it, and
    // never when the app flies the camera for them.
    const emitUserCameraMove = (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return;
      userCameraInteractionRef.current = true;
      onUserCameraMoveRef.current?.();
    };
    map.on("dragstart", emitUserCameraMove);
    map.on("zoomstart", emitUserCameraMove);
    map.on("rotatestart", emitUserCameraMove);
    map.on("pitchstart", emitUserCameraMove);
    map.on("moveend", () => {
      // Audit F5: every camera move (programmatic flys included) ends on a
      // fresh present. A repaint moves no camera, so this cannot re-fire
      // moveend; deliberately NOT hooked on `idle` (that would loop).
      map.triggerRepaint();
      setMapBearing(map.getBearing());
      const orbiting = orbitRef.current?.state() === "orbiting";
      const now = performance.now();
      if (!shouldPublishOrbitViewport(
        orbiting,
        lastOrbitViewportPublishAtRef.current,
        now,
        ORBIT_VIEWPORT_PUBLISH_INTERVAL_MS,
      )) return;
      lastOrbitViewportPublishAtRef.current = orbiting ? now : 0;
      publishCurrentViewport();
    });
    // Pure rotation can finish without a moveend on touch devices.
    map.on("rotateend", () => setMapBearing(map.getBearing()));
    // Kick the initial viewport's shards (a restored session may open on an
    // Outer-London borough that core doesn't cover).
    map.once("idle", emitBounds);

    // MapLibre 6 resolves missing images before firing styleimagemissing, so
    // use its supported resolver. OpenFreeMap references sprite images we
    // never render at our zoom/layers; a transparent pixel keeps those misses
    // quiet without shipping the real texture.
    map.setMissingStyleImageResolver((id) => {
      if (!map.hasImage(id)) {
        map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });

    // Rebuilds the whole scene from theme tokens. Runs on first load and after
    // every theme-driven setStyle (style.load fires for both).
    //
    // buildSceneBody delegates the full source/layer assembly to assembleScene
    // (components/map/canvas/buildScene.ts); the wrapper keeps only the D2
    // tile-paint gate and the pendingUpdatesRef flush, which own component state.
    // One generation-scoped gate owns every pin reveal callback. A theme swap
    // cancels the previous generation before setStyle, so a late render/frame
    // from the old style can never mutate the new one.
    const areBasemapTilesLoaded = () => readBasemapTilesLoaded(map);
    let initialBasemapPending = true;
    let basemapTileReadyForPaint = false;
    let tileNoticeOwner: BasemapNoticeOwner = "none";
    let tileFailureStamps: number[] = [];
    let tileSpend = INITIAL_TILE_FAILURE_SPEND;
    let tileFailureGeneration = 0;
    let tileFailureRecheckTimer: ReturnType<typeof setTimeout> | undefined;
    const failedBasemapTiles = createBasemapTileFailureTracker();
    const clearTileFailureRecheck = () => {
      if (tileFailureRecheckTimer !== undefined) {
        clearTimeout(tileFailureRecheckTimer);
      }
      tileFailureRecheckTimer = undefined;
    };
    const beginTileFailureGeneration = () => {
      tileFailureGeneration += 1;
      clearTileFailureRecheck();
      tileFailureStamps = [];
      failedBasemapTiles.reset();
      basemapTileReadyForPaint = false;
    };
    const hasPinsPaintable = () => {
      if (!venueDataReadyRef.current || !map.getSource("pubs")) return false;
      return map.isSourceLoaded("pubs");
    };
    // A pin-owned ceiling notice clears on its own signal, never the basemap's:
    // the background is already painted in that case, so a notice keyed on the
    // basemap would retire on the very next frame while the pub data was still
    // missing. It rides the same render/idle pair the basemap recovery uses, so
    // the hot render loop keeps ONE listener each way.
    let pinNoticeActive = false;
    let pinRetryWaitTimer: ReturnType<typeof setTimeout> | undefined;
    const clearPinRetryWait = () => {
      if (pinRetryWaitTimer !== undefined) clearTimeout(pinRetryWaitTimer);
      pinRetryWaitTimer = undefined;
    };
    // What the pin lanes are owed RIGHT NOW, from the live signals rather than
    // from whichever lane last wrote the toast. Every retire goes through this,
    // so a basemap notice that outranked a still-true pub-data failure hands
    // the surface back to it instead of blanking the only message on screen.
    const pinLaneNotice = () => {
      if (venueDataFailedRef.current) {
        return venueDataFailureNotice(venueRetrySpentRef.current);
      }
      if (pinNoticeActive && !hasPinsPaintable()) return PIN_PAINT_RETRY_NOTICE;
      return null;
    };
    const markPinsRecovered = () => {
      // A venue index that REFUSED still settles `venueDataReady`, because a
      // failed read owes the honest empty state rather than a stuck skeleton.
      // Reading that as recovery is what would clear the notice and leave a
      // bare map with nothing to read.
      if (venueDataFailedRef.current) return;
      if (!pinNoticeActive || !hasPinsPaintable()) return;
      pinNoticeActive = false;
      clearPinRetryWait();
      setSoftRetry((current) =>
        current?.kind === "pins" || current?.kind === "venues" ? null : current,
      );
    };
    const retireTilesNotice = () => {
      setSoftRetry((current) =>
        current?.kind === "tiles" ? pinLaneNotice() : current,
      );
    };
    armPinNoticeRef.current = () => {
      pinNoticeActive = true;
    };
    // The pin Retry spends the lane its notice named. An unsettled `pubs`
    // source is ours to re-push; a venue index that never arrived is the
    // owner's to fetch, and pushing the empty collection we already hold at it
    // would clear the only message the reader had and change nothing. Pins
    // still arm the bounded paint wait. Venues follow the live index read:
    // extra taps while it is in flight start no second fetch, and spent is
    // set only when that read answers.
    pinRetryRef.current = (kind) => {
      if (mapRef.current !== map) return;
      if (kind === "venues") {
        if (!venueRetryMayDispatch(venueRetryInFlightRef.current)) return;
        venueRetryInFlightRef.current = true;
        pinNoticeActive = true;
        setSoftRetry(pinRetryPendingNotice("venues"));
        onReloadVenueDataRef.current?.();
        return;
      }
      clearPinRetryWait();
      pinNoticeActive = true;
      // The tap changes the sentence: leaving the notice that raised the Retry
      // unchanged under the wait reads as a button that did nothing.
      setSoftRetry(pinRetryPendingNotice(kind));
      if (styleStructureReadyRef.current) {
        (
          map.getSource("pubs") as maplibregl.GeoJSONSource | undefined
        )?.setData(pubsDataRef.current);
        map.triggerRepaint();
      }
      pinRetryWaitTimer = setTimeout(() => {
        pinRetryWaitTimer = undefined;
        if (mapRef.current !== map || !pinNoticeActive) return;
        if (!venueDataFailedRef.current && hasPinsPaintable()) {
          markPinsRecovered();
          return;
        }
        setSoftRetry(
          venueDataFailedRef.current
            ? venueDataFailureNotice(true)
            : pinRetrySpentNotice(kind),
        );
      }, PIN_RETRY_WAIT_MS);
    };
    const markBasemapRecovered = () => {
      markPinsRecovered();
      if (!areBasemapTilesLoaded()) return;
      if (tileFailureRecheckTimer !== undefined) return;
      if (failedBasemapTiles.hasFailures()) return;
      initialBasemapPending = false;
      tileFailureStamps = [];
      tileSpend = { ...tileSpend, surfaced: false };
      // MapLibre treats errored tiles as settled, so `areTilesLoaded()` cannot
      // prove recovery from a real error burst. Only a timeout-owned notice
      // may clear when a slow source eventually settles. Error-owned notices
      // remain truthful until Retry reconstructs the map.
      if (tileNoticeOwner !== "timeout") return;
      tileNoticeOwner = "none";
      retireTilesNotice();
    };
    map.on("render", markBasemapRecovered);
    map.on("idle", markBasemapRecovered);
    const onBasemapTileLoaded = (event: unknown) => {
      const dataEvent = event as {
        sourceId?: unknown;
        source?: { type?: unknown };
        tile?: {
          state?: unknown;
          tileID?: { key?: unknown };
        };
      };
      if (
        dataEvent.tile?.state !== "loaded" ||
        (
          dataEvent.source?.type !== "vector" &&
          dataEvent.source?.type !== "raster" &&
          dataEvent.source?.type !== "raster-dem"
        )
      ) {
        return;
      }
      initialBasemapPending = false;
      basemapTileReadyForPaint = true;
      const recoveredFailures = failedBasemapTiles.recordSuccess({
        sourceId: dataEvent.sourceId,
        sourceType: dataEvent.source?.type,
        tileKey: dataEvent.tile.tileID?.key,
      });
      if (failedBasemapTiles.hasFailures()) return;
      if (!recoveredFailures && tileFailureRecheckTimer !== undefined) return;
      clearTileFailureRecheck();
      tileFailureStamps = [];
      markBasemapRecovered();
    };
    map.on("sourcedata", onBasemapTileLoaded);

    const pinRevealCoordinator = createPinRevealCoordinator({
      pinRevealTimeoutMs: PIN_REVEAL_TIMEOUT_MS,
      readyCeilingMs: PIN_READY_CEILING_MS,
      hasBasemapPainted: () => basemapTileReadyForPaint,
      hasPinsPaintable: () => !phoneFirstImpression || hasPinsPaintable(),
      // On a phone, local pub GeoJSON is the useful content that the reader
      // is waiting for. Do not hold its first painted frame behind remote
      // basemap tiles; tile failures still use their independent classifier
      // and retry lane below.
      requiresBasemapPaint: !phoneFirstImpression,
      confirmVisibleFrameBeforeReveal: phoneFirstImpression,
      visibleFrameHoldMs: phoneFirstImpression ? PHONE_PIN_COMPOSITE_HOLD_MS : 0,
      setPinsVisible: (visible) => {
        for (const id of PUB_PIN_LAYERS) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
          }
        }
      },
      subscribeRender: (listener) => {
        map.on("render", listener);
        return () => map.off("render", listener);
      },
      subscribeIdle: (listener) => {
        map.on("idle", listener);
        return () => map.off("idle", listener);
      },
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (handle) => window.clearTimeout(handle),
      canRecoverAfterTimeout: () => tileNoticeOwner === "timeout",
      onPaintAfterTimeout: () => {
        if (tileNoticeOwner !== "timeout") return;
        tileNoticeOwner = "none";
        retireTilesNotice();
      },
      onReveal: (reason, generation) => {
        const timeoutNotice = revealTimeoutNotice(reason, tileNoticeOwner, {
          basemapPainted: basemapTileReadyForPaint,
          venueData: venueDataFailedRef.current
            ? "failed"
            : venueDataReadyRef.current
              ? "ready"
              : "pending",
          pinsPaintable: hasPinsPaintable(),
        });
        if (timeoutNotice) {
          // Name the signal that missed. A painted basemap with missing pub
          // data is a pin handoff, and its Retry spends that lane rather than
          // tearing down a background that already drew.
          if (timeoutNotice.kind === "tiles") {
            tileNoticeOwner = "timeout";
          } else {
            pinNoticeActive = true;
          }
          setSoftRetry(timeoutNotice);
        } else if (reason !== "timeout" || basemapTileReadyForPaint) {
          markBasemapRecovered();
        }
        // Lift parent loading chrome only after basemap paint. Phone adds the
        // stricter pub-source and composite gates above because its unfinished
        // frame otherwise looks settled. Desktop keeps its established tile
        // gate. The ceiling degrades honestly if either required phone signal
        // never arrives.
        onMapReadyRef.current?.(true);
        window.dispatchEvent(new CustomEvent(MAP_PIN_REVEAL_EVENT, {
          detail: { reason, generation },
        }));
        startPinEntrance();
        // Audit F5: MapLibre renders on demand and can park on the pre-tile
        // black backbuffer after a programmatic arrival (nothing in the custom
        // RAF loop dirties the scene without a route or selection). Force one
        // present at the first painted-frame reveal so arrival never shows a
        // black canvas until the user touches the map.
        map.triggerRepaint();
      },
    });
    const buildScene = () => {
      // This listener runs after the readiness listener below. MapLibre 6
      // detaches a replaced Style from the Map before loading its replacement,
      // so an old Style cannot bubble a stale style.load to this map listener.
      // Keep the app-owned guard for teardown and app-owned setStyle windows.
      if (!styleStructureReadyRef.current) return;
      const generation = styleGeneration;

      // Wave K2: style.load already flipped `styleLoaded`, so the tile hard-fail
      // timer will never fire. Any throw below must still lift the parent
      // loading chrome — otherwise "Finding the pubs…" covers the map forever.
      //
      // Yield before the synchronous scene graph runs. While this handler is on
      // the stack MapLibre cannot decode or present incoming basemap tiles, which
      // is the half-canvas black the captain saw on a cold phone open.
      const runBuildScene = () => {
        const execute = () => {
          if (
            generation !== styleGeneration ||
            mapRef.current !== map ||
            !styleStructureReadyRef.current
          ) {
            return;
          }
          try {
            buildSceneBody(generation);
            settleSceneReady();
            // Audit F5: one present after the scene graph builds, so a settled
            // style never waits on user input for its first frame.
            map.triggerRepaint();
          } catch (error) {
            pinRevealCoordinator.cancel();
            console.error("[pubmap] buildScene failed", error);
            const detail =
              error instanceof Error ? error.message : "Scene build threw unexpectedly";
            settleSceneError({
              kind: "tiles",
              message: "The map loaded tiles but couldn't finish drawing pubs.",
              detail,
            });
          }
        };
        let scheduled = false;
        const scheduleExecute = () => {
          if (scheduled) return;
          scheduled = true;
          map.off("render", onFirstRender);
          window.clearTimeout(buildSceneDeferTimer);
          requestAnimationFrame(execute);
        };
        const onFirstRender = () => {
          scheduleExecute();
        };
        const buildSceneDeferTimer = window.setTimeout(scheduleExecute, 120);
        map.on("render", onFirstRender);
      };
      runBuildScene();
    };

    const buildSceneBody = (generation: number) => {
      cancelDeferredWork();
      const tokens = readTokens();
      const dark = themeRef.current === "dark";
      publishRenderedState(tokens);

      // buildScene re-runs on every style.load. After a genuine setStyle swap
      // the old style's layers are gone (getLayer → undefined) so everything
      // re-adds with fresh tokens; on a duplicate pass the layer survives and
      // a bare addLayer would throw "Layer with id X already exists" inside
      // MapLibre's event dispatch, aborting the rest of the scene. getLayer
      // checks the CURRENT style state, so both paths are safe.
      const addLayerOnce = (...args: Parameters<typeof map.addLayer>) => {
        if (!map.getLayer(args[0].id)) map.addLayer(...args);
      };

      // Label font for OUR symbol layers. Glyphs come from the active style's
      // glyph server, and OpenFreeMap serves ONLY the Noto Sans stack — any
      // other name (the old "Open Sans Semibold, Arial Unicode MS Bold") 404s
      // every glyph range and drops to slow client-side rendering. Noto Sans
      // has no Semibold, so Bold is the closest weight. The CARTO fallback
      // style's glyph server has no Noto Sans Bold; Montserrat Medium is its
      // closest served weight.
      const textFont = [usingFallback ? "Montserrat Medium" : "Noto Sans Bold"];
      textFontRef.current = textFont;

      // Assemble every source/layer in load-bearing paint order (see
      // components/map/canvas/buildScene.ts). The D2 tile-paint gate and the
      // pendingUpdatesRef flush below stay component-owned (they touch a
      // construct-scope timer and component refs).
      // Cold-open: do NOT pass transitLinesPath into the first assembleScene.
      // MapLibre fetches that GeoJSON URL when the source is added (~125 KB for
      // London TfL). Defer it until the first map `idle` so basemap tiles + pub
      // pins win the critical path; transit is an overlay, not first paint.
      const sceneCtx = {
        map,
        tokens,
        dark,
        textFont,
        addLayerOnce,
        poiHidden: poiHiddenRef.current,
        transitLinesPath: null,
        showLandmarks: showLandmarksRef.current,
        landmarksGeoJSON: landmarksGeoJSONRef.current,
        poisData: poisDataRef.current,
        routeLine: routeLineRef.current,
        routeStops: routeStopsRef.current,
        bandCorridor: bandCorridorRef.current,
        bandColor: bandColorRef.current,
        bandMemberIds: bandMemberIdsRef.current,
        pubsData: pubsDataRef.current,
        userLocationData: userLocationDataRef.current,
        ukBaseData: ukBaseDataRef.current,
        tonightData: tonightDataRef.current,
        tonightVisible: tonightOverlayVisibleRef.current,
        selectedId: selectedIdRef.current,
        selectionMuteStore: selectionMuteStoreRef.current,
      };
      // Cold-open: taste, sky and transit stay off the first frame so basemap
      // tiles and pub pins can decode (see assembleSceneCritical).
      assembleSceneCritical(sceneCtx);
      const withLiveSelection = (ctx: typeof sceneCtx) => ({
        ...ctx,
        selectedId: selectedIdRef.current,
        selectionMuteStore: selectionMuteStoreRef.current,
      });
      const scheduleDeferredScene = () => {
        deferredSceneIdleId = null;
        deferredSceneFrameId = null;
        if (
          generation !== styleGeneration ||
          mapRef.current !== map ||
          !styleStructureReadyRef.current
        ) {
          return;
        }
        if (!map.getStyle()) return;
        try {
          assembleSceneDeferred(withLiveSelection(sceneCtx));
          map.triggerRepaint();
        } catch (error) {
          console.warn("[pubmap] deferred scene assembly failed", error);
        }
      };
      deferredSceneIdleId = null;
      if (typeof requestIdleCallback === "function") {
        deferredSceneIdleId = requestIdleCallback(scheduleDeferredScene, { timeout: 200 });
      } else {
        deferredSceneFrameId = requestAnimationFrame(scheduleDeferredScene);
      }

      if (transitLinesPath) {
        const deferredTransitPath = transitLinesPath;
        let transitScheduled = false;
        let transitFallbackTimer = 0;
        const loadDeferredTransit = () => {
          if (
            generation !== styleGeneration ||
            mapRef.current !== map ||
            !styleStructureReadyRef.current
          ) {
            return;
          }
          if (transitScheduled) return;
          transitScheduled = true;
          window.clearTimeout(transitFallbackTimer);
          deferredTransitFallbackTimer = null;
          map.off("idle", loadDeferredTransit);
          deferredTransitHandler = null;
          if (!map.getStyle()) return;
          try {
            buildTransitLines({
              map,
              tokens,
              dark,
              textFont,
              addLayerOnce,
              poiHidden: poiHiddenRef.current,
              transitLinesPath: deferredTransitPath,
              // Remaining SceneCtx fields are unused by buildTransitLines;
              // pass empty placeholders to satisfy the type without re-fetching.
              showLandmarks: false,
              landmarksGeoJSON: landmarksGeoJSONRef.current,
              poisData: poisDataRef.current,
              routeLine: routeLineRef.current,
              routeStops: routeStopsRef.current,
              bandCorridor: bandCorridorRef.current,
              bandColor: bandColorRef.current,
              bandMemberIds: bandMemberIdsRef.current,
              pubsData: pubsDataRef.current,
              userLocationData: userLocationDataRef.current,
              ukBaseData: ukBaseDataRef.current,
              tonightData: tonightDataRef.current,
              tonightVisible: tonightOverlayVisibleRef.current,
              selectedId: selectedIdRef.current,
              selectionMuteStore: selectionMuteStoreRef.current,
            });
            // Re-apply chip state after deferred layers exist. A toggle that
            // ran before idle could only setFilter POI layers; tube-lines-*
            // were missing then, so their visibility must catch up here.
            applyPoiCategoryVisibility(map, poiHiddenRef.current);
            applySelectionState(withLiveSelection(sceneCtx));
          } catch {
            // Transit is additive; never block the pub map on overlay failure.
          }
        };
        // Prefer first full idle (basemap + pins settled). Continuous tile
        // repaint can starve `idle` on some GPUs — fall back after 2.5s so the
        // overlay still appears without riding the critical path.
        deferredTransitHandler = loadDeferredTransit;
        map.on("idle", loadDeferredTransit);
        transitFallbackTimer = window.setTimeout(loadDeferredTransit, 2500);
        deferredTransitFallbackTimer = transitFallbackTimer;
      }

      // --- Tile-paint gate (D2). buildScene runs on `style.load`, which fires
      // BEFORE the basemap's vector tiles have painted. The pub layers draw from
      // a GeoJSON source (no network tiles), so without this they paint on the
      // very next frame — floating over a blank/white basemap (worst in the light
      // Liberty/Positron style, which has no dark background to mask it; the dark
      // style just hid the same race). Hold every pub layer hidden until the pub
      // data is actually paintable, then reveal them together. Applies on the
      // initial load AND every theme swap. Cached tiles still cross one frame
      // boundary, avoiding a same-frame full-opacity flash.
      //
      // The local `pubs` GeoJSON can finish before any basemap vector tile has
      // painted. Gate every pin layer as one style generation and reveal only
      // after tile readiness crosses a paint frame. The timeout deliberately
      // degrades to usable pins over the themed container when community tiles
      // are partial/offline instead of leaving the product invisible.
      beginTileFailureGeneration();
      initialBasemapPending = true;
      pinRevealCoordinator.arm();

      // Flush any mutations that arrived while the style was mid-load (initial
      // load or a theme swap). buildScene has just re-seeded every source/layer
      // from the data refs, so these queued fns (filters, paint, visibility,
      // raced setData) apply cleanly on top. Keyed map = only the latest write
      // per target replayed. Run inside a try so one bad fn can't abort the rest.
      if (pendingUpdatesRef.current.size > 0) {
        const pending = pendingUpdatesRef.current;
        pendingUpdatesRef.current = new Map();
        for (const fn of pending.values()) {
          try {
            fn(map);
          } catch {
            // A layer/source a queued fn targets may not exist in this style
            // build (e.g. toggled away); skip it rather than abort the flush.
          }
        }
      }

      // Ready is published by settleSceneReady() after buildSceneBody returns.
    };
    // --- Basemap fallback: OpenFreeMap is community-run, so if the primary style
    // hasn't loaded within a timeout (or errors before first load), swap to
    // CARTO's keyless styles; if that also fails, surface the same graceful
    // notice as a WebGL failure rather than a blank map.
    let styleLoaded = false;
    let usingFallback = false;
    let sceneSettled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let hardFailTimer: ReturnType<typeof setTimeout> | undefined;
    let firstFrameSeen = false;

    // --- M7 pin entrance. Defined here (ahead of the style.load wiring below)
    // rather than down by the RAF loop: a cached style can fire `style.load`
    // SYNCHRONOUSLY from the `map.on(...)` call a few lines down (see the
    // hang-guard comment above), which would call settleSceneReady() —
    // and therefore startPinEntrance() — before any const declared later in
    // this function body has initialized. Keeping these three consts above
    // that registration avoids a "Cannot access before initialization" throw
    // on the fast/cached-style path.
    const applyPinEntranceFrame = (elapsedMs: number) => {
      if (!map.getLayer("pubs-point")) return;
      const selectedId = selectedIdRef.current;
      map.setLayoutProperty(
        "pubs-point",
        "icon-size",
        pinEntranceIconSizeExpr(
          elapsedMs,
          selectedId,
          PIN_ENTRANCE_BUCKETS,
          PIN_ENTRANCE_STAGGER_MS,
          PIN_ENTRANCE_RAMP_MS,
        ),
      );
      map.setPaintProperty(
        "pubs-point",
        "icon-opacity",
        pinEntranceIconOpacityExpr(
          elapsedMs,
          selectedId,
          PIN_ENTRANCE_BUCKETS,
          PIN_ENTRANCE_STAGGER_MS,
          PIN_ENTRANCE_RAMP_MS,
        ),
      );
      // The price tag rides its own pin's stagger. Only visible when the map
      // loads already at street zoom (a deep link), but there the alternative
      // is a grid of numbers at full strength over glyphs still fading in.
      map.setPaintProperty(
        "pubs-point",
        "text-opacity",
        pinEntranceIconOpacityExpr(
          elapsedMs,
          selectedId,
          PIN_ENTRANCE_BUCKETS,
          PIN_ENTRANCE_STAGGER_MS,
          PIN_ENTRANCE_RAMP_MS,
        ),
      );
      // City zoom shows clusters, not pins, so without this the entrance the
      // owner actually sees on a phone was no entrance at all — every disc
      // snapped in at full strength the moment the gate lifted. One shared
      // eased ramp (the discs are few and large; a per-cluster stagger reads
      // as flicker) lands them at the same moment the pins finish.
      applyClusterEntranceFrame(clusterEntranceProgress(elapsedMs, PIN_ENTRANCE_TOTAL_MS));
    };
    // Writes the cluster disc + count opacities for one entrance frame.
    // `progress` 1 restores the resting paint exactly (buildScene's constants).
    const applyClusterEntranceFrame = (progress: number) => {
      if (map.getLayer("clusters")) {
        map.setPaintProperty("clusters", "circle-opacity", CLUSTER_FILL_OPACITY * progress);
        map.setPaintProperty("clusters", "circle-stroke-opacity", CLUSTER_STROKE_OPACITY * progress);
      }
      if (map.getLayer("cluster-count")) {
        map.setPaintProperty("cluster-count", "text-opacity", progress);
      }
    };
    // Restores the static baseline (buildScene's own expressions) and
    // re-arms the layer's normal 250ms opacity transition (disabled for the
    // duration of the ramp so the manual per-frame writes above aren't
    // smoothed/lagged by it — same reasoning as pubs-selected-glow's pulse).
    let pinEntranceSettled = false;
    const markPinEntranceSettled = () => {
      if (pinEntranceSettled) return;
      pinEntranceSettled = true;
      markPubmaxTiming("pubmax:pin-entrance-settled");
    };
    const finishPinEntrance = () => {
      pinEntranceActiveRef.current = false;
      applyClusterEntranceFrame(1);
      if (map.getLayer("pubs-point")) {
        map.setPaintProperty("pubs-point", "text-opacity-transition", {
          duration: 250,
          delay: 0,
        });
        map.setPaintProperty("pubs-point", "icon-opacity-transition", {
          duration: 250,
          delay: 0,
        });
        map.setLayoutProperty("pubs-point", "icon-size", selectedPinIconSizeExpr(selectedIdRef.current));
        map.setPaintProperty("pubs-point", "icon-opacity", pubIconOpacityExpr(selectedIdRef.current));
        map.setPaintProperty("pubs-point", "text-opacity", pubIconOpacityExpr(selectedIdRef.current));
      }
      markPinEntranceSettled();
    };
    // Fired once per mount, when the tile-paint coordinator first flips the pub
    // layers back to visible. settleSceneReady calls this while the gate still
    // holds pins at visibility:none, so it deliberately does not start there.
    // Starting the clock at settle would burn the whole 400ms ramp invisibly
    // and users would only see the instant post-entrance state.
    // `pinEntranceFired` (not `sceneSettled`) is the once-only guard, so later
    // style-generation reveals can never re-trigger it.
    let pinEntranceFired = false;
    const startPinEntrance = () => {
      if (pinEntranceFired || !map.getLayer("pubs-point")) return;
      // D2 gate still holding pins hidden — revealPins re-invokes this at the
      // actual first reveal. Deliberately NOT marked fired yet.
      if (map.getLayoutProperty("pubs-point", "visibility") === "none") return;
      pinEntranceFired = true;
      // Phone readiness waits for a frame with visible map content. Starting
      // the opacity entrance after that frame would immediately blank those
      // pins again while the parent loading chrome retires.
      if (reducedRef.current || phoneFirstImpression) {
        markPinEntranceSettled();
        return;
      }
      pinEntranceActiveRef.current = true;
      pinEntranceStartRef.current = performance.now();
      map.setPaintProperty("pubs-point", "icon-opacity-transition", { duration: 0, delay: 0 });
      map.setPaintProperty("pubs-point", "text-opacity-transition", { duration: 0, delay: 0 });
      // Paint t=0 synchronously so there's no one-frame flash of full-size,
      // full-opacity pins before the RAF loop's next tick picks up the ramp.
      applyPinEntranceFrame(0);
    };
    // settle* helpers close over hangFailTimer; they only run after this const
    // is initialized (and after style.load listeners are wired below).
    const settleSceneReady = () => {
      if (sceneSettled) return;
      sceneSettled = true;
      clearTimeout(hangFailTimer);
      // Internal scene-built gate only: unblock the map's own data/camera
      // effects now that the scene graph exists at style.load. The PARENT
      // loading chrome is deliberately NOT lifted here — it stays up until the
      // basemap actually PAINTS (pinRevealCoordinator.onReveal above), so a slow
      // tile stream can't expose a background-only void behind a retired
      // skeleton. Error/timeout paths still lift the chrome via reportMapError.
      setMapReady(true);
      startPinEntrance();
    };
    const settleSceneError = (error: NonNullable<typeof mapError>) => {
      if (sceneSettled) return;
      sceneSettled = true;
      clearTimeout(hangFailTimer);
      queueMicrotask(() => reportMapError(error));
    };
    // Last-resort hang guard BEFORE style.load listeners: a cached style can
    // fire style.load synchronously from map.on(...). Primary + CARTO each get
    // STYLE_LOAD_TIMEOUT_MS, then slack — surface Retry instead of a stuck overlay.
    const hangFailTimer = setTimeout(() => {
      console.warn("[pubmap] scene ready timeout");
      settleSceneError({
        kind: "tiles",
        message:
          "The map is taking too long to finish loading. The pub list and crawl planner still work.",
        detail: "Scene ready timeout",
      });
    }, STYLE_LOAD_TIMEOUT_MS * 2 + 2000);
    const surfaceBasemapFailure = (detail: string) => {
      if (tileSpend.surfaced) return;
      tileSpend = markTileFailureSurfaced(tileSpend);
      sceneSettled = true;
      clearTimeout(hangFailTimer);
      queueMicrotask(() => {
        if (basemapFailureSurface(styleLoaded) === "toast") {
          tileNoticeOwner = "errors";
          setSoftRetry(BASEMAP_RETRY_NOTICE);
          return;
        }
        reportMapError({
          kind: "tiles",
          message:
            "The map couldn't load its tiles right now. The pub list and crawl planner still work.",
          detail,
        });
      });
    };
    const clearStyleLoadProtection = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (hardFailTimer) clearTimeout(hardFailTimer);
      fallbackTimer = undefined;
      hardFailTimer = undefined;
    };
    function armStyleLoadProtection() {
      styleLoaded = false;
      clearStyleLoadProtection();
      if (usingFallback) {
        hardFailTimer = setTimeout(() => {
          if (!styleLoaded) {
            surfaceBasemapFailure("Fallback style reload failed");
          }
        }, STYLE_LOAD_TIMEOUT_MS);
        return;
      }
      fallbackTimer = setTimeout(
        () => swapToBasemapFallback(),
        STYLE_LOAD_TIMEOUT_MS,
      );
    }
    let protectedStyleInFlight = false;
    let queuedProtectedStyle: { style: string; fallback: boolean } | null = null;
    function setProtectedStyle(
      style: string,
      fallback: boolean,
      supersede = false,
    ) {
      if (protectedStyleInFlight && !supersede) {
        // Theme mutations can arrive faster than a remote style URL resolves.
        // Keep only the latest request and never ask MapLibre to replace a
        // half-created Style object with another half-created Style object.
        queuedProtectedStyle = { style, fallback };
        return;
      }
      if (supersede) queuedProtectedStyle = null;
      protectedStyleInFlight = true;
      usingFallback = fallback;
      armStyleLoadProtection();
      styleStructureReadyRef.current = false;
      try {
        map.setStyle(style, { diff: false });
      } catch (error) {
        protectedStyleInFlight = false;
        const detail =
          error instanceof Error ? error.message : "Map style replacement failed";
        if (fallback) {
          surfaceBasemapFailure(detail);
          return;
        }
        queueMicrotask(() => {
          if (mapRef.current === map) swapToBasemapFallback();
        });
      }
    }
    function swapToBasemapFallback() {
      if (styleLoaded || usingFallback) return;
      pinRevealCoordinator.cancel();
      beginTileFailureGeneration();
      setProtectedStyle(FALLBACK_STYLES[themeRef.current], true, true);
    }
    // ORDER MATTERS: this flag-setter must be registered BEFORE buildScene.
    // MapLibre fires style validation/source problems as synchronous `error`
    // events from inside mutation calls, so if buildScene ran first (flag still
    // false) any such error would re-enter the error handler mid-build, call
    // swapToBasemapFallback → setStyle, and synchronously replace the active style
    // with a fresh UNLOADED style — every remaining addLayer in buildScene then
    // throws "Style is not done loading". With the flag set first, the error
    // handler knows the style did load and never swaps mid-build.
    map.on("style.load", () => {
      styleGeneration += 1;
      cancelDeferredWork();
      styleStructureReadyRef.current = true;
      styleLoaded = true;
      clearStyleLoadProtection();
      if (!protectedStyleInFlight) return;
      protectedStyleInFlight = false;
      const queued = queuedProtectedStyle;
      queuedProtectedStyle = null;
      if (queued) {
        queueMicrotask(() => {
          if (mapRef.current === map) {
            setProtectedStyle(queued.style, queued.fallback);
          }
        });
      }
    });
    map.on("style.load", buildScene);
    armStyleLoadProtection();
    // ONE recovery budget per mount, shared by both recovery nets (the tile
    // classifier here and the paint watchdog below), so the two can never
    // compound into more than PAINT_WATCHDOG_MAX_RETRIES total actions.
    let recoverySpent = 0;
    // An error before the first style loads means the style URL itself failed.
    // AFTER load, errors are classified (lib/mapTileFailure): the paint
    // watchdog below only sees a parked frame loop, so a source that fails
    // while frames keep presenting would otherwise paint black at 60fps with
    // no recovery and no message. A lone tile miss stays ignored; a burst,
    // sprite/glyph failure, or initial source-metadata failure spends ONE style
    // reload from the same recovery budget as the paint watchdog. If failure
    // survives that reload, honest error UI takes over. The retry is deferred
    // to a microtask because MapLibre fires mutation-validation errors
    // synchronously from inside buildScene - a setStyle re-entering mid-build
    // would leave every remaining addLayer throwing on an unloaded style
    // (same hazard as the flag-setter ordering above).
    const evaluateTileFailure = (
      now: number,
      critical: boolean,
      message: string,
      mayRecheck: boolean,
    ) => {
      const decision = classifyTileFailure({
        now,
        errorTimestamps: tileFailureStamps,
        criticalFailure: critical,
        documentVisible: document.visibilityState !== "hidden",
        // A flyTo legitimately outruns the tile stream and paints black for a
        // few seconds; the classifier stays silent until the flight ends.
        cameraInFlight: map.isMoving(),
        retrySpent: tileSpend.retrySpent,
        recoveryBudgetLeft: PAINT_WATCHDOG_MAX_RETRIES - recoverySpent,
        initialBasemapPending,
      });
      if (decision === "ignore") {
        const delay = initialBasemapPending
          ? null
          : tileFailureRecheckDelay(tileFailureStamps, now);
        if (
          !mayRecheck ||
          delay === null ||
          tileFailureRecheckTimer !== undefined
        ) {
          return;
        }
        const generation = tileFailureGeneration;
        tileFailureRecheckTimer = setTimeout(() => {
          tileFailureRecheckTimer = undefined;
          if (
            generation !== tileFailureGeneration ||
            tileSpend.surfaced ||
            mapRef.current !== map
          ) {
            return;
          }
          evaluateTileFailure(
            performance.now(),
            false,
            message,
            document.visibilityState !== "hidden" && !map.isMoving(),
          );
        }, Math.max(1, delay));
        return;
      }
      clearTileFailureRecheck();
      const spent = spendTileFailureDecision(tileSpend, decision);
      tileSpend = spent.state;
      if (spent.effect === "reload-style") {
        queueMicrotask(() => {
          if (mapRef.current !== map || tileSpend.surfaced) return;
          tileSpend = markTileRetrySpent(tileSpend);
          recoverySpent += 1; // shared budget with the paint watchdog
          beginTileFailureGeneration();
          console.warn("[pubmap] tile failure burst, reloading style", {
            critical,
            detail: message || undefined,
          });
          const styles = usingFallback ? FALLBACK_STYLES : MAP_STYLES;
          setProtectedStyle(styles[themeRef.current], usingFallback);
        });
        return;
      }
      if (spent.effect !== "surface") return;
      // surface: the bounded retry (or the budget) is spent and tiles are
      // still failing. Prefer a soft toast once a style actually loaded so we
      // never leave a silent grey canvas; fall back to the full card when
      // both style URLs refused. A MapLibre render event is not a loaded style.
      console.warn("[pubmap] tile failure survived reload, surfacing", {
        critical,
        detail: message || undefined,
      });
      surfaceBasemapFailure(
        message || "Tile source failure after style load",
      );
    };
    map.on("error", (event) => {
      if (!styleLoaded) {
        swapToBasemapFallback();
        return;
      }
      if (tileSpend.surfaced || mapRef.current !== map) return;
      const now = performance.now();
      tileFailureStamps = pruneTileFailures(tileFailureStamps, now);
      tileFailureStamps.push(now);
      const mapError = event as {
        error?: { message?: unknown };
        sourceId?: unknown;
        source?: { type?: unknown };
        tile?: { tileID?: { key?: unknown } };
      };
      const message = String(mapError.error?.message ?? "");
      const documentVisible = document.visibilityState !== "hidden";
      const cameraInFlight = map.isMoving();
      const critical = isCriticalBasemapFailure({
        message,
        initialBasemapPending,
        sourceType: mapError.source?.type,
        tilePresent: mapError.tile !== undefined,
      });
      if (
        documentVisible &&
        !cameraInFlight &&
        !initialBasemapPending
      ) {
        failedBasemapTiles.recordFailure({
          sourceId: mapError.sourceId,
          sourceType: mapError.source?.type,
          tileKey: mapError.tile?.tileID?.key,
        });
      }
      evaluateTileFailure(
        now,
        critical,
        message,
        documentVisible && !cameraInFlight,
      );
    });

    // --- Post-init context loss (iOS Safari P0).
    // iOS kills WebGL on app-switch / restores bfcache pages with a dead canvas.
    // MapLibre does not auto-recover → blank basemap + live DOM overlays.
    // Policy (all inside the canvas module so #601's code-split stays intact):
    //   (a) canvas `webglcontextlost` → preventDefault + schedule recovery;
    //       `webglcontextrestored` → resize + triggerRepaint
    //   (b) pageshow(persisted) + visibility→visible → isContextLost health
    //       check; dead → tear down + re-init preserving camera (selection is
    //       React state and survives the effect re-run)
    //   (c) if re-init already spent and still dead → soft retry toast
    let contextRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
    const surfaceSoftContextRetry = () => {
      sceneSettled = true;
      clearTimeout(hangFailTimer);
      // Soft toast only — full mapError would unmount the canvas and hide the
      // live DOM overlays the owner still sees after iOS app-switch. Retry on
      // the toast re-inits; if construct fails, the honest full card still lands.
      queueMicrotask(() => {
        setSoftRetry({
          kind: "context-lost",
          message: "The map lost its graphics. Tap Retry to reload the basemap.",
        });
      });
    };
    const scheduleContextRecovery = (reason: string) => {
      // Coalesce: canvas + map events fire together; don't stack timers.
      if (contextRecoveryTimer) return;
      if (contextLostTimer) clearTimeout(contextLostTimer);
      // Optimistic paint kick in case the browser is about to restore.
      try {
        map.resize();
        map.triggerRepaint();
      } catch {
        // Context may already be unusable.
      }
      contextRecoveryTimer = setTimeout(() => {
        contextRecoveryTimer = undefined;
        if (mapRef.current !== map) return;
        const lost = isMapWebGlContextLost(map);
        const action = contextHealthAction({
          contextLost: lost,
          reinitAlreadySpent: contextAutoReinitSpentRef.current,
        });
        if (action === "repaint") {
          try {
            map.resize();
            map.triggerRepaint();
          } catch {
            /* ignore */
          }
          if (containerRef.current) {
            containerRef.current.dataset.webglRecovery = "restored";
          }
          return;
        }
        if (action === "reinit") {
          contextAutoReinitSpentRef.current = true;
          try {
            recoveryViewRef.current = snapshotMapCamera(map);
          } catch {
            recoveryViewRef.current = null;
          }
          console.warn("[pubmap] webgl context dead - re-init preserving camera", {
            reason,
          });
          if (containerRef.current) {
            containerRef.current.dataset.webglRecovery = "reinit";
          }
          queueMicrotask(() => setInitAttempt((a) => a + 1));
          return;
        }
        console.warn("[pubmap] webgl context dead after re-init - soft retry", {
          reason,
        });
        if (containerRef.current) {
          containerRef.current.dataset.webglRecovery = "soft-retry";
        }
        surfaceSoftContextRetry();
      }, CONTEXT_LOST_RECOVERY_MS);
      if (containerRef.current) {
        containerRef.current.dataset.webglRecovery = "recovering";
      }
    };
    const canvasEl = map.getCanvas();
    const onCanvasContextLost = (event: Event) => {
      // preventDefault keeps the browser willing to restore the context.
      event.preventDefault();
      scheduleContextRecovery("webglcontextlost");
    };
    const onCanvasContextRestored = () => {
      if (contextRecoveryTimer) clearTimeout(contextRecoveryTimer);
      contextRecoveryTimer = undefined;
      if (contextLostTimer) clearTimeout(contextLostTimer);
      contextLostTimer = undefined;
      try {
        map.resize();
        map.triggerRepaint();
      } catch {
        /* ignore */
      }
      if (containerRef.current) {
        containerRef.current.dataset.webglRecovery = "restored";
      }
    };
    canvasEl.addEventListener("webglcontextlost", onCanvasContextLost, false);
    canvasEl.addEventListener("webglcontextrestored", onCanvasContextRestored, false);
    // MapLibre also emits these as map events; keep them as a secondary signal
    // (some builds only fire one path). preventDefault only works on the DOM
    // event above — map events are already past that.
    map.on("webglcontextlost", () => {
      scheduleContextRecovery("map-webglcontextlost");
    });
    map.on("webglcontextrestored", () => {
      onCanvasContextRestored();
    });
    if (containerRef.current) {
      containerRef.current.dataset.webglRecovery = "listening";
    }

    // bfcache restore (pageshow.persisted) + tab-foreground: health-check the
    // context. A dead canvas after iOS app-switch is the owner-reported defect.
    const healthCheckOnForeground = (reason: string) => {
      if (mapRef.current !== map) return;
      const lost = isMapWebGlContextLost(map);
      const action = contextHealthAction({
        contextLost: lost,
        reinitAlreadySpent: contextAutoReinitSpentRef.current,
      });
      if (action === "repaint") {
        try {
          map.resize();
          map.triggerRepaint();
        } catch {
          /* ignore */
        }
        return;
      }
      scheduleContextRecovery(reason);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) healthCheckOnForeground("pageshow-bfcache");
    };
    window.addEventListener("pageshow", onPageShow);

    // --- First-painted-frame watchdog (see FIRST_FRAME_TIMEOUT_MS). A single
    // MapLibre "render" event proves the frame loop is alive and disarms it
    // forever. If the timeout lapses with the tab visible and no frame ever
    // rendered, the "ready" scene is a lie — degrade to the honest fallback
    // (with Retry: a re-init can recover a crashed GPU process). While the tab
    // is hidden the browser legitimately throttles rAF to zero, so a lapse
    // there just re-arms rather than crying wolf at a background tab.
    // (`firstFrameSeen` is declared above the tile-error handler.)
    let firstFrameTimer: ReturnType<typeof setTimeout> | undefined;
    const onFirstFrame = () => {
      firstFrameSeen = true;
      if (firstFrameTimer) clearTimeout(firstFrameTimer);
      firstFrameTimer = undefined;
      map.off("render", onFirstFrame);
    };
    map.on("render", onFirstFrame);
    const armFirstFrameWatchdog = () => {
      firstFrameTimer = setTimeout(() => {
        firstFrameTimer = undefined;
        if (firstFrameSeen) return;
        if (document.visibilityState === "hidden") {
          armFirstFrameWatchdog();
          return;
        }
        console.error("[pubmap] no basemap frame rendered", {
          timeoutMs: FIRST_FRAME_TIMEOUT_MS,
        });
        // Settle the scene state so the style/tile hang guard can't race a
        // second error card on top of this one.
        sceneSettled = true;
        clearTimeout(hangFailTimer);
        queueMicrotask(() =>
          reportMapError({
            kind: "no-frame",
            message:
              "The map opened but did not draw anything. This browser or device cannot show the map right now.",
            detail: `No basemap frame within ${Math.round(FIRST_FRAME_TIMEOUT_MS / 1000)}s`,
          }),
        );
      }, FIRST_FRAME_TIMEOUT_MS);
    };
    armFirstFrameWatchdog();

    // --- Black-canvas recovery net (two mechanisms). These are NOT a render
    // driver — #544's event-based kicks (style.load scene build, pin-reveal,
    // moveend triggerRepaint) remain the primary presenters. This net only
    // catches the failure that dodges every one of those events: a "Plan
    // tonight" sheet opening resizes the map container, and a missed resize / a
    // throttled rAF present (iOS Low Power Mode) / a backgrounded-then-resumed
    // tab can leave the renderer parked on its pre-tile black backbuffer with no
    // further event to dirty the scene — DOM overlays alive, canvas solid black.

    // (1) Resize integrity. MapLibre's own trackResize watches the WINDOW, not
    // the container, so a layout change that resizes .maplibreMap without a
    // window resize (a sheet opening/closing) never reaches map.resize() — the
    // canonical black-canvas recovery. Observe the real container element and
    // call resize() on any box change, debounced to a microtask so a burst of
    // sub-frame resize entries collapses to a single resize() per tick.
    let resizePending = false;
    const paintObserver = new ResizeObserver(() => {
      if (resizePending) return;
      resizePending = true;
      queueMicrotask(() => {
        resizePending = false;
        if (mapRef.current === map) map.resize();
      });
    });
    paintObserver.observe(container);

    // (2) Paint watchdog. Stamp the last real present from MapLibre's "render"
    // event (fires only from an actual frame), then poll on a coarse interval:
    // if the map/style are loaded, the canvas is on-screen with a non-zero size,
    // and no frame has presented for longer than the stall threshold, fire ONE
    // recovery (resize + triggerRepaint). A capped retry counter means it can
    // never loop hot — after the cap it logs one structured warning and stops.
    // The decision itself is the pure shouldRecoverPaint() (lib/mapPaintWatchdog)
    // so it stays hermetically testable; this wrapper only owns the side effects.
    let lastRenderAt: number | null = null;
    const stampRender = () => {
      lastRenderAt = performance.now();
    };
    map.on("render", stampRender);
    let paintCapWarned = false;
    let paintWatchdogTimer: ReturnType<typeof setInterval> | undefined;
    const samplePaint = () => {
      if (document.visibilityState === "hidden") return; // paused while hidden
      if (mapRef.current !== map) return;
      const canvas = map.getCanvas();
      // A detached/display:none canvas reports zero offset dimensions; a live,
      // on-screen canvas reports its CSS box. Guard on the backing size too.
      const onScreen = canvas.offsetWidth > 0 && canvas.offsetHeight > 0;
      const recover = shouldRecoverPaint({
        now: performance.now(),
        lastRenderAt,
        documentVisible: true,
        mapLoaded: Boolean(map.isStyleLoaded()),
        canvasVisible: onScreen,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        retries: recoverySpent,
      });
      if (!recover) return;
      recoverySpent += 1;
      map.resize();
      map.triggerRepaint();
      if (recoverySpent >= PAINT_WATCHDOG_MAX_RETRIES && !paintCapWarned) {
        paintCapWarned = true;
        console.warn("[pubmap] paint watchdog exhausted its recovery budget", {
          retries: recoverySpent,
          lastRenderAt,
          intervalMs: PAINT_WATCHDOG_INTERVAL_MS,
        });
        if (paintWatchdogTimer) clearInterval(paintWatchdogTimer);
        paintWatchdogTimer = undefined;
      }
    };
    const startPaintWatchdog = () => {
      if (paintWatchdogTimer || paintCapWarned) return;
      paintWatchdogTimer = setInterval(samplePaint, PAINT_WATCHDOG_INTERVAL_MS);
    };
    const stopPaintWatchdog = () => {
      if (paintWatchdogTimer) clearInterval(paintWatchdogTimer);
      paintWatchdogTimer = undefined;
    };
    // Pause the interval entirely while the tab is hidden (no wasted wakes, and
    // no false stall from a legitimately throttled background rAF); resume — and
    // stamp — on return so a backgrounded-then-resumed map gets a clean first
    // sample and one present.
    const onPaintVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopPaintWatchdog();
      } else if (mapRef.current === map) {
        lastRenderAt = performance.now();
        // Health-check WebGL on every return to foreground (iOS app-switch).
        healthCheckOnForeground("visibility-visible");
        startPaintWatchdog();
      }
    };
    document.addEventListener("visibilitychange", onPaintVisibility);
    if (document.visibilityState !== "hidden") startPaintWatchdog();

    // --- Click + cursor wiring (see components/map/canvas/interactions.ts).
    // Pub-first hit testing: a single map click queries pubs/route stops before
    // landmarks/POIs so dense central London taps open a pub sheet, not a
    // landmark card that happened to sit under the same finger. Listeners are
    // torn down by map.remove() in constructCleanup exactly as before.
    wireClickRouting(map, {
      selectLandmark,
      setHoveredVenue,
      setActivePoi,
      onVenueClickRef,
      onUkBasePubClickRef,
      onRouteStopClickRef,
      onTonightOpportunityClickRef,
      cityLandmarksRef,
      tonightOpportunitiesRef,
      cinematic,
    });
    // The browser suite's counterpart to that hit test: it publishes where the
    // painted pins are so a tap can land on one (paintedPinProbe.ts).
    const removePaintedPinProbe = installPaintedPinProbe(map);
    wireHoverPrefetch(map, { onVenuePrefetchRef });
    wirePubHover(map, { hoverCapableRef, setHoveredVenue });
    wireCursor(map);
    // --- M5: donut cluster markers (bounded-count DOM-marker exception —
    // see donutClusters.ts). Syncs off the map's own render/moveend/
    // sourcedata events, so it adds no second RAF loop; click reuses the
    // same cluster-expansion-zoom behaviour as the plain circle layer.
    const useDomDonutClusters = !window.matchMedia(
      "(max-width: 640px), (pointer: coarse)",
    ).matches;
    const donutSync: DonutClusterSync = createDonutClusterSync(map, cinematic, {
      enabled: useDomDonutClusters,
    });
    // One RAF loop for motivated feedback only: pin entrance, route direction,
    // and the selected-pin pulse. The old perpetual camera orbit changed the
    // whole canvas every frame while idle, forcing tile churn that read as
    // flicker and fought the user's spatial memory.
    let rafId = 0;
    let dashStep = 0;
    let dashAt = 0;
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      // M7 pin entrance — progressed ahead of the big early-return below so
      // it isn't starved by a hidden/blurred tab (a background tab still
      // ticks rAF, just throttled; the elapsed-time check below simply
      // finishes instantly once the tab is foregrounded again — no visible
      // pop since nothing was visible meanwhile). A mid-ramp reduced-motion
      // toggle also finishes instantly rather than leaving pins stuck
      // half-visible forever.
      //
      // Style guard: app-owned style.load state, NOT isStyleLoaded(), which also waits for
      // tiles/sprite and reports false for seconds after style.load on a slow
      // connection (and again during every zoom-triggered tile load), which
      // starved this block entirely: startPinEntrance's t=0 write (opacity 0)
      // then sat un-progressed until the map fully quiesced — pins invisible
      // for the whole window. The app-owned state only goes false across a
      // genuine setStyle swap or teardown, which is the case this guard exists for.
      if (
        pinEntranceActiveRef.current &&
        styleStructureReadyRef.current &&
        map.getLayer("pubs-point")
      ) {
        if (reducedRef.current) {
          finishPinEntrance();
        } else {
          const elapsed = now - pinEntranceStartRef.current;
          if (elapsed >= PIN_ENTRANCE_TOTAL_MS) {
            finishPinEntrance();
          } else {
            applyPinEntranceFrame(elapsed);
          }
        }
      }
      // isStyleLoaded() is null-safe and false mid-swap; check it BEFORE
      // getLayer, which throws on the transiently-null style during a theme
      // setStyle({diff:false}) or on teardown.
      if (
        reducedRef.current ||
        document.hidden ||
        blurredRef.current ||
        !map.isStyleLoaded() ||
        !map.getLayer("pubs-point")
      )
        return;
      if (now - dashAt > 90 && map.getLayer("route-line-dash")) {
        dashAt = now;
        dashStep = (dashStep + 1) % DASH_SEQ.length;
        map.setPaintProperty("route-line-dash", "line-dasharray", DASH_SEQ[dashStep]);
      }
      // M1 selection spotlight — breathing pulse on the selected pub's glow
      // ring, reusing THIS RAF loop (no second one). Gated by the same
      // reduced-motion / hidden / blurred guard above, so reduced-motion gets
      // a static ring (the dim-opacity spotlight still applies, unaffected).
      if (selectedIdRef.current && map.getLayer("pubs-selected-glow")) {
        const pulse = glowPulsePaint(now);
        map.setPaintProperty("pubs-selected-glow", "circle-stroke-opacity", pulse.opacity);
        map.setPaintProperty("pubs-selected-glow", "circle-stroke-width", pulse.width);
      }
    };
    rafId = requestAnimationFrame(frame);

    // --- Theme: watch html[data-theme]; setStyle re-triggers buildScene, which
    // re-reads the (already flipped) CSS tokens.
    const themeObserver = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      if (next === themeRef.current) return;
      themeRef.current = next;
      // R3 — re-paint the container's own base colour immediately, ahead of
      // the new style's style.load (see paintContainerBase above) so a
      // dark→light swap never leaves the old dark-navy ink-deep showing
      // through while the new style is mid-fetch.
      paintContainerBase(next);
      // diff: false forces a full style swap: old layers are always dropped
      // and style.load always fires, so buildScene deterministically rebuilds
      // every layer with the new theme's tokens (a successful diff would keep
      // stale-themed layers and skip style.load entirely).
      pinRevealCoordinator.cancel();
      beginTileFailureGeneration();
      setProtectedStyle(MAP_STYLES[next], false);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // The construct body owns the map + its listeners/timers; it registers its
    // teardown here so the effect's single cleanup (below) can run it whether or
    // not construction was deferred by the size gate.
    constructCleanup = () => {
      cancelAnimationFrame(rafId);
      if (firstFrameTimer) clearTimeout(firstFrameTimer);
      map.off("render", onFirstFrame);
      // Black-canvas recovery net teardown.
      paintObserver.disconnect();
      map.off("render", stampRender);
      stopPaintWatchdog();
      document.removeEventListener("visibilitychange", onPaintVisibility);
      window.removeEventListener("pageshow", onPageShow);
      canvasEl.removeEventListener("webglcontextlost", onCanvasContextLost);
      canvasEl.removeEventListener("webglcontextrestored", onCanvasContextRestored);
      if (contextRecoveryTimer) clearTimeout(contextRecoveryTimer);
      clearStyleLoadProtection();
      clearTimeout(hangFailTimer);
      pinRevealCoordinator.dispose();
      clearTileFailureRecheck();
      clearPinRetryWait();
      styleGeneration += 1;
      cancelDeferredWork();
      pinRetryRef.current = null;
      armPinNoticeRef.current = null;
      map.off("render", markBasemapRecovered);
      map.off("idle", markBasemapRecovered);
      map.off("sourcedata", onBasemapTileLoaded);
      themeObserver.disconnect();
      reducedQuery.removeEventListener("change", onReducedChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      donutSync.destroy();
      removePaintedPinProbe();
      if (publishCurrentViewportRef.current === publishCurrentViewport) {
        publishCurrentViewportRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      styleStructureReadyRef.current = false;
      publishMapReady(false);
    };
    } // end construct()

    return () => {
      // Outer teardown: size-gate observer/timer and the pending auto-retry /
      // context-lost timers are the effect's, not construct's, so they clear
      // even if we never constructed. Then run construct's teardown if it ran.
      sizeObserver?.disconnect();
      if (sizeProceedTimer) clearTimeout(sizeProceedTimer);
      if (autoRetryTimer) clearTimeout(autoRetryTimer);
      if (contextLostTimer) clearTimeout(contextLostTimer);
      constructCleanup?.();
      // If the constructor threw before wiring, its own catch already removed
      // the window/media listeners; guard so cleanup is idempotent.
      if (!constructCleanup) {
        reducedQuery.removeEventListener("change", onReducedChange);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [
    // Intentionally omit mapView / maxBounds / landmarksGeoJSON — those are
    // read via refs so parent re-renders (new array identity) cannot remount
    // MapLibre and flicker the loading chrome. Include cityId so non-London
    // city switches (shared null transitLinesPath) still remount with fresh
    // camera/bounds even if PubMap's key={cityId} is removed. Landmark layers
    // sync in their own effect — toggling showLandmarks must not remount MapLibre.
    cinematic,
    cityId,
    selectLandmark,
    initAttempt,
    transitLinesPath,
    publishMapReady,
    publishRenderedState,
    reportMapError,
  ]);

  // Keep landmark GeoJSON in sync when the city catalog changes (e.g. London → Manchester).
  useEffect(() => {
    if (!mapReady) return;
    applyToMap("landmarks:data", (map) => {
      if (!showLandmarks) {
        if (map.getLayer("landmarks-label")) map.removeLayer("landmarks-label");
        if (map.getLayer("landmarks-icon")) map.removeLayer("landmarks-icon");
        const source = map.getSource("landmarks");
        if (source) map.removeSource("landmarks");
        return;
      }
      const addLayerOnce = (...args: Parameters<typeof map.addLayer>) => {
        if (!map.getLayer(args[0].id)) map.addLayer(...args);
      };
      buildLandmarks({
        map,
        tokens: readTokens(),
        dark: themeRef.current === "dark",
        textFont: textFontRef.current,
        addLayerOnce,
        showLandmarks: true,
        landmarksGeoJSON,
      } as SceneCtx);
    });
  }, [mapReady, applyToMap, showLandmarks, landmarksGeoJSON]);

  // Pubs data → source. Rebuilds when the favorite pint changes so the price
  // buckets + serves flags re-derive against that beer.
  useLayoutEffect(() => {
    pubsDataRef.current = pubsToGeoJSON(
      venues,
      venueSignals,
      favoritePint,
      drinkCategory,
      whatsOnByVenue,
      provisionalVenueIds,
      lensPrices,
    );
    publishRenderedState(readTokens());
    if (!mapReady) return;
    // Updating an existing GeoJSON source is safe once style structure exists.
    // `applyToMap` waits for every tile and image through isStyleLoaded(); a
    // slim-index update arriving after the one style.load would otherwise sit
    // queued forever, leaving the initial empty pubs source marked as loaded.
    const map = mapRef.current;
    if (!map || !styleStructureReadyRef.current) return;
    (map.getSource("pubs") as maplibregl.GeoJSONSource | undefined)?.setData(
      pubsDataRef.current,
    );
  }, [
    venues,
    venueSignals,
    favoritePint,
    drinkCategory,
    whatsOnByVenue,
    provisionalVenueIds,
    lensPrices,
    mapReady,
    publishRenderedState,
  ]);

  // UK base pubs → their own source, streamed per settled viewport and only
  // once the camera is past UK_BASE_MIN_ZOOM. Deliberately separate from the
  // `pubs` effect above: nothing here touches the curated source, its clusters
  // or its payload.
  const handleRestoredBasePub = useCallback((pub: UkBasePub) => {
    // Only reopen the sheet while the restored id is still the selection — a
    // slow shard must never steal a selection the user has already moved on
    // from.
    if (selectedIdRef.current !== pub.id) return;
    onUkBasePubClickRef.current?.(pub);
  }, []);
  const drawableVenueIds = useMemo(
    () => new Set(venues.map((venue) => venue.id)),
    [venues],
  );
  const ukBase = useUkBaseStreaming({
    mapRef,
    mapReady,
    applyToMap,
    ukBaseDataRef,
    drawableVenueIds,
    provisionalVenueIds,
    // A non-null lensPrices map is the one signal that an experience view owns
    // the map, the same one the curated pins read below.
    suspended: lensPrices !== null,
    scopeKey: cityId,
    restoreId: ukBaseRestore?.id ?? null,
    onRestorePub: handleRestoredBasePub,
  });

  useEffect(() => {
    ukBaseResidentPubsRef.current = ukBase.pubs;
    onUkBaseResidentPubsChange?.(ukBase.pubs);
  }, [onUkBaseResidentPubsChange, ukBase.pubs]);
  useEffect(() => {
    onUkBaseStatusChange?.(ukBase.status);
  }, [onUkBaseStatusChange, ukBase.status]);

  // Project coordinates through MapLibre rather than using getBounds(): at a
  // pitch or bearing, getBounds() is the enclosing rectangle and includes
  // off-canvas corners. While the operable DOM list is open, re-publish on
  // camera frames so its rows never name pins from the previous view. With
  // the list closed, settle its visible toggle count on moveend and avoid
  // projecting thousands of points through every ordinary pan. This is
  // coordinate projection only, never rendered-feature or canvas hit-testing.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    let frame: number | null = null;
    let lastMembershipKey: string | null = null;
    const publishVisibleMembership = () => {
      frame = null;
      const container = map.getContainer();
      const viewport = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      const curatedVenueIds = projectedItemIdsInViewport(
        venues,
        (venue) => map.project([venue.longitude, venue.latitude]),
        viewport,
      );
      const ukBasePubIds =
        map.getZoom() >= UK_BASE_MIN_ZOOM
          ? projectedItemIdsInViewport(
              ukBase.pubs,
              (pub) => map.project([pub.lng, pub.lat]),
              viewport,
            )
          : [];
      const membershipKey =
        `${curatedVenueIds.join("\u0000")}\u0001${ukBasePubIds.join("\u0000")}`;
      if (membershipKey === lastMembershipKey) return;
      lastMembershipKey = membershipKey;

      const visibleBaseIds = new Set(ukBasePubIds);
      onUkBasePubsChange?.(
        ukBase.pubs.filter((pub) => visibleBaseIds.has(pub.id)),
      );
      onVisibleVenueIdsChange?.({ curatedVenueIds, ukBasePubIds });
    };
    const scheduleVisibleMembership = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(publishVisibleMembership);
    };

    map.on(venueListOpen ? "move" : "moveend", scheduleVisibleMembership);
    map.on("resize", scheduleVisibleMembership);
    scheduleVisibleMembership();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      map.off(venueListOpen ? "move" : "moveend", scheduleVisibleMembership);
      map.off("resize", scheduleVisibleMembership);
    };
  }, [
    mapReady,
    onUkBasePubsChange,
    onVisibleVenueIdsChange,
    ukBase.pubs,
    venueListOpen,
    venues,
  ]);

  // CityMCP tonight opportunities → source data + overlay visibility. Kept out
  // of the mount effect deps so live opportunity refreshes never remount MapLibre.
  useEffect(() => {
    tonightDataRef.current = opportunitiesToGeoJSON(tonightOpportunities);
    tonightOpportunitiesRef.current = tonightOpportunities;
    tonightOverlayVisibleRef.current = tonightOverlayVisible;
    if (!mapReady) return;
    applyToMap("tonight:data+visibility", (map) => {
      (map.getSource("tonight-opportunities") as maplibregl.GeoJSONSource | undefined)?.setData(
        tonightDataRef.current,
      );
      const visibility: "visible" | "none" = tonightOverlayVisible ? "visible" : "none";
      for (const layer of TONIGHT_OPPORTUNITY_LAYERS) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visibility);
      }
    });
  }, [tonightOpportunities, tonightOverlayVisible, mapReady, applyToMap]);

  // POIs load once (client fetch) and feed the "pois" source.
  // Non-London cities pass poisPath=null → empty layer, no 404.
  useEffect(() => {
    let cancelled = false;
    loadPoisFromPath(poisPath)
      .then((pois) => {
        if (cancelled) return;
        poisDataRef.current = poisToGeoJSON(pois);
        applyToMap("pois:data", (map) => {
          (map.getSource("pois") as maplibregl.GeoJSONSource | undefined)?.setData(
            poisDataRef.current,
          );
        });
      })
      .catch(() => {
        // ponytail: POIs are ambient garnish — a fetch failure just leaves the
        // pub map intact, no error surfaced.
      });
    return () => {
      cancelled = true;
    };
  }, [mapReady, applyToMap, poisPath]);

  // POI category toggles → live layer filters + tube-line visibility.
  // Structural readiness only: existing layers accept filter and layout writes
  // after style.load, even while tiles load. applyToMap waits on isStyleLoaded()
  // and can defer writes until another style.load, so it cannot own live control
  // updates. Same gate pattern as applyRouteData.
  useEffect(() => {
    poiHiddenRef.current = poiHidden;
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const run = (m: maplibregl.Map) => applyPoiCategoryVisibility(m, poiHidden);
    if (styleStructureReadyRef.current) {
      run(map);
    } else {
      pendingUpdatesRef.current.set("pois:filters", run);
    }
  }, [poiHidden, mapReady]);

  // Route + selection ring → sources/filter.
  useEffect(() => {
    routeLineRef.current = routeToLine(route);
    routeStopsRef.current = routeToStops(route);
    selectedIdRef.current = selectedVenueId;
    if (!mapReady) return;
    // Route source data via the permissive gate (see applyRouteData) so a
    // set-once plan route paints even while basemap tiles are still loading.
    applyRouteData();
    applyToMap("selection", (map) => {
      const selectedFilter: maplibregl.FilterSpecification = [
        "==",
        ["get", "id"],
        selectedIdRef.current,
      ];
      if (map.getLayer("pubs-selected-glow")) {
        map.setFilter("pubs-selected-glow", selectedFilter);
        // Reset to the static baseline on every selection change; the RAF
        // loop takes over from here again next frame if a venue is selected,
        // and a deselect leaves the ring at this baseline (not mid-pulse).
        map.setPaintProperty("pubs-selected-glow", "circle-stroke-opacity", GLOW_BASE_STROKE_OPACITY);
        // Slightly fatter ring while selected so the pinpoint reads under the sheet.
        map.setPaintProperty(
          "pubs-selected-glow",
          "circle-stroke-width",
          selectedIdRef.current ? GLOW_BASE_STROKE_WIDTH + 1.2 : GLOW_BASE_STROKE_WIDTH,
        );
      }
      if (map.getLayer("pubs-selected")) {
        map.setFilter("pubs-selected", selectedFilter);
      }
      // The UK base layer answers a tap with its own quieter ring; the same
      // selected id drives it, so exactly one of the two ever matches.
      if (map.getLayer("uk-base-selected")) {
        map.setFilter("uk-base-selected", selectedFilter);
      }
      // M1 selection spotlight — dim every non-selected pub pin; the selected
      // pin stays fully opaque. Deselect restores the plain serves-based dim.
      if (map.getLayer("pubs-point")) {
        map.setLayoutProperty(
          "pubs-point",
          "icon-size",
          selectedPinIconSizeExpr(selectedIdRef.current),
        );
        map.setPaintProperty(
          "pubs-point",
          "icon-opacity",
          pubIconOpacityExpr(selectedIdRef.current),
        );
        map.setPaintProperty(
          "pubs-point",
          "text-opacity",
          pubIconOpacityExpr(selectedIdRef.current),
        );
        // …and the price tag steps aside for the selected pub, which redraws it
        // itself on pubs-point-selected at the offset its bigger glyph needs.
        map.setLayoutProperty(
          "pubs-point",
          "text-field",
          pinPriceLabelExpr(selectedIdRef.current),
        );
        // Pins collide now, so the spotlight is only honest if the selected pin
        // also wins placement: re-key it to the front of the queue (and hand
        // the key back when nothing is selected).
        map.setLayoutProperty(
          "pubs-point",
          "symbol-sort-key",
          pinSortKeyExpr(selectedIdRef.current),
        );
      }
      // The overlap exemption lives on the dedicated selected-pin layer
      // (icon-allow-overlap is data-constant, so pubs-point itself cannot
      // exempt one feature): re-point its filter and keep its size in step
      // with the spotlight scale.
      if (map.getLayer("pubs-point-selected")) {
        map.setFilter("pubs-point-selected", selectedPinFilter(selectedIdRef.current));
        map.setLayoutProperty(
          "pubs-point-selected",
          "icon-size",
          selectedPinIconSizeExpr(selectedIdRef.current),
        );
      }
      // M2 POI-at-initiation gating — while a venue is selected the selected pub
      // must dominate: heavy-mute the POI/landmark/transport app layers AND the
      // basemap-baked transit roundels / street / POI labels. Deselect restores
      // the exact originals so the city overview reads unchanged. Opacity-only
      // via paint transitions (MapLibre's default 300ms ease) — no new RAF, no
      // React re-render, and it composes with the POI/tube visibility toggles.
      applySelectionMute(map, Boolean(selectedIdRef.current), selectionMuteStoreRef.current);
    });
  }, [route, selectedVenueId, mapReady, applyToMap, applyRouteData]);

  // Road-following upgrade (T4). The effect above paints the straight line
  // instantly (routeToLine, drawn dashed as "approximate"); here we ask
  // /api/walk-route to redraw the SAME ordered stops along real walking roads.
  // On an "ors" success we swap routeLineRef to the road LineString and repaint
  // (buildRoute draws it solid); on any failure the straight dashed line simply
  // stays. Debounced via an AbortController so rapid stop edits collapse to the
  // last route (mirrors the hover-detail fetch above). `routeCoordKey` is the
  // ordered `lng,lat;lng,lat` wire format /api/walk-route decodes (parseStops),
  // and re-fires only when the stop coordinates actually change.
  const routeCoordKey = route.map((v) => `${v.longitude},${v.latitude}`).join(";");
  useEffect(() => {
    if (!mapReady) return;
    if (routeCoordKey.split(";").length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    fetch(`/api/walk-route?stops=${encodeURIComponent(routeCoordKey)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { line?: GeoJSON.FeatureCollection; source?: string } | null) => {
        // Only upgrade when the server actually routed roads; a "straight"
        // response is the same geometry we already painted, so leave it dashed.
        if (!body || body.source !== "ors" || !body.line?.features?.length) return;
        routeLineRef.current = body.line;
        applyRouteData();
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // fail-soft: keep the instant straight line.
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [routeCoordKey, mapReady, applyRouteData]);

  const didFitQueryOnArrivalRef = useRef(false);
  useEffect(() => {
    didFitQueryOnArrivalRef.current = false;
  }, [cityId]);

  useEffect(() => {
    if (!mapReady || !fitQueryOnArrival) return;
    if (didFitQueryOnArrivalRef.current) return;
    // User already tapped a venue — leave the cinematic fly-to alone.
    if (selectedVenueId) return;
    if (venues.length === 0) return;
    didFitQueryOnArrivalRef.current = true;
    fitQueryVenues();
  }, [mapReady, fitQueryOnArrival, venues.length, selectedVenueId, fitQueryVenues]);

  // Reactive search framing (issue: map search dead-ends). When a live search
  // narrows to a multi-venue set the parent bumps `searchFitToken`; re-frame the
  // camera onto the current filtered venues so the matches are actually shown
  // instead of the pins silently vanishing at city zoom. Token 0 is the initial
  // no-op so first paint (owned by arrival framing) is left alone.
  useEffect(() => {
    if (!mapReady || searchFitToken <= 0) return;
    fitQueryVenues();
  }, [searchFitToken, mapReady, fitQueryVenues]);

  // A granted location is a temporary map aid, not a persisted Home Area.
  // Frame the local pub cloud once, then leave the camera entirely under the
  // user's control. Active routes own their own framing and take precedence.
  const didFitUserLocationRef = useRef("");
  useEffect(() => {
    if (!mapReady || !userLocation || route.length >= 2 || nearbyMapVenues.length === 0) return;
    const key = `${userLocation.lat.toFixed(5)},${userLocation.lng.toFixed(5)}`;
    if (didFitUserLocationRef.current === key) return;
    didFitUserLocationRef.current = key;
    fitNearby(userLocation, nearbyMapVenues);
  }, [mapReady, userLocation, route.length, nearbyMapVenues, fitNearby]);

  // The reader's dot is a CANVAS layer under the pins (see buildUserLocation),
  // not a DOM marker over them, so a pin the reader is standing on keeps its
  // price readable. Feed the source; the layers themselves are built with the
  // scene and survive a basemap style swap the same way every other layer does.
  useEffect(() => {
    userLocationDataRef.current = userLocationGeoJSON;
    const map = mapRef.current;
    if (!mapReady || !map) return;
    (map.getSource("user-location") as maplibregl.GeoJSONSource | undefined)?.setData(
      userLocationGeoJSON,
    );
  }, [mapReady, userLocationGeoJSON]);

  // Frame the crawl only when the route identity changes *materially* — the
  // ordered list of stop ids. Filters that churn the route array or a mere
  // selection change produce the same key, so the camera stays put while a user
  // tunes filters and pans. A curated-crawl load, near-me, or add/remove/reverse
  // all change the key and refit.
  // routeKey is the material identity; fitRoute is stable and reads the live
  // route via ref, so the effect only refits when the ordered stop ids change.
  const routeKey = route.map((venue) => venue.id).join(">");
  useEffect(() => {
    if (!mapReady) return;
    // An active selection owns the camera — don't let route framing yank out.
    if (selectedVenueId) return;
    fitRoute();
  }, [routeKey, mapReady, fitRoute, selectedVenueId]);

  // Cinematic fly-to on venue selection (after the route framing above).
  // `selectedPresent` closes the ?sel= deep-link race: on first load the
  // selected venue (often a lazily-forced scraped pub) may not be in the venue
  // set yet, so the effect bails and the camera never moves. The boolean flips
  // false→true exactly once when the venue first appears — re-running the
  // effect — and stays true across filter/drop churn, so `venues` itself can
  // remain out of the deps (no re-flying on churn, the original guarantee).
  const selectedPresent =
    Boolean(selectedVenueId) &&
    (venues.some((item) => item.id === selectedVenueId) || isUkBaseId(selectedVenueId));

  // Ambient orbit starts only after first pin reveal. Camera updates are fixed
  // at four per second with a 0.15 degree maximum. This removes continuous
  // rotateTo rendering that caused tile churn during phone QA.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !mapReady || !container) return;

    let onScreen = true;
    const step = orbitBearingStep(
      ORBIT_DEG_PER_SEC,
      ORBIT_FRAME_INTERVAL_MS,
      ORBIT_MAX_BEARING_STEP_DEG,
    );
    const orbit = createIdleOrbit({
      firstDelayMs: ORBIT_FIRST_DELAY_MS,
      interactionDelayMs: ORBIT_INTERACTION_DELAY_MS,
      frameIntervalMs: ORBIT_FRAME_INTERVAL_MS,
      isReduced: () => reducedRef.current,
      startStep: () => {
        const live = mapRef.current;
        if (!live) return;
        live.jumpTo({ bearing: live.getBearing() - step });
      },
      stop: () => {
        const live = mapRef.current;
        if (!live) return;
        live.stop();
        lastOrbitViewportPublishAtRef.current = 0;
        setMapBearing(live.getBearing());
        publishCurrentViewportRef.current?.();
      },
      setTimer: (callback, ms) => window.setTimeout(callback, ms),
      clearTimer: (id) => window.clearTimeout(id),
    });
    orbitRef.current = orbit;

    const interact = () => orbit.noteInteraction();
    const enable = () => orbit.setEnabled(true);
    const syncSuspended = () => {
      orbit.setSuspended(document.hidden || !onScreen);
    };
    const listenerOptions = { capture: true, passive: true } as const;
    container.addEventListener("pointerdown", interact, listenerOptions);
    container.addEventListener("wheel", interact, listenerOptions);
    container.addEventListener("touchstart", interact, listenerOptions);
    container.addEventListener("keydown", interact, listenerOptions);
    window.addEventListener("pubmax:camera-intent", interact);
    window.addEventListener(MAP_PIN_REVEAL_EVENT, enable);
    document.addEventListener("visibilitychange", syncSuspended);

    const observer = new IntersectionObserver((entries) => {
      onScreen = entries[0]?.isIntersecting ?? true;
      syncSuspended();
    });
    observer.observe(container);
    syncSuspended();

    return () => {
      container.removeEventListener("pointerdown", interact, listenerOptions);
      container.removeEventListener("wheel", interact, listenerOptions);
      container.removeEventListener("touchstart", interact, listenerOptions);
      container.removeEventListener("keydown", interact, listenerOptions);
      window.removeEventListener("pubmax:camera-intent", interact);
      window.removeEventListener(MAP_PIN_REVEAL_EVENT, enable);
      document.removeEventListener("visibilitychange", syncSuspended);
      observer.disconnect();
      orbit.dispose();
      if (orbitRef.current === orbit) orbitRef.current = null;
    };
  }, [mapReady]);

  useEffect(() => {
    if (!selectedVenueId) return;
    // Any venue selection — map pin, route stop, or the sidebar list — retires
    // both overlay cards: the landmark story (H2) and the intro teaser (M5).
    queueMicrotask(() => {
      selectLandmark(null);
      setHeroDismissed(true);
    });
    const map = mapRef.current;
    if (!map || !mapReady || !selectedPresent) return;
    const venue = venuesRef.current.find((item) => item.id === selectedVenueId);
    // A UK base pub is not in `venues` by design (it is not a venue), so its
    // coordinates come from the feature the tap just resolved — or, when the
    // pick arrived via search / list, from the resident streamed record.
    const center = venue
      ? ([venue.longitude, venue.latitude] as [number, number])
      : ukBaseSelectionRef.current?.id === selectedVenueId
        ? ukBaseSelectionRef.current.center
        : (() => {
            const base = ukBaseResidentPubsRef.current.find(
              (pub) => pub.id === selectedVenueId,
            );
            return base ? ([base.lng, base.lat] as [number, number]) : null;
          })();
    if (!center) return;
    // Mobile: offset the camera so the pin sits in the visible band above the
    // half-sheet (not under it); soften pitch so 3D buildings don't bury it.
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const offset = isPhone ? mobileSelectCameraOffset(window.innerHeight, "half") : undefined;
    cinematic({
      center,
      zoom: Math.max(map.getZoom(), 14),
      pitch: isPhone ? PUB_SELECT_PITCH_MOBILE : PUB_SELECT_PITCH,
      duration: PUB_SELECT_DURATION_MS,
      easing: easeOutCubic,
      ...(offset ? { offset } : {}),
    });
  }, [selectedVenueId, selectedPresent, mapReady, cinematic, selectLandmark]);

  // --- Story bands (issue #15) -------------------------------------------
  // Resolve the active band + its member pubs under the CURRENT (filtered)
  // venue set. Member matching is a pure function (lib/storyBands); memoised so
  // it only recomputes when the band or the venue list actually changes.
  const bandMembers = useMemo(
    () => (activeBand ? bandMemberPubs(activeBand, venues, cityLandmarks) : []),
    [activeBand, venues, cityLandmarks],
  );
  // Push band state to the map: corridor source, member-halo filter, colour.
  // Debounced via requestAnimationFrame so a rapid filter churn doesn't thrash
  // setPaintProperty. Everything is guarded by getLayer so a mid-setStyle swap
  // is a no-op (buildScene re-reads the refs on the next style.load).
  useEffect(() => {
    activeBandColourTokenRef.current =
      activeBand?.colourToken ?? null;
    const bandColour = publishRenderedState(readTokens()).storyColour;
    bandCorridorRef.current = bandCorridorGeoJSON(activeBand, cityLandmarks);
    bandMemberIdsRef.current = bandMembers.map((m) => m.venue.id);
    if (!mapReady) return;
    // Debounced via rAF so a rapid filter churn doesn't thrash setPaintProperty.
    // If the style is mid-swap when the frame fires, applyToMap queues the write
    // to flush on the next style.load rather than dropping it.
    const raf = requestAnimationFrame(() => {
      applyToMap("band:corridor+halo", (map) => {
        (map.getSource("band-corridor") as maplibregl.GeoJSONSource | undefined)?.setData(
          bandCorridorRef.current,
        );
        if (map.getLayer("band-members-halo")) {
          map.setFilter("band-members-halo", [
            "all",
            ["!", ["has", "point_count"]],
            ["in", ["get", "id"], ["literal", bandMemberIdsRef.current]],
          ]);
          if (bandColour) {
            map.setPaintProperty("band-members-halo", "circle-stroke-color", bandColour);
          }
        }
        if (map.getLayer("band-corridor") && bandColour) {
          map.setPaintProperty("band-corridor", "line-color", bandColour);
        }
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [
    activeBand,
    bandMembers,
    mapReady,
    applyToMap,
    cityLandmarks,
    publishRenderedState,
  ]);

  // H5: a tapped landmark surfaces its nearest story pubs (straight-line
  // distance — no routing, per PRD scope), wiring the history layer into the
  // heritage layer instead of leaving a dead-end Wikipedia card.
  const storyPubsNearby = useMemo(
    () => (activeLandmark ? nearestStoryPubs(activeLandmark, venues) : []),
    [activeLandmark, venues],
  );

  // M5 / PRD P1.5: one curated story venue greets the first paint. Prefer a
  // heritage pub the community has actually logged (Pint Drops), with the
  // Prospect of Whitby as the London-only flagship tie-break.
  const heroVenue = useMemo(() => {
    const candidates = venues.filter(
      (venue) => venue.hasStory && venue.curation.heritageNote,
    );
    if (candidates.length === 0) return null;
    const preferWhitby = cityId === "london";
    const score = (venue: Venue) =>
      (venueSignals.get(venue.id)?.hasPintDrops ? 2 : 0) +
      (preferWhitby && venue.name.toLowerCase().includes("prospect of whitby") ? 1 : 0);
    return candidates.reduce((best, venue) => (score(venue) > score(best) ? venue : best));
  }, [venues, venueSignals, cityId]);

  const hoverDetail = useMemo(
    () => (hoveredVenueId ? hoverDetails.get(hoveredVenueId) : undefined),
    [hoverDetails, hoveredVenueId],
  );
  const hoverMapVenue = useMemo(
    () => (hoveredVenueId ? venues.find((venue) => venue.id === hoveredVenueId) : undefined),
    [venues, hoveredVenueId],
  );
  const hoverSignal = hoveredVenueId ? venueSignals.get(hoveredVenueId) : undefined;
  const hoverCopy = hoverCardCopy(
    hoverMapVenue,
    hoverSignal,
    hoverDetail,
    Boolean(hoveredVenueId && provisionalVenueIds?.has(hoveredVenueId)),
    lensPrices === null || !hoveredVenueId
      ? undefined
      : lensPrices.get(hoveredVenueId) ?? null,
    lensNoun,
    lensIndexStatus,
  );
  const hoverImageUrl = hoverImageUrlFor(hoverDetail, failedHoverImage, hoveredVenueId);
  const hoverCardStyle = hoveredVenue
    ? {
        left: `clamp(${HOVER_CARD_VIEWPORT_GUTTER_PX}px, ${hoveredVenue.x + HOVER_CARD_X_OFFSET_PX}px, calc(100vw - ${HOVER_CARD_WIDTH_PX + HOVER_CARD_VIEWPORT_GUTTER_PX}px))`,
        top: `clamp(${HOVER_CARD_MIN_TOP_PX}px, ${hoveredVenue.y + HOVER_CARD_Y_OFFSET_PX}px, calc(100dvh - ${HOVER_CARD_HEIGHT_PX + HOVER_CARD_VIEWPORT_GUTTER_PX}px))`,
      }
    : undefined;

  if (mapError) {
    // Heading + body vary by cause so we never cry "needs WebGL" at a browser
    // that has it. Only the confirmed-dead-probe case makes that claim (and
    // hides Retry, since a re-init can't conjure a context that doesn't exist);
    // every other kind gets an honest one-liner and a Retry that fully re-inits.
    const heading = mapError.noWebgl
      ? "Map unavailable"
      : mapError.kind === "tiles"
        ? "Map tiles unavailable"
        : mapError.kind === "no-frame"
          ? "Map couldn't draw"
          : mapError.kind === "context-lost"
            ? "Map lost its graphics"
            : "Map couldn't start";
    // Static venue alternative: the slim pin index needs no WebGL, so surface
    // the cheapest pours as tappable rows (opening the DOM venue sheet) plus
    // the full directory link — the map going dark must never take the venue
    // content with it.
    const fallbackVenues = selectMapFallbackPubs(venues, FALLBACK_VENUE_COUNT);
    return (
      <div className="mapCanvasWrap">
        {/* Force a fresh node: MapLibre's imperative light-theme background
            would otherwise survive React's div-for-div fallback swap. */}
        <div key="map-fallback" className="mapFallback" role="alert">
          <strong>{heading}</strong>
          <p>
            {mapError.message}
            {" "}
            The pub list and crawl planner beside it still work as ever.
          </p>
          {mapError.detail ? (
            <div className="mapFallbackDisclosure">
              <button
                type="button"
                className="mapFallbackDisclosureToggle"
                aria-expanded={detailOpen}
                onClick={() => setDetailOpen((open) => !open)}
              >
                Technical details
              </button>
              {detailOpen ? (
                <small className="mapFallbackDetail">{mapError.detail}</small>
              ) : null}
            </div>
          ) : null}
          {fallbackVenues.length > 0 ? (
            <ul className="mapFallbackVenues" aria-label="Pubs you can still browse">
              {fallbackVenues.map((venue) => (
                <li key={venue.id}>
                  <button
                    type="button"
                    className="mapFallbackVenue"
                    onClick={() => onVenueClick(venue.id)}
                  >
                    <span className="mapFallbackVenueName">{venue.name}</span>
                    <span className="mapFallbackVenueMeta">
                      {venue.primaryBorough}
                      {venue.cheapestPrice != null
                        ? ` · ${formatPrice(venue.cheapestPrice)}`
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Link className="mapFallbackBrowse" href="/pubs">
            Browse all pubs
          </Link>
          {mapError.noWebgl ? null : (
            <button
              type="button"
              className="mapFallbackRetry"
              onClick={() => {
                setMapError(null);
                setSoftRetry(null);
                setDetailOpen(false);
                publishMapErrored(false);
                publishMapReady(false);
                contextAutoReinitSpentRef.current = false;
                setInitAttempt((a) => a + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const canRecenter = route.length >= 2;
  const cityDisplayName = getCity(cityId).displayName;

  return (
    <div
      className="mapCanvasWrap"
      inert={interactionLocked || undefined}
      data-route-stops={route.length}
      data-venue-count={venues.length}
      data-uk-base-count={ukBase.count}
      data-uk-base-status={ukBase.status}
    >
      <div ref={containerRef} className="maplibreMap" />
      {/* The reader's dot is painted on the canvas, which says nothing to a
          screen reader. This carries the same accessible name the old DOM
          marker did, so the position stays announced while the pins keep the
          pixels. It is also how a test can tell the map accepted a location. */}
      {userLocation ? (
        <span
          className="sr-only"
          role="img"
          aria-label="Your approximate location"
          data-user-location="shown"
        />
      ) : null}
      {softRetry ? (
        <div className="mapSoftRetry" role="status" data-kind={softRetry.kind}>
          <span className="mapSoftRetryMessage">{softRetry.message}</span>
          <button
            type="button"
            className="mapSoftRetryBtn"
            onClick={() => {
              if (softRetry.kind === "pins" || softRetry.kind === "venues") {
                // The background drew; only the pubs are missing. A full
                // re-init would throw away a healthy basemap, so spend the lane
                // the notice named and let ITS outcome write over this notice.
                // Clearing here first is what left a failed refetch with no
                // message to replace.
                pinRetryRef.current?.(softRetry.kind);
                return;
              }
              setSoftRetry(null);
              setMapError(null);
              setDetailOpen(false);
              publishMapErrored(false);
              publishMapReady(false);
              contextAutoReinitSpentRef.current = false;
              setInitAttempt((a) => a + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {/* Camera fit for the active city — not a city switcher (toolbar owns that).
          D7: this used to PRINT the city name, so the map carried two controls
          both reading "London", a pill here and the toolbar's dropdown. The name
          belongs to the switcher, which is the control that can change it. This
          one says what it does; the accessible name still names the city, and
          leads with the visible words so the two agree. */}
      <div className="mapCameraControls" aria-label="Map camera controls">
        <button
          type="button"
          className="mapFitLondonBtn"
          onClick={fitCityBounds}
          aria-label={`Show all of ${cityDisplayName}`}
          title={`Show all of ${cityDisplayName}`}
        >
          <MapPinned size={14} aria-hidden />
          Show all
        </button>
        {/* D7: only render once there's a route to recenter — a disabled
            "No route" ghost chip sitting in the camera-controls stack reads
            as a stuck/broken control when the map is routeless. */}
        {canRecenter ? (
          <button
            type="button"
            className="mapRecenterBtn"
            onClick={fitRoute}
            aria-label="Recenter route"
            title="Recenter route"
          >
            <Crosshair size={14} aria-hidden />
            Recenter
          </button>
        ) : null}
        {(() => {
          const action = resolveCompassAction(mapBearing, getCity(cityId).mapView);
          // MapLibre owns the reset-to-north action. Keep this app control only
          // for the complementary city-attitude action, so the two controls do
          // not duplicate one another when the opening camera is rotated.
          if (action.kind !== "adopt-attitude") return null;
          return (
            <button
              type="button"
              className="mapCompassBtn"
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                orbitRef.current?.noteInteraction();
                map.easeTo(
                  {
                    bearing: action.bearing,
                    pitch: action.pitch,
                    duration: reducedRef.current ? 0 : 450,
                  },
                );
              }}
              aria-label="Tilt the city view"
              title="Tilt the city view"
            >
              <Navigation2
                size={14}
                aria-hidden
                style={{ transform: `rotate(${-mapBearing}deg)` }}
              />
              N
            </button>
          );
        })()}
      </div>
      {activeLandmark ? (
        <aside className="landmarkCard" aria-label={`${activeLandmark.name} history`}>
          {activeLandmark.image ? (
            <figure className="landmarkPhoto">
              {/* Plain <img> (not next/image): a remote Wikimedia URL loaded
                  lazily, so no remotePatterns config and no layout cost until the
                  card opens. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeLandmark.image.url}
                alt={activeLandmark.name}
                loading="lazy"
                decoding="async"
              />
              <LandmarkPhotoCredit image={activeLandmark.image} />
            </figure>
          ) : null}
          <div className="landmarkCardHead">
            <LandmarkIcon size={15} />
            <strong>{activeLandmark.name}</strong>
            <Link
              className="landmarkChapterLink"
              href={`/landmark/${encodeURIComponent(activeLandmark.id)}`}
            >
              Open chapter
            </Link>
            <button
              type="button"
              onClick={() => selectLandmark(null)}
              aria-label="Close landmark history"
            >
              <X size={14} />
            </button>
          </div>
          <p>{activeLandmark.history}</p>
          <a href={activeLandmark.source.url} target="_blank" rel="noreferrer">
            Source: {activeLandmark.source.label}
            <ExternalLink size={12} />
          </a>
          {/* Issue #15: promote the card to a journey entry point — start a crawl
              from the nearest pubs, or open the nearest story pub's PUBMAXXER. */}
          {storyPubsNearby.length > 0 && (onStartCrawl || onAskPubmaxxer) ? (
            <div className="landmarkActions">
              {onStartCrawl ? (
                <button
                  type="button"
                  className="landmarkAction primary"
                  onClick={() => {
                    onStartCrawl(storyPubsNearby.map((p) => p.venue.id).slice(0, 3));
                    selectLandmark(null);
                  }}
                >
                  Start a crawl here
                </button>
              ) : null}
              {onAskPubmaxxer ? (
                <button
                  type="button"
                  className="landmarkAction"
                  onClick={() => {
                    onAskPubmaxxer(storyPubsNearby[0].venue.id);
                    selectLandmark(null);
                  }}
                >
                  Ask the PUBMAXXER
                </button>
              ) : null}
            </div>
          ) : null}
          {storyPubsNearby.length > 0 ? (
            <div className="landmarkNearby">
              <h4>Story pubs nearby</h4>
              {storyPubsNearby.map(({ venue, km }) => (
                <button
                  key={venue.id}
                  type="button"
                  onClick={() => {
                    selectLandmark(null);
                    onVenueClick(venue.id);
                  }}
                >
                  <span>{venue.name}</span>
                  <span>{formatLogNearbyDistance(km)} straight-line</span>
                </button>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}
      {hoveredVenue ? (
        <aside className="venueHoverCard" style={hoverCardStyle} aria-hidden="true">
          {hoverImageUrl ? (
            <figure className="venueHoverPhoto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hoverImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => {
                  if (hoveredVenueId) {
                    setFailedHoverImage({ venueId: hoveredVenueId, url: hoverImageUrl });
                  }
                }}
              />
            </figure>
          ) : (
            <div className="venueHoverPhotoFallback" aria-hidden="true">
              <span>{hoveredVenue.name.slice(0, 1).toUpperCase()}</span>
            </div>
          )}
          <div className="venueHoverBody">
            <span className="venueHoverEyebrow">
              {hoverDetail === undefined
                ? `Loading ${hoverCopy.venueTypeLabel.toLowerCase()} picture`
                : hoverDetail
                  ? `${hoverCopy.venueTypeLabel} preview`
                  : `Fast ${hoverCopy.venueTypeLabel.toLowerCase()} preview`}
            </span>
            <strong>{hoverDetail?.name ?? hoveredVenue.name}</strong>
            <span className="venueHoverMeta">
              {hoverDetail?.primaryBorough ? `${hoverDetail.primaryBorough} · ` : ""}
              {hoverCopy.price !== null && hoverCopy.price !== undefined
                ? `${formatPrice(hoverCopy.price)} ${hoverCopy.priceSuffix}`
                : `Tap for full ${hoverCopy.detailLabel}`}
            </span>
            <span className="venueHoverProvenance">{hoverCopy.provenance}</span>
            {/* The badge on the pin, said in words. Its dot is the same colour
                as the one the map is drawing, so the card explains a mark the
                reader can see rather than introducing a new one. */}
            {hoverCopy.pendingNote ? (
              <span className="venueHoverPending">
                <i className="venueHoverPendingDot" />
                {hoverCopy.pendingNote}
              </span>
            ) : null}
          </div>
        </aside>
      ) : null}
      {heroVenue && !heroDismissed ? (
        <MapHeroCard
          venue={heroVenue}
          onDismiss={() => setHeroDismissed(true)}
          onVisit={onVenueClick}
        />
      ) : null}
      {/* Wave J declutter: one Layers control on all viewports (Airbnb-clean).
          Desktop mid-map POI strip + Place stories stack removed — same content
          lives in the Layers popover. Do not rebuild #63 structure. */}
      {!hideLayersControl ? (
        <MapLayersControl
          poiHidden={poiHidden}
          onPoiHiddenChange={setPoiHidden}
          activeBandId={activeBandId}
          onBandChange={onBandChange}
          storyBands={cityStoryBands}
          cityId={cityId}
          readerKey={layersReaderKey}
          readerPriceFilter={layersReaderPriceFilter}
          listOpen={listOpen}
          onListOpenChange={onListOpenChange}
          listCount={listCount}
        />
      ) : null}
      {activePoi ? (
        <div className="poiLabelCard" role="status">
          <span
            className="poiSwatch"
            style={{ background: POI_CATEGORY_META[activePoi.category].color }}
          />
          <strong>{activePoi.name}</strong>
          <span className="poiKind">{POI_CATEGORY_META[activePoi.category].label}</span>
          <button type="button" onClick={() => setActivePoi(null)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
