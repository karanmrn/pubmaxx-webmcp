// Pure derivations behind the map's Area button (the top-bar control that names
// the Night Area under the map centre and opens a sheet of that area's cheapest
// pints + a "go somewhere else" grid).
//
// House pattern (see lib/mapVenueList.ts): all the logic lives here, hermetic
// and node-testable, so the React shell in components/map/AreaButton.tsx is a
// thin render over these models. No fs, no serverEnv, no route imports — safe
// to import on the client and to unit test without a DOM.

import type { CityId } from "@/lib/cities";
import type { MapChosenAreaSelection } from "@/lib/mapChosenArea";
import { haversineKm } from "@/lib/haversine";
import {
  drinkLensUnknownRowLabel,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import {
  getNightAreasForCity,
  isNightAreaRouteReady,
  type NightArea,
} from "@/lib/nightAreas";
import type { MapBounds } from "@/lib/slimShards";
import type { Venue } from "@/lib/venues";

/** Top of the area's pub list — the ten cheapest, mirroring the plan intake. */
export const AREA_PUB_LIMIT = 10;

/**
 * How many of those rows the SHEET prints before it hands over to the picker.
 *
 * The sheet answers two questions: what is cheap here, and how do I go
 * somewhere else. Printing all ten rows answered the first and pushed the
 * second about 650 px below the fold on a 390x844 phone, so a reader looking
 * for "change my area" met a price list and gave up. That became load-bearing
 * when a failed Near me started offering "Pick an area" as its way on.
 *
 * Three rows is the lead: enough to read as an answer, short enough that the
 * picker's own heading lands inside the first screen. The rest are not hidden.
 * They are on the map, which is the product, and the row under the lead names
 * how many are left and takes the reader there.
 */
export const AREA_SHEET_LEAD_ROWS = 3;

/** What the row under the lead says: it names the rest rather than implying
 *  the lead is all of them. */
export function areaSheetOverflowLabel(total: number): string {
  const rest = Math.max(0, total - AREA_SHEET_LEAD_ROWS);
  if (rest <= 0) return "See all on the map";
  return rest === 1 ? "See the other one on the map" : `See the other ${rest} on the map`;
}

/**
 * Radius of the ad-hoc "area" the sheet derives around a locality/borough
 * centroid — the place a map-search result flies to that is NOT one of the
 * modelled Night Areas. A modelled area carries its own `radiusKm`; a plain
 * place does not, so search borrows this tight, walkable ring (~a 15-minute
 * stroll) to gather the pubs the arrival should show.
 */
export const LOCALITY_RADIUS_KM = 1.2;

/** Default camera zoom a modelled-area fly settles on when the option names no
 *  deeper zoom of its own (a locality search result flies a notch deeper). */
export const DEFAULT_AREA_FLY_ZOOM = 14;

/**
 * How long the Area sheet waits after a search-driven fly before it opens, so
 * the pubs appear AS the camera settles rather than mid-flight. Mirrors the
 * cinematic fly duration the canvas uses for an area focus. Reduced-motion
 * jumps the camera instantly, so the sheet opens on the next tick instead.
 */
export const AREA_SHEET_SETTLE_MS = 900;

/** The delay before the Area sheet opens after a search select: the fly's
 *  settle time normally, ~immediate (0) when the camera jumps under
 *  reduced-motion so the pubs never trail an instant camera. */
export function areaSheetOpenDelay(reducedMotion: boolean): number {
  return reducedMotion ? 0 : AREA_SHEET_SETTLE_MS;
}

/**
 * The Night Area whose region contains the map centre.
 *
 * A Night Area's region is the circle of `radiusKm` around its `centre`. When
 * the centre point sits inside more than one region the nearest area centre
 * wins; when it sits between areas (inside none) we fall back to the nearest
 * area overall, so the label is never blank while panning open country. Invalid
 * coordinates and cities with no modelled areas return null.
 */
export function areaUnderCentre(
  cityId: CityId,
  center: [number, number],
): NightArea | null {
  const [lng, lat] = center;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const areas = getNightAreasForCity(cityId);
  if (areas.length === 0) return null;

  let containing: NightArea | null = null;
  let containingKm = Number.POSITIVE_INFINITY;
  let nearest: NightArea | null = null;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    const km = haversineKm([lng, lat], [area.centre.lng, area.centre.lat]);
    if (km < nearestKm) {
      nearest = area;
      nearestKm = km;
    }
    if (km <= area.radiusKm && km < containingKm) {
      containing = area;
      containingKm = km;
    }
  }
  return containing ?? nearest;
}

