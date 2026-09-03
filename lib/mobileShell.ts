import type { Filters } from "@/lib/venues";
import { parseCityId, type CityId } from "@/lib/cities";
import { parsePoiHidden, type PoiHidden } from "@/lib/poiToggleGroups";
import { parseDrinkCategoryParam } from "@/lib/drinkBrands";
import { parseDrinkSubtypeParam } from "@/lib/drinkSubtypes";
import type { SheetSnap } from "@/lib/sheetSnap";
import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";

export type MapOverlay =
  | "none"
  | "search"
  | "filters"
  | "drink"
  | "tfl"
  | "tonight"
  | "layers"
  | "venue"
  | "planner"
  | "pub-pal"
  | "moment"
  | "near-me"
  | "area"
  | "choose-area";

export type MapSheetKind = Exclude<MapOverlay, "none" | "search">;
export type MapSheetDetent = SheetSnap;

/**
 * What each contextual sheet's chrome prints, and the dialog's accessible name.
 *
 * The chrome owns the ONE heading a sheet gets, so a body must not print the
 * same line again below it. That makes a title here a promise: it has to be
 * true in every state its body can reach. "Near me" is the near-me title for
 * exactly that reason. That body answers "near you", "a bit further out", or a
 * borough the reader picked, so no single one of the three may sit in the
 * chrome. `__tests__/mapSheetHeadings.test.ts` holds the pair apart.
 */
export const MAP_SHEET_TITLES: Partial<Record<MapSheetKind, string>> = {
  filters: "Prices and places",
  // The drink the map is under. Its own sheet, not a section of Filters: a
  // cocktail map is a different map, and a reader may not have to open a
  // refinement drawer to find out which prices the pins are showing.
  drink: "Drink",
  tfl: "TfL live",
  tonight: "Tonight",
  layers: "Map controls",
  "pub-pal": "Pub Pal",
  moment: "Choose a pub",
  "near-me": "Near me",
  area: "This area",
  "choose-area": "Choose an area",
};

export type MapViewportSnapshot = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

export type NearbyMapResult = {
  location: { lat: number; lng: number };
  venueIds: string[];
  /** The ring answered from — NEAR_ME_MAP_RADIUS_KM, the sheet's own walk ring. */
  radiusKm: number;
  strategy: "within-radius" | "nearest-20";
};

export type MobileShellState = {
  overlay: MapOverlay;
  viewport: MapViewportSnapshot | null;
  selectedVenueId: string | null;
  cityId: CityId;
  nightArea: NightAreaSlug | null;
};

export type MobileMapSessionV1 = {
  version: 1;
  savedAt: string;
  viewport: MapViewportSnapshot | null;
  filters: Filters;
  cityId: CityId;
  nightArea: NightAreaSlug | null;
  selectedVenueId: string | null;
  /**
   * Layers-chip choices (POI category → hidden). Null when the session
   * pre-dates this field or the stored shape drifted - the map then falls back
   * to viewport defaults rather than discarding the whole saved session.
   */
  poiHidden: PoiHidden | null;
  openSheet: MapSheetKind | null;
};

export const MOBILE_MAP_SESSION_KEY = "pubmaxx.mobile-map-session.v1";

/** Fired before primary-tab navigation so open map sheets can dismiss first. */
export const MOBILE_SHEET_DISMISS_EVENT = "pubmax:mobile-sheet-dismiss";

export function requestMobileSheetDismiss(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MOBILE_SHEET_DISMISS_EVENT));
}

const RESTORABLE_SHEETS = new Set<MapSheetKind>([
  "filters",
  "tfl",
  "tonight",
  "layers",
  "venue",
  "planner",
  "pub-pal",
]);
const CRAWL_STYLES = new Set([
  "balanced",
  "cheapest",
  "heritage",
  "writerTrail",
  "beerGarden",
  "sports",
  "dateNight",
  "noAlcoholFirst",
]);
const FILTER_BOOLEAN_KEYS = [
  "requireBeerGarden",
  "requireNonAlcoholic",
  "requireLiveSports",
  "requireFood",
  "requireCocktails",
  "requireWater",
  "requireHeritage",
  "requirePintDrops",
  "canonicalOnly",
  "requireStepFree",
  "requireAccessibleToilet",
  "requireSeatedService",
] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNightAreaSlug(value: unknown): value is NightAreaSlug {
  return typeof value === "string" && (NIGHT_AREA_SLUGS as readonly string[]).includes(value);
}

