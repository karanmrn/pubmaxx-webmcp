import type { LastPintDecisionKind } from "@/lib/tfl";

/** Public venue pickup for get-home handoffs. Viewer coordinates are refused. */
export type GetHomeHandoffVenue = {
  name: string;
  latitude: number;
  longitude: number;
  addressLine: string;
};

export type GetHomeHandoffLinkKind = "uber" | "citymapper" | "google_transit";

export type GetHomeHandoffLink = {
  kind: GetHomeHandoffLinkKind;
  href: string;
  label: string;
};

const VIEWER_INPUT_KEYS = [
  "viewerLatitude",
  "viewerLongitude",
  "userLatitude",
  "userLongitude",
  "fromLat",
  "fromLng",
  "originLat",
  "originLng",
  "pickupLat",
  "pickupLng",
  "lat",
  "lng",
] as const;

function assertNoViewerInput(input: Record<string, unknown>, context: string): void {
  for (const key of VIEWER_INPUT_KEYS) {
    if (key in input) {
      throw new Error(`${context} refuses viewer coordinates (${key})`);
    }
  }
}

function requireVenue(venue: GetHomeHandoffVenue): GetHomeHandoffVenue {
  assertNoViewerInput(venue as unknown as Record<string, unknown>, "getHomeHandoff");
  if (
    !venue.name.trim() ||
    !Number.isFinite(venue.latitude) ||
    !Number.isFinite(venue.longitude)
  ) {
    throw new Error("getHomeHandoff requires a venue name and finite public coordinates");
  }
  return {
    name: venue.name.trim(),
    latitude: venue.latitude,
    longitude: venue.longitude,
    addressLine: venue.addressLine.trim(),
  };
}

export function getHomeHandoffHeading(venue: GetHomeHandoffVenue): string {
  return `Get a ride from ${requireVenue(venue).name}`;
}

export function uberRideHref(venue: GetHomeHandoffVenue): string | null {
  const resolved = requireVenue(venue);
  const clientId = process.env.NEXT_PUBLIC_UBER_CLIENT_ID?.trim();
  if (!clientId) return null;

  const pickup = {
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    addressLine1: resolved.addressLine,
    title: resolved.name,
  };
  const params = new URLSearchParams({
    client_id: clientId,
    pickup: JSON.stringify(pickup),
  });
  return `https://m.uber.com/looking?${params.toString()}`;
}

export function citymapperDirectionsHref(venue: GetHomeHandoffVenue): string {
  const resolved = requireVenue(venue);
  const params = new URLSearchParams({
    startcoord: `${resolved.latitude},${resolved.longitude}`,
    startname: resolved.name,
    startaddress: resolved.addressLine,
  });
  return `https://citymapper.com/directions?${params.toString()}`;
}

/** Venue is the ORIGIN the user leaves from; the rider picks home in Google Maps. */
export function googleMapsTransitHref(venue: GetHomeHandoffVenue): string {
  const resolved = requireVenue(venue);
  const params = new URLSearchParams({
    api: "1",
    origin: `${resolved.latitude},${resolved.longitude}`,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function orderGetHomeLinkKinds(
  decision: LastPintDecisionKind | null | undefined,
): GetHomeHandoffLinkKind[] {
  if (decision === "train_risk") {
    return ["uber", "citymapper", "google_transit"];
  }
  return ["citymapper", "google_transit", "uber"];
}

export function buildGetHomeHandoffLinks(
  venue: GetHomeHandoffVenue,
  decision?: LastPintDecisionKind | null,
): GetHomeHandoffLink[] {
  const resolved = requireVenue(venue);
  const links: GetHomeHandoffLink[] = [];

  for (const kind of orderGetHomeLinkKinds(decision)) {
    if (kind === "uber") {
      const href = uberRideHref(resolved);
      if (!href) continue;
      links.push({ kind, href, label: "Uber" });
      continue;
    }
    if (kind === "citymapper") {
      links.push({
        kind,
        href: citymapperDirectionsHref(resolved),
        label: "Citymapper",
      });
      continue;
    }
    links.push({
      kind,
      href: googleMapsTransitHref(resolved),
      label: "Google Maps",
    });
  }

  return links;
}

export function venueToGetHomeHandoff(venue: {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
}): GetHomeHandoffVenue {
  assertNoViewerInput(venue as unknown as Record<string, unknown>, "venueToGetHomeHandoff");
  return {
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    addressLine: venue.address,
  };
}