/**
 * How far the view may reach past the named area and still be "over" it,
 * measured as a multiple of that area's own radius.
 *
 * A view four times the area's reach shows a region the area does not own, so
 * the name would be a claim about ground the reader can see is elsewhere.
 */
const CLAIM_MAX_VIEW_RADIUS_MULTIPLE = 2;

function boundsAreUsable(bounds: MapBounds): boolean {
  return [bounds.west, bounds.east, bounds.south, bounds.north].every((edge) =>
    Number.isFinite(edge),
  );
}

function centreIsInView(area: NightArea, bounds: MapBounds): boolean {
  return (
    area.centre.lng >= bounds.west &&
    area.centre.lng <= bounds.east &&
    area.centre.lat >= bounds.south &&
    area.centre.lat <= bounds.north
  );
}

/** Half the visible diagonal: how far the view reaches from its own centre. */
function viewReachKm(center: [number, number], bounds: MapBounds): number {
  return Math.max(
    haversineKm(center, [bounds.west, bounds.north]),
    haversineKm(center, [bounds.east, bounds.north]),
    haversineKm(center, [bounds.west, bounds.south]),
    haversineKm(center, [bounds.east, bounds.south]),
  );
}

/**
 * The Night Area the VIEW may be named after, or null when it may name none.
 *
 * areaUnderCentre answers a different question: which area is closest, so a
 * sheet always has pubs to list. A chip that PRINTS a place name makes a claim
 * about what is on screen, and the nearest-area fallback made that claim false
 * twice: "Camden" over a pub in North Finchley, "Balham" over a view holding
 * Luton to Crawley. Three rules, all of which must hold:
 *
 *  1. Containment. The map centre sits inside the area's own region. No
 *     nearest-area fallback, because "nearest" is not "over".
 *  2. One heart. No other area's centre is on screen. A view holding two areas
 *     spans them both, so it is neither of them.
 *  3. Scale. The view reaches no further than CLAIM_MAX_VIEW_RADIUS_MULTIPLE
 *     times the area's radius, which holds rule 2 honest in a city that models
 *     one area.
 *
 * Null is not a failure. It is the honest answer for a wide view, and the
 * caller prints the city name instead.
 */
export function areaClaimedByViewport(
  cityId: CityId,
  center: [number, number],
  bounds: MapBounds | null | undefined,
): NightArea | null {
  if (!bounds || !boundsAreUsable(bounds)) return null;
  const [lng, lat] = center;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const areas = getNightAreasForCity(cityId);
  if (areas.length === 0) return null;

  let claimed: NightArea | null = null;
  let claimedKm = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    const km = haversineKm([lng, lat], [area.centre.lng, area.centre.lat]);
    if (km <= area.radiusKm && km < claimedKm) {
      claimed = area;
      claimedKm = km;
    }
  }
  if (!claimed) return null;

  if (viewReachKm([lng, lat], bounds) > claimed.radiusKm * CLAIM_MAX_VIEW_RADIUS_MULTIPLE) {
    return null;
  }
  for (const area of areas) {
    if (area.slug === claimed.slug) continue;
    if (centreIsInView(area, bounds)) return null;
  }
  return claimed;
}

/**
 * Whose position a place claim on the map is measured against.
 *
 * "reader" is the person holding the phone, and only a granted browser location
 * earns it. "map" is the camera's own centre, which is all the map knows when
 * no location was given. The two are a different SENTENCE, not a different
 * precision: "179 m away" answers a question about the reader, and a map that
 * was never told where the reader is may not answer it. Every surface that
 * prints a place or a distance takes this rather than assuming the reader.
 */
export type MapPlaceOrigin = "reader" | "map";

/** The point row distances are measured from, carried WITH whose point it is,
 *  so a reader-measured row can never be worded as a map-measured one. */
export type AreaDistanceFrom = {
  /** [lng, lat] every row distance is measured from. */
  point: [number, number];
  origin: MapPlaceOrigin;
};

