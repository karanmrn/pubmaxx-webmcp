import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/curatedCrawls";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import {
  MAP_SELECTION_NOTICE_PARAM,
  UNKNOWN_MAP_SELECTION_NOTE,
} from "@/lib/pubMap";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { SlimVenue } from "@/lib/venuesSlim";

export { UNKNOWN_MAP_SELECTION_NOTE as PAL_UNMATCHED_VENUE_NOTICE };

export type PalVenueOpenTarget =
  | { kind: "open"; href: string }
  | { kind: "fallback"; href: string; notice: string };

/** Listed venue ids from the slim index — the one honest pre-check Pal can run client-side. */
export function palKnownVenueIds(slim: readonly SlimVenue[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of slim) {
    if (row.id) ids.add(row.id);
  }
  return ids;
}

/** Map browse link with no `?sel=` — the unmatched fallback lands here. */
export function palMapBrowseHref(cityId: CityId | null = DEFAULT_CITY_ID): string {
  return cityAwareMapPath(
    cityId ?? DEFAULT_CITY_ID,
    `${MAP_SELECTION_NOTICE_PARAM}=unknown`,
  );
}

/**
 * Where a Pal venue card should navigate. Reuses {@link venueMapUrl} for a
 * listed id. When the slim read has answered and the id is absent, Pal opens
 * the city map without `?sel=` and names the refusal locally before leaving.
 * When the slim read has not answered, trust the Pal card and let the map's
 * own `?sel=` honesty handle a bad id.
 */
export function resolvePalVenueOpenTarget(
  venueId: string,
  knownIds: ReadonlySet<string> | null,
): PalVenueOpenTarget {
  const trimmed = venueId.trim();
  if (!trimmed) {
    return {
      kind: "fallback",
      href: palMapBrowseHref(),
      notice: UNKNOWN_MAP_SELECTION_NOTE,
    };
  }

  if (knownIds && !knownIds.has(trimmed)) {
    return {
      kind: "fallback",
      href: palMapBrowseHref(cityIdFromVenueId(trimmed)),
      notice: UNKNOWN_MAP_SELECTION_NOTE,
    };
  }

  return { kind: "open", href: venueMapUrl(trimmed) };
}
