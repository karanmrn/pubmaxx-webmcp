/**
 * Pure labelling helpers for crawl stop cards (components/map/route/RouteList).
 *
 * A crawl can hold two pubs with the same name. London has several Queens
 * Heads, and a route through Camden printed two cards reading "The Queens Head"
 * over "Camden" with nothing else to separate them: the reader cannot tell
 * which stop is which, or whether the planner has repeated one pub by mistake.
 *
 * So a stop's place line is not a fixed field, it is whatever tells that stop
 * apart from the other stops on the SAME route. The area is enough almost
 * always; where it is not, the street joins it; where the street is not enough
 * either, the full address line does. Nothing here invents a place: every
 * candidate is read off the venue's own record.
 */

export type RouteStopPlace = {
  name: string;
  address: string;
  /** Curated story tag, the venue's own name for where it sits. */
  storyTag?: string;
  primaryBorough?: string;
  visibleBoroughs?: readonly string[];
};

/** Fallback when a venue records no area at all. */
const UNKNOWN_AREA = "London";

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A street is a proper noun, and a map pin's address is not always cased like
 * one: a slim pin recovers its address from the lower-cased search blob
 * (lib/slimPins.addressFromSlimSearchText), which was built as a key, never to
 * be read. A token that already carries a capital is left exactly as it is, so
 * "WC1X" and "McQueen" survive.
 */
function titleCasePlace(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (/[A-Z]/.test(word) ? word : word.replace(/^[a-z]/, (c) => c.toUpperCase())))
    .join(" ");
}

/** The first line of an address: "762-764 High Rd" from a full postal string. */
export function venueAddressLine(address: string): string | null {
  const line = address.split(",")[0]?.trim() ?? "";
  return line.length > 0 ? titleCasePlace(line) : null;
}

/**
 * The street a pub stands on, with the house number dropped: "High Rd" from
 * "762-764 High Rd". Returns null when the address line is only a number, so a
 * bare "762-764" never reads as a place name.
 */
export function venueStreetLabel(address: string): string | null {
  const line = venueAddressLine(address);
  if (!line) return null;
  const street = line.replace(/^[0-9]+[a-zA-Z]?(\s*[-–/]\s*[0-9]+[a-zA-Z]?)?\s+/, "").trim();
  if (street.length === 0) return null;
  if (/^[0-9]/.test(street)) return null;
  return street;
}

/** The area a stop sits in, in the venue's own words. */
export function routeStopAreaLabel(stop: RouteStopPlace): string {
  return (
    stop.storyTag?.trim() ||
    stop.primaryBorough?.trim() ||
    stop.visibleBoroughs?.[0]?.trim() ||
    UNKNOWN_AREA
  );
}

/**
 * One place line per stop, in route order. Stops that share a name get the
 * narrowest candidate that no same-named stop shares; every other stop keeps
 * the plain area, because a route of differently-named pubs already reads apart.
 */
export function routeStopPlaceLabels(stops: readonly RouteStopPlace[]): string[] {
  const sameName = new Map<string, number[]>();
  stops.forEach((stop, index) => {
    const key = normalise(stop.name);
    const seen = sameName.get(key);
    if (seen) seen.push(index);
    else sameName.set(key, [index]);
  });

  return stops.map((stop, index) => {
    const area = routeStopAreaLabel(stop);
    const siblings = (sameName.get(normalise(stop.name)) ?? []).filter((i) => i !== index);
    if (siblings.length === 0) return area;

    const candidates = [area];
    const street = venueStreetLabel(stop.address);
    if (street) candidates.push(`${street} · ${area}`);
    const line = venueAddressLine(stop.address);
    if (line && line !== street) candidates.push(`${line} · ${area}`);

    for (const candidate of candidates) {
      const shared = siblings.some((i) => sameNameCandidates(stops[i]).includes(candidate));
      if (!shared) return candidate;
    }
    return candidates[candidates.length - 1];
  });
}

/** Every place line a stop could print, used to test a candidate for collisions. */
function sameNameCandidates(stop: RouteStopPlace): string[] {
  const area = routeStopAreaLabel(stop);
  const out = [area];
  const street = venueStreetLabel(stop.address);
  if (street) out.push(`${street} · ${area}`);
  const line = venueAddressLine(stop.address);
  if (line && line !== street) out.push(`${line} · ${area}`);
  return out;
}
