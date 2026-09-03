import type { Venue } from "@/lib/venues";

// Pure, deterministic helpers behind the borough discovery pages (cc_plan2
// §14/§25). Each London borough gets a server-rendered, shareable page.
// Everything here is a plain transform over a Venue[] (no fetch, no React, no
// side effects) so it can be unit-tested directly against tiny fixtures (see
// __tests__/boroughs.test.ts).
//
// Integrity rule (SEO cleanup): anything these helpers label a "borough" must
// BE one. Names resolve through canonicalBorough() below — validated against
// the 33 real Greater London boroughs — never through the map UI's loose
// venueArea() fallback, which happily returns neighbourhoods (Soho, Mayfair,
// Covent Garden) and single-letter junk from visibleBoroughs[0].

/**
 * The 32 London boroughs + City of London — the same canonical names carried
 * by data/london_boroughs_simplified.json (the point-in-polygon source that
 * assigns primary_borough at build time). __tests__/boroughs.test.ts asserts
 * this list matches that GeoJSON exactly.
 */
export const LONDON_BOROUGHS: readonly string[] = [
  "Barking and Dagenham",
  "Barnet",
  "Bexley",
  "Brent",
  "Bromley",
  "Camden",
  "City of London",
  "Croydon",
  "Ealing",
  "Enfield",
  "Greenwich",
  "Hackney",
  "Hammersmith and Fulham",
  "Haringey",
  "Harrow",
  "Havering",
  "Hillingdon",
  "Hounslow",
  "Islington",
  "Kensington and Chelsea",
  "Kingston upon Thames",
  "Lambeth",
  "Lewisham",
  "Merton",
  "Newham",
  "Redbridge",
  "Richmond upon Thames",
  "Southwark",
  "Sutton",
  "Tower Hamlets",
  "Waltham Forest",
  "Wandsworth",
  "Westminster",
] as const;

export type BoroughSummary = {
  slug: string;
  name: string;
  pubCount: number;
  // The cheapest pint in the borough, in GBP, or null when no pub there carries
  // a usable price (so the page can render "—" instead of crashing).
  cheapestGbp: number | null;
};

// Kebab-case a borough name for the URL: "City of London" → "city-of-london",
// "Kensington & Chelsea" → "kensington-chelsea". Lowercased, non-alphanumerics
// collapse to single hyphens, and leading/trailing hyphens are trimmed. Empty
// or symbol-only input yields "" so callers can guard against it.
export function slugifyBorough(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Reverse a slug back to a real borough name by matching against the boroughs
// actually present in the dataset (slug equality is exact, case-insensitive).
// Returns the canonical display name, or null for a slug no borough produces —
// the page turns that null into notFound(). Reversing through the live index
// (rather than de-kebabing the string) keeps "&"/casing/"City of London"
// exactly as the data spells them.
export function boroughFromSlug(slug: string, venues: Venue[]): string | null {
  const target = slugifyBorough(slug);
  if (!target) return null;
  for (const name of boroughNames(venues)) {
    if (slugifyBorough(name) === target) return name;
  }
  return null;
}

// Canonical name lookup by slug, built once.
const CANONICAL_BY_SLUG = new Map(
  LONDON_BOROUGHS.map((name) => [slugifyBorough(name), name]),
);

/**
 * The venue's real borough — its primaryBorough (assigned by point-in-polygon
 * at build time), validated against LONDON_BOROUGHS — or null when the record
 * carries something else (a neighbourhood like Soho/Mayfair, "London", or
 * nothing). Ceremonial prefixes ("Royal Borough of Greenwich", "London
 * Borough of Camden") normalise to the canonical name; anything that isn't a
 * borough is null, never remapped by guesswork. Deliberately NO
 * visibleBoroughs fallback — that field holds neighbourhood labels and junk.
 */
export function canonicalBorough(venue: Venue): string | null {
  const raw = venue.primaryBorough?.trim();
  if (!raw) return null;
  const stripped = raw.replace(/^(?:royal|london)\s+borough\s+of\s+/i, "");
  return CANONICAL_BY_SLUG.get(slugifyBorough(stripped)) ?? null;
}

// The distinct canonical borough names present in the dataset, in first-seen
// order. Venues without a valid borough are skipped, not invented.
function boroughNames(venues: Venue[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const venue of venues) {
    const name = canonicalBorough(venue);
    if (!name) continue;
    const key = slugifyBorough(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

// All boroughs as summaries for the index page: name, how many pubs sit in it,
// and its cheapest pint. Sorted by pubCount descending (busiest areas lead),
// ties broken on name so the order is deterministic across renders.
export function listBoroughs(venues: Venue[]): BoroughSummary[] {
  const byKey = new Map<
    string,
    { name: string; pubCount: number; cheapestGbp: number | null }
  >();

  for (const venue of venues) {
    const name = canonicalBorough(venue);
    if (!name) continue;
    const slug = slugifyBorough(name);
    const entry = byKey.get(slug) ?? { name, pubCount: 0, cheapestGbp: null };
    entry.pubCount += 1;
    const price = venue.cheapestPrice;
    if (typeof price === "number") {
      entry.cheapestGbp =
        entry.cheapestGbp === null ? price : Math.min(entry.cheapestGbp, price);
    }
    byKey.set(slug, entry);
  }

  return Array.from(byKey.entries())
    .map(([slug, entry]) => ({ slug, ...entry }))
    .sort((a, b) => b.pubCount - a.pubCount || a.name.localeCompare(b.name));
}

// The venues in one borough, cheapest-first. `slug` is matched through
// slugifyBorough so it accepts the URL form directly. Priced pubs lead in
// ascending price order; unpriced pubs fall to the end (name-sorted). Ties on
// price break on name so the order is deterministic. An unknown/empty slug
// yields [] — the page renders an empty state, never a 500.
export function pubsInBorough(venues: Venue[], slug: string): Venue[] {
  const target = slugifyBorough(slug);
  if (!target) return [];
  return venues
    .filter((venue) => {
      const name = canonicalBorough(venue);
      return name !== null && slugifyBorough(name) === target;
    })
    .sort((a, b) => {
      const left = a.cheapestPrice ?? Number.POSITIVE_INFINITY;
      const right = b.cheapestPrice ?? Number.POSITIVE_INFINITY;
      return left - right || a.name.localeCompare(b.name);
    });
}
