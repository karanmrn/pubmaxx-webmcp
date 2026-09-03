import { buildLogNearbyCandidates, type LogNearbyCandidate } from "@/lib/mapLogIntent";
import { haversineKm } from "@/lib/haversine";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";
import {
  drinkLensCoverageNote,
  drinkLensUnknownSentence,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import { compactVenueAnchor } from "@/lib/venueAnchorPresentation";
import { isPubVenueKind } from "@/lib/venueKindFilters";

type MapVenueListVenueSignals = ReadonlyMap<
  string,
  { latestContributorPrice: number | null }
>;

// Accessibility contract (WCAG 2.1.1): WebGL pins are pointer-only. This is the
// pure model behind the DOM "List view", the keyboard-reachable parallel to
// the canvas. It reuses the existing nearby-picker builder so the list rows are
// the SAME shape (name + price + optional distance) the log-drop picker uses,
// and selection from a row drives the SAME select handler a pin tap does.

// Explicit limit available to deliberately bounded secondary views. Main map
// list does not apply it because every venue in view must remain operable.
export const MAP_VENUE_LIST_LIMIT = 60;

/** How List view orders the pubs currently in view. Default stays nearest. */
export type MapVenueListSortMode = "nearest" | "cheapest";

export type MapVenueListModel = {
  /**
   * Rows to render. Default order is nearest-first to the viewport centre when
   * known; "cheapest" ranks priced pubs ascending and leaves unpriced pubs last.
   */
  rows: LogNearbyCandidate[];
  /** Total venues currently on the map (pre-cap). */
  total: number;
  /** Rows actually shown (post-cap). */
  shown: number;
  /** True when the cap hid some of the on-map venues. */
  truncated: boolean;
  /**
   * What the selected drink's cross-venue read managed, or null when it
   * answered in full. This list is the DOM parallel to the pins, so it owes a
   * non-visual reader the same sentence the visual surfaces print: a read that
   * FAILED may never leave rows reading as a settled "none logged here".
   */
  coverageNote: string | null;
};

export type UkBasePubListRow = {
  id: string;
  name: string;
  priceLabel: "Other pub · no listed price";
  distanceKm?: number;
  pub: UkBasePub;
};

export type UkBasePubListModel = {
  rows: UkBasePubListRow[];
  total: number;
  shown: number;
  truncated: boolean;
};

/**
 * Exact rendered membership for pitched and rotated maps.
 *
 * MapLibre's geographic bounds are the axis-aligned box around the rendered
 * quadrilateral, so its corners can name pubs that are actually off canvas.
 * The map supplies its own projection here instead. This reads coordinates
 * only and never queries rendered features or performs canvas hit-testing.
 */
export function projectedItemIdsInViewport<T extends { id: string }>(
  items: readonly T[],
  project: (item: T) => { x: number; y: number },
  viewport: { width: number; height: number },
): string[] {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return [];
  }
  return items.flatMap((item) => {
    let point: { x: number; y: number };
    try {
      point = project(item);
    } catch {
      return [];
    }
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > viewport.width ||
      point.y < 0 ||
      point.y > viewport.height
    ) {
      return [];
    }
    return [item.id];
  });
}

/**
 * Pint-default figure the list rows and pins share: map-authority contributor
 * price from venueSignals when present, else the curated cheapest. A bare
 * non-pub figure without complete provenance is not shown on the row.
 */
function mapVenueListPintPrice(
  venue: Venue,
  venueSignals: MapVenueListVenueSignals | null,
): number | null {
  if (!isPubVenueKind(venue.kind) && compactVenueAnchor(venue) === null) {
    return null;
  }
  const price =
    venueSignals?.get(venue.id)?.latestContributorPrice ?? venue.cheapestPrice ?? null;
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
}

function mapVenueListPintPriceLabel(
  venue: Venue,
  venueSignals: MapVenueListVenueSignals | null,
): string {
  const price = mapVenueListPintPrice(venue, venueSignals);
  return price !== null ? `£${price.toFixed(2)}` : "Price TBD";
}

/**
 * The figure List view may rank on: an active drink lens uses that lens price
 * alone (same stack as AreaSheet), and the pint default mirrors pin authority
 * via venueSignals. A bare non-pub figure without complete provenance is not
 * shown on the row, so it cannot climb the cheapest sort.
 */
export function mapVenueListSortPrice(
  venue: Venue,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  venueSignals: MapVenueListVenueSignals | null = null,
): number | null {
  if (lensPrices !== null) {
    const price = lensPrices.get(venue.id)?.priceGbp;
    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? price
      : null;
  }
  return mapVenueListPintPrice(venue, venueSignals);
}

