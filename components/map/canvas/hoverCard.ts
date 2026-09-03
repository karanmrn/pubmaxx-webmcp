import { COMMUNITY_PROVISIONAL_SHORT_NOTE } from "@/lib/communityPrice";
import { formatFreshness, formatObservedAt, type Venue } from "@/lib/venues";
import { proxiedVenueImageUrl } from "@/lib/venueImages";
import type { PricedVenue } from "@/lib/priceUpdates";
import {
  drinkLensUnknownSentence,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import {
  anchorMonthLabel,
  anchorSourceLabel,
} from "@/lib/venueAnchorPresentation";
import {
  isPubVenueKind,
  venueKindLabel,
} from "@/lib/venueKindFilters";
import type { VenueSignal, FailedHoverImage } from "./types";

export const HOVER_DETAIL_CACHE_LIMIT = 24;
export const HOVER_CARD_VIEWPORT_GUTTER_PX = 16;
export const HOVER_CARD_WIDTH_PX = 292;
export const HOVER_CARD_HEIGHT_PX = 138;
export const HOVER_CARD_MIN_TOP_PX = 84;
export const HOVER_CARD_X_OFFSET_PX = 18;
export const HOVER_CARD_Y_OFFSET_PX = -30;

export function withBoundedHoverDetailCache(
  details: Map<string, Venue | null>,
  id: string,
  venue: Venue | null,
): Map<string, Venue | null> {
  const next = new Map(details);
  next.delete(id);
  next.set(id, venue);
  while (next.size > HOVER_DETAIL_CACHE_LIMIT) {
    const oldestId = next.keys().next().value;
    if (oldestId === undefined) break;
    next.delete(oldestId);
  }
  return next;
}

export function hoverImageUrlFor(
  hoverDetail: Venue | null | undefined,
  failedImage: FailedHoverImage | null,
  hoveredVenueId: string | null,
): string {
  const src = proxiedVenueImageUrl(hoverDetail?.imageUrl ?? "");
  if (failedImage?.venueId === hoveredVenueId && failedImage.url === src) return "";
  return src;
}

export type HoverPriceLine = {
  price: number | null;
  provenance: string;
};

export type HoverCardCopy = {
  venueTypeLabel: string;
  price: number | null;
  priceSuffix: string;
  provenance: string;
  detailLabel: string;
  /** The provisional mark explained, or "" when the pin wears no badge. */
  pendingNote: string;
};

// Compact honesty line for the map hover card. Price and provenance share one
// precedence stack (community → sourced → baseline) so a baseline API detail
// fetch never pairs with a Community/Sourced label.
export function hoverPriceLine(
  mapVenue: Venue | undefined,
  signal: VenueSignal | undefined,
  hoverDetail: Venue | null | undefined,
): HoverPriceLine {
  const communityPrice =
    signal?.latestContributorPrice ?? mapVenue?.latestContributorPrice ?? null;
  if (communityPrice !== null && communityPrice !== undefined) {
    const fresh = formatFreshness(
      signal?.latestContributorAt ?? mapVenue?.latestContributorAt,
    );
    return {
      price: communityPrice,
      provenance: fresh ? `Community · ${fresh}` : "Community · tap for detail",
    };
  }
  const sourced = (mapVenue as PricedVenue | undefined)?.sourcedPrice ?? null;
  if (sourced) {
    const observed = formatObservedAt(sourced.observedAt);
    // mergePriceUpdates already wrote the sourced amount onto cheapestPrice.
    const price =
      mapVenue?.cheapestPrice ?? hoverDetail?.cheapestPrice ?? null;
    return {
      price: price ?? null,
      provenance: observed ? `Sourced · ${observed}` : "Sourced · tap for detail",
    };
  }
  const baseline =
    mapVenue?.cheapestPrice ?? hoverDetail?.cheapestPrice ?? null;
  if (baseline !== null && baseline !== undefined) {
    return { price: baseline, provenance: "Baseline · tap for detail" };
  }
  return { price: null, provenance: "Tap for detail" };
}

export function hoverCardCopy(
  mapVenue: Venue | undefined,
  signal: VenueSignal | undefined,
  hoverDetail: Venue | null | undefined,
  // Whether this pin is wearing the provisional badge. Only a pub can: the
  // badge is about a pint report, and the price line above it is untouched
  // either way — the note explains the DOT, it never explains the price.
  provisional = false,
  // Undefined means ordinary map. Null means an experience view with no price.
  experiencePrice: MapLensPrice | null | undefined = undefined,
  // What the active lens is called inside a sentence, and how complete its
  // cross-venue read was. This card is the only per-pin price line a desktop
  // reader gets, so it owes the same three findings every other surface tells:
  // an unread or truncated index may not settle as "none logged here".
  lensNoun: string | null = null,
  lensStatus: CategoryPriceIndexStatus = "ready",
): HoverCardCopy {
  const kind = hoverDetail?.kind ?? mapVenue?.kind;
  const venueTypeLabel = venueKindLabel(kind);
  if (experiencePrice !== undefined) {
    if (experiencePrice === null) {
      const noun = lensNoun?.trim() || null;
      return {
        venueTypeLabel,
        price: null,
        priceSuffix: noun ? `for ${noun}` : "for this view",
        provenance: noun
          ? drinkLensUnknownSentence(noun, lensStatus)
          : "No price logged for this view",
        detailLabel: isPubVenueKind(kind) ? "pub detail" : "venue detail",
        pendingNote: "",
      };
    }
    const provenance =
      experiencePrice.source === "community"
        ? ["Community", formatFreshness(experiencePrice.submittedAt)]
            .filter(Boolean)
            .join(" · ")
        : [
            "Sourced",
            anchorMonthLabel(experiencePrice.observedAt),
            anchorSourceLabel(experiencePrice.sourceUrl),
          ]
            .filter(Boolean)
            .join(" · ");
    return {
      venueTypeLabel,
      price: experiencePrice.priceGbp,
      priceSuffix: experiencePrice.categoryLabel,
      provenance,
      detailLabel: isPubVenueKind(kind) ? "pub detail" : "venue detail",
      pendingNote: "",
    };
  }
  if (isPubVenueKind(kind)) {
    const line = hoverPriceLine(mapVenue, signal, hoverDetail);
    return {
      venueTypeLabel,
      price: line.price,
      priceSuffix: "cheapest pint",
      provenance: line.provenance,
      detailLabel: "pub detail",
      pendingNote: provisional ? COMMUNITY_PROVISIONAL_SHORT_NOTE : "",
    };
  }

  const price =
    hoverDetail?.cheapestPrice ?? mapVenue?.cheapestPrice ?? null;
  const anchorLabel =
    hoverDetail?.anchorLabel ?? mapVenue?.anchorLabel;
  const observedAt =
    hoverDetail?.anchorObservedAt ?? mapVenue?.anchorObservedAt;
  const sourceUrl =
    hoverDetail?.anchorSourceUrl ?? mapVenue?.anchorSourceUrl;
  const provenance = [
    "Anchor",
    anchorMonthLabel(observedAt),
    anchorSourceLabel(sourceUrl),
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    venueTypeLabel,
    price,
    priceSuffix:
      anchorLabel ??
      (kind === "bar" ? "cocktail anchor" : "large doner anchor"),
    provenance,
    detailLabel: "venue detail",
    pendingNote: "",
  };
}
