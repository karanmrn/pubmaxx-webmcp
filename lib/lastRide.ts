// Shared "last ride home" seam — London TfL Last Pint and city siblings
// (Manchester Metrolink Last Tram, future static providers) share one result
// shape so LastTrainCard can stay mostly transport-agnostic.
//
// Decision maths stay in lib/tfl.ts (`computeLastPintDecision`) — they are
// already mode-agnostic (walk + last departure + buffer). This module only
// routes cities to the right API path and names the provider.

import type { CityId } from "@/lib/cities";
import type { LastTrainResult } from "@/lib/tfl";

export type LastRideProviderId =
  | "tfl"
  | "metrolink"
  | "spt-subway"
  | "merseyrail";

/** Same payload as LastTrainResult, plus optional provider provenance for UI. */
export type LastRideResult = LastTrainResult & {
  provider?: LastRideProviderId;
  /** Human mode word for copy: "train" | "tram" | "subway". */
  modeLabel?: string;
  /** Honest source line; card prefers this over TfL-specific defaults. */
  provenance?: string;
};

export function lastRideProviderForCity(cityId: CityId): LastRideProviderId | null {
  switch (cityId) {
    case "manchester":
      return "metrolink";
    case "glasgow":
      return "spt-subway";
    case "liverpool":
      return "merseyrail";
    case "london":
      return "tfl";
    default:
      return null;
  }
}

/** API path for the city's last-ride provider. */
export function lastRideApiPath(cityId: CityId): string | null {
  switch (cityId) {
    case "manchester":
      return "/api/last-tram";
    case "glasgow":
      return "/api/last-subway";
    case "liverpool":
      return "/api/last-merseyrail";
    case "london":
      return "/api/last-train";
    default:
      return null;
  }
}

/** Build the last-ride fetch URL. Destination stays client-only — never sent. */
export function lastRideFetchUrl(cityId: CityId, lat: number, lng: number): string | null {
  const path = lastRideApiPath(cityId);
  if (!path) return null;
  const params = new URLSearchParams();
  params.set("lat", String(lat));
  params.set("lng", String(lng));
  return `${path}?${params.toString()}`;
}

/** Short tab label derived from the city's lastRideLabel ("Last Tram" → "Tram"). */
export function lastRideTabLabel(lastRideLabel: string): string {
  const trimmed = lastRideLabel.trim();
  if (trimmed.toLowerCase().startsWith("last ")) {
    const mode = trimmed.slice(5).trim();
    if (!mode) return trimmed;
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }
  return trimmed;
}