/**
 * Build the keyboard/AT-reachable list of the venues currently on the map.
 *
 * Default order is nearest-first to the viewport centre so the list mirrors
 * what the eye sees on the canvas; without a viewport fix it preserves the
 * filtered map order. "cheapest" ranks priced pubs ascending (active drink lens
 * when set) and leaves unpriced pubs last, nearest among themselves. Pure and
 * deterministic — safe on empty input.
 */
export function buildMapVenueListModel(
  venues: Venue[],
  viewportCenter: [number, number] | null,
  limit: number = venues.length,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  lensCategoryLabel: string = "this view",
  lensStatus: CategoryPriceIndexStatus = "ready",
  sortMode: MapVenueListSortMode = "nearest",
  venueSignals: MapVenueListVenueSignals | null = null,
): MapVenueListModel {
  const total = venues.length;
  const origin =
    viewportCenter &&
    Number.isFinite(viewportCenter[0]) &&
    Number.isFinite(viewportCenter[1])
      ? { lng: viewportCenter[0], lat: viewportCenter[1] }
      : null;
  const baseRows = buildLogNearbyCandidates(venues, limit, origin);
  const venueById = new Map(venues.map((item) => [item.id, item]));
  const drinkNoun = lensCategoryLabel.toLowerCase();
  // A row is read on its own, so its unknown wording carries the finding too -
  // the note below is not always heard beside it.
  const unknownLabel = drinkLensUnknownSentence(drinkNoun, lensStatus);
  const labelledRows =
    lensPrices === null
      ? baseRows.map((row) => {
          const item = venueById.get(row.id);
          return item
            ? { ...row, priceLabel: mapVenueListPintPriceLabel(item, venueSignals) }
            : row;
        })
      : baseRows.map((row) => {
          const lensPrice = lensPrices.get(row.id);
          return {
            ...row,
            priceLabel: lensPrice
              ? `${lensPrice.categoryLabel} · £${lensPrice.priceGbp.toFixed(2)}`
              : unknownLabel,
          };
        });
  const rows =
    sortMode === "cheapest"
      ? sortMapVenueListRowsCheapest(
          labelledRows,
          venues,
          lensPrices,
          venueSignals,
        )
      : labelledRows;
  return {
    rows,
    total,
    shown: rows.length,
    truncated: total > rows.length,
    coverageNote:
      lensPrices === null ? null : drinkLensCoverageNote(drinkNoun, lensStatus),
  };
}

function sortMapVenueListRowsCheapest(
  rows: LogNearbyCandidate[],
  venues: Venue[],
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  venueSignals: MapVenueListVenueSignals | null,
): LogNearbyCandidate[] {
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));
  return [...rows].sort((left, right) => {
    const leftVenue = venueById.get(left.id);
    const rightVenue = venueById.get(right.id);
    const leftPrice = leftVenue
      ? mapVenueListSortPrice(leftVenue, lensPrices, venueSignals)
      : null;
    const rightPrice = rightVenue
      ? mapVenueListSortPrice(rightVenue, lensPrices, venueSignals)
      : null;
    if (leftPrice !== null && rightPrice !== null) {
      return (
        leftPrice - rightPrice ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
      );
    }
    if (leftPrice !== null) return -1;
    if (rightPrice !== null) return 1;
    return (
      (left.distanceKm ?? Number.POSITIVE_INFINITY) -
        (right.distanceKm ?? Number.POSITIVE_INFINITY) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function buildUkBasePubListModel(
  pubs: UkBasePub[],
  viewportCenter: [number, number] | null,
  limit: number = pubs.length,
): UkBasePubListModel {
  const origin =
    viewportCenter &&
    Number.isFinite(viewportCenter[0]) &&
    Number.isFinite(viewportCenter[1])
      ? { lng: viewportCenter[0], lat: viewportCenter[1] }
      : null;
  const rows = pubs.map<UkBasePubListRow>((pub) => ({
    id: pub.id,
    name: pub.name,
    priceLabel: "Other pub · no listed price",
    ...(origin
      ? { distanceKm: haversineKm([origin.lng, origin.lat], [pub.lng, pub.lat]) }
      : {}),
    pub,
  }));
  if (origin) {
    rows.sort(
      (left, right) =>
        (left.distanceKm ?? Number.POSITIVE_INFINITY) -
          (right.distanceKm ?? Number.POSITIVE_INFINITY) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
  }
  const bounded = rows.slice(0, Math.max(0, Math.floor(limit)));
  return {
    rows: bounded,
    total: pubs.length,
    shown: bounded.length,
    truncated: pubs.length > bounded.length,
  };
}
