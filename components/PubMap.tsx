"use client";

import { CalendarClock, List, MapPinned, ShieldCheck, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

const PubPalMascot = dynamic(
  () => import("@/components/pal/PubPalMascot").then((m) => m.PubPalMascot),
  { ssr: false },
);
const ThemeToggle = dynamic(() => import("@/components/ThemeToggle"), { ssr: false });
import PriceBadge from "@/components/PriceBadge";
import "@/components/map/venueSheet.css";
import "@/components/map/spillComposer.css";
import "@/components/map/logIntentFallback.css";
import "@/components/map/mapBannerStaging.css";
import "@/components/map/mapToolbar.css";
import "@/components/map/citySuggestBanner.css";
import "@/components/map/cityStatusBanner.css";
import "@/components/map/mapConciergeAsk.css";
import "@/components/map/mapDesktopRail.css";
import "@/components/map/tonightLane.css";
const UkPlaceArrivalBanner = dynamic(
  () => import("@/components/map/UkPlaceArrivalBanner"),
  { ssr: false },
);
const UkNationalBrowseBanner = dynamic(
  () => import("@/components/map/UkNationalBrowseBanner"),
  { ssr: false },
);

import {
  buildCrawlRoute,
  formatPrice,
  mergeVenueDrops,
  NO_PINT_PRICE_CAP,
  provisionalPintDropVenueIds,
  type Filters,
  type Venue,
} from "@/lib/venues";
import {
  isMapSearchField,
  typedSearchCameraMove,
  TYPED_SEARCH_MIN_QUERY,
} from "@/lib/mapSearchCamera";
import { filterMapVenues, withForcedVenue } from "@/lib/filterMapVenues";
import {
  OPEN_NOW_FILTER_CAPTION,
  openNowStatesForVenues,
} from "@/lib/openNow";
import {
  loadWetherspoonsDirectory,
  type WetherspoonsPub,
} from "@/lib/wetherspoonsDirectory";
import type { WetherspoonsMatchVenue } from "@/lib/wetherspoonsMatch";
import { mergePriceUpdates, parsePriceUpdates, type PriceUpdate } from "@/lib/priceUpdates";
import { nearestVenueIds } from "@/lib/nearby";
import {
  NEAR_ME_MAP_MIN_VENUES,
  NEAR_ME_MAP_RADIUS_KM,
  nearMeMapVenues,
  withinNearMeRing,
} from "@/lib/nearMeMapFrame";
import {
  NEAR_ME_LOCATION_OPTIONS,
  nearMeLocationFailure,
  nearMeLocationMessage,
} from "@/lib/nearMeLocation";
import {
  buildMapVenueListModel,
  buildUkBasePubListModel,
  type MapVenueListSortMode,
} from "@/lib/mapVenueList";
import { UK_BOUNDS } from "@/components/map/canvas/tokens";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
const SpringDrawer = dynamic(() => import("@/components/map/SpringDrawer"), {
  ssr: false,
});
const SiteNav = dynamic(() => import("@/components/nav/SiteNav"), {
  ssr: false,
});
// Perf (mobile /map cold-open): MapLibre (~327 KB) lives only in PubMapCanvas
// and its canvas helpers (donutClusters / useMapCamera). Keep it out of the
// PubMap shell chunk so first paint is shell + skeleton; MapLibre parses after
// the dynamic import resolves. Type-only maplibre imports stay static in
// filters/interactions/buildScene. Loading fallback is a full-bleed map-shaped
// plate matching the dark basemap so CLS stays 0 under the existing .mapLoading
// overlay (same absolute inset stage).
const PubMapCanvas = dynamic(() => import("@/components/PubMapCanvas"), {
  ssr: false,
  loading: () => (
    <div
      className="mapCanvasWrap mapCanvasSkeleton"
      aria-hidden="true"
      data-map-canvas="loading"
    />
  ),
});
const MobileMapShell = dynamic(() => import("@/components/mobile/MobileMapShell"), {
  ssr: false,
});
import { Sheet } from "@/components/ui/sheet";
import { useMobileTflStatus } from "@/components/mobile/MobileTflPanel";
import { Button } from "@/components/ui/button";
import type { GeneratedMobilePlan } from "@/components/plan/MobilePlanActivation";
const MobilePlanActivation = dynamic(
  () =>
    import("@/components/plan/MobilePlanActivation").then(
      (m) => m.MobilePlanActivation,
    ),
  { ssr: false },
);
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
const DrinkLanePicker = dynamic(() => import("@/components/map/DrinkLanePicker"), {
  ssr: false,
});
const DrinkShapeChips = dynamic(() => import("@/components/map/DrinkShapeChips"), {
  ssr: false,
});
const MapKey = dynamic(() => import("@/components/map/MapKey"), { ssr: false });
const MapPriceFilterChips = dynamic(() => import("@/components/map/MapPriceFilterChips"), {
  ssr: false,
});
const MapExperienceLensControl = dynamic(
  () => import("@/components/map/MapExperienceLens"),
  { ssr: false },
);
const FavoritePintPicker = dynamic(() => import("@/components/map/FavoritePintPicker"), {
  ssr: false,
});
const MobilePriceChoices = dynamic(() => import("@/components/map/MobilePriceChoices"), {
  ssr: false,
});
const PersonaLensPicker = dynamic(() => import("@/components/map/PersonaLensPicker"), {
  ssr: false,
});
const PersonaLensCard = dynamic(() => import("@/components/map/PersonaLensCard"), {
  ssr: false,
});
import {
  SAVED_ONLY_ARIA_LABEL,
  SAVED_ONLY_EMPTY_NOTE,
} from "@/lib/savedOnlyFilter";
import { useTonightLaneCue } from "@/components/map/usePersonaTonight";
import type { WhatsOnKind } from "@/lib/whatsOn";
import { findPersonaByIdAsync, personaHighlightsPubs, loadPersonaDrinksModule } from "@/lib/personaDrinks.async";
import type { PersonaDrink } from "@/lib/personaDrinks";
const MapLayersControl = dynamic(() => import("@/components/map/MapLayersControl"), {
  ssr: false,
});
const TonightArcChips = dynamic(() => import("@/components/map/TonightArcChips"), {
  ssr: false,
});
const MobileTflPanel = dynamic(() => import("@/components/mobile/MobileTflPanel"), {
  ssr: false,
});
// Perf (mobile map budget): the planner rail/route panel, venue inspector,
// mobile plan activation, and the desktop-only map chrome below are NOT on the
// first mobile map paint — the planner and inspector only mount after a user
// opens them (planningOpen / detailOpen), and the desktop chrome never mounts
// on a phone viewport at all. Statically importing them fused their JS into the
// eager map chunk that must parse before the WebGL canvas can mount. Loading
// them via next/dynamic (ssr:false — the whole PubMap tree is already client
// only) splits each into its own lazy chunk fetched on demand, so a cold mobile
// /map load ships materially less JS to parse before first tile paint.
const ControlRail = dynamic(() => import("@/components/map/ControlRail"), {
  ssr: false,
});
import type { CuratedCrawl } from "@/lib/curatedCrawls";
const RoutePanel = dynamic(() => import("@/components/map/RoutePanel"), {
  ssr: false,
});
const ActiveRoundChip = dynamic(() => import("@/components/map/ActiveRoundChip"), {
  ssr: false,
});
import type { TabKey } from "@/components/map/VenueInspector";
const VenueInspector = dynamic(
  () => import("@/components/map/VenueInspector"),
  { ssr: false },
);
import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";
// Only ever mounted for a tapped UK base pin, so it stays off the map's
// critical chunk exactly like the curated inspector above it.
const UnverifiedPubSheet = dynamic(
  () => import("@/components/map/UnverifiedPubSheet"),
  { ssr: false },
);
const MapToolbar = dynamic(() => import("@/components/map/MapToolbar"), {
  ssr: false,
});
// Desktop right-rail (D3.1): off the critical map chunk and never on mobile.
const MapDesktopRail = dynamic(() => import("@/components/map/MapDesktopRail"), {
  ssr: false,
});
// List view (a11y keyboard venue path) joins the off-critical-path dynamic set:
// it renders on demand, so it must not enter the eager map chunk (#306 budget).
const MapVenueList = dynamic(() => import("@/components/map/MapVenueList"), {
  ssr: false,
});
const CitySuggestBanner = dynamic(
  () => import("@/components/map/CitySuggestBanner"),
  { ssr: false },
);
const CityStatusBanner = dynamic(
  () => import("@/components/map/CityStatusBanner"),
  { ssr: false },
);
import { useCrawlJourneys } from "@/components/map/useCrawlJourneys";
import { useTonightOpportunities } from "@/components/map/useTonightOpportunities";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
const TonightLane = dynamic(() => import("@/components/map/TonightLane"), {
  ssr: false,
});
import type { LocationRequestStatus } from "@/components/map/VenueGettingThere";
const MapConciergeAsk = dynamic(
  () => import("@/components/map/MapConciergeAsk"),
  { ssr: false },
);
import { trackEvent } from "@/lib/analytics";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityMapHref";
import { usePintDrops } from "@/components/map/usePintDrops";
import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import { mapPriceLegend } from "@/lib/mapPriceLegend";
import {
  EMPTY_MAP_RENDERED_STATE,
  sameMapRenderedState,
  type MapRenderedState,
} from "@/lib/mapRenderedState";
import {
  mergeCommunityPriceSignals,
  provisionalCommunityPriceVenueIds,
  provisionalVenueIdKey,
  provisionalVenueIdsFromKey,
} from "@/components/map/communityPriceSignals";
import { useLiveDrops } from "@/components/map/useLiveDrops";
import { useSheetDrag } from "@/components/map/useSheetDrag";
import {
  revealForm,
  venueRevealPrefersReducedMotion,
  VENUE_REVEAL_CINEMA_MS,
} from "@/lib/sheetSnap";
import type { VenueRevealRequest } from "@/lib/venueReveal";
import { useBuiltIdsPersistence } from "@/components/map/pubmap/useBuiltIdsPersistence";
import { useSelParamSync } from "@/components/map/pubmap/useSelParamSync";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { useLandmarkJourney } from "@/components/map/pubmap/useLandmarkJourney";
import { useLogIntent } from "@/components/map/pubmap/useLogIntent";
import { MappedRouteChip } from "@/components/map/pubmap/MappedRouteChip";
import { BandOnboardingChip } from "@/components/map/pubmap/BandOnboardingChip";
const MapOnboardingOverlay = dynamic(
  () =>
    import("@/components/map/pubmap/MapOnboardingOverlay").then((m) => ({
      default: m.MapOnboardingOverlay,
    })),
  { ssr: false },
);
const LogIntentFallback = dynamic(
  () =>
    import("@/components/map/pubmap/LogIntentFallback").then(
      (m) => m.LogIntentFallback,
    ),
  { ssr: false },
);
import { useActivePlanRoute } from "@/components/map/pubmap/useActivePlanRoute";
import { useMapPlanCoordinator, useMapPlanPresentation } from "@/components/map/pubmap/useMapPlanCoordinator";
import { planStopsToRouteVenues } from "@/lib/activePlanRoute";
import { seedCrawlState, useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import {
  TRUSTED_HANDOFF_FLAGS_OFF,
  type TrustedHandoffFlagsDTO,
} from "@/lib/trustedHandoffFlags";
import type { AltCrawlStyle } from "@/lib/crawlUrl";
import {
  clearFavoritePint,
  getFavoritePint,
  setFavoritePint as persistFavoritePint,
} from "@/lib/favoritePint";
import { notifyCheapPintPingQualified } from "@/lib/cheapPintPingQualifyClient";
import { getSaved } from "@/lib/savedPubs";
import { venuesInNearbyMembership } from "@/lib/mapNearbyMembership";
import {
  createSlimShardLoader,
  NEIGHBOUR_SHARD_RING,
  openingLoadViewportFor,
  openingLocationCancellationAfterAttempt,
  scheduleSlimShardRingLoads,
  VIEWPORT_SHARD_RING,
  type MapBounds,
  type SlimShardLoader,
} from "@/lib/slimShards";
import { useInitialSlimShardStart } from "@/components/map/useInitialSlimShardStart";
import type { SlimVenue } from "@/lib/venuesSlim";
import {
  DEFAULT_CITY_ID,
  getCity,
  pointInCityBounds,
  type CityId,
} from "@/lib/cities";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { pinsToSlimVenues, slimVenuesToPins } from "@/lib/slimPins";
import { formatSelectionHint, parseSelectionHint } from "@/lib/mapSelectionHistory";
import {
  isUkBaseId,
  type UkBasePub,
  type UkBaseStreamStatus,
} from "@/lib/ukBasePubs";
import { computeZonePintIndex } from "@/lib/zones";
import { useCityStoryCatalog } from "@/components/map/useCityStoryCatalog";
import { mapSeedNeedsCuratedCrawlLookup } from "@/lib/mapSeedCrawlPolicy";
import { completeNeighbourhoodCountSlugs } from "@/lib/mapAreaPicker";
const ZonePicker = dynamic(() => import("@/components/map/ZonePicker"), { ssr: false });
const AreaSheet = dynamic(() => import("@/components/map/AreaSheet"), { ssr: false });
const ChooseAreaSheet = dynamic(() => import("@/components/map/ChooseAreaSheet"), {
  ssr: false,
});
const ChooseAreaDesktopDialog = dynamic(
  () =>
    import("@/components/map/ChooseAreaSheet").then((m) => ({
      default: m.ChooseAreaDesktopDialog,
    })),
  { ssr: false },
);
import type { ChooseAreaPick } from "@/components/map/ChooseAreaSheet";
const MapArrivalCard = dynamic(() => import("@/components/map/MapArrivalCard"), {
  ssr: false,
});
import type { MapSearchSuggestProps } from "@/components/map/MapSearchSuggest";
import {
  LOCALITY_FLY_ZOOM,
  type PlaceSuggestion,
} from "@/lib/mapSearchSuggest";
import { haversineKm } from "@/lib/haversine";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import {
  buildLogNearbyCandidates,
  clearMapLogIntentSearch,
  hasMapLogIntent,
  resolveLogNearbyOrigin,
  LOG_NEARBY_MAX_KM,
} from "@/lib/mapLogIntent";
import prefetchVenue from "@/lib/prefetchVenue";
import { warmVenueDetail } from "@/lib/warmVenueDetail";
import { FIRST_PINS_SEEN_KEY, markPubmaxTiming } from "@/lib/performanceMarks";
import {
  isCurrentMapResumeRefresh,
  isPersistableMapResumeViewport,
  type MapResumeLiveLoadStatus,
  readMapResume,
  readMapResumeSync,
  writeMapResume,
} from "@/lib/mapResume";
import {
  readOpeningMapLocation,
  readMapOpeningLocation,
  resolveMapOpeningView,
  writeMapOpeningLocation,
} from "@/lib/mapOpeningLocation";
import type { MapOpeningLocation } from "@/lib/mapOpeningLocation";
import { mapLoadingHeld, mapLoadingProgressPercent } from "@/lib/mapLoadingCopy";
import { pickMapSurfaceToast } from "@/lib/mapSurfaceChrome";
import { resolveMapDisplayName } from "@/lib/mapDisplayName";
import MapLoadingFrame from "@/components/map/MapLoadingFrame";
import { useMapPinsRevealed } from "@/components/map/useMapPinsRevealed";
import { markPalRouteActivation } from "@/lib/pubPal";
import {
  drinkLensPriceNoun,
  drinkLensUnknownRowLabel,
  experienceLensSummary,
  NO_ALCOHOL_LENS_PRICE_NOUN,
  filtersForDrinkPriceLens,
  filtersForExperienceLens,
  filterVenuesForExperienceLens,
  isMapLensDrinkCategory,
  lensPricesForVenues,
  parseMapExperienceLensParam,
  trustedDrinkLensPrices,
  trustedNoAlcoholLensPrices,
  MAP_EXPERIENCE_LENS_URL_PARAM,
  type CategoryPriceIndexStatus,
  type MapExperienceLens as MapExperienceLensValue,
} from "@/lib/mapExperienceLens";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import {
  activeDrinkLane,
  applyDrinkLane,
  DEFAULT_DRINK_LANE,
  drinkLaneLabel,
  venueDrinkPriceView,
} from "@/lib/drinkLanes";
import {
  bandChipHasResolvedBand,
  bandChipDismissedKey,
  shouldShowBandOnboardingChip,
  shouldShowCuratedOnboarding,
} from "@/lib/bandOnboardingChip";
import { hasSeenTour } from "@/lib/firstRunTour";
import {
  locationAllowsInterruptivePrompt,
  subscribePromptBudget,
} from "@/lib/promptBudget";
import {
  shouldOpenPlanningInitially,
  shouldFitQueryVenuesOnArrival,
  resolveQueryRestoreFit,
} from "@/lib/mapArrival";
import {
  mapChosenAreaFlyTarget,
  mapChosenAreaPickerKind,
  readMapChosenArea,
  rememberMapChosenAreaSelection,
  resolveMapChosenAreaRestore,
  subscribeMapChosenArea,
  writeMapChosenArea,
} from "@/lib/mapChosenArea";
import type { MapCameraFocus } from "@/lib/mapCameraFocus";
import {
  shouldShowMapFirstVisitArrival,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";
import {
  areaSheetOpenDelay,
  areaClaimedByViewport,
  areaUnderCentre,
  planAreaSelect,
  type AreaDistanceFrom,
  type AreaElsewhereOption,
} from "@/lib/areaButton";
import type { AreaSheetPlaceFocus } from "@/components/map/AreaSheet";
import { parseLocalityGazetteer, type Locality } from "@/lib/localities";
import type { MapSearchAreaOption } from "@/lib/mapSearchSuggest";
import { getNightArea, getNightAreasForCity, nearestNightAreaForViewport, nightAreaForMapQuery, type NightArea } from "@/lib/nightAreas";
import { defaultPoiHiddenForViewport } from "@/lib/poiToggleGroups";
import {
  defaultVenueKindVisibility,
  filterVenuesByKind,
  hasSavedPubVenue,
  isPubVenue,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";
import { venueSheetLabels } from "@/lib/venueSheetLabels";
import {
  MAP_SHEET_TITLES,
  readMobileMapSession,
  MOBILE_SHEET_DISMISS_EVENT,
  withCityCameraAttitude,
  writeMobileMapSession,
  type MobileShellState,
  type MapOverlay,
  type MapSheetKind,
  type MapViewportSnapshot,
  type NearbyMapResult,
} from "@/lib/mobileShell";
import {
  EMPTY_MAP_SURFACE_STATE,
  useMapSurfaceNavigation,
  type MapSurfaceId,
  type MapSurfaceState,
} from "@/components/map/pubmap/useMapSurfaceNavigation";
import SurfaceNav from "@/components/ui/surface-nav";
import { homeActionLabel, type SurfaceEntry } from "@/lib/surfaceStack";
import {
  filtersForCuratedCrawl,
  buildMapSeed,
  detailStatusFor,
  mapSelectionNotice,
  mapSelectionNoticeFromSearch,
  MAP_SELECTION_LOOKUP_FAILED_NOTE,
  MAP_SELECTION_NOTICE_PARAM,
  UNKNOWN_MAP_SELECTION_NOTE,
  venueUpdateKey,
  normaliseTonightVenueLookup,
  type MapSeed,
  type MapSelectionNotice,
  type VenueDetailStatus,
} from "@/lib/pubMap";
import { explicitMapIntent } from "@/lib/explicitMapIntent";
import {
  parseUkPlaceIndex,
  UK_PLACE_INDEX_PATH,
  ukPlaceMapView,
  type UkPlace,
  type UkPlaceMapArrival,
} from "@/lib/ukPlaceSearch";
import {
  isUkNationalBrowse,
  UK_NATIONAL_MAP_VIEW,
} from "@/lib/ukNationalBrowse";
import {
  PLANNING_INTENT_CHANGED_EVENT,
  readPlanningIntent,
} from "@/lib/planningIntent";
import {
  acceptMapVenue,
  invalidateAcceptedArrivalSource,
  readAcceptedArrivalSource,
  scheduleAcceptedArrivalExpiry,
  type AcceptedArrivalInput,
} from "@/lib/mapAcceptance";
import { VENUE_ACCEPTANCE_STORAGE_ERROR } from "@/lib/venueAcceptance";

// The "Near me now" instant-answer cards (Cycle 3, Lane 1). Loaded lazily so it
// never rides in the eager map chunk (perf budget, PR #306) — it only mounts
// when the Near-me sheet opens, and answers from the already-loaded venues.
const NearMeNow = dynamic(() => import("@/components/nearme/NearMeNow"), { ssr: false });

// Mobile venue-detail bottom sheet: the drag gesture + snap→px math live in
// useSheetDrag (components/map/useSheetDrag.ts). PubMap only owns WHICH snap is
// default on a fresh pick and renders the sheet chrome.

// The set of venue ids this device has saved (any list). Read from the client
// saved-pub store; SSR-safe (getSaved returns [] on the server). Used only to
// narrow the map/list when the viewer flips "Saved only" on.
function readSavedVenueIds(): Set<string> {
  return new Set(getSaved().map((entry) => entry.venueId));
}

// SSR-safe read of the current URL query. Kept in one place so the several
// param probes below can't drift on the SSR ("") fallback.
function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

// A same-tab PlanningIntent write raises no `storage` event, so this lane also
// listens for the writer's own announcement. Without it the accepted-arrival
// answer only refreshed because the snapshot callback's identity changed with
// the search params, which is a coincidence rather than a subscription.
const ACCEPTED_ARRIVAL_EVENTS = [
  "storage",
  "popstate",
  PLANNING_INTENT_CHANGED_EVENT,
] as const;

function subscribeAcceptedArrival(
  query: () => AcceptedArrivalInput,
  onStoreChange: () => void,
): () => void {
  let cancelExpiry: () => void = () => {};
  let scheduleExpiry: () => void = () => {};
  const notify = () => {
    invalidateAcceptedArrivalSource();
    onStoreChange();
    scheduleExpiry();
  };
  scheduleExpiry = () => {
    cancelExpiry();
    cancelExpiry = scheduleAcceptedArrivalExpiry(query(), notify);
  };
  for (const name of ACCEPTED_ARRIVAL_EVENTS) window.addEventListener(name, notify);
  scheduleExpiry();
  return () => {
    cancelExpiry();
    for (const name of ACCEPTED_ARRIVAL_EVENTS) window.removeEventListener(name, notify);
  };
}

function noAcceptedArrivalSource(): null {
  return null;
}

// D4 — take `log=1` off the current history entry. Idempotent, so it can run
// again after a popstate restores an entry that still carries the flag.
function dropLogParamFromUrl(): void {
  if (typeof window === "undefined") return;
  if (!hasMapLogIntent(window.location.search)) return;
  const query = clearMapLogIntentSearch(window.location.search);
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

// hasCrawlArrivalParams (pure §4.5 deep-link probe) now lives in @/lib/pubMap.

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function subscribeMobileViewport(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function mobileViewportSnapshot(): boolean {
  return isMobileViewport();
}

// The desktop right-rail lives at >=1024, matching the feed/tonight rails (the
// 640 phone split is a separate threshold). Its own matchMedia so the rail
// mounts only when actually shown — no phantom conditions/area fetches below it.
const DESKTOP_RAIL_MEDIA_QUERY = "(min-width: 1024px)";

// One frozen empty gazetteer, so a non-London city hands every reader of
// `localities` the same reference rather than a fresh array every render.
const NO_LOCALITIES: Locality[] = [];

// Shard coverage is recomputed after every shard settles, so the held set is
// replaced only when its membership really moved.
function sameSlugSet(
  held: ReadonlySet<string> | null,
  next: ReadonlySet<string>,
): boolean {
  if (!held || held.size !== next.size) return false;
  for (const slug of next) {
    if (!held.has(slug)) return false;
  }
  return true;
}
function subscribeDesktopRailViewport(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_RAIL_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function desktopRailViewportSnapshot(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_RAIL_MEDIA_QUERY).matches;
}

// mergeVenueDrops (lib/venues.ts) folds drops into DERIVED SUMMARY SIGNALS only:
// a bare price is never a story, and demo seeds never move prices or hasStory.

// Hand-built stop ids are mirrored to localStorage while a crawl is active.
// Clean /map arrivals do NOT auto-restore from this key (that made tab links
// look weird by dumping stale ?pubs= into the address bar). The URL is the
// only share/restore source.
const BUILT_STORAGE_KEY = "pubmax_built_ids";

// crawlStopsFromPubIds, filtersForCuratedCrawl, resolveSeededCuratedCrawl,
// MapSeed and buildMapSeed (all pure) now live in @/lib/pubMap.

// useLandmarkJourney and useLogIntent now live in
// components/map/pubmap/useLandmarkJourney.ts and .../useLogIntent.ts.

// §4.5 curated-crawl onboarding: dismissal is per-session so a reload during the
// same visit doesn't re-nag, but a fresh session gets the offer again. sessionStorage
// (not localStorage) keeps it a gentle, per-visit prompt.
const ONBOARDING_DISMISSED_KEY = "pubmax_onboarding_dismissed";
const TONIGHT_OVERLAY_DISMISSED_KEY = "pubmaxx.tonightOverlay.dismissed";
const EMPTY_ROUTE: Venue[] = [];

/** Camera-settle debounce before one viewport's base pubs are read for marks. */
const PROVISIONAL_BASE_SETTLE_MS = 1_000;
/**
 * How long a `?sel=venue-uk-*` arrival may hold that read back while it waits
 * for its own pin to stream in. Bounded on purpose: an id the current shards no
 * longer carry never arrives, and an unbounded wait would mute every base mark
 * for the rest of the session.
 */
const PROVISIONAL_BASE_RESTORE_WAIT_MS = 8_000;

const DETAIL_STATUS_STYLE: CSSProperties = {
  margin: "0 18px 10px",
  padding: "10px 12px",
  border: "1px solid rgba(211, 164, 74, 0.28)",
  borderRadius: "8px",
  background: "rgba(211, 164, 74, 0.1)",
  color: "var(--ink)",
  fontSize: "0.82rem",
  fontWeight: 700,
};

const DETAIL_WARNING_STYLE: CSSProperties = {
  ...DETAIL_STATUS_STYLE,
  borderColor: "rgba(209, 99, 83, 0.34)",
  background: "rgba(209, 99, 83, 0.12)",
};

// VenueDetailStatus, detailStatusFor and venueUpdateKey (all pure) now live in
// @/lib/pubMap.

type UserLocation = {
  lat: number;
  lng: number;
};

type PendingNearMeRequest =
  | {
      kind: "map";
      location: UserLocation;
      mode: "tap" | "arrival" | "resume";
    }
  | {
      kind: "crawl";
      location: UserLocation;
      stopCount: number;
    };

const LOCATION_FIRST_ZOOM = 15;
const OPENING_LOCATION_HOLD_VIEW: MapViewportSnapshot = {
  center: [0, 0],
  zoom: 0,
  pitch: 0,
  bearing: 0,
};

function boundsForOpeningView(viewport: MapViewportSnapshot): MapBounds {
  const width = typeof window === "undefined" ? 390 : Math.max(window.innerWidth, 1);
  const height = typeof window === "undefined" ? 844 : Math.max(window.innerHeight, 1);
  const scale = 512 * 2 ** viewport.zoom;
  const longitudeDelta = (width * 180) / scale;
  const latitudeDelta = (height * 180 * 1.4) / scale;
  const [lng, lat] = viewport.center;
  return {
    west: lng - longitudeDelta,
    south: Math.max(-85, lat - latitudeDelta),
    east: lng + longitudeDelta,
    north: Math.min(85, lat + latitudeDelta),
  };
}

function readOnboardingDismissed(): boolean {
  if (typeof window === "undefined") return true; // SSR: never render the overlay server-side
  try {
    return window.sessionStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function readTonightOverlayDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(TONIGHT_OVERLAY_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// normaliseTonightVenueLookup (pure) now lives in @/lib/pubMap.

// G3: per-band session dismiss for the Place story deep-link chip. Distinct from
// ONBOARDING_DISMISSED_KEY so dismissing one never silences the other.
function readBandChipDismissed(bandId: string): boolean {
  if (!bandId || typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(bandChipDismissedKey(bandId)) === "1";
  } catch {
    return false;
  }
}

export default function PubMap({
  cityId = DEFAULT_CITY_ID,
  flags = TRUSTED_HANDOFF_FLAGS_OFF,
  placeArrival = null,
  nationalBrowse = false,
}: {
  cityId?: CityId;
  flags?: TrustedHandoffFlagsDTO;
  /**
   * Server-resolved uncovered-place arrival. Frozen at mount like every other
   * arrival read. It arrives as a prop rather than being parsed out of
   * location.search here because the name is printed as our own copy, so it
   * must come from our own place index, and because a soft navigation can hand
   * this component an empty search string at mount.
   */
  placeArrival?: UkPlaceMapArrival | null;
  /**
   * Explicit UK-wide browse (`/map?uk=1`). Opens at a national overview; pubs
   * appear once the camera crosses the base zoom gate. Never invents prices.
   */
  nationalBrowse?: boolean;
}) {
  const city = getCity(cityId);
  const [ukPlaceArrival] = useState(() => placeArrival);
  const [ukNationalBrowse] = useState(
    () => nationalBrowse || isUkNationalBrowse(currentSearch()),
  );
  // National gazetteer for map search (same places.json as /choose-city).
  // Loaded once when the reader types two characters or arrives on a national
  // / uncovered surface — never on every keystroke.
  const [ukPlaces, setUkPlaces] = useState<readonly UkPlace[]>([]);
  const ukPlacesPromiseRef = useRef<Promise<readonly UkPlace[]> | null>(null);
  const loadUkPlaces = useCallback((): Promise<readonly UkPlace[]> => {
    if (ukPlacesPromiseRef.current) return ukPlacesPromiseRef.current;
    const pending = fetch(UK_PLACE_INDEX_PATH)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const places = parseUkPlaceIndex(await response.json());
        setUkPlaces(places);
        return places;
      })
      .catch(() => {
        ukPlacesPromiseRef.current = null;
        return [] as readonly UkPlace[];
      });
    ukPlacesPromiseRef.current = pending;
    return pending;
  }, []);
  const [lastKnownLocation] = useState(() =>
    currentSearch() ? null : readMapOpeningLocation(),
  );
  const mapOpeningNeedsResolution =
    !currentSearch() && !ukPlaceArrival && !ukNationalBrowse;
  const [initialMapView] = useState<MapViewportSnapshot>(() => {
    if (ukPlaceArrival) return ukPlaceMapView(ukPlaceArrival, city.mapView);
    if (ukNationalBrowse) {
      return {
        ...UK_NATIONAL_MAP_VIEW,
        pitch: city.mapView.pitch ?? 0,
        bearing: city.mapView.bearing ?? 0,
      };
    }
    if (mapOpeningNeedsResolution) return OPENING_LOCATION_HOLD_VIEW;
    const location =
      lastKnownLocation &&
        pointInCityBounds(lastKnownLocation.lat, lastKnownLocation.lng, city)
        ? lastKnownLocation
        : null;
    return resolveMapOpeningView(
      city.mapView,
      location,
      LOCATION_FIRST_ZOOM,
    );
  });
  const mobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    mobileViewportSnapshot,
    () => false,
  );
  const locationAllowsOnboarding = useSyncExternalStore(
    subscribePromptBudget,
    locationAllowsInterruptivePrompt,
    () => false,
  );
  /**
   * Has the reader moved the camera themselves yet?
   *
   * The ambient banners (city suggest, city status) are an opening offer. Once
   * the reader drives the map, the map is the answer and the banners step off
   * it (design judgement 2026-08-01, finding 2.15). This is session state, not
   * a dismissal: it never writes to the per-banner "do not show me this again"
   * stores, because ignoring an offer is not rejecting it.
   */
  const [mapCameraTouched, setMapCameraTouched] = useState(false);
  const mapCameraTouchedRef = useRef(false);
  const [openingLocationFocus, setOpeningLocationFocus] =
    useState<MapCameraFocus | null>(null);
  const openingLocationCancelledRef = useRef(false);
  const [
    openingLocationCancelledBeforeResolution,
    setOpeningLocationCancelledBeforeResolution,
  ] = useState(false);
  const ambientBannerLane = !mobileViewport && !mapCameraTouched;
  const railViewport = useSyncExternalStore(
    subscribeDesktopRailViewport,
    desktopRailViewportSnapshot,
    () => false,
  );
  const isLondon = cityId === "london" && !ukPlaceArrival && !ukNationalBrowse;
  const mapDisplayName = resolveMapDisplayName({
    placeName: ukPlaceArrival?.name,
    ukNationalBrowse,
    cityDisplayName: city.displayName,
  });
  const mapSearchPlaceholder = ukPlaceArrival
    ? "Search priced pub names"
    : ukNationalBrowse
      ? "Search pubs or UK places"
      : `Search ${city.displayName} venues or areas`;
  const searchParams = useSearchParams();
  useEffect(() => {
    markPubmaxTiming("pubmax:map-chunk-ready");
  }, []);
  // Deep-link /map/<city> (and CitySwitcher arrivals) stick as the Map/Drop
  // preference so the next tab tap does not bounce back to London.
  useEffect(() => {
    writePreferredCity(cityId);
  }, [cityId]);
  // Seed the crawl from the shareable URL (falls back to defaults / honors
  // ?style=heritage from the landing page). Lazy useState keeps this off effects
  // and avoids a mount-only useMemo the React Compiler cannot preserve.
  // URL is the only share/restore source — do NOT resurrect a previous hand-built
  // crawl from localStorage on a clean /map tab click (that bloated the address
  // bar with stale ?mode=build&pubs=… every time someone returned to Map).
  const [seed] = useState<MapSeed>(() => buildMapSeed(currentSearch(), cityId));
  const [restoredMobileSession] = useState(() => {
    if (currentSearch()) return null;
    const saved = readMobileMapSession();
    return saved?.cityId === cityId ? saved : null;
  });
  // Freeze arrival search with the seed so fit-on-arrival does not flip when the
  // user later maps a route or the address bar syncs.
  const [arrivalSearch] = useState(() => currentSearch());
  // A restored /map?sel=venue-uk-* arrival: the base pub's id plus the `at=`
  // location hint the selecting tap wrote alongside sel. The id alone carries
  // no coordinates and no shard cell, so without the hint an older link
  // degrades honestly — selection ring only once the user zooms in, no sheet —
  // rather than opening a guessed pub.
  const [ukBaseRestore] = useState(() => {
    if (!seed.selectedVenueId || !isUkBaseId(seed.selectedVenueId)) return null;
    const hint = parseSelectionHint(currentSearch());
    return hint ? { id: seed.selectedVenueId, ...hint } : null;
  });
  // §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
  // link)? Captured ONCE at mount — useCrawlUrlSync starts writing mode/style back
  // to the URL after ~300ms, so re-reading location.search later would be wrong.
  // If any of these are present, the arrival is intentional and we never onboard.
  // §4.7 shared onboarding intent: the generic first-run tour and this curated
  // "Start with a story" overlay consume the SAME answer, so an intentional Map
  // arrival never gets a tour/onboarding stacked over it. A valid
  // PlanningIntent is always explicit Map intent.
  const [explicitArrivalIntent] = useState(() =>
    explicitMapIntent({
      search: currentSearch(),
      planningIntent: readPlanningIntent(),
      restoredMobileSession,
    }),
  );
  const [mapResumeSeed] = useState(() =>
    currentSearch() ? null : readMapResumeSync(cityId),
  );
  const shouldResolveOpeningLocation =
    !currentSearch() &&
    !ukPlaceArrival &&
    !ukNationalBrowse &&
    !mapResumeSeed &&
    !restoredMobileSession?.viewport;
  const [grantedOpeningLocation, setGrantedOpeningLocation] =
    useState<MapOpeningLocation | null>(null);
  const [openingLocationPromptActive, setOpeningLocationPromptActive] = useState(false);
  const [openingLocationResolved, setOpeningLocationResolved] = useState(
    !shouldResolveOpeningLocation,
  );
  const cancelOpeningLocation = useCallback(() => {
    const nextCancellation = openingLocationCancellationAfterAttempt({
      openingLocationResolved,
      openingLocationCancelledBeforeResolution,
    });
    if (
      nextCancellation === openingLocationCancelledBeforeResolution
    ) return;
    openingLocationCancelledRef.current = true;
    setOpeningLocationCancelledBeforeResolution(nextCancellation);
  }, [openingLocationCancelledBeforeResolution, openingLocationResolved]);
  const dismissAmbientBanners = useCallback(() => {
    mapCameraTouchedRef.current = true;
    cancelOpeningLocation();
    setOpeningLocationFocus(null);
    setMapCameraTouched(true);
  }, [cancelOpeningLocation]);
  useEffect(() => {
    if (!shouldResolveOpeningLocation) return;
    let cancelled = false;
    void readOpeningMapLocation(undefined, {
      onPermissionPrompt: () => {
        if (!cancelled) setOpeningLocationPromptActive(true);
      },
    }).then((location) => {
      if (cancelled) return;
      if (
        location &&
        !openingLocationCancelledRef.current &&
        pointInCityBounds(location.lat, location.lng, city)
      ) {
        setGrantedOpeningLocation(location);
        writeMapOpeningLocation(location);
      }
      setOpeningLocationPromptActive(false);
      setOpeningLocationResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [city, shouldResolveOpeningLocation]);
  const mapResumeSeedConsumedRef = useRef(false);
  // `loaded` means the slim map index has settled. Source datasets are not
  // fetched on /map mount; full details arrive lazily per selected venue.
  const [loaded, setLoaded] = useState(Boolean(mapResumeSeed));
  // Story catalogs are secondary to the slim index and pin-price path. A
  // shared story URL still loads them immediately so its claim is ready on
  // arrival; a clean map waits until the map has settled before fetching the
  // catalog and its city data.
  const storyCatalogDeepLink = (() => {
    const search = currentSearch();
    const params = new URLSearchParams(search);
    return (
      mapSeedNeedsCuratedCrawlLookup(search) ||
      params.has("band") ||
      params.has("landmark")
    );
  })();
  const cityStoryCatalog = useCityStoryCatalog(
    cityId,
    loaded || storyCatalogDeepLink,
  );
  const cityLandmarks = cityStoryCatalog.landmarks;
  const cityStoryBands = cityStoryCatalog.storyBands;
  const cityCuratedCrawls = cityStoryCatalog.curatedCrawls;
  // Pair settlement with its city. On a client-side city switch there is one
  // render before the loading effect clears old pins; this prevents that prior
  // city's index from producing a transient, dishonest search result.
  const [loadedCityId, setLoadedCityId] = useState<CityId | null>(
    mapResumeSeed ? cityId : null,
  );
  // Bumped by the canvas's pin Retry when the readiness ceiling named the pub
  // list. The index load is the owner's, so the way to try again is to re-run
  // the effect that owns it.
  const [venueIndexAttempt, setVenueIndexAttempt] = useState(0);
  // `loaded` settles either way on purpose - a core fetch that REFUSED still
  // owes the honest empty state rather than a permanent skeleton - so it cannot
  // answer whether the pub list arrived. This does, and it is the only signal
  // the pin-ceiling Retry may report an outcome from.
  const [venueIndexFailed, setVenueIndexFailed] = useState(false);
  const reloadVenueIndex = useCallback(() => {
    // The load effect's microtask already sets loaded=false and failed=false
    // together. Clearing failed here while loaded is still true makes one
    // frame look like a successful read, which resets spent and drops the toast.
    setVenueIndexAttempt((attempt) => attempt + 1);
  }, []);
  // Canvas handoff readiness. Desktop waits for basemap paint; phone also waits
  // for the active city's slim data, a paintable pubs source, and its guarded
  // visible frame. Canvas errors lift this state so fallback UI is not hidden.
  const [mapCanvasReady, setMapCanvasReady] = useState(false);
  // Pin-reveal is the loading shell's exit: it fires when painted pubs are
  // tappable, not merely when the basemap or slim rows exist.
  const { pinsRevealed, resetPinReveal } = useMapPinsRevealed();
  // A recovery toast on the canvas owns the surface: the map keeps search plus
  // ONE toast, so the arrival card stands down while a failure is on screen.
  const [mapSoftRetryActive, setMapSoftRetryActive] = useState(false);
  const showMapArrivalCard = useSyncExternalStore(
    subscribeMapFirstVisitArrival,
    () =>
      shouldShowMapFirstVisitArrival({
        pinsRevealed,
        search: arrivalSearch,
        recoveryToastActive: mapSoftRetryActive,
      }),
    () => false,
  );
  const mapChosenArea = useSyncExternalStore(
    subscribeMapChosenArea,
    readMapChosenArea,
    () => null,
  );
  // Canvas has committed to its user-facing error fallback (WebGL/tiles/etc.).
  // We drop the loading skeleton immediately in that case even if slim pins
  // are still in flight, so the fallback card isn't hidden behind chrome.
  const [mapCanvasErrored, setMapCanvasErrored] = useState(false);
  // Issue #35 - staged load. `slimPins` are Venue-shape pins built from the
  // compact index (or its IndexedDB mirror) before any detail request. They
  // carry kind, anchor provenance, and fast filter signals; detail-only fields
  // keep inert defaults until a selected venue hydrates (see lib/slimPins).
  const [slimPins, setSlimPins] = useState<Venue[]>(() =>
    mapResumeSeed ? slimVenuesToPins(mapResumeSeed.rows) : [],
  );
  const [mapResumeUpdating, setMapResumeUpdating] = useState(Boolean(mapResumeSeed));
  const [mapResumeViewport, setMapResumeViewport] =
    useState<MapViewportSnapshot | null>(mapResumeSeed?.viewport ?? null);
  const openingViewport = mapResumeViewport ?? restoredMobileSession?.viewport ?? null;
  const fallbackOpeningMapView = useMemo(() => {
    const location =
      lastKnownLocation &&
        pointInCityBounds(lastKnownLocation.lat, lastKnownLocation.lng, city)
        ? lastKnownLocation
        : null;
    return resolveMapOpeningView(
      city.mapView,
      location,
      LOCATION_FIRST_ZOOM,
    );
  }, [city, lastKnownLocation]);
  const locationFirstMapView = useMemo(() => {
    if (!mapOpeningNeedsResolution) return initialMapView;
    if (!openingLocationResolved) return OPENING_LOCATION_HOLD_VIEW;
    if (!grantedOpeningLocation) return fallbackOpeningMapView;
    return resolveMapOpeningView(
      city.mapView,
      grantedOpeningLocation,
      LOCATION_FIRST_ZOOM,
    );
  }, [
    fallbackOpeningMapView,
    grantedOpeningLocation,
    initialMapView,
    mapOpeningNeedsResolution,
    openingLocationResolved,
    city.mapView,
  ]);
  const openingLoadViewport = useMemo(
    () => mapResumeSeed?.viewport ?? restoredMobileSession?.viewport ?? locationFirstMapView,
    [locationFirstMapView, mapResumeSeed, restoredMobileSession],
  );
  useEffect(() => {
    if (!mapResumeSeed) return;
    markPubmaxTiming("pubmax:first-pins");
    markPubmaxTiming("pubmax:slim-venues-ready");
  }, [mapResumeSeed]);
  const [detailById, setDetailById] = useState<Map<string, Venue>>(() => new Map());
  const [detailStatusById, setDetailStatusById] = useState<Map<string, VenueDetailStatus>>(
    () => new Map(),
  );
  const [selectedVenueId, setSelectedVenueId] = useState<string>(
    seed.selectedVenueId || restoredMobileSession?.selectedVenueId || "",
  );
  const reactiveAcceptanceSearch = searchParams?.toString() ?? "";
  // Canonicalising an alias `sel` moves the URL with history.replaceState,
  // which useSearchParams never hears, so the live location is the only honest
  // reading of which Venue this arrival is about. The router's own params stay
  // in the dependency list because a client navigation is the other way this
  // answer changes, and they are the SSR-safe reading before a window exists.
  const acceptanceQuery = useCallback((): AcceptedArrivalInput => {
    const routerSearch = reactiveAcceptanceSearch ? `?${reactiveAcceptanceSearch}` : "";
    const search = typeof window === "undefined" ? routerSearch : window.location.search;
    return {
      search,
      selectedVenueId: new URLSearchParams(search).get("sel") ?? seed.selectedVenueId,
      cityId,
    };
  }, [cityId, reactiveAcceptanceSearch, seed.selectedVenueId]);
  const acceptedArrivalSnapshot = useCallback(
    () => readAcceptedArrivalSource(acceptanceQuery()),
    [acceptanceQuery],
  );
  const acceptedArrivalSubscription = useCallback(
    (onStoreChange: () => void) => subscribeAcceptedArrival(acceptanceQuery, onStoreChange),
    [acceptanceQuery],
  );
  const acceptedArrivalSource = useSyncExternalStore(
    acceptedArrivalSubscription,
    acceptedArrivalSnapshot,
    noAcceptedArrivalSource,
  );
  const [arrivalSelectionNotice, setArrivalSelectionNotice] = useState<MapSelectionNotice | null>(
    () => mapSelectionNoticeFromSearch(currentSearch()),
  );
  const [selectionNotice, setSelectionNotice] = useState<MapSelectionNotice | null>(
    () => arrivalSelectionNotice,
  );
  useEffect(() => {
    if (!selectionNotice || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(MAP_SELECTION_NOTICE_PARAM)) return;
    url.searchParams.delete(MAP_SELECTION_NOTICE_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [selectionNotice]);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const preSheetFocusRef = useRef<HTMLElement | null>(null);
  const [venueInitialTab, setVenueInitialTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<Filters>(restoredMobileSession?.filters ?? seed.filters);
  // First-party Wetherspoon directory for Open now hours. Loaded once; match is
  // name+distance only and never invents hours for unmatched pubs.
  const [wetherspoonsDirectoryPubs, setWetherspoonsDirectoryPubs] = useState<
    WetherspoonsPub[] | null
  >(null);
  // Held until the canvas hands over. The directory is 2.1 MB of national
  // opening times: it answers the Open now filter and nothing on the first
  // frame, but fetched at mount it queues ahead of the slim venue shard that
  // makes the pins exist and then parses on the main thread mid map-init.
  // `null` already means "not loaded yet" everywhere downstream, so waiting
  // reads as it always did rather than as a pub with no hours. A reader who
  // arrives with Open now already on is asking for those hours, so that case
  // does not wait.
  useEffect(() => {
    if (!mapCanvasReady && !filters.openNow) return;
    let cancelled = false;
    loadWetherspoonsDirectory()
      .then((directory) => {
        if (!cancelled) setWetherspoonsDirectoryPubs(directory.pubs);
      })
      .catch(() => {
        if (!cancelled) setWetherspoonsDirectoryPubs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mapCanvasReady, filters.openNow]);
  const [experienceLens, setExperienceLens] =
    useState<MapExperienceLensValue>("all");
  const [experiencePolicyNow] = useState(() => Date.now());
  const [mapOverlay, setMapOverlay] = useState<MapOverlay>(() => {
    const restored = restoredMobileSession?.openSheet;
    return restored && !["venue", "planner"].includes(restored) ? restored : "none";
  });
  const [chooseAreaLocationNote, setChooseAreaLocationNote] = useState<string | null>(null);
  const openChooseAreaRef = useRef<(locationNote?: string | null) => void>(() => {});
  const restoredChosenAreaRef = useRef(false);
  const [mapViewport, setMapViewport] = useState<MapViewportSnapshot>(() =>
    openingViewport
      ? withCityCameraAttitude(openingViewport, city.mapView)
      : locationFirstMapView,
  );
  // The settled view's own edges, published by the canvas on every moveend. The
  // centre alone cannot answer what the view is OVER, which is what a place
  // name claims (see areaClaimedByViewport). Null until the map first settles,
  // and a map that has not settled claims no place.
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [settledMapBoundsCityId, setSettledMapBoundsCityId] =
    useState<CityId | null>(null);
  // Layer choices restore with the session: a returning visit keeps the Tube/
  // Rail/Parks chips it left on rather than resetting to viewport defaults.
  const [poiHidden, setPoiHidden] = useState(
    () => restoredMobileSession?.poiHidden ?? defaultPoiHiddenForViewport(),
  );
  const [venueKindVisibility, setVenueKindVisibility] = useState(
    defaultVenueKindVisibility,
  );
  const [mobileLayersTab, setMobileLayersTab] = useState<"key" | "layers" | "prices" | "events" | "transit">("key");
  const tflStatus = useMobileTflStatus();
  const [nearbyMapResult, setNearbyMapResult] = useState<NearbyMapResult | null>(null);
  const [pendingNearMeRequest, setPendingNearMeRequest] =
    useState<PendingNearMeRequest | null>(null);
  const [nearbyLoadVersion, setNearbyLoadVersion] = useState(0);
  const {
    mode,
    setMode,
    builtIds,
    setBuiltIds,
    routeMapped,
    setRouteMapped,
    planningOpen,
    setPlanningOpen,
    plannedNightArea,
    activateGeneratedPlan,
  } = useMapPlanCoordinator({
    mode: seed.mode,
    builtIds: seed.builtIds,
    routeMapped: seed.routeMapped,
    nightArea: restoredMobileSession?.nightArea ?? null,
    planningOpen: !seed.selectedVenueId &&
      restoredMobileSession?.openSheet !== "venue" &&
      (restoredMobileSession?.openSheet === "planner" ||
        shouldOpenPlanningInitially(seed.builtIds, seed.mode, currentSearch())),
  });
  // Issue #15 story bands: the active band id ("" = none), seeded from the URL
  // and synced back so a band link reproduces. The band overlay + picker live
  // inside PubMapCanvas; PubMap only owns the shareable state.
  const [activeBandId, setActiveBandId] = useState<string>(seed.bandId);
  // Live landmark selection for shareable ?landmark= URLs (seeded once, then
  // updated when the user opens/dismisses a landmark card on the map).
  const [activeLandmarkId, setActiveLandmarkId] = useState<string>(seed.landmarkId ?? "");
  // Map-first layout: the planner (left drawer) is hidden until the user asks
  // for it. Curated crawl arrivals stay map-first (polyline + chip); other
  // shared/restored crawl links still open straight into planning.
  // Explicit route mapping: a suggested crawl can exist without drawing on the
  // clean first map. Once the user chooses "Map route" (or a curated/nearby
  // crawl), keep the line visible even if the mobile planner closes.
  // Lights ActiveRoundChip immediately after Plan-drawer Start Round (stay-on-map).
  const [activeRoundStartedCode, setActiveRoundStartedCode] = useState<string | null>(null);
  // Favorite pint: re-prices the map to one beer. Persisted per-device.
  // A beer brand deep-link (`?drink=beer&brand=guinness`) seeds the same path.
  const [favoritePint, setFavoritePintState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    if (seed.filters.drinkCategory === "beer" && seed.filters.drinkBrand) {
      return seed.filters.drinkBrand;
    }
    return getFavoritePint();
  });
  // "Show saved only": a viewer convenience that narrows the map + list to venues
  // this device has saved. The toggle lives here (ControlRail renders it); the
  // saved-id set is read lazily and re-read on each toggle so a just-saved venue
  // appears without a reload. localStorage-only for the signed-out demo — that's
  // fine, this is a per-viewer view, not shared state.
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set<string>() : readSavedVenueIds(),
  );
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  // Purpose-limited copy used only after the viewer explicitly asks for travel
  // times. A location granted for "Pubs near me" must not silently become a
  // precise journey request for every venue they inspect.
  const [venueJourneyLocation, setVenueJourneyLocation] =
    useState<UserLocation | null>(null);
  const [locationRequestStatus, setLocationRequestStatus] =
    useState<LocationRequestStatus>("idle");
  // The curated crawl whose blurb is shown under the route title. Seeded from
  // ?crawl= / matching pubs= on curated arrival; cleared when the user mutates stops.
  const [activeCrawl, setActiveCrawl] = useState<CuratedCrawl | null>(seed.activeCrawl);
  // Issue #31 alt crawl style ("kind of night" label). Seeded from the URL and
  // synced back so a shared link reproduces it. Only shapes copy + the .ics
  // export noun; the scoring crawlStyle is untouched.
  const [altStyle, setAltStyle] = useState<AltCrawlStyle>(seed.altStyle);
  const planSnapshotRef = useRef({
    mode,
    builtIds,
    activeCrawl,
    filters,
    altStyle,
    routeMapped,
  });
  useLayoutEffect(() => {
    planSnapshotRef.current = {
      mode,
      builtIds,
      activeCrawl,
      filters,
      altStyle,
      routeMapped,
    };
  }, [activeCrawl, altStyle, builtIds, filters, mode, routeMapped]);
  // Curated crawl catalog is a separate chunk — hydrate crawl-shaped arrivals
  // before paint so shared ?crawl= links still map-first.
  const [crawlHydrationPending, setCrawlHydrationPending] = useState(() =>
    mapSeedNeedsCuratedCrawlLookup(arrivalSearch),
  );
  useLayoutEffect(() => {
    let cancelled = false;
    if (!mapSeedNeedsCuratedCrawlLookup(arrivalSearch)) {
      return;
    }
    const planSnapshot = {
      mode: seed.mode,
      builtIds: seed.builtIds,
      activeCrawl: seed.activeCrawl,
      filters: seed.filters,
      altStyle: seed.altStyle,
      routeMapped: seed.routeMapped,
    };
    void import("@/lib/mapSeedCrawl")
      .then(
        async ({
          curatedCrawlHydrationFromSeed,
          sameCuratedCrawlHydrationSnapshot,
        }) => {
          if (cancelled) return;
          const hydration = await curatedCrawlHydrationFromSeed(arrivalSearch, cityId);
          if (cancelled) return;
          if (
            !hydration ||
            !sameCuratedCrawlHydrationSnapshot(planSnapshot, planSnapshotRef.current)
          ) {
            setCrawlHydrationPending(false);
            return;
          }
          setMode("build");
          setBuiltIds(hydration.crawl.venueIds);
          setRouteMapped(true);
          setFilters(hydration.filters);
          setAltStyle(hydration.altStyle);
          setActiveCrawl(hydration.crawl);
          setCrawlHydrationPending(false);
        },
      )
      .catch(() => {
        if (!cancelled) setCrawlHydrationPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    arrivalSearch,
    cityId,
    seed,
    setBuiltIds,
    setCrawlHydrationPending,
    setFilters,
    setMode,
    setRouteMapped,
  ]);
  // §4.5 onboarding: has the viewer dismissed (or acted on) the "Start with a
  // story" overlay this session? Lazy init reads sessionStorage once, SSR-safe.
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(readOnboardingDismissed);
  // G3: per-band dismiss set for the Place story deep-link chip. Seeded from the
  // arrival band; grows when the viewer dismisses or switches to an already-
  // dismissed band this session.
  const [dismissedBandIds, setDismissedBandIds] = useState<Set<string>>(() => {
    if (!seed.bandId || !readBandChipDismissed(seed.bandId)) return new Set();
    return new Set([seed.bandId]);
  });
  const [logIntentFallbackVisible, setLogIntentFallbackVisible] = useState(false);
  // D4 — `log=1` is an owned URL passthrough, so it outlived every close and
  // rearmed the pub picker each time. Leaving the flow disarms it: the flag
  // leaves the URL, and this state stands the intent down for the render pass
  // (a replaceState never re-runs Next's useSearchParams).
  const [logIntentCleared, setLogIntentCleared] = useState(false);
  const clearLogIntent = useCallback(() => {
    setLogIntentFallbackVisible(false);
    setLogIntentCleared(true);
    dropLogParamFromUrl();
  }, []);
  // Closing the sheet pops the Map surface entry, and the clean entry
  // underneath still carries `log=1` - it is an owned
  // passthrough there too, written before the reader left the flow. So one
  // strip is not enough: hold the URL clean for the rest of the session, on
  // every render and on every history pop. Otherwise Back or a reload rearms
  // the picker the reader just closed.
  useEffect(() => {
    if (!logIntentCleared) return;
    dropLogParamFromUrl();
  });
  useEffect(() => {
    if (!logIntentCleared || typeof window === "undefined") return;
    window.addEventListener("popstate", dropLogParamFromUrl);
    return () => window.removeEventListener("popstate", dropLogParamFromUrl);
  }, [logIntentCleared]);
  const [tonightOverlayVisible, setTonightOverlayVisible] = useState(false);
  const [tonightDismissed, setTonightDismissed] = useState<boolean>(
    readTonightOverlayDismissed,
  );
  // W2: the live-events lane is map-first — a compact top chip until requested.
  const [tonightLaneOpen, setTonightLaneOpen] = useState(false);
  /** Once the viewer collapses a deep-linked lane, don't keep forcing it open. */
  const [dismissedTonightSrc, setDismissedTonightSrc] = useState<string | null>(null);
  const [mapListOpen, setMapListOpen] = useState(false);
  const [mapListSortMode, setMapListSortMode] =
    useState<MapVenueListSortMode>("nearest");
  const [visibleVenueState, setVisibleVenueState] = useState<{
    cityId: CityId;
    curatedVenueIds: string[];
    ukBasePubIds: string[];
  } | null>(null);
  const [renderedMapState, setRenderedMapState] =
    useState<MapRenderedState>(EMPTY_MAP_RENDERED_STATE);
  const handleRenderedMapStateChange = useCallback(
    (next: MapRenderedState) => {
      setRenderedMapState((current) =>
        sameMapRenderedState(current, next) ? current : next,
      );
    },
    [],
  );
  const baseVenues = useMemo(
    () => mergeLazyDetailPins(slimPins, detailById),
    [slimPins, detailById],
  );

  // Community Pint Drops: fetch/submit/report state lives in the hook.
  // City-scoped so Manchester demo seeds colour Manchester pins without
  // leaking into the London feed/landing.
  const pintDrops = usePintDrops(cityId, baseVenues);
  const {
    dropsByVenueId,
    venueSignals: dropSignals,
    refreshVenueDrops,
    closeComposer,
    setComposerOpen,
  } = pintDrops;
  // Community price submissions ("tap a pub, log tonight's price"). Merging the
  // freshest submission into the SAME venueSignals map the pins, the venue list
  // and the sheet already read is the whole restamp: one merge here and every
  // surface shows the price the viewer just logged, with no map-canvas change.
  //
  // The merge also gates: only a corroborated, under-30-days figure reaches
  // these signals (see communityPriceSignals.ts). The venue sheet reads
  // `communityPrices.byVenueId` for itself, so an uncorroborated submission
  // still shows there, dated - it just doesn't move a pin.
  const communityPrices = useCommunityPrices();
  const loadNoAlcoholPriceIndex = communityPrices.loadNoAlcoholIndex;
  const loadProvisionalBaseVenues =
    communityPrices.loadProvisionalBaseVenues;
  const loadDrinkCategoryIndex = communityPrices.loadDrinkCategoryIndex;
  // `other` is submittable but never lensable, so it selects no map lens: its
  // pins would print a figure labelled with a name that identifies no drink.
  const selectedDrinkCategory: DrinkCategory | null = isMapLensDrinkCategory(
    filters.drinkCategory,
  )
    ? filters.drinkCategory
    : null;
  const mapDrinkLensCategory =
    experienceLens === "all" &&
    selectedDrinkCategory !== null &&
    selectedDrinkCategory !== "beer"
      ? selectedDrinkCategory
      : null;
  // The lane the reader put the map under, as the lane controls print it. An
  // experience view owns the map instead, and it stands the drink refinements
  // down, so the lane reads as the resting pint lane while one is on rather
  // than naming a drink the pins are not showing.
  const activeMapDrinkLane: DrinkCategory =
    experienceLens === "all"
      ? activeDrinkLane(filters.drinkCategory)
      : DEFAULT_DRINK_LANE;
  useEffect(() => {
    if (mapDrinkLensCategory) {
      loadDrinkCategoryIndex(mapDrinkLensCategory);
    }
  }, [loadDrinkCategoryIndex, mapDrinkLensCategory]);
  // Whichever cross-venue index is answering the map right now reports its own
  // completeness, so the price key never claims a read it did not finish.
  const drinkIndexStatus: CategoryPriceIndexStatus = mapDrinkLensCategory
    ? communityPrices.drinkCategoryIndexStatus.get(mapDrinkLensCategory) ??
      "idle"
    : experienceLens === "no-alcohol"
      ? communityPrices.noAlcoholIndexStatus
      : "ready";
  const drinkLensPrices = useMemo(
    () =>
      mapDrinkLensCategory
        ? trustedDrinkLensPrices(
            communityPrices.byVenueId,
            mapDrinkLensCategory,
            experiencePolicyNow,
          )
        : null,
    [
      communityPrices.byVenueId,
      experiencePolicyNow,
      mapDrinkLensCategory,
    ],
  );
  const noAlcoholLensPrices = useMemo(
    () =>
      trustedNoAlcoholLensPrices(
        communityPrices.byVenueId,
        experiencePolicyNow,
      ),
    [communityPrices.byVenueId, experiencePolicyNow],
  );
  const venueSignals = useMemo(
    // The age gate reads the clock inside the merge (its `now` default) rather
    // than taking a Date.now() from here: calling it during render is impure,
    // and there is nothing to gain - the window is 30 days, so a submission
    // cannot cross it inside a session and no re-render needs to chase it.
    () => mergeCommunityPriceSignals(dropSignals, communityPrices.freshestByVenueId),
    [dropSignals, communityPrices.freshestByVenueId],
  );
  // The OTHER half of the same loop: the pubs whose first report is in but not
  // yet confirmed. Ungated on purpose - a first submitter has to see the map
  // change under their thumb, or there is no reason to log a second price
  // (captain decision 2026-07-26). It rides BESIDE the merge above, never
  // through it: this set paints a badge, and the price a pin claims still comes
  // only from the gated signals.
  //
  // Its REACH is whatever the community-price layer has loaded, and that layer
  // fetches per venue as sheets open (useCommunityPrices.loadVenue). So the
  // badge is guaranteed for the pub you just logged - the moment this exists to
  // deliver - and fills in for others as you open them, rather than pretending
  // to a city-wide pending feed the API does not serve.
  //
  // Combined through a membership KEY rather than straight into a Set, because
  // this set's identity is load-bearing: it reaches the base layer's `publish`,
  // where a new Set tears the viewport stream down and re-`setData`s every base
  // pin. `freshestByVenueId` is rebuilt on every `loadVenue` - that is, on every
  // curated sheet open - so allocating per render would restream the whole base
  // layer each time anyone tapped a pin.
  const provisionalVenueIdKeyValue = useMemo(() => {
    const local = provisionalCommunityPriceVenueIds(
      communityPrices.freshestByVenueId,
    );
    const combined = new Set(local);
    for (const venueId of communityPrices.provisionalBaseVenueIds) {
      // A locally loaded or optimistic row is newer than the viewport read.
      // Its absence from `local` means it is confirmed or aged out, so it
      // actively overrides a stale provisional id from the batch response.
      if (!communityPrices.freshestByVenueId.has(venueId)) {
        combined.add(venueId);
      }
    }
    // The Pint Drop lane feeds the same mark: a lone in-window drop no longer
    // paints a band or prints a figure (corroboratedPriceDrop gate), so its
    // first submitter sees the map change HERE instead — visibility without
    // authority, the same deal community submissions get.
    for (const venueId of provisionalPintDropVenueIds(dropsByVenueId)) {
      combined.add(venueId);
    }
    return provisionalVenueIdKey(combined);
  }, [
    communityPrices.freshestByVenueId,
    communityPrices.provisionalBaseVenueIds,
    dropsByVenueId,
  ]);
  const provisionalVenueIds = useMemo(
    () => provisionalVenueIdsFromKey(provisionalVenueIdKeyValue),
    [provisionalVenueIdKeyValue],
  );
  // Live map pins (issue #37): refetch the drops layer on a new-drop signal (or
  // a 30s poll when realtime is unavailable). Self-contained, signal-only.
  useLiveDrops(pintDrops.refreshAllDrops);
  const { opportunities: tonightOpportunities, status: tonightStatus } =
    useTonightOpportunities(isLondon);
  // W1: PRIMARY What's-On spine — venueId-joined pub events on tonight. Feeds
  // the pin badges (summary) and the Tonight lane (rows). Nearness uses the
  // same geolocation the walk labels and near-me shard merge already share.
  const whatsOnTonight = useWhatsOnTonight(isLondon, userLocation);

  // Mobile bottom-sheet drag (GH #17) — state + pointer handlers live in
  // useSheetDrag. Two instances: venue (right) and planner (left). A fling
  // past peek dismisses that sheet. "half" is the default resting snap;
  // open/pick handlers re-assert it below.
  //
  // A fling-dismiss is the gesture's Back: it leaves this sheet for whatever
  // opened it, exactly as the Back arrow does, because two different backs is
  // worse than one. The trail is assembled further down this component, so the
  // gesture reaches it through a ref.
  const surfaceBackRef = useRef<() => void>(() => {});
  const surfaceOpenRef = useRef<
    (entry: SurfaceEntry<MapSurfaceState>) => void
  >(() => {});
  const surfaceStateRef = useRef<MapSurfaceState>(EMPTY_MAP_SURFACE_STATE);
  const {
    sheetSnap,
    setSheetSnap,
    sheetDragY,
    setSheetDragY,
    sheetReleaseVelocity,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  } = useSheetDrag(() => surfaceBackRef.current());

  const [venueRevealRequest, setVenueRevealRequest] =
    useState<VenueRevealRequest | null>(null);
  const [venueRevealEntranceActive, setVenueRevealEntranceActive] =
    useState(false);
  const [venueRevealSettleSequence, setVenueRevealSettleSequence] = useState(0);
  const revealSequenceRef = useRef(0);
  const lastRevealAtRef = useRef<number | null>(null);
  const interruptVenueReveal = useCallback(() => {
    setVenueRevealRequest((current) =>
      !current || current.interrupted ? current : { ...current, interrupted: true },
    );
  }, []);
  const beginReveal = useCallback(
    (
      venueId: string,
      rows: VenueRevealRequest["rows"],
      lane: VenueRevealRequest["lane"],
    ) => {
      const now = Date.now();
      const form = revealForm(now, lastRevealAtRef.current);
      lastRevealAtRef.current = now;
      revealSequenceRef.current += 1;
      setVenueRevealEntranceActive(form === "full");
      setVenueRevealRequest({
        sequence: revealSequenceRef.current,
        venueId,
        startedAt: now,
        form,
        rows,
        lane,
        interrupted: false,
      });
    },
    [],
  );
  useEffect(() => {
    const request = venueRevealRequest;
    if (!request || request.interrupted || request.form !== "full") return;
    const remaining = Math.max(
      0,
      VENUE_REVEAL_CINEMA_MS - (Date.now() - request.startedAt),
    );
    const timer = setTimeout(() => setVenueRevealEntranceActive(false), remaining);
    return () => clearTimeout(timer);
  }, [venueRevealRequest]);
  const venueEntranceOvershoot =
    venueRevealEntranceActive &&
    venueRevealRequest?.form === "full" &&
    !venueRevealRequest.interrupted &&
    venueRevealRequest.venueId === selectedVenueId;

  const onVenueSheetDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      interruptVenueReveal();
      onSheetDragStart(event);
    },
    [interruptVenueReveal, onSheetDragStart],
  );

  const onVenueSheetDragMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      interruptVenueReveal();
      onSheetDragMove(event);
    },
    [interruptVenueReveal, onSheetDragMove],
  );

  const onVenueSheetDragEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      onSheetDragEnd(event);
    },
    [onSheetDragEnd],
  );

  // Ref so fling-dismiss can call the same closePlanning as chrome buttons
  // without a hook ↔ callback cycle (useSheetDrag needs onDismiss up front).
  const closePlanningRef = useRef<() => void>(() => {
    setPlanningOpen(false);
  });
  const {
    sheetSnap: plannerSheetSnap,
    setSheetSnap: setPlannerSheetSnap,
    sheetDragY: plannerSheetDragY,
    setSheetDragY: setPlannerSheetDragY,
    sheetReleaseVelocity: plannerSheetReleaseVelocity,
    onSheetDragStart: onPlannerSheetDragStart,
    onSheetDragMove: onPlannerSheetDragMove,
    onSheetDragEnd: onPlannerSheetDragEnd,
  } = useSheetDrag(() => surfaceBackRef.current());

  const closePlanning = useCallback(() => {
    setPlanningOpen(false);
    setMapOverlay("none");
    setPlannerSheetSnap("half");
    setPlannerSheetDragY(null);
  }, [setPlannerSheetDragY, setPlannerSheetSnap, setPlanningOpen]);
  useLayoutEffect(() => {
    closePlanningRef.current = closePlanning;
  }, [closePlanning]);

  const claimMapDrawer = useCallback(
    (owner: "planner" | "venue") => {
      if (owner === "planner") {
        setSelectedVenueId("");
      } else {
        closePlanning();
      }
    },
    [closePlanning, setSelectedVenueId],
  );

  const openPlanning = useCallback(() => {
    surfaceOpenRef.current({
      id: "planner",
      title: "Plan an outing",
      state: surfaceStateRef.current,
    });
    claimMapDrawer("planner");
    if (isMobileViewport()) {
      closeComposer();
      setSheetSnap("half");
      setSheetDragY(null);
    }
    setMapOverlay("none");
    setPlanningOpen(true);
    setPlannerSheetSnap("half");
    setPlannerSheetDragY(null);
  }, [
    claimMapDrawer,
    closeComposer,
    setPlannerSheetDragY,
    setPlannerSheetSnap,
    setPlanningOpen,
    setSheetDragY,
    setSheetSnap,
  ]);

  const togglePlanning = useCallback(() => {
    if (planningOpen) closePlanning();
    else openPlanning();
  }, [closePlanning, openPlanning, planningOpen]);

  // Issue #35 + location-first sharding: paint pins from the slim index cells
  // that intersect the opening viewport (or instantly from the resume
  // snapshot), then stream a neighbouring ring as the camera settles. Full
  // venue detail is still fetched lazily via /api/venue/[id] when inspected.
  //
  // One code path: the shard loader (lib/slimShards.ts) hides fetching, dedup,
  // offline mirroring, and the single-file fallback for cities that ship no
  // manifest (non-London packs behave exactly as before). City switches reset
  // pins asynchronously so we never setState in the effect body.
  const slimLoaderRef = useRef<SlimShardLoader | null>(null);
  const slimLoaderGenerationRef = useRef(0);
  const initialShardLoadStartedRef = useRef(false);
  const initialShardLoadSettledRef = useRef(false);
  const liveShardLoadStatusRef = useRef<MapResumeLiveLoadStatus>("pending");
  const liveShardRowsCommittedRef = useRef(false);
  const latestMapBoundsRef = useRef<MapBounds | null>(null);
  const latestMapBoundsCityRef = useRef<CityId | null>(null);
  const activeMapCityIdRef = useRef(cityId);
  useEffect(() => {
    activeMapCityIdRef.current = cityId;
  }, [cityId]);
  const ringLoadPendingKeyRef = useRef<string | null>(null);
  const targetViewportLoadStartedRef = useRef(false);
  const [deferInitialSpatialLoad] = useState(() => {
    try {
      return window.localStorage.getItem(FIRST_PINS_SEEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const openingLocationBounds =
    mapBounds !== null && settledMapBoundsCityId === cityId
      ? mapBounds
      : null;
  const {
    ready: initialShardReady,
    viewport: initialShardViewport,
    readStart: readInitialShardStart,
  } = useInitialSlimShardStart({
    openingLocationResolved,
    openingLocationCancelled: openingLocationCancelledBeforeResolution,
    openingLocationSettled: openingLocationBounds !== null,
    deferInitialSpatialLoad,
    initialMapView,
    openingLoadViewport,
    settledBounds: openingLocationBounds,
  });
  // Which night areas the loader can vouch a complete pub count for. A shard
  // can land carrying no pin this map had not already seen, so this is refreshed
  // off the LOADER settling rather than off the pins changing.
  const [completeCountSlugs, setCompleteCountSlugs] =
    useState<ReadonlySet<string> | null>(null);

  // Merge lazily-loaded shard venues into the painted pins, dedup by id. A
  // no-op update returns the previous array so React skips a re-render.
  const refreshCountCoverage = useCallback(() => {
    const loader = slimLoaderRef.current;
    if (!loader) return;
    const next = completeNeighbourhoodCountSlugs(cityId, (bounds) =>
      loader.coverageComplete(bounds),
    );
    setCompleteCountSlugs((held) => (sameSlugSet(held, next) ? held : next));
  }, [cityId]);

  const mergeSlimVenues = useCallback((rows: SlimVenue[]) => {
    if (rows.length === 0) return;
    setSlimPins((prev) => {
      const byId = new Map(prev.map((pin) => [pin.id, pin]));
      let changed = false;
      for (const pin of slimVenuesToPins(rows)) {
        const current = byId.get(pin.id);
        if (!current || JSON.stringify(current) !== JSON.stringify(pin)) {
          byId.set(pin.id, pin);
          changed = true;
        }
      }
      return changed ? Array.from(byId.values()) : prev;
    });
  }, []);

  useEffect(() => {
    if (
      !shouldResolveOpeningLocation ||
      !openingLocationResolved ||
      openingLocationCancelledRef.current ||
      mapCameraTouchedRef.current
    ) return;
    const viewport = locationFirstMapView;
    setOpeningLocationFocus((current) => {
      if (
        current?.center[0] === viewport.center[0] &&
        current.center[1] === viewport.center[1] &&
        current.zoom === viewport.zoom
      ) {
        return current;
      }
      return {
        center: viewport.center,
        zoom: viewport.zoom,
        source: "opening-location",
        token: (current?.token ?? 0) + 1,
      };
    });
  }, [locationFirstMapView, openingLocationResolved, shouldResolveOpeningLocation]);

  const scheduleRingLoad = useCallback(
    (
      loader: SlimShardLoader,
      bounds: MapBounds,
    ) => {
      const key = JSON.stringify([
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north,
      ]);
      if (ringLoadPendingKeyRef.current === key) return;
      ringLoadPendingKeyRef.current = key;
      const loaderGeneration = slimLoaderGenerationRef.current;
      const isCurrentLoader = () =>
        slimLoaderRef.current === loader &&
        slimLoaderGenerationRef.current === loaderGeneration;
      const loadRing = (ring: number, onSettled?: () => void) => {
        if (!isCurrentLoader()) return;
        void loader
          .inBounds(bounds, ring)
          .then((rows) => {
            if (!isCurrentLoader()) return;
            mergeSlimVenues(rows);
            refreshCountCoverage();
          })
          .catch(() => undefined)
          .finally(() => onSettled?.());
      };
      scheduleSlimShardRingLoads(
        () => {
          if (!isCurrentLoader()) return;
          targetViewportLoadStartedRef.current = true;
          loadRing(VIEWPORT_SHARD_RING);
        },
        () =>
          loadRing(NEIGHBOUR_SHARD_RING, () => {
            if (isCurrentLoader() && ringLoadPendingKeyRef.current === key) {
              ringLoadPendingKeyRef.current = null;
            }
          }),
      );
    },
    [mergeSlimVenues, refreshCountCoverage],
  );

  // A canvas that reports itself no longer ready has been torn down and is
  // re-initialising (Retry, soft retry, context loss). Its painted pins are
  // gone with it, so the reveal latch drops and the held frame comes back
  // until the next paint announces itself.
  const handleMapCanvasReady = useCallback(
    (ready: boolean) => {
      setMapCanvasReady(ready);
      if (!ready) resetPinReveal();
    },
    [resetPinReveal],
  );

  const mapLoadingStage = useMemo(
    () => ({
      pinsRevealed,
      canvasReady: mapCanvasReady,
      slimLoaded: loaded,
      slimPinCount: slimPins.length,
    }),
    [pinsRevealed, mapCanvasReady, loaded, slimPins.length],
  );
  const mapLoadingProgress = mapLoadingProgressPercent(mapLoadingStage);

  useEffect(() => {
    if (
      !initialShardReady &&
      !arrivalSearch &&
      !ukPlaceArrival &&
      !ukNationalBrowse
    ) {
      return;
    }
    const initialShardStart = readInitialShardStart();
    let cancelled = false;
    const loaderGeneration = ++slimLoaderGenerationRef.current;
    const loader = createSlimShardLoader(cityId, {
      bypassInFlight: venueIndexAttempt > 0,
      deferSpatial: deferInitialSpatialLoad,
    });
    const isCurrentLoader = () =>
      !cancelled &&
      slimLoaderRef.current === loader &&
      slimLoaderGenerationRef.current === loaderGeneration;
    slimLoaderRef.current = loader;
    initialShardLoadStartedRef.current = false;
    initialShardLoadSettledRef.current = false;
    liveShardLoadStatusRef.current = "pending";
    liveShardRowsCommittedRef.current = false;
    ringLoadPendingKeyRef.current = null;
    targetViewportLoadStartedRef.current = false;
    const preserveSyncResume =
      !mapResumeSeedConsumedRef.current && Boolean(mapResumeSeed);
    mapResumeSeedConsumedRef.current = true;
    let resumeRefreshVersion = 0;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setVenueIndexFailed(false);
      setCompleteCountSlugs(null);
      if (!preserveSyncResume) {
        setLoaded(false);
        setLoadedCityId(null);
        setSlimPins([]);
        setMapResumeViewport(null);
        setMapResumeUpdating(false);
      }
    });
    if (
      !arrivalSearch &&
      !ukPlaceArrival &&
      !ukNationalBrowse &&
      initialShardReady
    ) {
      // A placeholder viewport names nowhere, and its bounds are the whole
      // world. Reading shards from it asked for the entire city before the map
      // was interactive (lib/slimShards.ts openingLoadViewportFor).
      const openingBounds =
        initialShardStart.settledBounds ??
        boundsForOpeningView(
          openingLoadViewportFor(initialShardStart.viewport, city.mapView),
        );
      const startInitialLoad = (bounds: MapBounds) => {
        if (!isCurrentLoader() || initialShardLoadStartedRef.current) return;
        initialShardLoadStartedRef.current = true;
        void loader.initialResult(bounds)
          .then((result) => {
            if (!isCurrentLoader()) return;
            const rows = result.rows;
            liveShardLoadStatusRef.current = result.status;
            if (rows.length > 0) liveShardRowsCommittedRef.current = true;
            setVenueIndexFailed(result.status !== "ready");
            mergeSlimVenues(rows);
            if (rows.length > 0) {
              markPubmaxTiming("pubmax:first-pins");
              markPubmaxTiming("pubmax:slim-venues-ready");
            }
            initialShardLoadSettledRef.current = true;
            resumeRefreshVersion += 1;
            setLoadedCityId(cityId);
            setLoaded(true);
            setMapResumeUpdating(false);
            initialShardLoadStartedRef.current = result.status === "ready";
            if (result.status === "ready") {
              const targetBounds =
                latestMapBoundsCityRef.current === cityId
                  ? latestMapBoundsRef.current
                  : null;
              if (
                isCurrentLoader() &&
                targetBounds &&
                !targetViewportLoadStartedRef.current
              ) {
                scheduleRingLoad(loader, targetBounds);
              }
            }
            refreshCountCoverage();
          })
          .catch(() => {
            if (!isCurrentLoader()) return;
            liveShardLoadStatusRef.current = "unavailable";
            initialShardLoadSettledRef.current = true;
            setVenueIndexFailed(true);
            setLoadedCityId(cityId);
            setLoaded(true);
            setMapResumeUpdating(false);
            initialShardLoadStartedRef.current = false;
          });
      };

      if (mapResumeSeed) {
        void readMapResume(cityId).then((snapshot) => {
          if (
            !isCurrentLoader() ||
            !snapshot ||
            mapCameraTouchedRef.current ||
            snapshot.savedAt <= mapResumeSeed.savedAt ||
            liveShardRowsCommittedRef.current
          ) return;
          const refreshVersion = ++resumeRefreshVersion;
          setMapResumeViewport(snapshot.viewport);
          setMapResumeUpdating(true);
          const resumeBounds = boundsForOpeningView(snapshot.viewport);
          void loader.initial(resumeBounds)
            .then((rows) => {
              if (
                !isCurrentLoader() ||
                !isCurrentMapResumeRefresh(
                  liveShardLoadStatusRef.current,
                  liveShardRowsCommittedRef.current,
                  resumeRefreshVersion,
                  refreshVersion,
                )
              ) return;
              mergeSlimVenues(rows);
              refreshCountCoverage();
              if (resumeRefreshVersion === refreshVersion) setMapResumeUpdating(false);
            })
            .catch(() => {
              if (isCurrentLoader() && resumeRefreshVersion === refreshVersion) {
                setMapResumeUpdating(false);
              }
            });
        });
        startInitialLoad(openingBounds);
      } else {
        startInitialLoad(openingBounds);
        void readMapResume(cityId)
          .then((snapshot) => {
            if (
              !isCurrentLoader() ||
              !snapshot ||
              mapCameraTouchedRef.current ||
              liveShardRowsCommittedRef.current
            ) return;
            setSlimPins(slimVenuesToPins(snapshot.rows));
            setLoadedCityId(cityId);
            setLoaded(true);
            markPubmaxTiming("pubmax:first-pins");
            markPubmaxTiming("pubmax:slim-venues-ready");
            setMapResumeViewport(snapshot.viewport);
            const refreshVersion = ++resumeRefreshVersion;
            setMapResumeUpdating(true);
            void loader.initial(boundsForOpeningView(snapshot.viewport))
              .then((rows) => {
                if (
                  !isCurrentLoader() ||
                  !isCurrentMapResumeRefresh(
                    liveShardLoadStatusRef.current,
                    liveShardRowsCommittedRef.current,
                    resumeRefreshVersion,
                    refreshVersion,
                  )
                ) return;
                mergeSlimVenues(rows);
                refreshCountCoverage();
                if (resumeRefreshVersion === refreshVersion) setMapResumeUpdating(false);
              })
              .catch(() => {
                if (isCurrentLoader() && resumeRefreshVersion === refreshVersion) {
                  setMapResumeUpdating(false);
                }
              });
          });
      }
    }
    return () => {
      cancelled = true;
      if (slimLoaderGenerationRef.current === loaderGeneration) {
        slimLoaderGenerationRef.current += 1;
      }
      if (slimLoaderRef.current === loader) slimLoaderRef.current = null;
      initialShardLoadStartedRef.current = false;
      initialShardLoadSettledRef.current = false;
      liveShardLoadStatusRef.current = "pending";
      liveShardRowsCommittedRef.current = false;
      ringLoadPendingKeyRef.current = null;
      targetViewportLoadStartedRef.current = false;
    };
  }, [arrivalSearch, city.mapView, cityId, deferInitialSpatialLoad, initialShardReady, initialShardViewport, mapResumeSeed, mergeSlimVenues, readInitialShardStart, refreshCountCoverage, scheduleRingLoad, ukNationalBrowse, ukPlaceArrival, venueIndexAttempt]);

  // Lazy outer shards: whenever the map settles on a viewport, load the shards
  // it intersects and merge their pins. Already-loaded shards are skipped by
  // the loader; a failed shard is not marked loaded, so a later moveend retries
  // it — the map keeps working with whatever loaded.
  const handleMapBoundsChange = useCallback(
    (bounds: MapBounds) => {
      if (activeMapCityIdRef.current !== cityId) return;
      if (
        shouldResolveOpeningLocation &&
        !openingLocationResolved &&
        !openingLocationCancelledRef.current
      ) return;
      latestMapBoundsRef.current = bounds;
      latestMapBoundsCityRef.current = cityId;
      setSettledMapBoundsCityId(cityId);
      // Same settled camera the place claim is measured against, so the name in
      // the bar can never describe a view the reader has already left.
      setMapBounds((current) =>
        current &&
        current.west === bounds.west &&
        current.east === bounds.east &&
        current.south === bounds.south &&
        current.north === bounds.north
          ? current
          : bounds,
      );
      const loader = slimLoaderRef.current;
      if (!loader) return;
      const loaderGeneration = slimLoaderGenerationRef.current;
      const isCurrentLoader = () =>
        slimLoaderRef.current === loader &&
        slimLoaderGenerationRef.current === loaderGeneration;
      if (!isCurrentLoader()) return;
      const firstLoad = !initialShardLoadStartedRef.current;
      if (!firstLoad && !initialShardLoadSettledRef.current) return;
      if (!firstLoad) {
        scheduleRingLoad(loader, bounds);
        return;
      }
      initialShardLoadStartedRef.current = true;
      void loader.initialResult(bounds)
        .then((result) => {
          if (!isCurrentLoader()) return;
          const rows = result.rows;
          liveShardLoadStatusRef.current = result.status;
          if (rows.length > 0) liveShardRowsCommittedRef.current = true;
          setVenueIndexFailed(result.status !== "ready");
          mergeSlimVenues(rows);
          if (firstLoad && rows.length > 0) {
            markPubmaxTiming("pubmax:first-pins");
            markPubmaxTiming("pubmax:slim-venues-ready");
          }
          if (firstLoad) {
            initialShardLoadSettledRef.current = true;
            setLoadedCityId(cityId);
            setLoaded(true);
            setMapResumeUpdating(false);
            initialShardLoadStartedRef.current = result.status === "ready";
            if (result.status === "ready" && isCurrentLoader()) {
              scheduleRingLoad(loader, bounds);
            }
          }
          refreshCountCoverage();
        })
        .catch(() => {
          if (!isCurrentLoader()) return;
          liveShardLoadStatusRef.current = "unavailable";
          if (firstLoad) {
            initialShardLoadSettledRef.current = true;
            setVenueIndexFailed(true);
            setLoadedCityId(cityId);
            setLoaded(true);
            setMapResumeUpdating(false);
          }
          // Keep loaded shards; a later moveend retries this one.
          if (firstLoad) initialShardLoadStartedRef.current = false;
        });
    },
    [
      cityId,
      mergeSlimVenues,
      openingLocationResolved,
      refreshCountCoverage,
      scheduleRingLoad,
      shouldResolveOpeningLocation,
    ],
  );
  const handleVisibleVenueIdsChange = useCallback(
    (membership: {
      curatedVenueIds: string[];
      ukBasePubIds: string[];
    }) => {
      setVisibleVenueState({ cityId, ...membership });
    },
    [cityId],
  );

  // Sourced price-refresh layer (issue #23): London-only JSON; community drops
  // always outrank it inside mergePriceUpdates. Skip the fetch for other cities
  // and ignore any stale London updates while viewing them (no setState clear).
  const [priceUpdates, setPriceUpdates] = useState<PriceUpdate[]>([]);
  useEffect(() => {
    if (cityId !== "london") return;
    let cancelled = false;
    fetch("/data/price_updates/latest.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        setPriceUpdates(parsePriceUpdates(raw));
      })
      .catch(() => {
        // No update file (or bad JSON) — baseline + community prices stand.
      });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  // Greater London locality gazetteer (public/data/london_localities.json) —
  // hundreds of neighbourhood names the basemap paints, so map search can fly to
  // any of them, not just the modelled areas. London-only; fail-soft to [] so a
  // missing file or a non-London city just falls back to areas + boroughs.
  const [londonLocalities, setLondonLocalities] = useState<Locality[]>([]);
  useEffect(() => {
    if (cityId !== "london") return;
    let cancelled = false;
    fetch("/data/london_localities.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        setLondonLocalities(parseLocalityGazetteer(raw));
      })
      .catch(() => {
        // No gazetteer (or bad JSON) — modelled areas + boroughs still search.
      });
    return () => {
      cancelled = true;
    };
  }, [cityId]);
  // Gate at the point of use (mirrors priceUpdates): the fetch is London-only, so
  // a non-London city never sees stale gazetteer rows in its search.
  const localities = cityId === "london" ? londonLocalities : NO_LOCALITIES;

  const venues = useMemo<Venue[]>(
    () =>
      mergePriceUpdates(
        mergeVenueDrops(baseVenues, dropsByVenueId),
        cityId === "london" ? priceUpdates : [],
        venueUpdateKey,
      ),
    [baseVenues, dropsByVenueId, priceUpdates, cityId],
  );
  const pubVenues = useMemo(() => venues.filter(isPubVenue), [venues]);
  const hasSavedPub = useMemo(
    () => hasSavedPubVenue(pubVenues, savedIds),
    [pubVenues, savedIds],
  );
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  // Zone pint index (nearest-station fare zone medians) for the zone picker.
  // Computed off the full venue set so the strip's numbers don't shift as the
  // user filters — it's a stable "here's the lay of the land" reference.
  const zoneIndex = useMemo(() => computeZonePintIndex(pubVenues), [pubVenues]);
  // Base narrowing: the existing filter pipeline (story filters, price, query,
  // pint-drops). Favorite-pint re-prices inside PubMapCanvas and never changes
  // membership, so it isn't part of this set.
  const effectiveMapFilters = useMemo(
    () =>
      filtersForDrinkPriceLens(
        filtersForExperienceLens(filters, experienceLens),
        mapDrinkLensCategory,
      ),
    [experienceLens, filters, mapDrinkLensCategory],
  );
  const openNowStateById = useMemo(() => {
    if (!wetherspoonsDirectoryPubs || !filters.openNow) return null;
    const matchVenues: WetherspoonsMatchVenue[] = venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      lat: venue.latitude,
      lng: venue.longitude,
    }));
    return openNowStatesForVenues(matchVenues, wetherspoonsDirectoryPubs);
  }, [venues, wetherspoonsDirectoryPubs, filters.openNow]);
  const pipelineVenues = useMemo(
    () =>
      filterMapVenues(
        venues,
        effectiveMapFilters,
        (id) => Boolean(venueSignals.get(id)?.hasPintDrops),
        (id) => openNowStateById?.get(id) ?? "unknown",
      ),
    [effectiveMapFilters, venues, venueSignals, openNowStateById],
  );
  // "Saved only" composes ON TOP of the pipeline: when on, keep only venues in
  // the saved set. When off it's a no-op, so all existing behavior is preserved.
  const filteredVenues = useMemo(
    () => (savedOnly ? pipelineVenues.filter((v) => savedIds.has(v.id)) : pipelineVenues),
    [pipelineVenues, savedOnly, savedIds],
  );
  const filteredPubVenues = useMemo(
    () => filteredVenues.filter(isPubVenue),
    [filteredVenues],
  );

  const nearbyMapResultForView = useMemo(() => {
    if (!nearbyMapResult) return null;
    const { location } = nearbyMapResult;
    const nextVenues = nearMeMapVenues(location.lat, location.lng, filteredVenues);
    const nextIds = nextVenues.map((venue) => venue.id);
    const nextStrategy = withinNearMeRing(location, filteredVenues) >= NEAR_ME_MAP_MIN_VENUES
      ? "within-radius"
      : "nearest-20";
    const sameIds = nearbyMapResult.venueIds.length === nextIds.length &&
      nearbyMapResult.venueIds.every((id, index) => id === nextIds[index]);
    if (sameIds && nearbyMapResult.strategy === nextStrategy) return nearbyMapResult;
    return { ...nearbyMapResult, venueIds: nextIds, strategy: nextStrategy };
  }, [filteredVenues, nearbyMapResult]);

  // Deep-links from /pubs (?sel=) must still paint the pin even if a filter
  // would otherwise hide a scraped gazetteer pub.
  const mapMembershipVenues = useMemo(
    () => venuesInNearbyMembership(filteredVenues, nearbyMapResultForView),
    [filteredVenues, nearbyMapResultForView],
  );
  const experienceVisibleMapVenues = useMemo(
    () =>
      filterVenuesForExperienceLens(
        mapMembershipVenues,
        experienceLens,
        noAlcoholLensPrices,
      ),
    [experienceLens, mapMembershipVenues, noAlcoholLensPrices],
  );
  const kindVisibleMapVenues = useMemo(
    () => filterVenuesByKind(experienceVisibleMapVenues, venueKindVisibility),
    [experienceVisibleMapVenues, venueKindVisibility],
  );
  const canvasVenues = useMemo(
    () => withForcedVenue(kindVisibleMapVenues, venueById, selectedVenueId),
    [kindVisibleMapVenues, venueById, selectedVenueId],
  );
  const experienceLensPrices = useMemo(
    () =>
      experienceLens === "all"
        ? null
        : lensPricesForVenues(
            canvasVenues,
            experienceLens,
            noAlcoholLensPrices,
          ),
    [canvasVenues, experienceLens, noAlcoholLensPrices],
  );
  const activeLensPrices =
    experienceLens === "all" ? drinkLensPrices : experienceLensPrices;
  const activeLensLabel = mapDrinkLensCategory
    ? CATEGORY_META[mapDrinkLensCategory].label
    : experienceLens === "no-alcohol"
      ? "No-alcohol"
      : experienceLens === "food"
        ? "Food"
        : null;
  // The name a heading wears is not always the name a sentence wants: the
  // no-alcohol lens is titled with a negative, and "no no-alcohol price
  // logged" hides the one fact that is about the pub.
  const activeLensNoun = mapDrinkLensCategory
    ? drinkLensPriceNoun(mapDrinkLensCategory)
    : experienceLens === "no-alcohol"
      ? NO_ALCOHOL_LENS_PRICE_NOUN
      : experienceLens === "food"
        ? "Food"
        : null;
  const activeBand = useMemo(
    () => cityStoryBands.find((band) => band.id === activeBandId),
    [cityStoryBands, activeBandId],
  );
  const activePriceLegend = mapPriceLegend(
    experienceLens === "food"
      ? { kind: "food", renderedState: renderedMapState }
      : activeLensLabel && activeLensNoun
        ? {
            kind: "drink",
            label: activeLensLabel,
            noun: activeLensNoun,
            status: drinkIndexStatus,
            renderedState: renderedMapState,
          }
        : {
            kind: "default",
            renderedState: renderedMapState,
          },
  );
  const experienceSummary = useMemo(() => {
    if (experienceLens === "all") return "";
    let noAlcoholPriceCount = 0;
    let sourcedFoodPriceCount = 0;
    for (const price of experienceLensPrices?.values() ?? []) {
      if (price.source === "community") noAlcoholPriceCount += 1;
      if (price.source === "sourced-anchor") sourcedFoodPriceCount += 1;
    }
    return experienceLensSummary(
      experienceLens,
      noAlcoholPriceCount,
      sourcedFoodPriceCount,
      communityPrices.noAlcoholIndexStatus,
    );
  }, [
    communityPrices.noAlcoholIndexStatus,
    experienceLens,
    experienceLensPrices,
  ]);
  // Accessibility contract: derive list membership from MapLibre's exact coordinate
  // projection after every product filter that controls canvas membership.
  // Before the first projection, empty is the only honest answer.
  const mapVenueListVenues = useMemo(
    () => {
      if (visibleVenueState?.cityId !== cityId) return [];
      const visibleIds = new Set(visibleVenueState.curatedVenueIds);
      return kindVisibleMapVenues.filter((venue) => visibleIds.has(venue.id));
    },
    [cityId, kindVisibleMapVenues, visibleVenueState],
  );
  const mapVenueListModel = useMemo(
    () =>
      buildMapVenueListModel(
        mapVenueListVenues,
        mapViewport.center,
        undefined,
        activeLensPrices,
        activeLensNoun ?? undefined,
        drinkIndexStatus,
        mapListSortMode,
        venueSignals,
      ),
    [
      activeLensNoun,
      activeLensPrices,
      drinkIndexStatus,
      mapListSortMode,
      mapVenueListVenues,
      mapViewport.center,
      venueSignals,
    ],
  );
  const [renderedBasePubs, setRenderedBasePubs] = useState<UkBasePub[]>([]);
  const [ukBaseStatus, setUkBaseStatus] =
    useState<UkBaseStreamStatus>("loading");
  /** Resident streamed base pubs (padded viewport), for map-search name match. */
  const [residentUkBasePubs, setResidentUkBasePubs] = useState<UkBasePub[]>([]);
  const provisionalRestoreResolved = useRef(!ukBaseRestore);
  useEffect(() => {
    if (
      !provisionalRestoreResolved.current &&
      renderedBasePubs.some((pub) => pub.id === ukBaseRestore?.id)
    ) {
      provisionalRestoreResolved.current = true;
    }
    // A restore fly can settle through several intermediate viewports. Wait
    // for the last one so one arrival makes one bounded visibility read rather
    // than billing every camera frame that briefly became "settled".
    //
    // The wait is longer while the restore target has not appeared, and it is a
    // WAIT rather than a skip: a `?sel=venue-uk-*` link whose pub a later OSM
    // shard rebuild dropped never becomes visible, and refusing to read until
    // it does would silently cost the whole session every base mark, not just
    // that pin's.
    const timer = setTimeout(
      () => {
        provisionalRestoreResolved.current = true;
        loadProvisionalBaseVenues(renderedBasePubs.map((pub) => pub.id));
      },
      provisionalRestoreResolved.current
        ? PROVISIONAL_BASE_SETTLE_MS
        : PROVISIONAL_BASE_RESTORE_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [
    loadProvisionalBaseVenues,
    renderedBasePubs,
    ukBaseRestore?.id,
  ]);
  const ukBasePubListModel = useMemo(
    () => {
      if (visibleVenueState?.cityId !== cityId) {
        return buildUkBasePubListModel([], mapViewport.center);
      }
      const visibleIds = new Set(visibleVenueState.ukBasePubIds);
      return buildUkBasePubListModel(
        renderedBasePubs.filter((pub) => visibleIds.has(pub.id)),
        mapViewport.center,
      );
    },
    [cityId, mapViewport.center, renderedBasePubs, visibleVenueState],
  );
  const mapContextName =
    ukPlaceArrival?.name ??
    (ukNationalBrowse
      ? "UK"
      : !mapViewport.center ||
          pointInCityBounds(mapViewport.center[1], mapViewport.center[0], city)
        ? city.displayName
        : "UK");
  const outsideCuratedBounds =
    !ukPlaceArrival &&
    !ukNationalBrowse &&
    Boolean(
      mapViewport.center &&
        !pointInCityBounds(mapViewport.center[1], mapViewport.center[0], city),
    );
  // Base-led chrome: uncovered place, national browse, or pan past cityMaxBounds.
  const baseLedChrome = Boolean(
    ukPlaceArrival || ukNationalBrowse || outsideCuratedBounds,
  );

  const hasReactiveLogIntent = hasMapLogIntent(searchParams) && !logIntentCleared;
  const shouldBuildSuggestedRoute = !hasReactiveLogIntent || planningOpen || routeMapped;
  const suggestedRoute = useMemo(
    () =>
      shouldBuildSuggestedRoute
        ? buildCrawlRoute(filteredPubVenues, filters, noAlcoholLensPrices)
        : EMPTY_ROUTE,
    [shouldBuildSuggestedRoute, filteredPubVenues, filters, noAlcoholLensPrices],
  );
  // C2 — a plan that's "on tonight" (lib/activePlan) draws on the map through
  // the SAME route paint the crawl planner uses. useActivePlanRoute carries the
  // live plan's stops; planStopsToRouteVenues resolves them (ordered, deduped,
  // real pins only) against the live venue index. Honest-empty: no active plan,
  // or none of its stops on the map, → [] → no overlay.
  const activePlanStops = useActivePlanRoute();
  const activePlanRoute = useMemo(
    () => planStopsToRouteVenues(activePlanStops, venueById),
    [activePlanStops, venueById],
  );
  const { route, routeMappedActive, routeForMap, routeForMapLegs } = useMapPlanPresentation({
    mode,
    builtIds,
    routeMapped,
    suggestedRoute,
    activePlanRoute,
    venueById,
  });
  // A suggested route exists behind the clean map, but its TfL legs are only
  // useful once the planner is open or the viewer explicitly maps it.
  const {
    byToIndex: journeyByToIndex,
    loading: journeyLoading,
    totalMinutes: journeyTotalMinutes,
  } = useCrawlJourneys(route, isLondon && (planningOpen || routeMappedActive));
  const distanceFromUserKm = useMemo(() => {
    const firstStop = route[0];
    if (!firstStop || !userLocation) return null;
    return haversineKm(
      [userLocation.lng, userLocation.lat],
      [firstStop.longitude, firstStop.latitude],
    );
  }, [route, userLocation]);

  const selectedVenue = useMemo(
    () => (selectedVenueId ? venueById.get(selectedVenueId) : route[0]),
    [route, selectedVenueId, venueById],
  );
  const selectedVenueResolvable = selectedVenueId ? venueById.has(selectedVenueId) : false;
  const selectedVenueIsPub = selectedVenue ? isPubVenue(selectedVenue) : false;
  const selectedVenueLabels = venueSheetLabels(selectedVenue);
  const selectedDetailStatus = detailStatusFor(selectedVenueId, detailById, detailStatusById);

  const venueIdByNormalisedName = useMemo(() => {
    const map = new Map<string, string>();
    for (const venue of venues) {
      const key = normaliseTonightVenueLookup(venue.name);
      if (key && !map.has(key)) map.set(key, venue.id);
    }
    return map;
  }, [venues]);

  // Keep the URL in sync so "Copy link" shares the current crawl. A restored
  // session is held back from the address bar until the reader changes
  // something: they typed a clean /map, and that address wins over stored
  // state. Restoring the map itself is untouched.
  useCrawlUrlSync(
    useMemo(
      () => ({
        mode,
        filters,
        builtIds,
        selectedVenueId,
        bandId: activeBandId,
        altStyle,
        landmarkId: activeLandmarkId,
        crawlId: activeCrawl?.id ?? "",
      }),
      [
        mode,
        filters,
        builtIds,
        selectedVenueId,
        activeBandId,
        altStyle,
        activeLandmarkId,
        activeCrawl?.id,
      ],
    ),
    restoredMobileSession !== null,
    crawlHydrationPending,
  );

  // Load the venue's community Pint Drops whenever the inspected venue changes.
  const selectedId = selectedVenue?.id;
  useEffect(() => {
    if (!selectedId) {
      return;
    }
    return refreshVenueDrops(selectedId);
  }, [selectedId, refreshVenueDrops]);

  useEffect(() => {
    if (!selectedId) return;
    const priceView = venueDrinkPriceView(
      communityPrices.byVenueId.get(selectedId),
      experienceLens,
      mapDrinkLensCategory,
    );
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setVenueRevealRequest((current) => {
        if (!current || current.venueId !== selectedId) return current;
        if (current.rows === priceView.rows && current.lane === priceView.lane) {
          return current;
        }
        return { ...current, rows: priceView.rows, lane: priceView.lane };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    communityPrices.byVenueId,
    experienceLens,
    mapDrinkLensCategory,
    selectedId,
  ]);

  useEffect(() => {
    if (tonightStatus !== "ready" || tonightDismissed) return;
    Promise.resolve().then(() => setTonightOverlayVisible(true));
  }, [tonightStatus, tonightDismissed]);

  // Refresh-safety net: mirror hand-built stops to localStorage (see
  // components/map/pubmap/useBuiltIdsPersistence.ts).
  useBuiltIdsPersistence(builtIds, BUILT_STORAGE_KEY);

  const selectVenue = useCallback(
    (
      id: string,
      initialTab: TabKey = "overview",
    ) => {
      if (!id) return;
      setArrivalSelectionNotice(null);
      setSelectionNotice(null);
      setAcceptanceError(null);
      setDetailStatusById((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      surfaceOpenRef.current({
        id: "venue",
        title: "Pub detail",
        state: {
          ...surfaceStateRef.current,
          venueId: id,
          venueTab: initialTab,
        },
      });
      if (typeof document !== "undefined") {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active !== document.body &&
          active !== document.documentElement &&
          !active.closest(".mapDrawer, .mobileSheetPortal")
        ) {
          // Capture synchronously. Search closes and blurs its combobox in the
          // same event before React opens the drawer.
          preSheetFocusRef.current = active;
        }
      }
      // Base pubs have no /api/venue record; prefetching one is a certain 404.
      if (!isUkBaseId(id)) prefetchVenue(id);
      setTonightLaneOpen(false);
      setMapOverlay("none");
      claimMapDrawer("venue");
      setVenueInitialTab(initialTab);
      setSelectedVenueId(id);
      closeComposer();
      const reducedMotion = venueRevealPrefersReducedMotion();
      if (mobileViewport && selectedVenueId && !reducedMotion) {
        interruptVenueReveal();
        setVenueRevealSettleSequence((current) => current + 1);
      }
      setSheetSnap("half"); // a fresh pick always opens at the readable mid-height snap
      setSheetDragY(null);
      if (reducedMotion) {
        setVenueRevealRequest(null);
      } else if (!isUkBaseId(id)) {
        const priceView = venueDrinkPriceView(
          communityPrices.byVenueId.get(id),
          experienceLens,
          mapDrinkLensCategory,
        );
        beginReveal(id, priceView.rows, priceView.lane);
      } else {
        setVenueRevealRequest(null);
      }
    },
    [
      beginReveal,
      claimMapDrawer,
      closeComposer,
      communityPrices.byVenueId,
      experienceLens,
      interruptVenueReveal,
      mapDrinkLensCategory,
      mobileViewport,
      setSelectedVenueId,
      setSheetSnap,
      setSheetDragY,
      selectedVenueId,
      venueById,
      setVenueRevealSettleSequence,
    ],
  );

  // §4.8 Make it Stop 1. Only a confirmed PlanningIntent write may emit
  // acceptance telemetry or hand the person to Plan. The source is never the
  // calling surface's belief about where the selection came from: acceptMapVenue
  // reads it from the verified stored intent, so a matching Near/Tonight arrival
  // keeps its richer area and provenance envelope and everything else is a
  // plain map search.
  const acceptStop1 = useCallback(() => {
    const venue = selectedVenue;
    if (!venue) return;
    const result = acceptMapVenue({
      cityId,
      acceptedVenueId: venue.id,
      search: currentSearch(),
    });
    if (!result.accepted || !result.telemetry || !result.destination) {
      setAcceptanceError(VENUE_ACCEPTANCE_STORAGE_ERROR);
      return;
    }
    setAcceptanceError(null);
    trackEvent("venue_accepted", result.telemetry);
    trackEvent("planning_handoff_opened", { from: result.telemetry.source, to: "plan" });
    if (typeof window !== "undefined") window.location.assign(result.destination);
  }, [selectedVenue, cityId]);

  // The tapped UK base pub, held whole because it exists in no index this
  // component has: the map hands the record up with the tap. Selection itself
  // still runs through selectedVenueId, so Back/close and the selection ring
  // behave as they do for a curated pin. ?sel= deep-linking needs one extra
  // step the curated path doesn't: the id alone carries no record, so restore
  // rides the `at=` location hint (ukBaseRestore above) — the canvas flies
  // there, streams the one cell, and hands the resolved pub back through this
  // same click handler. A link without the hint gets the ring only, no sheet.
  const [selectedBasePub, setSelectedBasePub] = useState<UkBasePub | null>(null);
  const handleUkBasePubClick = useCallback(
    (pub: UkBasePub) => {
      setSelectedBasePub(pub);
      selectVenue(pub.id);
    },
    [selectVenue],
  );
  // Selecting anything else (or closing the sheet) retires the base pub, by
  // derivation rather than by a state-sync effect: the record only ever shows
  // while it IS the selection.
  const basePubOpen = Boolean(selectedBasePub && selectedBasePub.id === selectedVenueId);
  // The sel entry's `at=` companion: a base pub's coordinates ride in the URL
  // because the id alone could not say which shard cell a shared/reloaded
  // link should stream. Empty for curated selections, which clears the param.
  const selectionHint =
    basePubOpen && selectedBasePub
      ? formatSelectionHint(selectedBasePub.lat, selectedBasePub.lng)
      : "";

  const prefetchVenueDetail = useCallback((id: string) => {
    prefetchVenue(id);
    // Also populate the shared warm cache so select can skip a second fetch.
    void warmVenueDetail(id);
  }, []);

  // ?sel= client-nav sync — verbatim in components/map/pubmap/useSelParamSync.ts.
  const selParam = searchParams?.get("sel") ?? "";
  useSelParamSync({ selParam, selectedVenueId, selectVenue });

  // W3 cheap-round / vertical deep links: /map?src=whats-on-deal opens the
  // Tonight lane already filtered to that kind (exact allowlisted tokens only).
  const srcParam = searchParams?.get("src") ?? "";
  const tonightDeepLinkKind = useMemo((): WhatsOnKind | null => {
    const kindBySrc: Record<string, WhatsOnKind> = {
      "whats-on-quiz": "quiz",
      "whats-on-sport": "sport",
      "whats-on-deal": "deal",
      "whats-on-music": "music",
    };
    if (!isLondon) return null;
    return kindBySrc[srcParam] ?? null;
  }, [srcParam, isLondon]);
  const tonightLaneKind =
    tonightDeepLinkKind && srcParam !== dismissedTonightSrc ? tonightDeepLinkKind : null;
  const tonightLaneForcedOpen = Boolean(tonightLaneKind);

  // D1 — the picker is grounded in a real origin: the reader's fix, else the
  // centre of the map they are looking at. It never offers a city-wide five.
  const logNearbyOrigin = useMemo(
    () => resolveLogNearbyOrigin({ userLocation, mapCenter: mapViewport.center }),
    [mapViewport.center, userLocation],
  );
  const logNearbyCandidates = useMemo(
    () =>
      buildLogNearbyCandidates(
        filteredPubVenues,
        undefined,
        logNearbyOrigin?.origin ?? null,
        LOG_NEARBY_MAX_KM,
      ),
    [filteredPubVenues, logNearbyOrigin],
  );

  const showLoadedRoute = useCallback(
    (firstStopId: string) => {
      openPlanning();
      if (isMobileViewport()) {
        setVenueInitialTab("pints");
        return;
      }
      selectVenue(firstStopId);
    },
    [openPlanning, selectVenue],
  );

  useEffect(() => {
    const request = pendingNearMeRequest;
    const location = request?.location ?? userLocation ?? venueJourneyLocation;
    if (!location) return;
    const loader = slimLoaderRef.current;
    const finish = () => {
      if (
        !request ||
        slimLoaderRef.current !== loader ||
        pendingNearMeRequest !== request
      ) return;
      if (request.kind === "map") {
        const nearby = nearMeMapVenues(location.lat, location.lng, filteredVenues);
        const withinRing = withinNearMeRing(location, filteredVenues);
        setNearbyMapResult({
          location,
          venueIds: nearby.map((venue) => venue.id),
          radiusKm: NEAR_ME_MAP_RADIUS_KM,
          strategy: withinRing >= NEAR_ME_MAP_MIN_VENUES ? "within-radius" : "nearest-20",
        });
        setNearbyLoading(false);
        setPendingNearMeRequest(null);
        if (request.mode !== "resume") setMapOverlay("near-me");
        return;
      }
      const ids = nearestVenueIds(
        location.lat,
        location.lng,
        filteredPubVenues,
        request.stopCount,
      );
      setNearbyLoading(false);
      setPendingNearMeRequest(null);
      if (ids.length === 0) {
        setNearbyError("Nothing within reach matches those filters. Loosen one and the map fills back up.");
        return;
      }
      setMode("build");
      setBuiltIds(ids);
      setRouteMapped(true);
      setActiveCrawl(null);
      showLoadedRoute(ids[0]);
    };
    if (!loader) {
      return;
    }
    const loaderGeneration = slimLoaderGenerationRef.current;
    let cancelled = false;
    const failNearbyLoad = () => {
      if (
        cancelled ||
        !request ||
        slimLoaderRef.current !== loader ||
        pendingNearMeRequest !== request
      ) return;
      setNearbyError("Nearby venues are unavailable right now.");
      setNearbyLoading(false);
      setPendingNearMeRequest(null);
    };
    void loader.nearPoint(location.lat, location.lng)
      .then((result) => {
        if (
          cancelled ||
          slimLoaderRef.current !== loader ||
          slimLoaderGenerationRef.current !== loaderGeneration
        ) return;
        mergeSlimVenues(result.rows);
        refreshCountCoverage();
        if (request) setNearbyLoadVersion((version) => version + 1);
        if (result.status === "unavailable") {
          failNearbyLoad();
          return;
        }
        if (result.rows.length === 0) finish();
      })
      .catch(() => {
        failNearbyLoad();
      });
    return () => {
      cancelled = true;
    };
  }, [
    cityId,
    filteredPubVenues,
    filteredVenues,
    loaded,
    mergeSlimVenues,
    nearbyLoadVersion,
    openingLocationResolved,
    pendingNearMeRequest,
    refreshCountCoverage,
    setActiveCrawl,
    setBuiltIds,
    setMode,
    setRouteMapped,
    showLoadedRoute,
    userLocation,
    venueJourneyLocation,
    venueIndexAttempt,
  ]);

  // Persist the favorite-pint choice as the user picks it (null = clear).
  const changeFavoritePint = useCallback((beerId: string | null) => {
    setFavoritePintState(beerId);
    if (beerId) {
      persistFavoritePint(beerId);
      notifyCheapPintPingQualified();
    } else clearFavoritePint();
  }, []);

  // Putting the map under a drink is ONE write, wherever the reader taps it:
  // the desktop lane panel, the phone lane sheet and the Filters copy all land
  // here, so the three cannot drift into three different ideas of what a lane
  // switch retires. A brand is a pint refinement, so leaving the pint lane
  // clears the favourite too rather than leaving it set and inert.
  const changeDrinkLane = useCallback(
    (lane: DrinkCategory) => {
      setFilters((current) => applyDrinkLane(current, lane));
      if (lane !== DEFAULT_DRINK_LANE) changeFavoritePint(null);
    },
    [changeFavoritePint, setFilters],
  );

  // The brand refinement inside the pint lane. It names the lane explicitly so
  // a brand chosen from the resting map still round-trips through the crawl URL.
  const changeDrinkBrand = useCallback(
    (drinkBrand: string) => {
      setFilters((current) => ({
        ...current,
        drinkCategory: DEFAULT_DRINK_LANE,
        drinkBrand,
        drinkSubtype:
          current.drinkCategory === DEFAULT_DRINK_LANE ? current.drinkSubtype : "",
      }));
    },
    [setFilters],
  );

  const [personaLensId, setPersonaLensId] = useState<string | null>(null);
  // What the drinker had set before an experience view took the map. The view
  // has to stand the pint refinements down (they are invisible while it owns
  // the map, so they must also be inert), but standing something down is not
  // the same as throwing it away: coming back to All puts every one of them
  // back, exactly as filtersForExperienceLens already does for zone and the
  // price cap. Captured once, on the way OUT of All, so All → food → All is the
  // same round trip as All → no-alcohol → All.
  type ExperienceLensRestore = {
    drinkCategory: string;
    drinkBrand: string;
    drinkSubtype: string;
    topShelfOnly: boolean;
    requireCocktails: boolean;
    favoritePint: string | null;
    personaLensId: string | null;
    venueKindVisibility: VenueKindVisibility;
  };
  const experienceLensRestoreRef = useRef<ExperienceLensRestore | null>(null);
  const experienceLensLiveRef = useRef<ExperienceLensRestore>({
    drinkCategory: filters.drinkCategory,
    drinkBrand: filters.drinkBrand,
    drinkSubtype: filters.drinkSubtype,
    topShelfOnly: filters.topShelfOnly,
    requireCocktails: filters.requireCocktails,
    favoritePint,
    personaLensId,
    venueKindVisibility,
  });
  useEffect(() => {
    experienceLensLiveRef.current = {
      drinkCategory: filters.drinkCategory,
      drinkBrand: filters.drinkBrand,
      drinkSubtype: filters.drinkSubtype,
      topShelfOnly: filters.topShelfOnly,
      requireCocktails: filters.requireCocktails,
      favoritePint,
      personaLensId,
      venueKindVisibility,
    };
  }, [
    favoritePint,
    filters.drinkBrand,
    filters.drinkCategory,
    filters.drinkSubtype,
    filters.requireCocktails,
    filters.topShelfOnly,
    personaLensId,
    venueKindVisibility,
  ]);
  const changeExperienceLens = useCallback(
    (next: MapExperienceLensValue) => {
      setExperienceLens(next);
      if (next === "all") {
        const saved = experienceLensRestoreRef.current;
        experienceLensRestoreRef.current = null;
        if (!saved) return;
        setFilters((current) => ({
          ...current,
          drinkCategory: saved.drinkCategory,
          drinkBrand: saved.drinkBrand,
          drinkSubtype: saved.drinkSubtype,
          topShelfOnly: saved.topShelfOnly,
          requireCocktails: saved.requireCocktails,
        }));
        setVenueKindVisibility(saved.venueKindVisibility);
        setPersonaLensId(saved.personaLensId);
        setFavoritePintState(saved.favoritePint);
        if (saved.favoritePint) persistFavoritePint(saved.favoritePint);
        else clearFavoritePint();
        return;
      }
      // Only the first step out of All captures: hopping between two views must
      // not overwrite the snapshot with the stood-down state.
      if (!experienceLensRestoreRef.current) {
        experienceLensRestoreRef.current = experienceLensLiveRef.current;
      }
      setFavoritePintState(null);
      clearFavoritePint();
      setPersonaLensId(null);
      setMobileLayersTab("layers");
      setFilters((current) => ({
        ...current,
        drinkCategory: "",
        drinkBrand: "",
        drinkSubtype: "",
        topShelfOnly: false,
        requireCocktails: false,
      }));
      setVenueKindVisibility((current) =>
        next === "food"
          ? { ...current, food: true, restaurant: true }
          : {
              ...current,
              pub: true,
              bar: true,
              food: true,
              restaurant: true,
            },
      );
      if (next === "no-alcohol") loadNoAlcoholPriceIndex();
    },
    [loadNoAlcoholPriceIndex],
  );

  useEffect(() => {
    const seeded = parseMapExperienceLensParam(
      new URLSearchParams(currentSearch()).get(MAP_EXPERIENCE_LENS_URL_PARAM),
    );
    // Defer setState out of the effect body (react-hooks/set-state-in-effect).
    if (seeded && seeded !== "all") {
      void Promise.resolve().then(() => changeExperienceLens(seeded));
    }
  }, [changeExperienceLens]);

  // Alcohol-free-first crawl style needs the same corroborated NA index as the
  // no-alcohol experience lens. Selecting the style (or restoring ?style=…)
  // must load it; otherwise scoreVenue's NA bias is always empty.
  useEffect(() => {
    if (filters.crawlStyle === "noAlcoholFirst") loadNoAlcoholPriceIndex();
  }, [filters.crawlStyle, loadNoAlcoholPriceIndex]);

  // Persona "Drink like..." lens. The picker sets filters.drinkCategory so the
  // lens RIDES the existing drink-category filter path (filterVenues +
  // pubsToGeoJSON) instead of forking a new pin pipeline; we only track WHICH
  // persona is active so the card can render. Conditions cross-link: personas
  // whose category fits tonight sort first (useTonightLaneCue reuses the
  // shared /api/tonight-conditions verdict, no duplicated weather rules).
  const tonightLaneCue = useTonightLaneCue(isLondon);
  const personaTonightCategory = tonightLaneCue.category;

  const selectPersona = useCallback((persona: PersonaDrink | null) => {
    if (!persona) {
      setPersonaLensId(null);
      setFilters((current) => ({
        ...current,
        drinkCategory: "",
        drinkBrand: "",
        // A persona owns the whole drink lens, refinement included — leaving a
        // subtype behind would keep narrowing a lens the user just cleared.
        drinkSubtype: "",
        topShelfOnly: false,
        requireCocktails: false,
      }));
      return;
    }
    setPersonaLensId(persona.id);
    setFavoritePintState(null);
    // Non-alcoholic / uncovered orders (water, Cherry Coke, milk) would filter
    // the map to empty, so we leave the drink filter cleared and just show the
    // card, no lens dead-end. Everything else rides the drink-category path.
    const highlights = personaHighlightsPubs(persona);
    setFilters((current) => ({
      ...current,
      drinkCategory: highlights ? persona.drinkCategory : "",
      drinkBrand: "",
      drinkSubtype: "",
      topShelfOnly: false,
      requireCocktails: highlights && persona.drinkCategory === "cocktail",
    }));
  }, []);

  // The card shows while the active persona still owns the live drink lens.
  // Highlighting personas hold the card while their category is the active
  // filter; non-highlighting (non-alcoholic) personas hold it while no other
  // drink lens has taken over (drinkCategory stays cleared). Either way,
  // selecting a different lens by any control implicitly retires the card.
  const [activePersona, setActivePersona] = useState<PersonaDrink | null>(null);
  useEffect(() => {
    if (!personaLensId) return;
    let cancelled = false;
    void findPersonaByIdAsync(personaLensId)
      .then((persona) => {
        if (cancelled) return;
        if (!persona) {
          setActivePersona(null);
          return;
        }
        const owns = personaHighlightsPubs(persona)
          ? persona.drinkCategory === filters.drinkCategory
          : filters.drinkCategory === "";
        setActivePersona(owns ? persona : null);
      })
      .catch(() => {
        if (!cancelled) selectPersona(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.drinkCategory, personaLensId, selectPersona]);

  const personaForCard = useMemo(() => {
    if (!personaLensId || !activePersona || activePersona.id !== personaLensId) {
      return null;
    }
    const owns = personaHighlightsPubs(activePersona)
      ? activePersona.drinkCategory === filters.drinkCategory
      : filters.drinkCategory === "";
    return owns ? activePersona : null;
  }, [activePersona, filters.drinkCategory, personaLensId]);

  useEffect(() => {
    if (!personaLensId) return;
    let cancelled = false;
    void loadPersonaDrinksModule().catch(() => {
      if (!cancelled) selectPersona(null);
    });
    return () => {
      cancelled = true;
    };
  }, [personaLensId, selectPersona]);

  // Flip "Saved only". Re-read the saved set from localStorage on every toggle
  // (event handler, not an effect) so a venue saved elsewhere this session is
  // reflected the moment the filter is turned on — no stale set, no reload.
  const changeSavedOnly = useCallback((next: boolean) => {
    if (next) setSavedIds(readSavedVenueIds());
    setSavedOnly(next);
  }, []);

  const handleTonightOpportunityClick = useCallback(
    (op: ThingsToDoOpportunity) => {
      const label = op.place?.name?.trim() || op.title.trim();
      if (!label) return;
      const venueId = venueIdByNormalisedName.get(normaliseTonightVenueLookup(label));
      if (venueId) {
        selectVenue(venueId);
        return;
      }
      setFilters((current) => ({ ...current, query: label }));
    },
    [selectVenue, venueIdByNormalisedName],
  );

  const dismissTonightOverlay = useCallback(() => {
    setTonightDismissed(true);
    setTonightOverlayVisible(false);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(TONIGHT_OVERLAY_DISMISSED_KEY, "1");
      } catch {
        // Best-effort; in-memory state still hides the chip for this session.
      }
    }
  }, []);

  // Dismiss the §4.5 onboarding overlay and remember it for the session. Event
  // handler, so setState is fine; the sessionStorage write is best-effort.
  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
      } catch {
        // sessionStorage can throw (private mode / quota) — the state flag alone
        // still closes the overlay for this render session.
      }
    }
  }, []);

  // G3: dismiss the band deep-link chip for this band id (session-scoped).
  const dismissBandChip = useCallback(() => {
    const id = activeBandId;
    if (!id) return;
    setDismissedBandIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(bandChipDismissedKey(id), "1");
      } catch {
        // Best-effort; in-memory flag still closes the chip this session.
      }
    }
  }, [activeBandId]);

  const filteredVenueCount = filteredVenues.length;
  const filteredPubVenueCount = filteredPubVenues.length;
  const firstRouteId = route[0]?.id ?? "";
  const firstFilteredVenueId = filteredPubVenues[0]?.id ?? "";

  // --- Search fly-to / fit (map search was a dead end) --------------------
  // Typing a pub name narrowed the pin set but never moved the camera, so at
  // city zoom the matches simply vanished. Now: a single match flies to and
  // opens that venue (reusing selectVenue → the canvas cinematic + venue
  // sheet); multiple matches re-frame the camera onto the matched set via a
  // token the canvas watches. The live venue set is read through a ref so
  // unrelated churn (drops/signals) never yanks the camera; only a query
  // change drives a move.
  const [searchFitToken, setSearchFitToken] = useState(0);
  const [searchAreaNewsArea, setSearchAreaNewsArea] = useState<string | null>(null);
  // The query whose camera an explicit pick already owns. Cleared on every
  // keystroke, so the next word re-arms the typed-search move.
  const searchQueryCameraOwnedRef = useRef<string | null>(null);
  const filteredVenuesRef = useRef(filteredVenues);
  useEffect(() => {
    filteredVenuesRef.current = filteredVenues;
  }, [filteredVenues]);
  const selectTopSearchMatch = useCallback(() => {
    const top = filteredVenuesRef.current[0];
    if (top) selectVenue(top.id);
  }, [selectVenue]);

  const trimmedMapQuery = filters.query.trim();
  // A search field under the reader's finger owns the screen. This tracks
  // whether it still holds the caret; lib/mapSearchCamera owns the rule.
  const [mapSearchFieldFocused, setMapSearchFieldFocused] = useState(false);
  useEffect(() => {
    const readFocus = () =>
      setMapSearchFieldFocused(isMapSearchField(document.activeElement));
    readFocus();
    // focusout lands with activeElement on <body>; the focusin that follows in
    // the same tick corrects it, and the effect's cleanup drops the timer the
    // intermediate state armed. So a tab between two fields never moves the map.
    document.addEventListener("focusin", readFocus);
    document.addEventListener("focusout", readFocus);
    return () => {
      document.removeEventListener("focusin", readFocus);
      document.removeEventListener("focusout", readFocus);
    };
  }, []);
  const didMountSearchFlyRef = useRef(false);
  // The phone search overlay covers the map with its own suggestion panel, so a
  // camera move made while it is open is work nobody can see. It is also
  // premature: "cam" matches Camden, Camberwell and Cambridge, and framing all
  // of them zooms out to the whole city behind a panel the reader is still
  // typing into. Hold the camera until the overlay closes. Picking a suggestion
  // flies through its own path and does not need this one.
  const searchOverlayOpen = mapOverlay === "search";
  useEffect(() => {
    if (ukPlaceArrival) return;
    // Leave first paint to arrival framing; only react to user-driven typing.
    if (!didMountSearchFlyRef.current) {
      didMountSearchFlyRef.current = true;
      return;
    }
    // The camera stays still while the reader is typing. Once focus leaves the
    // field this effect runs again and the same move happens, deferred rather
    // than dropped.
    if (mapSearchFieldFocused) return;
    // The phone overlay covers the map with its own suggestion panel, so a move
    // made under it is work nobody can see. Focus does not answer this on its
    // own: the overlay stays up after the field is blurred, which is exactly
    // when the deferred move would fire behind it.
    if (searchOverlayOpen) return;
    if (trimmedMapQuery.length < TYPED_SEARCH_MIN_QUERY) return;
    const handle = window.setTimeout(() => {
      const move = typedSearchCameraMove({
        query: trimmedMapQuery,
        matchCount: filteredVenuesRef.current.length,
        // Re-read at fire time: focus can return during the debounce.
        searchFieldFocused: isMapSearchField(document.activeElement),
        // An explicit pick (an area, a pub) already pointed the camera at an
        // answer for this query. Do not let the timer fire late and replace it.
        cameraOwnedByPick: searchQueryCameraOwnedRef.current === trimmedMapQuery,
      });
      if (move === "select-one") {
        // Fly to the one match and open its sheet (reuses the pin path).
        selectVenue(filteredVenuesRef.current[0].id);
      } else if (move === "fit-many") {
        // Frame the whole matched set so none stay hidden off-screen.
        setSearchFitToken((token) => token + 1);
      }
    }, 320);
    return () => window.clearTimeout(handle);
  }, [mapSearchFieldFocused, searchOverlayOpen, trimmedMapQuery, selectVenue, ukPlaceArrival]);

  // #397: a query restored from the URL (?q=) must fly to its matches exactly
  // like typed search does (#371). The typed-search effect above deliberately
  // skips first paint, and the arrival framing prop can miss the restore on the
  // slow two-stage venue load (mapReady fires before slim pins match) — leaving
  // the query in the field and a pin count on screen while the camera sits on
  // the default view with no match in sight. Drive the same select-one /
  // fit-many result here once the map is ready and the slim pins have matched.
  // A zero-result query never moves the camera and never claims pins.
  const didRestoreQueryFlyRef = useRef(false);
  useEffect(() => {
    if (didRestoreQueryFlyRef.current) return;
    if (!mapCanvasReady) return;
    if (!shouldFitQueryVenuesOnArrival(arrivalSearch)) return;
    // A restored selection (?sel=) owns the camera; don't fight its fly-to.
    if (seed.selectedVenueId) return;
    const matches = filteredVenues;
    const fit = resolveQueryRestoreFit(matches.length);
    // "none" means still loading (no match yet) or an honest zero-result query;
    // either way, leave the camera alone and don't latch the once-guard.
    if (fit === "none") return;
    const firstMatchId = matches[0]?.id;
    // Defer the state write out of the effect body (matches the typed-search
    // effect above) and latch on the actual fire, so re-renders while the pins
    // are still settling reschedule cleanly instead of losing the fly-to.
    const handle = window.setTimeout(() => {
      didRestoreQueryFlyRef.current = true;
      if (fit === "select-single" && firstMatchId) {
        selectVenue(firstMatchId);
      } else if (fit === "fit-many") {
        setSearchFitToken((token) => token + 1);
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [mapCanvasReady, filteredVenues, arrivalSearch, seed.selectedVenueId, selectVenue]);

  const focusMapSearch = useCallback(() => {
    const search = (document.getElementById("mobileMapSearchInput") ?? document.getElementById("mapSearchInput")) as HTMLInputElement | null;
    if (search) search.focus();
  }, []);

  const resetLogIntentFilters = useCallback(() => {
    setSavedOnly(false);
    setSavedIds(readSavedVenueIds());
    setFilters(seedCrawlState("").filters);
    closePlanning();
    focusMapSearch();
  }, [closePlanning, focusMapSearch, setFilters]);

  // #395 R1: clear only the search query and unfilter the map. Used by the
  // mobile active-search chip so a restored (or typed) query is never an
  // invisible filter. Leaves every other filter and the camera untouched.
  const changeMapSearchQuery = useCallback((query: string) => {
    searchQueryCameraOwnedRef.current = null;
    setSearchAreaNewsArea(null);
    setFilters((current) => ({ ...current, query }));
  }, [setFilters]);

  const clearMapQuery = useCallback(() => {
    changeMapSearchQuery("");
  }, [changeMapSearchQuery]);

  const openComposerForLog = useCallback(() => {
    closePlanning();
    setVenueInitialTab("pints");
    setSheetSnap("full");
    setSheetDragY(null);
    dismissOnboarding();
    setComposerOpen(true);
  }, [closePlanning, dismissOnboarding, setComposerOpen, setSheetDragY, setSheetSnap]);

  const pickLogNearbyVenue = useCallback(
    (venueId: string) => {
      setLogIntentFallbackVisible(false);
      selectVenue(venueId);
      openComposerForLog();
    },
    [openComposerForLog, selectVenue],
  );

  const handleInspectorTabSelect = useCallback(
    (nextTab: TabKey) => {
      if (!isMobileViewport()) return;
      setSheetSnap(nextTab === "overview" ? "half" : "full");
      setSheetDragY(null);
    },
    [setSheetDragY, setSheetSnap],
  );

  // Core-loop entry point: the mobile Log FAB links to /map?log=1. Once the
  // fast venue list exists, turn that intent into the existing single composer
  // path: pick the best visible pub, open its sheet, and open the composer.
  useLogIntent({
    hasLogIntent: hasReactiveLogIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    selectedVenueId,
    selectedVenueResolvable,
    selectedVenueIsPub,
    selectVenue,
    openComposerForLog,
    setFallbackVisible: setLogIntentFallbackVisible,
  });

  // Keyboard shortcuts: "/" focuses search. Escape enters the same Back owner
  // as browser, button, and gesture navigation.
  useMapKeyboardShortcuts({
    planningOpen,
    selectedVenueId,
    onBack: () => surfaceBackRef.current(),
    onInterruptReveal: interruptVenueReveal,
    logIntentFallbackVisible,
    dismissLogIntent: clearLogIntent,
  });

  const toggleBuiltStop = useCallback((id: string) => {
    setBuiltIds((current) => {
      if (current.includes(id)) return current.filter((existing) => existing !== id);
      const venue = venueById.get(id);
      if (venue && !isPubVenue(venue)) return current;
      return [...current, id];
    });
    setRouteMapped(true);
    setActiveCrawl(null); // a manual stop change is no longer "the curated crawl"
  }, [setBuiltIds, setRouteMapped, venueById]);

  // Reverse the hand-built route: start from the opposite end. Event handler, so
  // setState is fine; URL-sync picks up the new builtIds order automatically.
  const reverseRoute = useCallback(() => {
    setBuiltIds((current) => [...current].reverse());
    setRouteMapped(true);
    setActiveCrawl(null);
  }, [setBuiltIds, setRouteMapped]);

  const clearBuilt = useCallback(() => {
    setBuiltIds([]);
    setRouteMapped(false);
    setActiveCrawl(null);
    // Explicit Clear also drops the refresh-safety net.
    if (typeof window !== "undefined") window.localStorage.removeItem(BUILT_STORAGE_KEY);
  }, [setBuiltIds, setRouteMapped]);

  // Trust fix (§4.3): a pin tap INSPECTS ONLY, in both modes. It never mutates
  // the crawl — otherwise browsing pubs in build mode silently adds/removes
  // stops and destroys a carefully-built route. The crawl is mutated ONLY via
  // the explicit Add/Remove button in VenueInspector (which calls toggleBuiltStop).
  const handleVenueClick = useCallback(
    (id: string) => {
      // W1: a pin carrying a What's-On badge was tapped → badge_tap (the typed
      // rail's map-badge signal). Silent for pins without a tonight badge.
      if (whatsOnTonight.summary.has(id)) trackEvent("badge_tap");
      selectVenue(id);
    },
    [selectVenue, whatsOnTonight.summary],
  );

  // Load a named curated crawl into Build mode. URL-sync makes it shareable.
  const loadCuratedCrawl = useCallback(
    (crawl: CuratedCrawl) => {
      setMode("build");
      setBuiltIds(crawl.venueIds);
      setRouteMapped(true);
      setFilters((current) => filtersForCuratedCrawl(current, crawl));
      setAltStyle(crawl.altStyle ?? "pint"); // "kind of night" label for copy
      setActiveCrawl(crawl); // its blurb shows under the route title until mutated
      showLoadedRoute(crawl.venueIds[0] ?? "");
      dismissOnboarding(); // picking a crawl from the overlay closes + remembers it
    },
    [
      dismissOnboarding,
      setActiveCrawl,
      setAltStyle,
      setBuiltIds,
      setFilters,
      setMode,
      setRouteMapped,
      showLoadedRoute,
    ],
  );

  // Issue #15: "Start a crawl here" from a landmark card. The canvas hands us the
  // nearest pub ids (2-3, already resolved via lib/haversine); we drop them into
  // Build mode exactly like a curated crawl so the URL (?mode=build&pubs=…) makes
  // it shareable. No new mechanism — this reuses the curated-crawl path.
  // Issue #15 landmark → journey actions (see useLandmarkJourney above).
  const { startCrawlFromPubs, askPubmaxxerAtPub } = useLandmarkJourney({
    selectVenue,
    showLoadedRoute,
    dismissOnboarding,
    setMode,
    setBuiltIds,
    setRouteMapped,
    setActiveCrawl,
    setPlanningOpen: (open) => {
      if (open) openPlanning();
      else closePlanning();
    },
  });

  // "Pubs near me": ask for location, build a crawl from the nearest matching
  // venues. Event handler (not an effect) so setState here is fine. Degrades
  // gracefully — feature-detect geolocation, catch denial, never throws.
  const requestVenueLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationRequestStatus("unavailable");
      return;
    }

    setLocationRequestStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setVenueJourneyLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        writeMapOpeningLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationRequestStatus("idle");
      },
      () => {
        setLocationRequestStatus("unavailable");
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 },
    );
  }, []);

  const clearVenueLocation = useCallback(() => {
    setVenueJourneyLocation(null);
    setLocationRequestStatus("idle");
  }, []);

  const startNearbyCrawl = useCallback(() => {
    setNearbyError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNearbyError(nearMeLocationMessage("unsupported"));
      return;
    }
    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lng: position.coords.longitude };
        setUserLocation(location);
        writeMapOpeningLocation(location);
        setPendingNearMeRequest({
          kind: "crawl",
          location,
          stopCount: filters.stopCount,
        });
      },
      (error) => {
        setNearbyLoading(false);
        setNearbyError(nearMeLocationMessage(nearMeLocationFailure(error)));
      },
      NEAR_ME_LOCATION_OPTIONS,
    );
  }, [
    filters.stopCount,
    setNearbyLoading,
    setPendingNearMeRequest,
    setUserLocation,
  ]);

  // Three ways in, one flow, and they differ ONLY in what a refusal owes.
  //
  // `tap` is the ordinary Near me seams - the phone chip, the desktop toolbar
  // row, the Area sheet's own button. A refusal is one alert beside the control
  // that was pressed, and nothing opens: none of those controls promised a
  // picker, and forcing a modal over the map is not what they were pressed for.
  //
  // `arrival` is the first-visit card's Use my location, whose whole offer is
  // "location, OR pick an area", so a refusal really does hand over the picker.
  // The sheet then CARRIES the sentence, so the alert must not also hold it or
  // the same words render twice, one of them over the other.
  //
  // `resume` is a remembered Near me on arrival: the reader asked for this mode
  // LAST time, not for a notice now, so a refusal is silent and leaves the
  // default city view with the picker still one tap away. Nothing about where
  // they stood was ever stored, so this is a live fix or it is nothing.
  const runNearMe = useCallback(
    (mode: "tap" | "arrival" | "resume") => {
      setNearbyError(null);
      const refuse = (message: string) => {
        if (mode === "resume") return;
        if (mode === "arrival") {
          openChooseAreaRef.current(message);
          return;
        }
        setNearbyError(message);
      };
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        refuse(nearMeLocationMessage("unsupported"));
        return;
      }
      setNearbyLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(location);
          writeMapOpeningLocation(location);
          setPendingNearMeRequest({ kind: "map", location, mode });
          // A mode marker, never a point: lib/mapChosenArea.ts owns that rule.
          writeMapChosenArea({
            cityId,
            label: "Near me",
            slug: "near-me",
            kind: "near-me",
          });
        },
        (error) => {
          setNearbyLoading(false);
          refuse(nearMeLocationMessage(nearMeLocationFailure(error)));
        },
        NEAR_ME_LOCATION_OPTIONS,
      );
    },
    [cityId, setPendingNearMeRequest],
  );

  const showNearbyMap = useCallback(() => runNearMe("tap"), [runNearMe]);
  const useLocationFromArrivalCard = useCallback(
    () => runNearMe("arrival"),
    [runNearMe],
  );

  const mapCurrentRoute = useCallback(() => {
    if (route.length < 2) return;
    setRouteMapped(true);
    dismissOnboarding();
    if (isMobileViewport()) closePlanning();
  }, [route.length, closePlanning, dismissOnboarding, setRouteMapped]);

  const hideMappedRoute = useCallback(() => {
    setRouteMapped(false);
  }, [setRouteMapped]);

  const checkLastTrainAtRouteEnd = useCallback(() => {
    const finalStop = route[route.length - 1];
    if (!finalStop) return;
    closePlanning();
    selectVenue(finalStop.id, "getting-home");
  }, [closePlanning, route, selectVenue]);

  // The venue sheet is open for a curated venue OR for a tapped base pub; both
  // fill the same drawer/sheet, so every open/close/snap path stays one path.
  const detailOpen = Boolean(selectedVenueId && selectedVenue) || basePubOpen;
  const activeNightArea = useMemo(() => nightAreaForMapQuery(cityId, filters.query) ??
    (!filters.query.trim() && plannedNightArea ? getNightArea(plannedNightArea) : null),
  [cityId, filters.query, plannedNightArea]);
  const suggestedPlanArea = useMemo(
    () => activeNightArea ?? nearestNightAreaForViewport(cityId, mapViewport.center),
    [activeNightArea, cityId, mapViewport.center],
  );
  const venuesById = useMemo(
    () => new Map(filteredPubVenues.map((venue) => [venue.id, venue])),
    [filteredPubVenues],
  );
  // The Area button's live label: the Night Area whose region holds the map
  // centre. Recomputes only when the viewport settles (moveend drives
  // mapViewport), so panning updates it without a separate debounce timer.
  const centreArea = useMemo(
    () => areaUnderCentre(cityId, mapViewport.center),
    [cityId, mapViewport.center],
  );
  // The place the top bar is allowed to NAME. Narrower than centreArea, which
  // answers "nearest area" for the sheet's pub list: a name printed in the bar
  // is a claim about what is on screen, so a view spanning several areas earns
  // no area name and the bar says the city instead.
  const claimedArea = useMemo(
    () => areaClaimedByViewport(cityId, mapViewport.center, mapBounds),
    [cityId, mapBounds, mapViewport.center],
  );
  // Where the Area sheet's row distances are measured from. A granted location
  // is the reader's own point, and only then may a row say "away". With none,
  // the map centre is all we have and the rows name it.
  const areaSheetDistanceFrom = useMemo<AreaDistanceFrom>(
    () =>
      userLocation
        ? { point: [userLocation.lng, userLocation.lat], origin: "reader" }
        : { point: mapViewport.center, origin: "map" },
    [mapViewport.center, userLocation],
  );
  // Area button "go somewhere else": bump a token to fly the canvas camera.
  const [areaFocus, setAreaFocus] = useState<MapCameraFocus | null>(null);
  /**
   * The ONE way the camera is deliberately moved to another place.
   *
   * A Near me answer is a membership over the painted map (see
   * lib/mapNearbyMembership.ts), so it stops describing the screen the moment
   * the reader goes somewhere else on purpose. Every such move drops it here
   * rather than at one of its call sites: the Area sheet's "go somewhere else",
   * a choose-area pick and a map-search area or place select are the same act,
   * and a membership left held paints the new area with whichever of those
   * twenty pins happen to be in frame - usually none - while the sheet beside
   * it lists that area's pubs, so the two disagree about the same place.
   */
  const moveMapCameraTo = useCallback(
    (camera: { center: [number, number]; zoom: number }) => {
      setNearbyMapResult(null);
      cancelOpeningLocation();
      setOpeningLocationFocus(null);
      setAreaFocus((prev) => ({
        center: camera.center,
        zoom: camera.zoom,
        source: "area",
        token: (prev?.token ?? 0) + 1,
      }));
    },
    [cancelOpeningLocation],
  );
  const flyToArea = useCallback(
    (option: AreaElsewhereOption) =>
      // Localities carry a slightly deeper zoom; areas/boroughs keep the default.
      moveMapCameraTo({ center: option.center, zoom: option.zoom ?? 14 }),
    [moveMapCameraTo],
  );

  // The Area sheet target set by a map-search select: a modelled area (shown
  // as-is) or an ad-hoc locality/borough ring. null = the Area button, which
  // falls back to the area under the map centre.
  const [searchAreaTarget, setSearchAreaTarget] = useState<
    | { kind: "area"; area: NightArea }
    | ({ kind: "place" } & AreaSheetPlaceFocus)
    | null
  >(null);
  // Deferred open of the Area sheet so its pubs appear AS the fly settles, not
  // mid-flight. Cleared on any manual overlay change / new select / unmount.
  const areaSheetOpenTimer = useRef<number | null>(null);
  const clearAreaSheetTimer = useCallback(() => {
    if (areaSheetOpenTimer.current !== null) {
      window.clearTimeout(areaSheetOpenTimer.current);
      areaSheetOpenTimer.current = null;
    }
  }, []);
  useEffect(() => clearAreaSheetTimer, [clearAreaSheetTimer]);

  // Map-search area/locality/borough select — the owner-specified journey:
  // the dropdown CLOSES, the map flies there, and the pubs there are DISPLAYED
  // as the camera settles. All three, in order. (A pub select is handled by
  // selectVenue, which already collapses search and opens the venue card.)
  const selectSearchArea = useCallback(
    (option: MapSearchAreaOption) => {
      const journey = planAreaSelect(option);
      searchQueryCameraOwnedRef.current = trimmedMapQuery;
      setSearchAreaNewsArea(option.areaNewsArea || null);
      // 1. Fly the camera to the chosen place.
      moveMapCameraTo({
        center: journey.camera.center,
        zoom: journey.camera.zoom,
      });
      // 2. Resolve what the sheet shows on arrival.
      const target = journey.target;
      // Every explicit search-area pick is a new named map area, so it replaces
      // any older remembered area before the chip renders. The pure transition
      // carries the public search centre; viewer location never reaches it.
      rememberMapChosenAreaSelection({ cityId, ...journey.rememberedArea });
      if (target.kind === "place") {
        setSearchAreaTarget({ kind: "place", name: target.name, center: target.center, radiusKm: target.radiusKm });
      } else {
        const area = getNightAreasForCity(cityId).find((a) => a.slug === target.slug) ?? null;
        setSearchAreaTarget(area ? { kind: "area", area } : null);
      }
      // 3. Collapse the search UI now (unmounts the input → keyboard closes,
      //    suggestions panel gone) via a direct set so it survives the auto-open
      //    below (changeMapOverlay would clear the pending target + timer).
      clearLogIntent();
      setMapOverlay("none");
      // 4. Open the pubs display as the camera settles (reduced-motion jumps,
      //    so the sheet opens on the next tick instead of trailing the fly).
      clearAreaSheetTimer();
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      areaSheetOpenTimer.current = window.setTimeout(() => {
        areaSheetOpenTimer.current = null;
        setMapOverlay("area");
      }, areaSheetOpenDelay(reduced));
    },
    [cityId, clearAreaSheetTimer, clearLogIntent, moveMapCameraTo, trimmedMapQuery],
  );
  // §4.8: picking a search result records the typed "map-search" origin, unlike
  // a browse pin tap. The current search input text is NOT proof of origin — only
  // an explicit result selection through this seam is.
  const selectVenueFromSearch = useCallback(
    (id: string, targetCityId?: CityId) => {
      // The reader picked a pub for this query, so the deferred typed-search
      // move must not fit the whole matched set over their choice on blur.
      searchQueryCameraOwnedRef.current = trimmedMapQuery;
      if (targetCityId && targetCityId !== cityId) {
        // Full navigation resets city-specific map state before the target city loads.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(
          `${cityMapShareUrl(targetCityId)}?sel=${encodeURIComponent(id)}`,
        );
        return;
      }
      selectVenue(id, "overview");
    },
    [cityId, selectVenue, trimmedMapQuery],
  );
  const selectUkBasePubFromSearch = useCallback(
    (pub: UkBasePub) => {
      searchQueryCameraOwnedRef.current = trimmedMapQuery;
      setSelectedBasePub(pub);
      selectVenue(pub.id, "overview");
    },
    [selectVenue, trimmedMapQuery],
  );
  const selectPlaceFromSearch = useCallback(
    (place: PlaceSuggestion) => {
      searchQueryCameraOwnedRef.current = trimmedMapQuery;
      // Already on that curated city guide → fly in place (no remount).
      if (place.placeKind === "curated" && place.cityId === cityId) {
        moveMapCameraTo({ center: place.center, zoom: place.flyZoom });
        clearLogIntent();
        setMapOverlay("none");
        changeMapSearchQuery("");
        return;
      }
      // Uncovered / other-city arrivals must full-load so PubMap remounts with
      // the server-resolved placeArrival (frozen at mount). Soft push would
      // leave the old arrival banner and emptied venues.
      window.location.assign(place.href);
    },
    [changeMapSearchQuery, cityId, clearLogIntent, moveMapCameraTo, trimmedMapQuery],
  );
  const selectCityFromSearch = useCallback(
    (targetCityId: CityId) => {
      if (targetCityId === cityId) {
        setMapOverlay("none");
        changeMapSearchQuery("");
        return;
      }
      window.location.assign(cityMapShareUrl(targetCityId));
    },
    [changeMapSearchQuery, cityId],
  );
  // Prefetch the national place index once the reader is typing a place-shaped
  // query, or already on a national / uncovered surface that needs it.
  useEffect(() => {
    if (ukPlaces.length > 0) return;
    if (
      ukNationalBrowse ||
      ukPlaceArrival ||
      trimmedMapQuery.length >= TYPED_SEARCH_MIN_QUERY
    ) {
      void loadUkPlaces();
    }
  }, [
    loadUkPlaces,
    trimmedMapQuery.length,
    ukNationalBrowse,
    ukPlaceArrival,
    ukPlaces.length,
  ]);
  const limitedCoverageSearch = Boolean(ukPlaceArrival || ukNationalBrowse);
  const sharedMapSearchProps = {
    cityId,
    query: filters.query,
    onQueryChange: changeMapSearchQuery,
    venues: limitedCoverageSearch ? [] : venues,
    localities: limitedCoverageSearch ? [] : localities,
    places: ukPlaces,
    includeLocalResults: !limitedCoverageSearch,
    ukBasePubs: residentUkBasePubs,
    userLocation,
    mapCenter: mapViewport.center,
    onSelectVenue: selectVenueFromSearch,
    onSelectUkBasePub: selectUkBasePubFromSearch,
    onSelectPlace: selectPlaceFromSearch,
    onSelectCity: selectCityFromSearch,
    onFlyToArea: selectSearchArea,
    onSubmitQuery: limitedCoverageSearch ? undefined : selectTopSearchMatch,
  } satisfies Omit<MapSearchSuggestProps, "id" | "mode" | "placeholder" | "onClose">;

  const applyGeneratedMobilePlan = useCallback((generated: GeneratedMobilePlan) => {
    const ids = generated.stops.map((stop) => stop.venueId);
    activateGeneratedPlan(generated.context.nightArea, ids);
    markPalRouteActivation();
    setActiveCrawl(null);
    if (generated.context.nightArea) {
      trackEvent("night_description_submitted", {
        area: generated.context.nightArea,
        daypart: generated.context.daypart,
      });
    }
  }, [activateGeneratedPlan, setActiveCrawl]);
  const coordinatedMobileOverlay: MapOverlay = logIntentFallbackVisible
    ? "moment"
    : detailOpen
      ? "venue"
      : planningOpen
        ? "planner"
        : mapOverlay;
  const mobileShellState: MobileShellState = {
    overlay: coordinatedMobileOverlay,
    viewport: mapViewport,
    selectedVenueId: selectedVenueId || null,
    cityId,
    nightArea: activeNightArea?.slug ?? null,
  };

  const changeMapOverlay = useCallback((next: MapOverlay) => {
    // Leaving the phone "Choose a pub" sheet leaves the Drop flow (D4).
    if (next !== "moment") clearLogIntent();
    if (next !== "none" && isMobileViewport()) {
      setPlanningOpen(false);
      setSelectedVenueId("");
      closeComposer();
    }
    // A manual overlay change (X, the Area button, any chip) cancels a pending
    // search auto-open and drops its searched target, so the Area button always
    // shows the area under the map centre — never a stale search result.
    clearAreaSheetTimer();
    setSearchAreaTarget(null);
    setMapOverlay(next);
  }, [clearAreaSheetTimer, clearLogIntent, closeComposer, setPlanningOpen]);

  const openChooseArea = useCallback((locationNote?: string | null) => {
    setChooseAreaLocationNote(locationNote ?? null);
    // The sheet takes the sentence, so the floating alert lets go of it: two
    // copies of one refusal, one painted over the other, read as two faults.
    if (locationNote) setNearbyError(null);
    changeMapOverlay("choose-area");
  }, [changeMapOverlay, setNearbyError]);

  useEffect(() => {
    openChooseAreaRef.current = openChooseArea;
  }, [openChooseArea]);

  const handleChooseAreaPick = useCallback(
    (pick: ChooseAreaPick) => {
      changeMapOverlay("none");
      setChooseAreaLocationNote(null);
      if (pick.kind === "near-me") {
        restoredChosenAreaRef.current = true;
        showNearbyMap();
        return;
      }
      if (pick.kind === "city") {
        if (pick.cityId !== cityId) {
          window.location.assign(cityMapShareUrl(pick.cityId));
        }
        return;
      }
      const { row } = pick;
      const kind = mapChosenAreaPickerKind(row.slug);
      const rememberedArea = {
        cityId,
        label: row.name,
        slug: row.slug,
        center: row.center,
        kind,
      } as const;
      rememberMapChosenAreaSelection(rememberedArea);
      restoredChosenAreaRef.current = true;
      const camera = mapChosenAreaFlyTarget(
        rememberedArea,
        LOCALITY_FLY_ZOOM,
      );
      flyToArea({
        slug: row.slug,
        name: row.name,
        center: row.center,
        coverage: null,
        kind: camera.kind,
        zoom: camera.zoom,
      });
    },
    [changeMapOverlay, cityId, flyToArea, showNearbyMap],
  );

  const chooseAreaSheet = useMemo(
    () => (
      <ChooseAreaSheet
        cityId={cityId}
        venues={pubVenues}
        localities={localities}
        completeCountSlugs={completeCountSlugs}
        locationNote={chooseAreaLocationNote}
        locationBusy={nearbyLoading}
        onPick={handleChooseAreaPick}
      />
    ),
    [
      chooseAreaLocationNote,
      cityId,
      completeCountSlugs,
      handleChooseAreaPick,
      localities,
      nearbyLoading,
      pubVenues,
    ],
  );

  useEffect(() => {
    if (!loaded || restoredChosenAreaRef.current) return;
    // lib/mapChosenArea.ts owns WHETHER the remembered area may move the
    // camera; this effect only carries the answer out. `wait` is the one answer
    // that leaves the one-shot unspent.
    const decision = resolveMapChosenAreaRestore({
      stored: readMapChosenArea(),
      cityId,
      explicitArrivalIntent,
      hasRestoredViewport: Boolean(restoredMobileSession?.viewport),
      venueCount: filteredVenues.length,
    });
    if (decision.action === "wait") return;
    restoredChosenAreaRef.current = true;
    if (decision.action === "skip") return;
    if (decision.action === "locate") {
      queueMicrotask(() => runNearMe("resume"));
      return;
    }
    const stored = decision.area;
    const camera = mapChosenAreaFlyTarget(stored, LOCALITY_FLY_ZOOM);
    queueMicrotask(() => {
      flyToArea({
        slug: stored.slug,
        name: stored.label,
        center: stored.center,
        coverage: null,
        kind: camera.kind,
        zoom: camera.zoom,
      });
    });
  }, [
    cityId,
    explicitArrivalIntent,
    filteredVenues,
    flyToArea,
    loaded,
    restoredMobileSession,
    runNearMe,
  ]);

  const mapChipLabel =
    mapChosenArea && mapChosenArea.cityId === cityId
      ? mapChosenArea.label
      : ukPlaceArrival?.name ?? claimedArea?.name ?? mapContextName;


  // ── Where the reader is, and how they get out ────────────────────────────
  // Every Map panel used to carry its own close and nothing else, so a reader
  // who opened three of them could shut the top one and land somewhere they
  // never chose. One navigation owner records direct open intents, follows the
  // derived visible surface as a safety net, and gives every panel one Back and
  // Home contract.
  const mapSurfaceId: MapSurfaceId =
    coordinatedMobileOverlay !== "none"
      ? coordinatedMobileOverlay
      : mapListOpen
        ? "venue-list"
        : "none";
  const mapSurfaceTitle =
    mapSurfaceId === "venue"
      ? basePubOpen
        ? selectedBasePub?.name ?? "Pub detail"
        : selectedVenue?.name ?? selectedVenueLabels.detailLabel
      : mapSurfaceId === "planner"
        ? "Plan an outing"
        : mapSurfaceId === "venue-list"
          ? "List view"
          : mapSurfaceId === "search"
            ? // Search is an inline row, not a sheet, so it has no entry in the
              // sheet-title table. It is still a place a reader can be, and a
              // Back that offered to return them to "Map controls" would name a
              // surface they never opened.
              "Search"
            : MAP_SHEET_TITLES[mapSurfaceId as MapSheetKind] ?? "Map controls";
  const mapSurfaceState = useMemo<MapSurfaceState>(
    () => ({
      venueTab: venueInitialTab,
      venueId: selectedVenueId,
      areaTargetKey: searchAreaTarget
        ? searchAreaTarget.kind === "area"
          ? `area:${searchAreaTarget.area.slug}`
          : `place:${searchAreaTarget.name}`
        : "",
      areaTarget: searchAreaTarget,
      layersTab: mobileLayersTab,
    }),
    [mobileLayersTab, searchAreaTarget, selectedVenueId, venueInitialTab],
  );
  const closeEverySurface = useCallback(() => {
    clearAreaSheetTimer();
    setSearchAreaTarget(null);
    clearLogIntent();
    closeComposer();
    setMapOverlay("none");
    setSelectedVenueId("");
    setPlanningOpen(false);
    setMapListOpen(false);
  }, [clearAreaSheetTimer, clearLogIntent, closeComposer, setPlanningOpen, setSelectedVenueId]);

  useEffect(() => {
    const onDismiss = () => closeEverySurface();
    window.addEventListener(MOBILE_SHEET_DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(MOBILE_SHEET_DISMISS_EVENT, onDismiss);
  }, [closeEverySurface]);
  const restoreMapSurface = useCallback(
    (entry: SurfaceEntry<MapSurfaceState> | null) => {
      closeEverySurface();
      if (!entry) return;
      const held = entry.state ?? EMPTY_MAP_SURFACE_STATE;
      if (entry.id === "venue") {
        // Restore the tab the reader left on, not the overview default.
        setVenueInitialTab((held.venueTab || "overview") as TabKey);
        setSelectedVenueId(held.venueId);
        return;
      }
      if (entry.id === "planner") {
        setPlanningOpen(true);
        return;
      }
      if (entry.id === "venue-list") {
        setMapListOpen(true);
        return;
      }
      // A sheet. Its searched area target is part of what the reader had, so it
      // is put back BEFORE the sheet opens; changeMapOverlay drops it on purpose
      // and would undo the restore.
      setMobileLayersTab(
        (held.layersTab || "key") as "key" | "layers" | "prices" | "events" | "transit",
      );
      setSearchAreaTarget(
        (held.areaTarget ?? null) as
          | { kind: "area"; area: NightArea }
          | ({ kind: "place" } & AreaSheetPlaceFocus)
          | null,
      );
      setMapOverlay(entry.id as MapOverlay);
    },
    [closeEverySurface, setPlanningOpen, setSelectedVenueId],
  );
  const mapSurfaceTrail = useMapSurfaceNavigation({
    arrivalSearch,
    surfaceId: mapSurfaceId,
    surfaceTitle: mapSurfaceTitle,
    surfaceState: mapSurfaceState,
    selectionHint,
    onRestore: restoreMapSurface,
    onHome: closeEverySurface,
  });
  const {
    rejectSelection: rejectMapSelection,
    resolveSelection: resolveMapSelection,
  } = mapSurfaceTrail;
  useLayoutEffect(() => {
    surfaceBackRef.current = mapSurfaceTrail.back;
    surfaceOpenRef.current = mapSurfaceTrail.open;
    surfaceStateRef.current = mapSurfaceState;
  }, [mapSurfaceState, mapSurfaceTrail.back, mapSurfaceTrail.open]);

  useEffect(() => {
    if (!selectedVenueId || detailById.has(selectedVenueId) || isUkBaseId(selectedVenueId)) return;
    const requestedVenueId = selectedVenueId;
    let cancelled = false;
    warmVenueDetail(requestedVenueId).then((result) => {
      if (cancelled) return;
      if (result.status !== "found") {
        setDetailStatusById((current) => {
          const next = new Map(current);
          next.set(requestedVenueId, result.status === "missing" ? "missing" : "unavailable");
          return next;
        });
        return;
      }
      const canonicalVenueId = result.venue.id;
      resolveMapSelection(requestedVenueId, canonicalVenueId);
      setDetailById((current) => {
        const next = new Map(current);
        next.set(canonicalVenueId, result.venue);
        return next;
      });
      setDetailStatusById((current) => {
        const next = new Map(current);
        next.delete(requestedVenueId);
        next.delete(canonicalVenueId);
        return next;
      });
      setSelectionNotice(null);
      if (canonicalVenueId !== requestedVenueId) {
        setSelectedVenueId((current) =>
          current === requestedVenueId ? canonicalVenueId : current,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detailById, resolveMapSelection, selectedVenueId]);

  useEffect(() => {
    const notice = mapSelectionNotice({
      loaded,
      selectedVenueId,
      resolvable: selectedVenueResolvable,
      ukBase: isUkBaseId(selectedVenueId),
      detailStatus: selectedDetailStatus,
    });
    if (!notice) return;
    const unresolvedVenueId = selectedVenueId;
    queueMicrotask(() => {
      setSelectionNotice(notice);
      if (notice !== "unknown") return;
      rejectMapSelection(unresolvedVenueId);
      setSelectedVenueId((current) => (current === unresolvedVenueId ? "" : current));
    });
  }, [
    loaded,
    rejectMapSelection,
    selectedDetailStatus,
    selectedVenueId,
    selectedVenueResolvable,
  ]);

  useEffect(() => {
    // An uncovered-place arrival is a one-off destination, not a city session:
    // persisting its viewport under cityId reopened the town under full London
    // chrome, with no arrival banner, on the next clean /map visit.
    if (ukPlaceArrival) return;
    writeMobileMapSession({
      viewport: mapViewport,
      filters,
      cityId,
      nightArea: activeNightArea?.slug ?? null,
      selectedVenueId: selectedVenueId || null,
      poiHidden,
      openSheet: detailOpen
        ? "venue"
        : planningOpen
          ? "planner"
          : mapOverlay !== "none" && mapOverlay !== "search" && mapOverlay !== "moment"
            ? mapOverlay
            : null,
    });
  }, [activeNightArea?.slug, cityId, detailOpen, filters, mapOverlay, mapViewport, planningOpen, poiHidden, selectedVenueId, ukPlaceArrival]);

  useEffect(() => {
    if (
      ukPlaceArrival ||
      !isPersistableMapResumeViewport(
        mapViewport,
        !mapOpeningNeedsResolution || openingLocationResolved,
        mapBounds !== null,
      ) ||
      slimPins.length === 0 ||
      liveShardLoadStatusRef.current !== "ready" ||
      venueIndexFailed
    ) return;
    const timer = window.setTimeout(() => {
      writeMapResume({
        cityId,
        viewport: mapViewport,
        rows: pinsToSlimVenues(slimPins),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cityId, mapBounds, mapOpeningNeedsResolution, mapViewport, openingLocationResolved, slimPins, ukPlaceArrival, venueIndexFailed]);

  // #215 a11y — the sheet's close button is the natural first stop for a
  // keyboard/AT user landing in a freshly-opened panel; on close (button,
  // Esc, or a fresh ?sel= navigating away) we hand focus back to whatever
  // triggered the open rather than dropping it to <body>.
  const drawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (detailOpen) {
      if (preSheetFocusRef.current === null) {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active !== document.body &&
          active !== document.documentElement
        ) {
          preSheetFocusRef.current = active;
        }
      }
      drawerCloseButtonRef.current?.focus({ preventScroll: true });
    } else if (preSheetFocusRef.current) {
      const target = preSheetFocusRef.current;
      const targetId = target.id;
      const restoreFocus = () => {
        const currentTarget =
          target.isConnected
            ? target
            : targetId
              ? document.getElementById(targetId)
              : null;
        currentTarget?.focus();
      };
      // Restore in the close commit, then once more after selection history has
      // popped its URL checkpoint. Browser history traversal can otherwise
      // move focus back to the document after this layout effect.
      restoreFocus();
      preSheetFocusRef.current = null;
      const frame = requestAnimationFrame(restoreFocus);
      let popFrame: number | null = null;
      const restoreAfterHistory = () => {
        popFrame = requestAnimationFrame(restoreFocus);
      };
      // Local close pops the selection sentinel after this commit. Restore
      // once more on that exact history settlement so traversal cannot strand
      // focus on the document. Browser-Back close has already popped, and the
      // animation-frame restore above covers that path.
      window.addEventListener("popstate", restoreAfterHistory, { once: true });
      const listenerCeiling = window.setTimeout(() => {
        window.removeEventListener("popstate", restoreAfterHistory);
      }, 1_000);
      return () => {
        cancelAnimationFrame(frame);
        if (popFrame !== null) cancelAnimationFrame(popFrame);
        window.clearTimeout(listenerCeiling);
        window.removeEventListener("popstate", restoreAfterHistory);
      };
    }
  }, [detailOpen]);

  // Desktop accessibility contract: drawer is modal for its full open lifetime. Desktop
  // never changes detent, so gating trap on mobile-oriented `sheetSnap` left it
  // inactive at its permanent `half` state.
  const detailDrawerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(
    !mobileViewport && detailOpen,
    detailDrawerRef,
    "map-surface",
    preSheetFocusRef,
  );

  // G3: Place story deep-link chip when `?band=` resolves. Takes priority over
  // curated onboarding so the two never fight.
  const showBandChip = shouldShowBandOnboardingChip({
    loaded,
    activeBandId,
    bandResolved: bandChipHasResolvedBand(activeBandId, activeBand),
    chipDismissed:
      dismissedBandIds.has(activeBandId) || readBandChipDismissed(activeBandId),
  });
  // §4.5: show the "Start with a story" onboarding overlay only on a clean first
  // paint — never while the band deep-link chip is showing (G3 priority), never
  // when this city has no curated crawls to offer, and never while the Tonight
  // lane (W1's PRIMARY what's-on spine) has live rows to show — the flagship
  // surface wins first paint over the story upsell so it's never occluded
  // (GateZ regression). Once the lane has no rows (quiet night / non-London),
  // onboarding is free to show as before.
  const tonightLaneHasRows =
    isLondon && whatsOnTonight.status === "ready" && whatsOnTonight.rows.length > 0;
  const tonightLanePending = isLondon && whatsOnTonight.status === "idle";
  // W3: curated crawl waits until first-map orientation (band-colour tour) is
  // done — at most one orientation surface after consent.
  const mapOrientationPending = !hasSeenTour();
  const showOnboarding =
    locationAllowsOnboarding &&
    shouldShowCuratedOnboarding({
      loaded,
      onboardingDismissed,
      arrivedWithCrawlParams: explicitArrivalIntent,
      mode,
      builtIdsCount: builtIds.length,
      hasActiveCrawl: Boolean(activeCrawl),
      selectedVenueId,
      showBandChip,
      curatedCrawlCount: cityCuratedCrawls.length,
      tonightLaneHasRows,
      tonightLanePending,
      mapOrientationPending,
    });
  // Show the first four curated crawls as the onboarding picks.
  const onboardingCrawls = cityCuratedCrawls.slice(0, 4);

  const plannerPanel = planningOpen ? (
    <>
      {mobileViewport && isLondon && suggestedPlanArea ? (
        <MobilePlanActivation
          cityId={cityId}
          initialNightArea={suggestedPlanArea.slug}
          venuesById={venuesById}
          onGenerated={applyGeneratedMobilePlan}
          mapRouteTransfer={flags.mapRouteTransfer}
        />
      ) : null}
      {!mobileViewport ? <button type="button" className="plannerMapButton" onClick={closePlanning}>
        <MapPinned size={16} aria-hidden="true" />
        View {mapDisplayName} map
      </button> : null}
      {/* One planner per surface. The rail is the DESKTOP planner: brand block,
          mode toggle, search box, featured routes and the full filter stack. The
          phone already owns every one of those in its own chrome (the one-bar
          search overlay, the Filters sheet, the Near me control) and opens its
          own "Describe the outing" form above, so mounting the rail here stacked
          a second planner under the first inside one bottom sheet. */}
      {!mobileViewport ? (
        <ControlRail
          mode={mode}
          onModeChange={setMode}
          filters={filters}
          onFiltersChange={setFilters}
          filteredVenues={filteredPubVenues}
          builtCount={builtIds.length}
          onClearBuilt={clearBuilt}
          onLoadCrawl={loadCuratedCrawl}
          onNearbyCrawl={startNearbyCrawl}
          nearbyLoading={nearbyLoading}
          nearbyError={nearbyError}
          savedOnly={savedOnly}
          onSavedOnlyChange={changeSavedOnly}
          curatedCrawls={cityCuratedCrawls}
          cityDisplayName={city.displayName}
          cityId={cityId}
        />
      ) : null}
      <RoutePanel
        mode={mode}
        crawlStyle={filters.crawlStyle}
        altStyle={altStyle}
        onAltStyleChange={setAltStyle}
        route={route}
        filteredVenues={filteredPubVenues}
        builtIds={builtIds}
        activeVenueId={selectedVenue?.id}
        venueSignals={venueSignals}
        crawlBlurb={activeCrawl?.blurb}
        crawlName={activeCrawl?.name}
        crawlId={activeCrawl?.id}
        routeMapped={routeMappedActive}
        originDistanceKm={distanceFromUserKm}
        onMapRoute={mapCurrentRoute}
        onHideRoute={hideMappedRoute}
        onCheckLastTrain={checkLastTrainAtRouteEnd}
        onSelectVenue={selectVenue}
        onToggleStop={toggleBuiltStop}
        onReverseRoute={reverseRoute}
        journeyByToIndex={journeyByToIndex}
        journeyLoading={journeyLoading}
        journeyTotalMinutes={journeyTotalMinutes}
        cityDisplayName={city.displayName}
        cityId={cityId}
        poisPath={city.poisPath}
        onRoundStarted={setActiveRoundStartedCode}
      >
        {loaded && filteredPubVenueCount === 0 ? (
          savedOnly && !hasSavedPub ? (
            <section className="venueInspector" style={{ textAlign: "center" }}>
              <p className="description" style={{ marginTop: 0 }}>
                {SAVED_ONLY_EMPTY_NOTE}
              </p>
              <button type="button" className="addStopBtn" onClick={() => changeSavedOnly(false)}>
                Show all pubs
              </button>
            </section>
          ) : (
            <section className="venueInspector" style={{ textAlign: "center" }}>
              <p className="description" style={{ marginTop: 0 }}>
                No pubs match these filters. Try widening your price or clearing your story filters.
              </p>
              <button type="button" className="addStopBtn" onClick={() => setFilters(seedCrawlState("").filters)}>
                Clear filters
              </button>
            </section>
          )
        ) : null}
      </RoutePanel>
    </>
  ) : null;

  function renderVenuePanel() {
    if (basePubOpen && selectedBasePub) {
      return (
        <UnverifiedPubSheet
          pub={selectedBasePub}
          communityPrices={communityPrices}
          experienceLens={experienceLens}
          drinkLensCategory={mapDrinkLensCategory}
        />
      );
    }
    if (!detailOpen || !selectedVenue) return null;
    const selectedLensPrice =
      activeLensPrices?.get(selectedVenue.id) ?? null;
    const showsAcceptedArrivalReceipt =
      acceptedArrivalSource !== null
      && selectedVenue.id === acceptanceQuery().selectedVenueId;
    const skeletonRevealRequest =
      venueRevealRequest?.venueId === selectedVenue.id &&
      !venueRevealRequest.interrupted
        ? venueRevealRequest
        : null;

    return (
      <>
        {showsAcceptedArrivalReceipt ? (
          <p className="venueAcceptanceReceipt" role="status">
            Kept for tonight. Make it Stop 1 when you are ready.
          </p>
        ) : null}
        <div className="mobileVenuePeekSummary" aria-label={selectedVenueLabels.summaryLabel}>
          {activeLensPrices !== null ? (
            <span>
              {selectedLensPrice ? (
                <PriceBadge>{formatPrice(selectedLensPrice.priceGbp)}</PriceBadge>
              ) : (
                <strong>Unknown</strong>
              )}
              <small>
                {selectedLensPrice?.categoryLabel ??
                  drinkLensUnknownRowLabel(
                    activeLensNoun?.toLowerCase() ?? "this view",
                    drinkIndexStatus,
                  )}
              </small>
            </span>
          ) : typeof selectedVenue.cheapestPrice === "number" ? (
            <span>
              <PriceBadge>{formatPrice(selectedVenue.cheapestPrice)}</PriceBadge>
              <small>current recorded price</small>
            </span>
          ) : selectedVenueIsPub ? (
            <button
              type="button"
              className="mobileVenuePeekDrop"
              onClick={openComposerForLog}
            >
              <strong>No price yet.</strong>
              <small>Be the first →</small>
            </button>
          ) : null}
          <span>
            <strong className="mobileVenuePeekNearMe">
              {userLocation
                ? `${Math.max(1, Math.ceil(haversineKm(
                    [userLocation.lng, userLocation.lat],
                    [selectedVenue.longitude, selectedVenue.latitude],
                  ) * 12.5))} min`
                : "Near me"}
            </strong>
            <small>{userLocation ? "walk" : "Turn on location for walk times"}</small>
          </span>
          {/* Adding a pub to the crawl you are building is a different capability
              from "Make it Stop 1", which starts one plan around one accepted
              pub. Keeping both is why the peek has three columns. */}
          {selectedVenueIsPub ? (
            <button
              type="button"
              aria-pressed={builtIds.includes(selectedVenue.id)}
              onClick={() => toggleBuiltStop(selectedVenue.id)}
            >
              {builtIds.includes(selectedVenue.id) ? "In plan" : "Plan stop"}
            </button>
          ) : null}
        </div>
        {selectedDetailStatus === "loading" ? (
          <VenueSheetSkeleton
            loadingLabel={selectedVenueLabels.loadingLabel}
            revealForm={skeletonRevealRequest?.form ?? null}
            revealStartedAt={skeletonRevealRequest?.startedAt ?? null}
          />
        ) : null}
        {selectedDetailStatus === "unavailable" ? (
          <div style={DETAIL_WARNING_STYLE} role="status">
            {selectedVenueLabels.unavailableLabel}
          </div>
        ) : null}
        <VenueInspector
          venue={selectedVenue}
          mode={mode}
          inCrawl={builtIds.includes(selectedVenue.id)}
          // The UNMERGED drop signal on purpose: the sheet gives every source its
          // own row, so the "Latest Pint Drop price" line must stay the Pint Drop
          // price. The community submission gets its own dated row alongside it.
          // Only the pins/list - which can show one number - take the merged one.
          latestContributorPrice={dropSignals.get(selectedVenue.id)?.latestContributorPrice}
          latestPintDropAt={dropSignals.get(selectedVenue.id)?.latestContributorAt}
          // Share copy prefers the MERGED map-authority figure (same seam as
          // pins), dated — never a sheet-only uncorroborated report.
          shareLoggedPintGbp={venueSignals.get(selectedVenue.id)?.latestContributorPrice}
          shareLoggedAt={venueSignals.get(selectedVenue.id)?.latestContributorAt ?? null}
          onToggleStop={toggleBuiltStop}
          onSelectVenue={selectVenue}
          onAcceptStop1={selectedVenueIsPub ? acceptStop1 : undefined}
          acceptanceError={acceptanceError}
          initialTab={venueInitialTab}
          pintDrops={pintDrops}
          communityPrices={communityPrices}
          experienceLens={experienceLens}
          drinkLensCategory={mapDrinkLensCategory}
          onGrabDragStart={mobileViewport ? undefined : onVenueSheetDragStart}
          onGrabDragMove={mobileViewport ? undefined : onVenueSheetDragMove}
          onGrabDragEnd={mobileViewport ? undefined : onVenueSheetDragEnd}
          revealRequest={
            venueRevealRequest?.venueId === selectedVenue.id
              ? venueRevealRequest
              : null
          }
          onInterruptReveal={interruptVenueReveal}
          onTabSelect={handleInspectorTabSelect}
          cityLandmarks={cityLandmarks}
          cityStoryBands={cityStoryBands}
          cityCuratedCrawls={cityCuratedCrawls}
          cityId={cityId}
          userLocation={venueJourneyLocation}
          locationRequestStatus={locationRequestStatus}
          onRequestLocation={requestVenueLocation}
          onClearLocation={clearVenueLocation}
          zoneIndex={zoneIndex}
          onLogged={refreshVenueDrops}
        />
      </>
    );
  }

  const venuePanel = renderVenuePanel();

  const mapLoadingActive = !mapCanvasErrored && mapLoadingHeld(mapLoadingStage);

  const mobileShellReady = !mapLoadingActive;
  // Desktop reader controls. Both live inside Layers rather than on the map
  // surface, which keeps its budget at search plus one toast. The phone reaches
  // the same two through the More sheet's Key and Prices tabs.
  const desktopLayersReaderKey = mobileViewport ? undefined : (
    <MapKey legend={activePriceLegend} />
  );
  const desktopLayersPriceFilter =
    !mobileViewport && experienceLens === "all" && activeLensLabel === null
      ? (close: () => void) => (
          <MapPriceFilterChips
            filters={filters}
            onFiltersChange={setFilters}
            onPicked={close}
          />
        )
      : undefined;
  const drinkFiltersActive = Boolean(
    favoritePint ||
      filters.drinkCategory ||
      filters.drinkBrand ||
      filters.drinkSubtype ||
      filters.topShelfOnly ||
      filters.requireCocktails,
  );

  return (
    <main id="main"
      className={
        // The `sheet-full` marker only ever matters ≤640px (mapToolbar.css
        // gates every rule that reads it behind that same breakpoint) — it
        // lets the map's floating controls (toolbar/legend) get out of the
        // way while the mobile sheet is at its most-expanded snap, per the
        // thumb-reach control pass (GH #17 user story 17).
        "appShell dark" +
        (planningOpen ? " planning-open" : "") +
        (detailOpen ? " detail-open" : "") +
        // sheet-full: hide floating map chrome when either mobile sheet is at
        // its most-expanded snap (venue detail OR planner). Peek/half keep
        // the map usable — chrome stays visible above the sheet.
        ((detailOpen && sheetSnap === "full") ||
        (planningOpen && plannerSheetSnap === "full")
          ? " sheet-full"
          : "") +
        (routeMappedActive ? " route-mapped" : "") +
        (!mobileViewport && showOnboarding ? " onboarding-open" : "")
      }
    >
      {!mobileViewport ? (
        <SiteNav
          active="map"
        />
      ) : null}

      {/* Full-bleed map is the base layer; every panel slides in over it.
          Named region so AT users get a landmark for the map surface (the
          canvas pins are pointer-only; List view provides their operable DOM
          parallel alongside search and the tonight lane). */}
      <section className="mapStage" aria-label={`Interactive pub map of ${mapDisplayName}`}>
        {/* Desktop only. On a phone these toggles are a section of the Filters
            sheet instead, so the map keeps the band the third chrome bar used
            to take (design judgement 2026-08-01, finding 2.3). */}
        {!baseLedChrome && !mobileViewport ? (
          <TonightArcChips
            visibility={venueKindVisibility}
            experienceLens={experienceLens}
            onChange={setVenueKindVisibility}
          />
        ) : null}
        {/* One toast at a time. A soft retry owns the surface outright, so the
            arrival and national-browse banners stand down with the selection
            note rather than stacking under it. */}
        {pickMapSurfaceToast({
          selectionNotice: selectionNotice !== null,
          selectionNoticePriority: arrivalSelectionNotice !== null,
          softRetry: mapSoftRetryActive,
        }) === "soft-retry" ? null : selectionNotice ? (
          <aside
            className="ukPlaceArrival"
            role="status"
            aria-live="polite"
            data-testid={
              selectionNotice === "unknown"
                ? "unknown-map-selection"
                : "map-selection-lookup-failed"
            }
          >
            <MapPinned className="ukPlaceArrivalIcon" size={18} aria-hidden="true" />
            <span className="ukPlaceArrivalCopy">
              <strong>
                {selectionNotice === "unknown"
                  ? UNKNOWN_MAP_SELECTION_NOTE
                  : MAP_SELECTION_LOOKUP_FAILED_NOTE}
              </strong>
            </span>
            <button
              type="button"
              className="ukPlaceArrivalDismiss"
              onClick={() => {
                setArrivalSelectionNotice(null);
                setSelectionNotice(null);
              }}
              aria-label="Dismiss pub lookup note"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </aside>
        ) : ukPlaceArrival ? (
          <UkPlaceArrivalBanner arrival={ukPlaceArrival} />
        ) : ukNationalBrowse ? (
          <UkNationalBrowseBanner variant="national" />
        ) : outsideCuratedBounds ? (
          <UkNationalBrowseBanner variant="outside" />
        ) : null}
        {/* Hold the pitched-London loading chrome until the canvas announces
            painted, tappable pins. A canvas error lifts it immediately so the
            fallback card is never hidden behind it. */}
        {mapLoadingActive ? (
          <MapLoadingFrame
            mapDisplayName={mapDisplayName}
            progress={mapLoadingProgress}
            openingLocationPromptActive={openingLocationPromptActive}
          />
        ) : null}
        {mapResumeUpdating ? (
          <span className="mapResumeUpdating" role="status" aria-live="polite">
            Updating map
          </span>
        ) : null}
        <PubMapCanvas
          venues={canvasVenues}
          interactionLocked={mobileViewport && showMapArrivalCard}
          venueDataReady={loaded && loadedCityId === cityId}
          // Clean first view stays route-free. Once the user maps a crawl, the
          // line remains visible even if the mobile planner closes.
          route={routeForMap}
          selectedVenueId={selectedVenueId}
          onVenueClick={handleVenueClick}
          onUkBasePubClick={handleUkBasePubClick}
          onUkBasePubsChange={setRenderedBasePubs}
          onUkBaseStatusChange={setUkBaseStatus}
          onUkBaseResidentPubsChange={setResidentUkBasePubs}
          onVisibleVenueIdsChange={handleVisibleVenueIdsChange}
          onRenderedStateChange={handleRenderedMapStateChange}
          venueListOpen={mapListOpen}
          ukBaseRestore={ukBaseRestore}
          onRouteStopClick={selectVenue}
          onVenuePrefetch={prefetchVenueDetail}
          venueSignals={venueSignals}
          favoritePint={favoritePint}
          drinkCategory={experienceLens === "all" ? filters.drinkCategory || null : null}
          whatsOnByVenue={whatsOnTonight.summary}
          provisionalVenueIds={provisionalVenueIds}
          lensPrices={activeLensPrices}
          lensNoun={activeLensNoun?.toLowerCase() ?? null}
          lensIndexStatus={drinkIndexStatus}
          activeBandId={activeBandId}
          onBandChange={setActiveBandId}
          onStartCrawl={startCrawlFromPubs}
          onAskPubmaxxer={askPubmaxxerAtPub}
          initialLandmarkId={seed.landmarkId}
          onLandmarkSelect={(landmark) => setActiveLandmarkId(landmark?.id ?? "")}
          onMapReady={handleMapCanvasReady}
          onMapErrored={setMapCanvasErrored}
          mapView={openingViewport
            ? withCityCameraAttitude(openingViewport, city.mapView)
            : locationFirstMapView}
          resumeViewport={mapResumeViewport}
          maxBounds={UK_BOUNDS}
          fitQueryOnArrival={shouldFitQueryVenuesOnArrival(arrivalSearch)}
          searchFitToken={searchFitToken}
          userLocation={userLocation}
          poisPath={city.poisPath}
          transitLinesPath={city.transitLinesPath}
          cityLandmarks={cityLandmarks}
          cityStoryBands={cityStoryBands}
          cityId={cityId}
          tonightOpportunities={tonightOpportunities}
          tonightOverlayVisible={isLondon && tonightOverlayVisible && !tonightDismissed}
          onTonightOpportunityClick={handleTonightOpportunityClick}
          poiHidden={poiHidden}
          onPoiHiddenChange={setPoiHidden}
          hideLayersControl={mobileViewport}
          layersReaderKey={desktopLayersReaderKey}
          layersReaderPriceFilter={desktopLayersPriceFilter}
          venueDataFailed={venueIndexFailed}
          onReloadVenueData={reloadVenueIndex}
          listOpen={mapListOpen}
          onListOpenChange={setMapListOpen}
          listCount={mapVenueListModel.total + ukBasePubListModel.total}
          onSoftRetryChange={setMapSoftRetryActive}
          focusPoint={openingLocationFocus ?? areaFocus}
          onViewportChange={setMapViewport}
          onUserCameraMove={dismissAmbientBanners}
          onBoundsChange={handleMapBoundsChange}
        />
        {!mobileViewport ? <MapToolbar
          cityLabel={mapChipLabel}
          outsideCurated={outsideCuratedBounds || ukNationalBrowse}
          query={filters.query}
          onQueryChange={changeMapSearchQuery}
          searchProps={{
            ...sharedMapSearchProps,
            id: "mapSearchInput",
            mode: "toolbar",
            placeholder: mapSearchPlaceholder,
          }}
          favoritePint={favoritePint}
          onFavoritePintChange={changeFavoritePint}
          drinkFiltersActive={drinkFiltersActive}
          drinkCategory={filters.drinkCategory}
          drinkBrand={filters.drinkBrand}
          onDrinkBrandChange={changeDrinkBrand}
          onDrinkLaneChange={changeDrinkLane}
          drinkLaneStatus={drinkIndexStatus}
          personaId={personaLensId}
          onPersonaSelect={selectPersona}
          personaTonightCategory={personaTonightCategory}
          planningOpen={planningOpen}
          detailOpen={detailOpen}
          desktopLaneActive={railViewport}
          onTogglePlanning={togglePlanning}
          filters={filters}
          onFiltersChange={setFilters}
          searchSettled={loaded && loadedCityId === cityId}
          filteredVenueCount={filteredVenueCount}
          searchableVenueCount={venues.length}
          zoneIndex={zoneIndex}
          cityId={cityId}
          onUseMyLocation={showNearbyMap}
          onOpenChooseArea={() => openChooseArea()}
          locationBusy={nearbyLoading}
          experienceLens={experienceLens}
          experienceSummary={experienceSummary}
          onExperienceLensChange={changeExperienceLens}
        /> : null}
        {/* D3.1/D3.2 desktop right-rail: always-on Conditions + Area news at the
            map's top-right. Mounted only at >=1024 and only while the RIGHT venue
            drawer is closed — the drawer owns that edge, so the rail steps aside
            and the toolbar chip carries Conditions instead (mapDesktopRail.css).
            The area is the Night Area under the current view (search-area first,
            else nearest to centre); AreaNewsRail fail-soft hides when it has none. */}
        {railViewport && !detailOpen ? (
          <MapDesktopRail area={searchAreaNewsArea ?? suggestedPlanArea?.slug ?? null} />
        ) : null}
        {/* Ambient banners dock under the control bar and step off the map the
            moment the reader moves the camera (design judgement 2026-08-01,
            finding 2.15). They used to park in the exact centre of the
            viewport, over the pins the map exists to show. */}
        {ambientBannerLane && !baseLedChrome ? (
          <CitySuggestBanner
            cityId={cityId}
            onLocationFound={setUserLocation}
          />
        ) : null}
        {ambientBannerLane && isLondon ? (
          <CityStatusBanner cityId={cityId} />
        ) : null}
        {/* F3: concierge as map home — a first-class grounded ask affordance in
            the bottom map-home lane. Rendered before the Tonight lane so its
            sibling CSS lifts the lane above the collapsed pill (no collision). */}
        {!mobileViewport && !ukPlaceArrival ? <MapConciergeAsk cityId={cityId} onSelectVenue={(id) => selectVenue(id)} /> : null}
        {!mobileViewport && isLondon ? (
          <TonightLane
            rows={whatsOnTonight.rows}
            asOf={whatsOnTonight.asOf}
            status={whatsOnTonight.status}
            open={tonightLaneOpen || tonightLaneForcedOpen}
            onOpenChange={(next) => {
              setTonightLaneOpen(next);
              if (!next && tonightDeepLinkKind) setDismissedTonightSrc(srcParam);
            }}
            near={userLocation}
            gardenCue={tonightLaneCue.gardenCue}
            initialKind={tonightLaneKind}
            onSelectVenue={(id) => selectVenue(id)}
            overlayCount={
              tonightStatus === "ready" && !tonightDismissed
                ? tonightOpportunities.length
                : 0
            }
            overlayActive={tonightOverlayVisible}
            onToggleOverlay={() =>
              setTonightOverlayVisible((visible) => !visible)
            }
            onDismissOverlay={dismissTonightOverlay}
          />
        ) : null}
        {!mobileViewport && logIntentFallbackVisible ? (
          <LogIntentFallback
            candidates={logNearbyCandidates}
            origin={logNearbyOrigin?.source ?? null}
            filteredPubVenueCount={filteredPubVenueCount}
            onPickVenue={pickLogNearbyVenue}
            onPrefetchVenue={prefetchVenueDetail}
            onFocusSearch={focusMapSearch}
            onResetFilters={resetLogIntentFilters}
            onDismiss={clearLogIntent}
          />
        ) : null}
        {!mobileViewport ? <ActiveRoundChip refreshKey={activeRoundStartedCode} /> : null}
        {!mobileViewport && routeMappedActive ? (
          <MappedRouteChip
            stopCount={route.length}
            totalKm={routeForMapLegs.totalKm}
            totalMinutes={routeForMapLegs.totalMinutes}
            onEdit={openPlanning}
            onCheckLastTrain={checkLastTrainAtRouteEnd}
            onHide={hideMappedRoute}
          />
        ) : null}
        {/* G3: Place story deep-link chip when `?band=` resolves. Distinct
            dismiss key from curated onboarding; suppresses that overlay while
            visible. */}
        {showBandChip ? (
          <BandOnboardingChip
            title={activeBand?.title ?? "Place story"}
            copy={activeBand?.copy ?? "Loading place story."}
            onWalkStory={dismissBandChip}
            onDismiss={dismissBandChip}
          />
        ) : null}
        {personaForCard ? (
          <PersonaLensCard
            persona={personaForCard}
            matchCount={
              personaHighlightsPubs(personaForCard) ? filteredPubVenueCount : undefined
            }
            onClose={() => selectPersona(null)}
          />
        ) : null}

        {/* A11Y #1 — keyboard/SR "List view": the DOM parallel to the canvas
            pins. Present on both viewports; selection drives the same
            selectVenue the pin tap does. Hidden by CSS while a sheet owns the
            map. */}
        <MapVenueList
          model={mapVenueListModel}
          ukBaseModel={ukBasePubListModel}
          ukBaseStatus={ukBaseStatus}
          cityName={mapContextName}
          open={mapListOpen}
          onOpenChange={setMapListOpen}
          loaded={
            loaded &&
            loadedCityId === cityId &&
            visibleVenueState?.cityId === cityId
          }
          onSelectVenue={selectVenue}
          onSelectUkBasePub={handleUkBasePubClick}
          onPrefetchVenue={prefetchVenueDetail}
          sortMode={mapListSortMode}
          onSortModeChange={setMapListSortMode}
          backLabel={mapListOpen && mapSurfaceId === "venue-list" ? mapSurfaceTrail.backLabel : null}
          onBack={mapSurfaceTrail.back}
          onHome={mapSurfaceTrail.home}
          homeTitle={`the ${mapDisplayName} map`}
        />

        {mobileShellReady ? (
        <MobileMapShell
          cityId={cityId}
          cityLabel={mapChipLabel}
          limitedCoverage={Boolean(ukPlaceArrival)}
          interactionLocked={showMapArrivalCard}
          overlay={mobileShellState.overlay}
          onOverlayChange={changeMapOverlay}
          backLabel={mapSurfaceTrail.backLabel}
          onBack={mapSurfaceTrail.back}
          onHome={mapSurfaceTrail.home}
          activeQuery={trimmedMapQuery}
          onClearQuery={clearMapQuery}
          onNearMe={showNearbyMap}
          nearMeStatus={nearbyLoading ? "requesting" : nearbyMapResultForView ? "ready" : nearbyError ? "error" : "idle"}
          nearMeError={nearbyError}
          onDismissNearMeError={() => setNearbyError(null)}
          nearbyCount={nearbyMapResultForView?.venueIds.length ?? 0}
          tonightCount={whatsOnTonight.rows.length}
          tonightNearReader={userLocation != null}
          tflCount={tflStatus.issueCount}
          tflStatus={tflStatus.failed ? "unavailable" : !tflStatus.payload ? "checking" : tflStatus.issueCount ? "issues" : "clear"}
          priceLabel={filters.maxPrice < NO_PINT_PRICE_CAP ? `≤£${filters.maxPrice.toFixed(2)}` : "Price"}
          drinkFiltersActive={drinkFiltersActive}
          drinkLaneLabel={drinkLaneLabel(activeMapDrinkLane)}
          drinkLaneSelected={activeMapDrinkLane !== DEFAULT_DRINK_LANE}
          experienceFilterLabel={
            experienceLens === "no-alcohol"
              ? "no-alcohol view"
              : experienceLens === "food"
                ? "food view"
                : undefined
          }
          zoneActive={
            experienceLens === "all" &&
            filters.zone !== "" &&
            filters.zone !== "all"
          }
          openNowActive={filters.openNow}
          savedOnlyActive={savedOnly}
          priceCapActive={
            experienceLens === "all" &&
            mapDrinkLensCategory === null &&
            filters.maxPrice < NO_PINT_PRICE_CAP
          }
          planOpen={planningOpen}
          planActive={routeMappedActive || activePlanRoute.length >= 2}
          planStopCount={routeMappedActive ? route.length : activePlanRoute.length}
          planInteractive={mobileViewport && !ukPlaceArrival}
          venueListOpen={mapListOpen}
          bandNoticeOpen={showBandChip}
          onPlan={openPlanning}
          searchProps={{
            ...sharedMapSearchProps,
            id: "mobileMapSearchInput",
            mode: "overlay",
            placeholder: mapSearchPlaceholder,
            onClose: () => changeMapOverlay("none"),
          }}
          filtersContent={
            <div className="mobileMapFilters">
              <MapExperienceLensControl
                lens={experienceLens}
                allSelected={!drinkFiltersActive}
                summary={experienceSummary}
                onChange={changeExperienceLens}
              />
              {/* The phone's only copy of the venue-type toggles. */}
              <TonightArcChips
                visibility={venueKindVisibility}
                experienceLens={experienceLens}
                variant="sheet"
                onChange={setVenueKindVisibility}
              />
              {/* Same Saved only field as the desktop ControlRail — narrows the
                  map to this device's saved pubs. Empty state when nothing is
                  saved yet points at Save on a pub sheet. */}
              <section className="toggles mobileMapSavedOnly">
                <label aria-label={SAVED_ONLY_ARIA_LABEL} style={{ minHeight: 44 }}>
                  <input
                    type="checkbox"
                    checked={savedOnly}
                    onChange={(event) => changeSavedOnly(event.target.checked)}
                  />
                  Saved only
                </label>
                {savedOnly && !hasSavedPub ? (
                  <div className="mobileMapSavedOnlyEmpty" role="status">
                    <p>{SAVED_ONLY_EMPTY_NOTE}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => changeSavedOnly(false)}
                    >
                      Show all pubs
                    </Button>
                  </div>
                ) : null}
              </section>
              {experienceLens === "all" ? (
                <>
                  <DrinkShapeChips filters={filters} onFiltersChange={setFilters} />
                  {isLondon ? (
                    <ZonePicker
                      variant="inline"
                      zone={filters.zone}
                      onZoneChange={(zone) => setFilters((current) => ({ ...current, zone }))}
                      index={zoneIndex}
                    />
                  ) : null}
                  {/* Brand is a pint refinement. The drink itself is chosen on
                      the map's own lane chip, never in this drawer. */}
                  {activeMapDrinkLane === DEFAULT_DRINK_LANE ? (
                    <FavoritePintPicker
                      value={favoritePint}
                      onChange={changeFavoritePint}
                      drinkBrand={filters.drinkBrand}
                      onDrinkBrandChange={changeDrinkBrand}
                    />
                  ) : null}
                  <PersonaLensPicker
                    personaId={personaLensId}
                    onSelect={selectPersona}
                    tonightCategory={personaTonightCategory}
                  />
                </>
              ) : null}
              <MobilePriceChoices
                maxPrice={filters.maxPrice}
                legend={activePriceLegend}
                drinkLabel={activeLensLabel ?? undefined}
                onMaxPriceChange={(maxPrice) =>
                  setFilters((current) => ({ ...current, maxPrice }))
                }
              />
              <label className="mobileMapFilterToggle">
                <input
                  type="checkbox"
                  checked={filters.openNow}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      openNow: event.target.checked,
                    }))
                  }
                />
                <span>
                  <strong>Open now</strong>
                  {filters.openNow ? (
                    <small>{OPEN_NOW_FILTER_CAPTION}</small>
                  ) : (
                    <small>Hide pubs we know are closed. Pubs without hours stay visible.</small>
                  )}
                </span>
              </label>
            </div>
          }
          drinkContent={
            <DrinkLanePicker
              lane={activeMapDrinkLane}
              status={drinkIndexStatus}
              variant="sheet"
              onChange={(lane) => {
                changeDrinkLane(lane);
                // An experience view stands the drink lane down, so picking a
                // drink has to hand the map back to All or the tap does nothing
                // a reader can see.
                if (experienceLens !== "all") changeExperienceLens("all");
              }}
            />
          }
          tflContent={<MobileTflPanel status={tflStatus} />}
          tonightContent={
            <TonightLane
              rows={whatsOnTonight.rows}
              asOf={whatsOnTonight.asOf}
              status={whatsOnTonight.status}
              open
              variant="sheet"
              onOpenChange={() => undefined}
              near={userLocation}
              gardenCue={tonightLaneCue.gardenCue}
              initialKind={tonightLaneKind}
              onSelectVenue={selectVenue}
              overlayCount={tonightStatus === "ready" && !tonightDismissed ? tonightOpportunities.length : 0}
              overlayActive={tonightOverlayVisible}
              onToggleOverlay={() => setTonightOverlayVisible((visible) => !visible)}
              onDismissOverlay={dismissTonightOverlay}
            />
          }
          layersContent={
            <Tabs className="mobileLayersPanel" value={mobileLayersTab} onValueChange={(value) => setMobileLayersTab(value as typeof mobileLayersTab)}>
              <TabsList
                className="mobileMapControlTabs"
                aria-label="Map control sections"
              >
                <TabsTrigger value="key">Key</TabsTrigger>
                <TabsTrigger value="layers">Layers</TabsTrigger>
                {experienceLens === "all" ? (
                  <TabsTrigger value="prices">Prices</TabsTrigger>
                ) : null}
                <TabsTrigger value="events">Events</TabsTrigger>
                <TabsTrigger value="transit">Transit</TabsTrigger>
              </TabsList>
              <TabsContent value="key" className="mobileLayersPanel">
                <MapKey legend={activePriceLegend} />
              </TabsContent>
              <TabsContent value="layers" className="mobileLayersPanel">
                <div className="mobileLayerShortcuts">
                  <Button className="mobilePlannerLaunch w-full justify-start" onClick={openPlanning}>
                    <MapPinned size={18} aria-hidden="true" />
                    Plan an outing
                  </Button>
                  {isLondon ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full justify-start"
                      aria-label="On tonight near you"
                      onClick={() => changeMapOverlay("tonight")}
                    >
                      <CalendarClock size={18} aria-hidden="true" />
                      On tonight
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full justify-start"
                    aria-label="List view of venues on the map"
                    aria-pressed={mapListOpen}
                    onClick={() => {
                      setMapListOpen((open) => !open);
                      changeMapOverlay("none");
                    }}
                  >
                    <List size={18} aria-hidden="true" />
                    {mapListOpen ? "Hide venue list" : "List view"}
                  </Button>
                  {/* Pub Pal left the one top bar so the place name beside the
                      wordmark stays whole (finding 2.3). It keeps a named
                      shortcut here, beside the map's other destinations. */}
                  <Button
                    asChild
                    variant="secondary"
                    className="w-full justify-start"
                  >
                    <Link href="/pal">
                      <PubPalMascot size={18} circular />
                      Ask your Pub Pal
                    </Link>
                  </Button>
                </div>
                {routeMappedActive ? <Button variant="secondary" onClick={hideMappedRoute}>Hide active route</Button> : null}
                <div className="mobileLayersTheme">
                  <div><strong>Map appearance</strong><small>Theme changes preserve this view and its active sheet.</small></div>
                  <ThemeToggle />
                </div>
                <MapLayersControl embedded poiHidden={poiHidden} onPoiHiddenChange={setPoiHidden} activeBandId={activeBandId} onBandChange={setActiveBandId} storyBands={cityStoryBands} cityId={cityId} />
              </TabsContent>
              {experienceLens === "all" ? (
                <TabsContent value="prices" className="mobileMapFilters">
                  <DrinkShapeChips filters={filters} onFiltersChange={setFilters} />
                  {activeMapDrinkLane === DEFAULT_DRINK_LANE ? (
                    <FavoritePintPicker value={favoritePint} onChange={changeFavoritePint} drinkBrand={filters.drinkBrand} onDrinkBrandChange={changeDrinkBrand} />
                  ) : null}
                  <MobilePriceChoices
                    maxPrice={filters.maxPrice}
                    legend={activePriceLegend}
                    drinkLabel={activeLensLabel ?? undefined}
                    onMaxPriceChange={(maxPrice) =>
                      setFilters((current) => ({ ...current, maxPrice }))
                    }
                  />
                </TabsContent>
              ) : null}
              <TabsContent value="events">
                <TonightLane
                  rows={whatsOnTonight.rows}
                  asOf={whatsOnTonight.asOf}
                  status={whatsOnTonight.status}
                  open
                  variant="sheet"
                  onOpenChange={() => undefined}
                  near={userLocation}
                  gardenCue={tonightLaneCue.gardenCue}
                  initialKind={tonightLaneKind}
                  onSelectVenue={selectVenue}
                  overlayCount={tonightStatus === "ready" && !tonightDismissed ? tonightOpportunities.length : 0}
                  overlayActive={tonightOverlayVisible}
                  onToggleOverlay={() => setTonightOverlayVisible((visible) => !visible)}
                  onDismissOverlay={dismissTonightOverlay}
                />
              </TabsContent>
              <TabsContent value="transit"><MobileTflPanel status={tflStatus} /></TabsContent>
            </Tabs>
          }
          palContent={
            <div className="mobilePalSummon">
              <PubPalMascot size={64} circular />
              <h3>Your Pub Pal is ready</h3>
              <p>Ask for a grounded pub pick, a bit of lore, or help shaping tonight.</p>
              <Link href="/pal">Open Pub Pal</Link>
              <small><ShieldCheck size={14} aria-hidden="true" /> It never changes a plan or posts a memory without confirmation.</small>
            </div>
          }
          momentContent={
            <LogIntentFallback
              candidates={logNearbyCandidates}
              origin={logNearbyOrigin?.source ?? null}
              filteredPubVenueCount={filteredPubVenueCount}
              onPickVenue={pickLogNearbyVenue}
              onPrefetchVenue={prefetchVenueDetail}
              onFocusSearch={() => {
                changeMapOverlay("search");
                requestAnimationFrame(focusMapSearch);
              }}
              onResetFilters={resetLogIntentFilters}
            />
          }
          nearMeContent={
            mapOverlay === "near-me" ? (
              <NearMeNow
                cityId={cityId}
                onSelectVenue={selectVenue}
                titledByHost
                initialLocation={userLocation}
                venues={filteredPubVenues.map((venue) => ({
                  id: venue.id,
                  name: venue.name,
                  lat: venue.latitude,
                  lng: venue.longitude,
                  cheapestPrice: venue.cheapestPrice,
                  borough: venue.primaryBorough,
                }))}
              />
            ) : null
          }
          chooseAreaContent={chooseAreaSheet}
          sheetsEnabled={mobileViewport}
          areaContent={
            <AreaSheet
              cityId={cityId}
              area={searchAreaTarget ? (searchAreaTarget.kind === "area" ? searchAreaTarget.area : null) : centreArea}
              placeFocus={searchAreaTarget?.kind === "place" ? searchAreaTarget : null}
              venues={pubVenues}
              lensPrices={drinkLensPrices}
              drinkCategory={mapDrinkLensCategory}
              lensStatus={drinkIndexStatus}
              distanceFrom={areaSheetDistanceFrom}
              onSelectVenue={selectVenue}
              onFlyToArea={flyToArea}
              /* The map's one Near me path. On success it opens the near-me
                 sheet over this one; on failure nearbyError lands in the
                 sheet, because the alert under the chip is behind it. */
              onUseMyLocation={showNearbyMap}
              locationBusy={nearbyLoading}
              locationNote={nearbyError}
              baseLed={baseLedChrome}
              onClose={() => changeMapOverlay("none")}
            />
          }
        />
        ) : null}

        {showMapArrivalCard ? (
          <MapArrivalCard
            onUseLocation={useLocationFromArrivalCard}
            onChooseArea={() => openChooseArea()}
          />
        ) : null}
        <ChooseAreaDesktopDialog
          open={!mobileViewport && mapOverlay === "choose-area"}
          onClose={() => changeMapOverlay("none")}
        >
          {chooseAreaSheet}
        </ChooseAreaDesktopDialog>

        {/* §4.5 onboarding overlay: a dismissible "Start with a story" card that
            offers curated crawls on a clean first paint. It's the mobile
            onboarding (control rail is hidden on small screens) and never blocks
            the map — the backdrop and the link both close it. */}
        {!mobileViewport && showOnboarding ? (
          <MapOnboardingOverlay
            crawls={onboardingCrawls}
            onLoadCrawl={loadCuratedCrawl}
            onDismiss={dismissOnboarding}
          />
        ) : null}
      </section>

      {mobileViewport ? (
        <Sheet
          kind={detailOpen ? "venue" : planningOpen ? "planner" : null}
          title={
            detailOpen
              ? basePubOpen
                ? selectedBasePub?.name ?? "Pub detail"
                : selectedVenue?.name ?? selectedVenueLabels.detailLabel
              : "Plan an outing"
          }
          initialSnap="half"
          requestedSnap={detailOpen ? sheetSnap : plannerSheetSnap}
          onClose={mapSurfaceTrail.home}
          onDismiss={mapSurfaceTrail.backLabel ? mapSurfaceTrail.back : mapSurfaceTrail.home}
          closeLabel={detailOpen ? selectedVenueLabels.closeLabel : undefined}
          backLabel={mapSurfaceTrail.backLabel}
          onBack={mapSurfaceTrail.back}
          entranceOvershoot={detailOpen && venueEntranceOvershoot}
          onInterruptReveal={interruptVenueReveal}
          venueRevealSettleSequence={venueRevealSettleSequence}
        >
          {detailOpen ? venuePanel : plannerPanel}
        </Sheet>
      ) : null}

      {/* Left drawer: the whole crawl planner, on demand.
          On mobile (≤640px) this is a drag bottom-sheet with the same snap
          points as the venue sheet (peek/half/full — lib/sheetSnap.ts). Opens
          at half so the map stays partially visible. Desktop is unchanged —
          side drawer, no gesture. */}
      {!mobileViewport ? <SpringDrawer
        open={planningOpen}
        side="left"
        snap={plannerSheetSnap}
        dragOffsetY={plannerSheetDragY}
        releaseVelocityY={plannerSheetReleaseVelocity}
        keepMounted={mapSurfaceTrail.holdsSurface("planner")}
        fade
        className={
          "mapDrawer left" +
          (plannerSheetDragY !== null ? " sheet-dragging" : "")
        }
        aria-hidden={!planningOpen}
        aria-modal={planningOpen && plannerSheetSnap === "full" ? true : undefined}
        role={planningOpen && plannerSheetSnap === "full" ? "dialog" : undefined}
        aria-label={planningOpen && plannerSheetSnap === "full" ? "Crawl planner" : undefined}
      >
        <div
          className="mapDrawerHead sheetDragHandle plannerSheetHead"
          onPointerDown={onPlannerSheetDragStart}
          onPointerMove={onPlannerSheetDragMove}
          onPointerUp={onPlannerSheetDragEnd}
          onPointerCancel={onPlannerSheetDragEnd}
        >
          <span className="venueSheetGrabZone" aria-hidden="true">
            <span className="venueSheetGrab" />
          </span>
          {/* The planner used to have no way out of its own head at all: the
              reader had to find "View the map" inside the body. Same pair, same
              places, as every other surface. */}
          <SurfaceNav
            backLabel={mapSurfaceTrail.backLabel}
            onBack={mapSurfaceTrail.back}
            homeLabel={homeActionLabel(`the ${mapDisplayName} map`)}
            onHome={mapSurfaceTrail.home}
          />
        </div>
        {plannerPanel}
      </SpringDrawer> : null}

      {/* Right drawer: the selected pub's detail — opens only on an explicit pick.
          On mobile (≤640px) this is a true drag bottom-sheet with snap points
          (peek/half/full — lib/sheetSnap.ts). The snap class drives the resting
          transform in CSS; sheetDragY (a live px offset) only exists mid-drag, so
          a release always lands back on a snap-driven spring, never a
          hand-picked pixel position. Desktop ignores both — no drag handlers
          fire above the gesture breakpoint, and the extra classes/attrs are
          no-ops there (see venueSheet.css / globals.css .mapDrawer rules). */}
      {!mobileViewport ? <SpringDrawer
        ref={detailDrawerRef}
        open={detailOpen}
        side="right"
        snap={sheetSnap}
        dragOffsetY={sheetDragY}
        releaseVelocityY={sheetReleaseVelocity}
        entranceOvershoot={detailOpen && venueEntranceOvershoot}
        onScroll={interruptVenueReveal}
        fade
        className={
          "mapDrawer right" +
          (sheetDragY !== null ? " sheet-dragging" : "")
        }
        aria-hidden={!detailOpen}
        aria-modal={detailOpen ? true : undefined}
        role={detailOpen ? "dialog" : undefined}
        aria-label={detailOpen ? selectedVenueLabels.detailLabel : undefined}
      >
        <div
          className="mapDrawerHead sheetDragHandle"
          onPointerDown={onVenueSheetDragStart}
          onPointerMove={onVenueSheetDragMove}
          onPointerUp={onVenueSheetDragEnd}
          onPointerCancel={onVenueSheetDragEnd}
        >
          {/* Finding 2.16: this close used to be a bordered box that drew a
              coral ring on hover, so the way out shouted louder than the pub's
              name. SurfaceNav is quiet, and it brings the Back the venue sheet
              never had. */}
          <SurfaceNav
            backLabel={mapSurfaceTrail.backLabel}
            onBack={mapSurfaceTrail.back}
            homeLabel={
              mapSurfaceTrail.backLabel
                ? homeActionLabel(`the ${mapDisplayName} map`)
                : selectedVenueLabels.closeLabel
            }
            onHome={mapSurfaceTrail.home}
            closeRef={drawerCloseButtonRef}
          />
        </div>
        {venuePanel}
      </SpringDrawer> : null}
    </main>
  );
}