export function validateMapViewport(value: unknown): MapViewportSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<MapViewportSnapshot>;
  if (!Array.isArray(raw.center) || raw.center.length !== 2) return null;
  if (![...raw.center, raw.zoom, raw.pitch, raw.bearing].every(finite)) return null;
  const [lng, lat] = raw.center;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  if ((raw.zoom ?? -1) < 0 || (raw.zoom ?? 99) > 24) return null;
  return {
    center: [lng, lat],
    zoom: raw.zoom!,
    pitch: Math.max(0, Math.min(85, raw.pitch!)),
    bearing: raw.bearing!,
  };
}

/**
 * Re-adopt the city's designed camera attitude for a dead-flat saved viewport.
 *
 * Pitch/bearing are PRESENTATION, not intent: every programmatic fitBounds used
 * to zero the bearing, and the flattened camera then round-tripped through the
 * saved session forever — so the designed pitched, slightly-rotated city view
 * (e.g. London's pitch 38 / bearing -8) never came back. A snapshot that is
 * exactly pitch 0 AND bearing 0 is overwhelmingly that artefact, not a choice,
 * so it upgrades to the city's designed attitude; any other saved attitude
 * (a user's own rotation or tilt) is preserved untouched.
 */
export function withCityCameraAttitude(
  viewport: MapViewportSnapshot,
  cityView: { pitch?: number; bearing?: number },
): MapViewportSnapshot {
  if (viewport.pitch !== 0 || viewport.bearing !== 0) return viewport;
  const pitch = cityView.pitch ?? 0;
  const bearing = cityView.bearing ?? 0;
  if (pitch === 0 && bearing === 0) return viewport;
  return { ...viewport, pitch, bearing };
}

export function validateMobileMapFilters(value: unknown): Filters | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Filters>;
  if (
    typeof raw.query !== "string" ||
    typeof raw.drinkCategory !== "string" ||
    typeof raw.drinkBrand !== "string" ||
    !finite(raw.maxPrice) || raw.maxPrice < 0 || raw.maxPrice > 100 ||
    !finite(raw.stopCount) || raw.stopCount < 1 || raw.stopCount > 20 ||
    !finite(raw.routeWindow) || raw.routeWindow < 1 || raw.routeWindow > 120 ||
    typeof raw.crawlStyle !== "string" || !CRAWL_STYLES.has(raw.crawlStyle) ||
    !FILTER_BOOLEAN_KEYS.every((key) => typeof raw[key] === "boolean")
  ) return null;
  // Drink-subtype lens fields post-date this store, so a session saved before
  // they existed is UPGRADED (to the off state) rather than discarded — losing
  // a user's whole saved map because the schema grew would be the wrong trade.
  const category = parseDrinkCategoryParam(raw.drinkCategory);
  const subtype = category
    ? parseDrinkSubtypeParam(raw.drinkSubtype, category)
    : null;
  return {
    ...(raw as Filters),
    // A session saved when a category was still lensable must not restore it as
    // an invisible filter: the picker could neither show nor clear it.
    drinkCategory: category ?? "",
    drinkSubtype: subtype?.id ?? "",
    topShelfOnly: raw.topShelfOnly === true && Boolean(category),
    // Open-now post-dates older sessions; upgrade missing to off rather than
    // discarding the whole saved map.
    openNow: raw.openNow === true,
  };
}

export function readMobileMapSession(): MobileMapSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(MOBILE_MAP_SESSION_KEY) ?? "null") as Partial<MobileMapSessionV1> | null;
    const cityId = parseCityId(raw?.cityId);
    const filters = validateMobileMapFilters(raw?.filters);
    if (!raw || raw.version !== 1 || !filters || !cityId) return null;
    return {
      version: 1,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString(),
      viewport: validateMapViewport(raw.viewport),
      filters,
      cityId,
      nightArea: isNightAreaSlug(raw.nightArea) ? raw.nightArea : null,
      selectedVenueId: typeof raw.selectedVenueId === "string" ? raw.selectedVenueId : null,
      poiHidden: parsePoiHidden(raw.poiHidden),
      openSheet: typeof raw.openSheet === "string" && RESTORABLE_SHEETS.has(raw.openSheet as MapSheetKind)
        ? (raw.openSheet as MapSheetKind)
        : null,
    };
  } catch {
    return null;
  }
}

export function writeMobileMapSession(value: Omit<MobileMapSessionV1, "version" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify({
      ...value,
      version: 1,
      savedAt: new Date().toISOString(),
    } satisfies MobileMapSessionV1));
  } catch {
    // Cross-tab recovery is best-effort in private/quota-constrained browsers.
  }
}