/**
 * May the Area chip claim the named area is where the READER stands?
 *
 * Only a granted location INSIDE that area's own region earns "reader". The
 * containment test is direct rather than through areaUnderCentre, which falls
 * back to the nearest area: a reader in Manchester would otherwise "match" a
 * London area and the chip would name a place they are 260 km from.
 */
export function areaLabelOrigin(
  area: NightArea | null | undefined,
  reader: { lat: number; lng: number } | null | undefined,
): MapPlaceOrigin {
  if (!area || !reader) return "map";
  if (!Number.isFinite(reader.lat) || !Number.isFinite(reader.lng)) return "map";
  const km = haversineKm(
    [reader.lng, reader.lat],
    [area.centre.lng, area.centre.lat],
  );
  return km <= area.radiusKm ? "reader" : "map";
}

/**
 * What the Area chip claims about the place it names.
 *
 * The chip is one short name in a narrow phone bar, so the claim rides its
 * accessible name and its glyph rather than a longer line. "Your area" is the
 * only wording that places the reader, and areaLabelOrigin is the one thing
 * allowed to award it.
 */
export function areaChipClaimPrefix(origin: MapPlaceOrigin): string {
  return origin === "reader" ? "Your area: " : "Area in view: ";
}

export function areaChipClaim(origin: MapPlaceOrigin, name: string): string {
  return `${areaChipClaimPrefix(origin)}${name}`;
}

/**
 * One-line distance, direct register, no fake precision.
 *
 * "away" is a distance from the READER, so it needs a granted location behind
 * it. Without one the row names the map centre it was actually measured from.
 * The default is "map" because that is the claim a caller that told us nothing
 * has earned.
 */
export function formatAreaDistance(
  km: number,
  origin: MapPlaceOrigin = "map",
): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (origin === "reader") {
    if (km < 0.1) return "right here";
    if (km < 1) return `${Math.round(km * 1000)} m away`;
    return `${km.toFixed(1)} km away`;
  }
  if (km < 0.1) return "at the map centre";
  if (km < 1) return `${Math.round(km * 1000)} m from map centre`;
  return `${km.toFixed(1)} km from map centre`;
}

/**
 * The price the map's pins already show for a venue: a contributor's verified
 * drop overrides the baseline. Zero / non-finite / null all read as "no price"
 * so the row fails soft rather than inventing a number.
 */
function verifiedPrice(
  venue: Venue,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
): number | null {
  const price =
    lensPrices === null
      ? venue.latestContributorPrice ?? venue.cheapestPrice
      : lensPrices.get(venue.id)?.priceGbp ?? null;
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
}

function withinRadius(
  centre: { lng: number; lat: number },
  radiusKm: number,
  venue: Venue,
): boolean {
  if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) {
    return false;
  }
  return (
    haversineKm([venue.longitude, venue.latitude], [centre.lng, centre.lat]) <=
    radiusKm
  );
}

export type AreaPubRow = {
  id: string;
  name: string;
  /** Verified price for active drink lens, or null when none is priced yet. */
  price: number | null;
  /** "£5.20" or the honest fail-soft copy — never a fabricated number. */
  priceLabel: string;
  distanceKm: number;
  distanceLabel: string;
};

/**
 * Rank active drink prices inside a ring: priced venues first, cheapest
 * ascending; venues with no verified price follow (nearest to `origin` first)
 * so a thin ring still fills the list honestly rather than hiding pubs. Ties
 * break on name for a stable, deterministic order. Shared by both the modelled
 * area sheet and the ad-hoc locality/borough ring so the two never disagree.
 */
