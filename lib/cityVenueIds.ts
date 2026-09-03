import type { CityId } from "@/lib/cities";

export const CITY_VENUE_ID_PREFIX: Partial<Record<CityId, string>> = {
  manchester: "mcr",
  liverpool: "liv",
  oxford: "oxf",
  durham: "dur",
  glasgow: "glw",
  bristol: "bri",
  cambridge: "cam",
  bath: "bat",
  llandudno: "lla",
} as const;

const CITY_BY_PREFIX: ReadonlyMap<string, CityId> = new Map(
  Object.entries(CITY_VENUE_ID_PREFIX).map(([cityId, prefix]) => [
    prefix,
    cityId as CityId,
  ]),
);

const CITY_PREFIXED_VENUE_ID_RE = /^venue-([a-z]{3})-[a-z0-9]{1,12}$/;

export function venueCityPrefix(venueId: string): string | null {
  return CITY_PREFIXED_VENUE_ID_RE.exec(venueId)?.[1] ?? null;
}

export function cityIdFromVenueId(venueId: string): CityId | null {
  const prefix = venueCityPrefix(venueId);
  return prefix ? CITY_BY_PREFIX.get(prefix) ?? null : null;
}

export function venueIdMatchesCity(venueId: string, cityId: CityId): boolean {
  const prefix = venueCityPrefix(venueId);
  if (cityId === "london") return prefix === null;
  return prefix === CITY_VENUE_ID_PREFIX[cityId];
}

/** Friendly label when a venue id cannot be resolved from the slim index. */
export function unresolvedVenueLabel(venueId?: string | null): string {
  const cityId = venueId ? cityIdFromVenueId(venueId) : null;
  switch (cityId) {
    case "manchester":
      return "A Manchester pub";
    case "liverpool":
      return "A Liverpool pub";
    case "oxford":
      return "An Oxford pub";
    case "durham":
      return "A Durham pub";
    case "glasgow":
      return "A Glasgow pub";
    case "bristol":
      return "A Bristol pub";
    case "cambridge":
      return "A Cambridge pub";
    case "bath":
      return "A Bath pub";
    case "llandudno":
      return "A Llandudno pub";
    default:
      return "A London pub";
  }
}
