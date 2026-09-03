import { firstHttp, firstHttps } from "@/lib/httpUrl";
import type { Venue } from "@/lib/venues";

/**
 * External venue CTAs (Book / Menu / Order) — Greene King–style actions without
 * inventing commerce. Only surfaces real http(s) URLs already on the venue,
 * except the "Find booking" fallback below, which is an honest search
 * deep-link (never a fabricated direct booking page).
 *
 * Food ordering stays link-out only until we have a curated `orderUrl` layer.
 */

export type VenueExternalActionKind = "book" | "menu" | "website" | "order";

/**
 * Honesty tier for the booking CTA:
 * - "direct": the venue's own bookingUrl — a real table-booking page.
 * - "site": we don't hold a booking-specific URL, but we do hold a real
 *   website/menu domain for the venue — link there and let the guest look.
 * - "search": we hold nothing bookable for this venue — send the guest to a
 *   Google Maps place search instead of inventing a link that might not exist.
 */
export type BookingTier = "direct" | "site" | "search";

export type VenueExternalAction = {
  kind: VenueExternalActionKind;
  label: string;
  href: string;
  /** Present on "book" actions so the UI can render the honesty tier. */
  tier?: BookingTier;
};

export type BookingResolution = {
  href: string;
  label: string;
  tier: BookingTier;
};

export type BookingCandidateInput = {
  /** Venue/pub display name, used in the tier-3 search query. */
  name: string;
  /** A known booking-specific URL, if any (tier 1). */
  bookingUrl?: string;
  /** The venue's own website, if any (tier 2). */
  websiteUrl?: string;
  /** A curated menu page URL — its domain doubles as a tier-2 site link. */
  menuUrl?: string;
  /** Address, postcode, or borough — narrows the tier-3 map search. */
  areaHint?: string;
};

const BOOKING_LABELS: Record<BookingTier, string> = {
  direct: "Book a table",
  site: "Book via site",
  search: "Find booking",
};

/** Origin (scheme + host) of an already-validated http(s) URL, or "" on failure. */
function originOf(httpUrl: string): string {
  if (!httpUrl) return "";
  try {
    return new URL(httpUrl).origin;
  } catch {
    return "";
  }
}

/** Honest Google Maps place-search deep-link — never a fabricated booking page. */
function mapsSearchHref(name: string, areaHint: string | undefined): string {
  const query = [name, areaHint, "book a table"]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Resolve an honest booking CTA for any venue/pub-shaped input, in three
 * tiers. Always returns a result — the search tier is the guaranteed floor,
 * so every venue gets some booking affordance.
 */
export function resolveBookingAction(input: BookingCandidateInput): BookingResolution {
  const direct = firstHttp(input.bookingUrl);
  if (direct) {
    return { href: direct, label: BOOKING_LABELS.direct, tier: "direct" };
  }

  const site =
    firstHttps(input.websiteUrl) ||
    originOf(firstHttps(input.menuUrl)) ||
    originOf(firstHttp(input.bookingUrl));
  if (site) {
    return { href: site, label: BOOKING_LABELS.site, tier: "site" };
  }

  return {
    href: mapsSearchHref(input.name, input.areaHint),
    label: BOOKING_LABELS.search,
    tier: "search",
  };
}

/** Venue-shaped convenience wrapper over {@link resolveBookingAction}. */
export function venueBookingAction(venue: Venue): BookingResolution {
  return resolveBookingAction({
    name: venue.name,
    bookingUrl: venue.bookingLink,
    websiteUrl: venue.website,
    menuUrl: venue.menuUrl,
    areaHint: venue.address || venue.primaryBorough,
  });
}

function websiteLabel(venue: Venue): string {
  if (venue.kind === "bar") return "Bar website";
  if (venue.kind === "food") return "Late-food venue website";
  if (venue.kind === undefined || venue.kind === "pub") return "Pub website";
  return "Venue website";
}

/**
 * Resolve Book / Look at the menu / venue website / Order food CTAs for a venue.
 * Order: book → menu/website → order. The book CTA always resolves (see
 * {@link resolveBookingAction}); menu/website/order never invent URLs.
 */
export function venueExternalActions(venue: Venue): VenueExternalAction[] {
  const actions: VenueExternalAction[] = [];

  const booking = venueBookingAction(venue);
  actions.push({
    kind: "book",
    label: booking.label,
    href: booking.href,
    tier: booking.tier,
  });

  // Curated menuUrl always wins as "Look at the menu". Otherwise, when the
  // venue serves food, the homepage is an honest menu/site link-out; without
  // food, label the website for its venue kind.
  const curatedMenu = firstHttps(venue.menuUrl);
  if (curatedMenu) {
    actions.push({
      kind: "menu",
      label: "Look at the menu",
      href: curatedMenu,
    });
  } else if (venue.amenities.food) {
    const menuHref = firstHttps(venue.website);
    if (menuHref) {
      actions.push({
        kind: "menu",
        label: "Look at the menu",
        href: menuHref,
      });
    }
  } else {
    const website = firstHttps(venue.website);
    if (website) {
      actions.push({
        kind: "website",
        label: websiteLabel(venue),
        href: website,
      });
    }
  }

  const order = firstHttp(venue.orderUrl);
  if (order) {
    actions.push({ kind: "order", label: "Order food", href: order });
  }

  return actions;
}