function rankCheapestDrinks(
  centre: { lng: number; lat: number },
  radiusKm: number,
  venues: Venue[],
  origin: [number, number],
  originKind: MapPlaceOrigin,
  limit: number,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  lensCategoryLabel: string,
  lensStatus: CategoryPriceIndexStatus,
): AreaPubRow[] {
  const ranked = venues
    .filter((venue) => withinRadius(centre, radiusKm, venue))
    .map((venue) => ({
      venue,
      price: verifiedPrice(venue, lensPrices),
      distanceKm: haversineKm([venue.longitude, venue.latitude], origin),
    }))
    .sort((left, right) => {
      if (left.price !== null && right.price !== null) {
        return (
          left.price - right.price ||
          left.venue.name.localeCompare(right.venue.name)
        );
      }
      if (left.price !== null) return -1;
      if (right.price !== null) return 1;
      return (
        left.distanceKm - right.distanceKm ||
        left.venue.name.localeCompare(right.venue.name)
      );
    });

  return ranked
    .slice(0, Math.max(0, limit))
    .map(({ venue, price, distanceKm }) => ({
      id: venue.id,
      name: venue.name,
      price,
      priceLabel:
        price !== null
          ? lensPrices === null
            ? `£${price.toFixed(2)}`
            : `${lensCategoryLabel} · £${price.toFixed(2)}`
          : lensPrices === null
            ? "no priced pints yet"
            : drinkLensUnknownRowLabel(
                lensCategoryLabel.toLowerCase(),
                lensStatus,
              ),
      distanceKm,
      distanceLabel: formatAreaDistance(distanceKm, originKind),
    }));
}

/**
 * Modelled area's cheapest drinks, measured from `from` — the reader's granted
 * location, or the live map centre when there is none. An unusable point falls
 * back to the area centre, which is a map point, so the fallback also drops any
 * reader claim the caller made: a row may never say "away" from a point we lost.
 */
export function cheapestDrinksInArea(
  area: NightArea,
  venues: Venue[],
  from: AreaDistanceFrom,
  limit: number = AREA_PUB_LIMIT,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  lensCategoryLabel: string = "Pint",
  lensStatus: CategoryPriceIndexStatus = "ready",
): AreaPubRow[] {
  const [lng, lat] = from.point;
  const usable = Number.isFinite(lng) && Number.isFinite(lat);
  const origin: [number, number] = usable
    ? [lng, lat]
    : [area.centre.lng, area.centre.lat];
  return rankCheapestDrinks(
    area.centre,
    area.radiusKm,
    venues,
    origin,
    usable ? from.origin : "map",
    limit,
    lensPrices,
    lensCategoryLabel,
    lensStatus,
  );
}

/**
 * Cheapest drinks within a walkable ring of an arbitrary place centroid - a
 * locality or borough a map search flew to that is not a modelled Night Area.
 * Distances are measured from the centroid itself (the place the camera lands
 * on), which is a MAP point and never the reader, so the rows are worded that
 * way with no origin to choose. Returns [] when no priced-or-unpriced venue
 * sits inside the ring, which the sheet renders as its honest "no priced pints
 * nearby yet" line.
 */
export function cheapestDrinksNearPoint(
  center: [number, number],
  venues: Venue[],
  radiusKm: number = LOCALITY_RADIUS_KM,
  limit: number = AREA_PUB_LIMIT,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  lensCategoryLabel: string = "Pint",
  lensStatus: CategoryPriceIndexStatus = "ready",
): AreaPubRow[] {
  const [lng, lat] = center;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  return rankCheapestDrinks(
    { lng, lat },
    radiusKm,
    venues,
    center,
    "map",
    limit,
    lensPrices,
    lensCategoryLabel,
    lensStatus,
  );
}

export type AreaCoverageTone = "review" | "capture" | "discovery" | "paused";
export type AreaCoverageLabel = { label: string; tone: AreaCoverageTone } | null;

/**
 * The honest evidence label the plan intake shows, condensed to a chip. Route
 * ready areas return null (no warning needed); everything else says, in pub
 * words, how much of the area we have actually checked. VOICE.md rule 2 keeps
 * the evidence stage names ("capture", "review", "confidence") in the tone,
 * never in the label a thirsty reader sees.
 */
export function areaCoverageLabel(
  area: NightArea,
  now: Date = new Date(),
): AreaCoverageLabel {
  if (isNightAreaRouteReady(area, now)) return null;
  switch (area.coverageStatus) {
    case "captured":
      return { label: "Not all checked", tone: "capture" };
    case "reviewed":
      return { label: "Not all checked", tone: "review" };
    case "discovered":
      return { label: "Rough guess", tone: "discovery" };
    case "paused":
      return { label: "Gone stale", tone: "paused" };
    default:
      return { label: "Not all checked", tone: "review" };
  }
}

