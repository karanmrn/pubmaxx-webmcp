import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export type CompactVenueAnchor = {
  label: string;
  observedLabel: string;
  sourceLabel: string;
  sourceUrl: string;
};

type VenueAnchorInput = {
  kind?: VenueKind;
  anchorLabel?: string;
  anchorObservedAt?: string;
  anchorSourceUrl?: string;
};

export function anchorMonthLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  const year = date.getUTCFullYear();
  return year === new Date().getUTCFullYear() ? month : `${month} ${year}`;
}

export function anchorSourceLabel(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function compactVenueAnchor(
  venue: VenueAnchorInput,
): CompactVenueAnchor | null {
  if (isPubVenueKind(venue.kind)) return null;
  const label = venue.anchorLabel?.trim() ?? "";
  const observedLabel = anchorMonthLabel(venue.anchorObservedAt);
  const sourceLabel = anchorSourceLabel(venue.anchorSourceUrl);
  const sourceUrl = venue.anchorSourceUrl?.trim() ?? "";
  if (!label || !observedLabel || !sourceLabel || !sourceUrl) return null;
  return { label, observedLabel, sourceLabel, sourceUrl };
}
