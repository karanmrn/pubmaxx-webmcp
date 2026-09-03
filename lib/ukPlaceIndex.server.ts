import "server-only";

// Server-side resolution of a `/map?place=…` arrival against the shipped UK
// place index.
//
// The place name is printed in the page title, the description, the social
// card and the on-map banner, so it may never be free text off the query
// string: a stranger could otherwise render their own copy inside PUBMAXX
// chrome and share it as ours. The name is looked up in our own index and the
// arrival carries the INDEXED name and the INDEXED coordinates; the URL's
// lat/lng only chooses between same-named places. Anything the index does not
// know is refused, and the map falls back to its ordinary London arrival.
//
// The index file is opened at request time, so next.config.mjs declares it in
// outputFileTracingIncludes for /map, from the same path constant this module
// reads (__tests__/mapPlaceTracing.test.ts pins the pair). An untraced file
// would fail the way CLAUDE.md warns about: every town deep link would answer
// as an ordinary London map with nothing anywhere saying why. So a failed read
// is logged and NOT cached, and the next request tries again.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { enabledCityContainingPoint } from "@/lib/cities";
import { UK_PLACE_INDEX_FILE } from "@/lib/ukPlaceIndexFile.mjs";
import {
  normaliseUkPlaceQuery,
  parseUkPlaceIndex,
  parseUkPlaceMapArrival,
  type UkPlace,
  type UkPlaceMapArrival,
} from "@/lib/ukPlaceSearch";

const INDEX_FILE = join(
  /* turbopackIgnore: true */ process.cwd(),
  UK_PLACE_INDEX_FILE,
);

let byName: Map<string, UkPlace[]> | null = null;
let reported = false;

function placeIndex(): Map<string, UkPlace[]> | null {
  if (byName) return byName;
  try {
    const places = parseUkPlaceIndex(
      JSON.parse(
        readFileSync(/* turbopackIgnore: true */ INDEX_FILE, "utf8"),
      ) as unknown,
    );
    if (places.length === 0) throw new Error("index has no usable place rows");
    const index = new Map<string, UkPlace[]>();
    for (const place of places) {
      const rows = index.get(place.search);
      if (rows) rows.push(place);
      else index.set(place.search, [place]);
    }
    byName = index;
    reported = false;
    return index;
  } catch (error) {
    if (!reported) {
      reported = true;
      console.error(
        `[uk-place-index] ${UK_PLACE_INDEX_FILE} is unreadable, so every /map?place= arrival answers as London until it is back`,
        error,
      );
    }
    return null;
  }
}

/**
 * The arrival for a `/map` query string, or null when the place is not one of
 * ours. Never returns a name or a coordinate that did not come from the index.
 */
export function resolveUkPlaceMapArrival(
  search: string | URLSearchParams,
): UkPlaceMapArrival | null {
  const requested = parseUkPlaceMapArrival(search);
  if (!requested) return null;
  const candidates = placeIndex()?.get(normaliseUkPlaceQuery(requested.name));
  if (!candidates?.length) return null;
  const nearest = candidates.reduce((closest, place) => {
    const distance =
      (place.lat - requested.lat) ** 2 + (place.lng - requested.lng) ** 2;
    const closestDistance =
      (closest.lat - requested.lat) ** 2 + (closest.lng - requested.lng) ** 2;
    return distance < closestDistance ? place : closest;
  });
  if (enabledCityContainingPoint(nearest.lat, nearest.lng)) return null;
  return { name: nearest.name, lat: nearest.lat, lng: nearest.lng };
}
