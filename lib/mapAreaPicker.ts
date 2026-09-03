// Choose-area sheet models — London neighbourhoods with live pub counts and
// search filtering over night areas + locality gazetteer rows.

import type { CityId } from "@/lib/cities";
import { listEnabledCities } from "@/lib/cities";
import type { Locality } from "@/lib/localities";
import { getNightAreasForCity, type NightArea } from "@/lib/nightAreas";
import { assignVenueToNightArea } from "@/lib/pricedLanding";
import type { MapBounds } from "@/lib/slimShards";
import type { Venue } from "@/lib/venues";

export type ChooseAreaNeighbourhood = {
  slug: string;
  name: string;
  /**
   * How many pubs this area holds, or `null` when nobody can say yet. The pins
   * the map is holding are a STREAM - core lands first and outer shards arrive
   * as the reader moves - so a count taken over them is a count of whatever
   * happens to be loaded. A partial figure on a picker is worse than none,
   * because the reader cannot tell there is anything to disbelieve, so a row
   * whose shards have not all landed carries no figure at all.
   */
  pubCount: number | null;
  center: [number, number];
};

export type ChooseAreaCityRow = {
  cityId: CityId;
  name: string;
};

function normaliseQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** One row, one visible name: the only thing a reader can tell two rows by. */
function rowIdentity(name: string): string {
  return name.trim().toLowerCase();
}

// Degrees per kilometre. Latitude is near enough constant; longitude narrows
// with the cosine of the latitude, floored so a pole cannot divide by zero.
const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LNG_AT_EQUATOR = 111.32;

/**
 * The patch of map that could hold a pub belonging to this area.
 *
 * `nightAreaForPoint` assigns a venue to the NEAREST area whose radius contains
 * it, so a pub counted here always lies inside this area's own radius. The box
 * around that radius is therefore a safe over-estimate: every shard that could
 * hold one of this area's pubs intersects it.
 */
export function nightAreaCoverageBounds(area: NightArea): MapBounds {
  const latSpan = area.radiusKm / KM_PER_DEGREE_LAT;
  const cosLat = Math.cos((area.centre.lat * Math.PI) / 180);
  const lngSpan =
    area.radiusKm / (KM_PER_DEGREE_LNG_AT_EQUATOR * Math.max(Math.abs(cosLat), 0.01));
  return {
    west: area.centre.lng - lngSpan,
    east: area.centre.lng + lngSpan,
    south: area.centre.lat - latSpan,
    north: area.centre.lat + latSpan,
  };
}

/**
 * The areas whose pub count may be PRINTED, asked of the shard loader one area
 * at a time. Only a `true` earns a figure: `null` is a loader that has not
 * answered and `false` is a shard still in flight, and neither is a count.
 */
export function completeNeighbourhoodCountSlugs(
  cityId: CityId,
  coverageComplete: (bounds: MapBounds) => boolean | null,
): Set<string> {
  const complete = new Set<string>();
  for (const area of getNightAreasForCity(cityId)) {
    if (coverageComplete(nightAreaCoverageBounds(area)) === true) {
      complete.add(area.slug);
    }
  }
  return complete;
}

/**
 * Count pubs per modelled night area for one city pack. `completeCountSlugs`
 * names the areas whose shards have all landed; every other row answers `null`
 * rather than a figure taken over a partly-streamed index.
 */
export function londonNeighbourhoodRows(
  venues: readonly Venue[],
  cityId: CityId = "london",
  completeCountSlugs?: ReadonlySet<string> | null,
): ChooseAreaNeighbourhood[] {
  const areas = getNightAreasForCity(cityId);
  const counts = new Map<string, number>();
  for (const venue of venues) {
    const area = assignVenueToNightArea(venue, areas);
    if (!area) continue;
    counts.set(area.slug, (counts.get(area.slug) ?? 0) + 1);
  }
  return areas
    .map((area) => ({
      slug: area.slug,
      name: area.name,
      pubCount: completeCountSlugs?.has(area.slug)
        ? counts.get(area.slug) ?? 0
        : null,
      center: [area.centre.lng, area.centre.lat] as [number, number],
    }))
    .sort((a, b) => {
      // A counted area leads; an uncounted one keeps its place by name rather
      // than jumping the list as its shard lands.
      if (a.pubCount === null && b.pubCount === null) {
        return a.name.localeCompare(b.name);
      }
      if (a.pubCount === null) return 1;
      if (b.pubCount === null) return -1;
      return b.pubCount - a.pubCount || a.name.localeCompare(b.name);
    });
}

export function filterChooseAreaNeighbourhoods(
  rows: readonly ChooseAreaNeighbourhood[],
  query: string,
  localities: readonly Locality[] = [],
): ChooseAreaNeighbourhood[] {
  const needle = normaliseQuery(query);
  if (!needle) return [...rows];

  const areaHits = rows.filter((row) => row.name.toLowerCase().includes(needle));
  // Deduped on the NAME, not the slug: every locality row carries a
  // `locality:` prefix of its own, so a slug comparison can never match and a
  // gazetteer entry sharing a night area's name would print twice with
  // identical visible text.
  const seen = new Set(areaHits.map((row) => rowIdentity(row.name)));

  const localityHits: ChooseAreaNeighbourhood[] = [];
  for (const locality of localities) {
    const haystack = `${locality.name} ${locality.borough}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    localityHits.push({
      slug: `locality:${locality.name.toLowerCase().replace(/\s+/g, "-")}`,
      name: locality.name,
      pubCount: null,
      center: [locality.lng, locality.lat],
    });
  }

  const merged = [...areaHits];
  for (const row of localityHits) {
    const identity = rowIdentity(row.name);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(row);
  }
  return merged;
}

/** Other enabled cities for the sheet footer, excluding the active one. */
export function otherCityRows(activeCityId: CityId): ChooseAreaCityRow[] {
  return listEnabledCities()
    .filter((city) => city.id !== activeCityId)
    .map((city) => ({ cityId: city.id, name: city.displayName }));
}
