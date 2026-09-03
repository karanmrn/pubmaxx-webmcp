import { haversineKm } from "@/lib/haversine";
import type { WetherspoonsPub } from "@/lib/wetherspoonsDirectory";

/** Venue shape needed to join the first-party Wetherspoon directory. */
export type WetherspoonsMatchVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

/** Exact normalised name + 250 m; shared by open-now filter and plan opening evidence. */
export const WETHERSPOONS_MATCH_MAX_KM = 0.25;

export function normalizeWetherspoonsMatchName(value: string): string {
  return value
    .toLocaleLowerCase("en-GB")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bjd wetherspoons?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

/** Closest first-party directory row for a venue, or null when name/coords disagree. */
export function matchWetherspoonsDirectoryPub(
  venue: Omit<WetherspoonsMatchVenue, "id">,
  pubs: readonly WetherspoonsPub[],
): WetherspoonsPub | null {
  const venueName = normalizeWetherspoonsMatchName(venue.name);
  if (!venueName) return null;
  return (
    pubs
      .filter((pub) => normalizeWetherspoonsMatchName(pub.name) === venueName)
      .filter((pub) => typeof pub.latitude === "number" && typeof pub.longitude === "number")
      .map((pub) => ({
        pub,
        distance: haversineKm([venue.lng, venue.lat], [pub.longitude!, pub.latitude!]),
      }))
      .filter(({ distance }) => distance <= WETHERSPOONS_MATCH_MAX_KM)
      .sort((left, right) => left.distance - right.distance)[0]?.pub ?? null
  );
}

/** Venue ids that join the first-party directory under the shared name+distance rule. */
export function matchedWetherspoonsVenueIds(
  venues: readonly WetherspoonsMatchVenue[],
  pubs: readonly WetherspoonsPub[],
): ReadonlySet<string> {
  const byName = new Map<string, WetherspoonsPub[]>();
  for (const pub of pubs) {
    const key = normalizeWetherspoonsMatchName(pub.name);
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(pub);
    else byName.set(key, [pub]);
  }
  const matched = new Set<string>();
  for (const venue of venues) {
    const key = normalizeWetherspoonsMatchName(venue.name);
    if (!key) continue;
    const candidates = byName.get(key);
    if (!candidates) continue;
    if (matchWetherspoonsDirectoryPub(venue, candidates)) matched.add(venue.id);
  }
  return matched;
}
