// Permalink slug helpers for /venue/:slug and /pub/:slug. A slug is either a
// durable venue id, or a name + UK outward-postcode token (e.g. the-ship-w1).
// Ambiguous matches resolve to nothing: a wrong pub is worse than a branded 404.

const POSTCODE_OUTWARD_RE =
  /\b([a-z]{1,2}\d{1,2}[a-z]?)\s*\d[a-z]{2}\b/i;
const OUTWARD_ONLY_RE = /\b([a-z]{1,2}\d{1,2}[a-z]?)\b/i;

export function slugifyVenueName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Outward postcode token from search text or address, lowercased. */
export function postcodeOutwardFromText(text: string): string | null {
  const full = text.match(POSTCODE_OUTWARD_RE);
  if (full?.[1]) return full[1].toLowerCase();
  const outward = text.match(OUTWARD_ONLY_RE);
  return outward?.[1]?.toLowerCase() ?? null;
}

/**
 * District prefixes a permalink may use. W1F also answers W1 so a short area
 * token still finds the pub without guessing between two W1 pubs.
 */
export function postcodeDistrictPrefixes(outward: string): string[] {
  const clean = outward.trim().toLowerCase();
  if (!clean) return [];
  const prefixes = new Set<string>([clean]);
  // Drop the final letter of a lettered outward (W1F → W1, SW1A → SW1).
  if (/^[a-z]{1,2}\d{1,2}[a-z]$/.test(clean)) {
    prefixes.add(clean.slice(0, -1));
  }
  return [...prefixes];
}

export type PermalinkSlugParts = {
  nameSlug: string;
  district: string | null;
};

/** Split `the-ship-w1` into name + trailing district when the tail looks UK. */
export function parsePermalinkSlug(slug: string): PermalinkSlugParts | null {
  const clean = slug.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.length > 120) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) return null;

  const parts = clean.split("-");
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1]!;
    if (/^[a-z]{1,2}\d{1,2}[a-z]?$/.test(tail)) {
      const nameSlug = parts.slice(0, -1).join("-");
      if (nameSlug) return { nameSlug, district: tail };
    }
  }
  return { nameSlug: clean, district: null };
}

export type PermalinkVenueCandidate = {
  id: string;
  name: string;
  searchText?: string;
};

/** Exact permalink keys one venue may answer. */
export function venuePermalinkKeys(venue: PermalinkVenueCandidate): string[] {
  const nameSlug = slugifyVenueName(venue.name);
  if (!nameSlug) return [];
  const keys = new Set<string>([nameSlug]);
  const outward = postcodeOutwardFromText(venue.searchText ?? "");
  if (!outward) return [...keys];
  for (const district of postcodeDistrictPrefixes(outward)) {
    keys.add(`${nameSlug}-${district}`);
    // Bare name stem (the-ship from the-ship-soho) + district for short links.
    const stem = nameSlug.replace(/-(soho|ec\d+|se\d+|n\d+|e\d+|w\d+|nw\d+|sw\d+)$/i, "");
    if (stem && stem !== nameSlug) keys.add(`${stem}-${district}`);
  }
  return [...keys];
}

/**
 * Resolve a permalink slug to exactly one venue id. Zero or many matches → null.
 * Raw venue ids are accepted as-is when `byId` contains them.
 */
export function matchVenuePermalinkSlug(
  slug: string,
  venues: readonly PermalinkVenueCandidate[],
  byId?: ReadonlyMap<string, PermalinkVenueCandidate>,
): string | null {
  const clean = slug.trim();
  if (!clean) return null;
  if (byId?.has(clean)) return clean;

  const parsed = parsePermalinkSlug(clean);
  if (!parsed) return null;

  const needle = parsed.district
    ? `${parsed.nameSlug}-${parsed.district}`
    : parsed.nameSlug;

  // `venuePermalinkKeys` always seeds its set with `slugifyVenueName(venue.name)`
  // (the bare name-only key), so a name-only `needle` (no district) can only
  // ever match through that first key - there is no separate name-only case
  // for `keys.includes(needle)` to miss.
  const hits: string[] = [];
  for (const venue of venues) {
    const keys = venuePermalinkKeys(venue);
    if (keys.includes(needle)) hits.push(venue.id);
  }
  return hits.length === 1 ? hits[0]! : null;
}
