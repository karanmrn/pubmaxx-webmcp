import { haversineKm } from "@/lib/haversine";
import {
  compactVenueAnchor,
  type CompactVenueAnchor,
} from "@/lib/venueAnchorPresentation";
import {
  isPubVenueKind,
  venueKindLabel,
} from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

type ResolveMapLogIntentInput = {
  hasLogIntent: boolean;
  loaded: boolean;
  selectedVenueId: string;
  selectedVenueResolvable: boolean;
  selectedVenueIsPub: boolean;
  firstRouteId: string;
  firstFilteredVenueId: string;
};

export type MapLogIntentResolution =
  | { status: "inactive" }
  | { status: "pending" }
  | { status: "open"; venueId: string }
  | { status: "fallback" };

export type LogNearbyCandidate = {
  id: string;
  name: string;
  kind?: VenueKind;
  typeLabel: string;
  priceLabel: string;
  anchor: CompactVenueAnchor | null;
  /** Straight-line km from origin when geo-sorted; omitted without a fix. */
  distanceKm?: number;
};

// Cap the nearby-picker list so the log-intent fallback stays thumb-scannable.
export const LOG_NEARBY_PICKER_LIMIT = 5;

// D1 — how far a pub may sit from the picker's origin and still be offered as
// one the reader might be standing in. Past this the list is guessing: the
// shipped picker offered pubs 20 miles apart to everyone. An empty list is the
// honest answer, and the picker then leads with search and "tap the map".
export const LOG_NEARBY_MAX_KM = 5;

type LogNearbyVenue = {
  id: string;
  name: string;
  cheapestPrice?: number | null;
  latitude?: number;
  longitude?: number;
  kind?: VenueKind;
  anchorLabel?: string;
  anchorObservedAt?: string;
  anchorSourceUrl?: string;
};

export type LogNearbyOrigin = { lat: number; lng: number };

/** Where the picker's "nearest first" order is measured from. */
export type LogNearbyOriginSource = "user" | "map";

export type LogNearbyOriginResolution = {
  origin: LogNearbyOrigin;
  source: LogNearbyOriginSource;
} | null;

/**
 * D1 — ground the picker in where the reader actually is. A GPS fix wins. With
 * no fix, the map centre is the honest second origin: the reader chose that
 * view. With neither, return null; the picker then offers no list at all
 * rather than the same five pubs to every visitor.
 */
export function resolveLogNearbyOrigin(input: {
  userLocation?: { lat: number; lng: number } | null;
  mapCenter?: [number, number] | null;
}): LogNearbyOriginResolution {
  const user = input.userLocation;
  if (user && Number.isFinite(user.lat) && Number.isFinite(user.lng)) {
    return { origin: { lat: user.lat, lng: user.lng }, source: "user" };
  }
  const centre = input.mapCenter;
  if (centre && Number.isFinite(centre[0]) && Number.isFinite(centre[1])) {
    return { origin: { lat: centre[1], lng: centre[0] }, source: "map" };
  }
  return null;
}

function priceLabelFor(
  venue: LogNearbyVenue,
  anchor: CompactVenueAnchor | null,
): string {
  return typeof venue.cheapestPrice === "number" &&
    Number.isFinite(venue.cheapestPrice) &&
    (isPubVenueKind(venue.kind) || anchor !== null)
    ? `£${venue.cheapestPrice.toFixed(2)}`
    : "Price TBD";
}

/**
 * Wave K0 — Drop nearby picker.
 * With an origin, sort by haversine nearest-first (venues missing coords sink).
 * Without origin, preserve list order (filtered map order).
 * `maxKm` drops pubs the reader cannot be standing in; it needs an origin, so
 * an unmeasured list is never silently emptied.
 */
export function buildLogNearbyCandidates(
  venues: LogNearbyVenue[],
  limit = LOG_NEARBY_PICKER_LIMIT,
  origin?: LogNearbyOrigin | null,
  maxKm?: number,
): LogNearbyCandidate[] {
  const take = Math.max(0, Math.min(Math.floor(limit), venues.length));
  if (take === 0) return [];

  const ranked = origin
    ? [...venues]
        .map((venue) => {
          const hasCoords =
            typeof venue.latitude === "number" &&
            Number.isFinite(venue.latitude) &&
            typeof venue.longitude === "number" &&
            Number.isFinite(venue.longitude);
          const distanceKm = hasCoords
            ? haversineKm([origin.lng, origin.lat], [venue.longitude!, venue.latitude!])
            : Number.POSITIVE_INFINITY;
          return { venue, distanceKm };
        })
        .filter(({ distanceKm }) =>
          typeof maxKm === "number" && Number.isFinite(maxKm) ? distanceKm <= maxKm : true,
        )
        .sort((a, b) => a.distanceKm - b.distanceKm)
    : venues.map((venue) => ({ venue, distanceKm: undefined as number | undefined }));

  return ranked.slice(0, Math.min(take, ranked.length)).map(({ venue, distanceKm }) => {
    const anchor = compactVenueAnchor(venue);
    return {
      id: venue.id,
      name: venue.name,
      ...(venue.kind !== undefined ? { kind: venue.kind } : {}),
      typeLabel: venueKindLabel(venue.kind),
      priceLabel: priceLabelFor(venue, anchor),
      anchor,
      ...(typeof distanceKm === "number" && Number.isFinite(distanceKm)
        ? { distanceKm }
        : {}),
    };
  });
}

type QueryLike = string | { get(name: string): string | null };

export function hasMapLogIntent(query: QueryLike): boolean {
  if (typeof query !== "string") return query.get("log") === "1";
  const normalized = query.startsWith("?") ? query.slice(1) : query;
  return new URLSearchParams(normalized).get("log") === "1";
}

/**
 * D4 — leaving the Drop flow must take `log=1` with it. The param survived
 * every close (useCrawlUrl keeps it as an owned passthrough), so closing the
 * venue sheet reopened the pub picker and closing the picker left the flag
 * armed for the next close. The reader could not get out.
 * Returns the query WITHOUT a leading "?", empty when nothing else is left.
 */
export function clearMapLogIntentSearch(search: string): string {
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalized);
  params.delete("log");
  return params.toString();
}

export function shouldRunMapLogIntent(input: {
  hasLogIntent: boolean;
  handled: boolean;
}): boolean {
  return input.hasLogIntent && !input.handled;
}

/**
 * Wave H2 — Drop intent trust:
 * Only auto-open the composer when the URL (or an already-selected sheet)
 * names a resolvable pub (`sel=`). Never silently attach a Spill to the first
 * filtered / first route venue — that was the wrong-pub failure mode.
 * Without a resolvable selection → `fallback` (nearby picker).
 */
export function resolveMapLogIntent(input: ResolveMapLogIntentInput): MapLogIntentResolution {
  if (!input.hasLogIntent) return { status: "inactive" };
  if (!input.loaded) return { status: "pending" };

  const selectedVenueId =
    input.selectedVenueId && input.selectedVenueResolvable && input.selectedVenueIsPub
      ? input.selectedVenueId
      : "";
  if (selectedVenueId) return { status: "open", venueId: selectedVenueId };
  // firstRouteId / firstFilteredVenueId are intentionally ignored for auto-open.
  void input.firstRouteId;
  void input.firstFilteredVenueId;
  return { status: "fallback" };
}

/** Format a short distance chip for the nearby picker (e.g. "120 m", "1.2 km"). */
export function formatLogNearbyDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