export type AreaElsewhereOption = {
  slug: string;
  name: string;
  /** [lng, lat] the map flies to — GeoJSON order, matching the camera helpers. */
  center: [number, number];
  coverage: AreaCoverageLabel;
  /** Optional camera zoom for the fly; undefined lets the map keep its default
   *  area zoom. A locality search result flies a notch deeper than an area. */
  zoom?: number;
  /** What was chosen. A modelled Night Area ("area") opens the sheet as-is; a
   *  "locality"/"borough" opens the ad-hoc radius ring around its centroid.
   *  Undefined (the Area-button "go somewhere else" grid) is always an area. */
  kind?: "area" | "locality" | "borough";
};

/** The modelled Night Areas for the city as a compact "go somewhere else" grid. */
export function areaElsewhereOptions(
  cityId: CityId,
  now: Date = new Date(),
): AreaElsewhereOption[] {
  return getNightAreasForCity(cityId).map((area) => ({
    slug: area.slug,
    name: area.name,
    center: [area.centre.lng, area.centre.lat],
    coverage: areaCoverageLabel(area, now),
  }));
}

export type AreaSheetModel = {
  /** Empty when the centre resolved to no area (fail-soft, never "undefined"). */
  areaName: string;
  pubs: AreaPubRow[];
  elsewhere: AreaElsewhereOption[];
};

/** Everything the area sheet renders, derived once and hermetically testable. */
export function buildAreaSheetModel(
  cityId: CityId,
  area: NightArea | null,
  venues: Venue[],
  center: [number, number],
  now: Date = new Date(),
): AreaSheetModel {
  return {
    areaName: area ? area.name : "",
    pubs: area
      ? cheapestDrinksInArea(area, venues, { point: center, origin: "map" })
      : [],
    elsewhere: areaElsewhereOptions(cityId, now),
  };
}

/**
 * What the Area sheet should show when a map-search suggestion is chosen. A
 * modelled Night Area is named by `slug` (the shell resolves it to the curated
 * area, coverage chip and all); a locality/borough carries the centroid + ring
 * the sheet derives its pubs from directly.
 */
export type AreaSheetTarget =
  | { kind: "area"; slug: string; name: string }
  | { kind: "place"; name: string; center: [number, number]; radiusKm: number };

/**
 * The whole search-select journey as one hermetic transition: choosing an area
 * suggestion collapses the search UI, flies the camera, and opens the Area
 * sheet on the chosen target. The React shell is a thin driver over this — it
 * bumps the fly token to `camera`, sets the sheet `target`, and (because
 * `collapseSearch`/`openSheet` are always set) closes the input and opens the
 * sheet as the camera settles. Kept pure so the journey is node-testable.
 */
export type AreaSelectJourney = {
  /** The fly the canvas performs — a modelled area keeps the default zoom, a
   *  locality flies to its own deeper `zoom`. */
  camera: { center: [number, number]; zoom: number };
  /** What the sheet shows on arrival. */
  target: AreaSheetTarget;
  /**
   * The named public place this explicit pick makes current. Its centre comes
   * from the search row, never from viewer location, and is safe to remember.
   */
  rememberedArea: Omit<MapChosenAreaSelection, "cityId">;
  /** Always true: the suggestions panel + input collapse on any select. */
  collapseSearch: true;
  /** Always "area": the pubs display opens once the fly settles. */
  openSheet: "area";
};

export function planAreaSelect(
  option: AreaElsewhereOption,
  radiusKm: number = LOCALITY_RADIUS_KM,
): AreaSelectJourney {
  const kind = option.kind ?? "area";
  const camera = {
    center: option.center,
    zoom: option.zoom ?? DEFAULT_AREA_FLY_ZOOM,
  };
  const target: AreaSheetTarget =
    kind === "area"
      ? { kind: "area", slug: option.slug, name: option.name }
      : { kind: "place", name: option.name, center: option.center, radiusKm };
  const rememberedArea = {
    kind: kind === "area" ? "night-area" : kind,
    label: option.name,
    slug: option.slug,
    center: option.center,
  } satisfies Omit<MapChosenAreaSelection, "cityId">;
  return {
    camera,
    target,
    rememberedArea,
    collapseSearch: true,
    openSheet: "area",
  };
}
