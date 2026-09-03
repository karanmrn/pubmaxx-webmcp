import { getCity, type CityId } from "@/lib/cities";
import { lastRideTabLabel } from "@/lib/lastRide";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

// Mobile-first tabs regroup the panel's long vertical scroll into thumb-friendly
// sections (most PUBMAXXERs are on a phone while travelling). The labels follow
// the mobile product contract while retaining stable internal keys/URLs.
// "getting-home" is a placeholder slot the orchestrator fills with
// a transport card built by another agent — we only render its mount point here.
export type TabKey =
  | "overview"
  | "photos"
  | "pints"
  | "menu"
  | "story"
  | "ask"
  | "getting-home";

export const BASE_TABS: { key: TabKey; label: string; shortLabel: string }[] = [
  { key: "overview", label: "Overview", shortLabel: "Overview" },
  // The wall sits second because it is the most-looked-at thing about a pub
  // after what it costs, and because a photo is the one section a reader can
  // judge in a glance rather than by reading.
  { key: "photos", label: "Photos", shortLabel: "Photos" },
  { key: "menu", label: "Drinks", shortLabel: "Drinks" },
  { key: "pints", label: "Stories", shortLabel: "Stories" },
  { key: "story", label: "Lore", shortLabel: "Lore" },
  { key: "ask", label: "Ask", shortLabel: "Ask" },
];

export function tabsForCity(cityId: CityId): { key: TabKey; label: string; shortLabel: string }[] {
  const city = getCity(cityId);
  // London's card is branded "Last Pint", but a venue tab labelled only "Pint"
  // collides with Pint Drops/Pints. The tab is an action surface, so name the
  // transport mode; the Last Pint card keeps the branded copy inside the panel.
  const rideLabel = city.lastRideLabel === "Last Pint" ? "Last train" : city.lastRideLabel;
  const ride = lastRideTabLabel(rideLabel);
  return [
    ...BASE_TABS,
    { key: "getting-home", label: rideLabel, shortLabel: ride },
  ];
}

export function tabsForVenue(
  cityId: CityId,
  kind: VenueKind | undefined,
): { key: TabKey; label: string; shortLabel: string }[] {
  const tabs = tabsForCity(cityId);
  return isPubVenueKind(kind) ? tabs : tabs.filter((tab) => tab.key !== "pints");
}

export const DEFAULT_TAB: TabKey = "overview";
