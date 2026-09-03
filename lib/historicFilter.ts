// Historic Pubs — the pure, React-free filter + sort core behind the /historic
// discovery surface. Extracted so the ordering rules (especially the mixed
// year-vs-century "oldest first" comparison) can be unit-tested without a DOM.
//
// Provenance contract: this module only ever reads, filters, and reorders the
// records loaded by lib/historic — it never fabricates a field. The citation
// helpers below derive a link + label strictly from the data's own sourceRefs.

import type { HistoricPub, HistoricVenueStatus } from "@/lib/historic";

export type HistoricSort = "oldest" | "az" | "borough";

export type HistoricFilters = {
  /** Exact borough match; null = every borough. */
  borough: string | null;
  /** Only pubs carrying a listed-building grade. */
  listedOnly: boolean;
  /** Only pubs with an extracted era/date. */
  hasDate: boolean;
  sort: HistoricSort;
};

// Map an era string to a comparable *start year* for "oldest first".
//   - a plain 3–4 digit year ("1520", "1667")      → that year
//   - "Nth century" ("17th century")               → (N-1)*100, i.e. its start
//   - anything unparseable, and null               → +Infinity (sorts last)
// So a dated pub "1520" (1520) precedes "17th century" (1600) precedes "18th
// century" (1700) precedes a null-era pub — matching the required ordering.
// Centuries are ranked by their opening year so a specific 16th-century year
// still slots ahead of the generic "17th century".
export function eraStartYear(era: string | null): number {
  if (!era) return Number.POSITIVE_INFINITY;
  const century = era.match(/(\d{1,2})\s*(?:st|nd|rd|th)\s*century/i);
  if (century) {
    const n = Number(century[1]);
    if (Number.isFinite(n) && n > 0) return (n - 1) * 100;
  }
  const year = era.match(/\d{3,4}/);
  if (year) {
    const n = Number(year[0]);
    if (Number.isFinite(n)) return n;
  }
  return Number.POSITIVE_INFINITY;
}

/** The distinct boroughs actually present, A–Z. Nulls dropped. */
export function availableBoroughs(pubs: HistoricPub[]): string[] {
  const set = new Set<string>();
  for (const pub of pubs) {
    if (pub.borough) set.add(pub.borough);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Human label for a listed grade, e.g. "II*" → "Grade II*". null → null. */
export function listedBadge(listed: string | null): string | null {
  return listed ? `Grade ${listed}` : null;
}

/** Venue lifecycle badge from stored status only — never guessed from hook text. */
export function venueStatusBadge(
  status: HistoricVenueStatus | null | undefined,
): string | null {
  if (status === "closed") return "Closed";
  if (status === "demolished") return "Demolished";
  return null;
}

// Canonical human label for a heritage fact's `source`, shared by every heritage
// surface (the map venue sheet + /historic) so the chip reads identically
// everywhere. Named public sources get their real brand; our own seed curation
// and any unrecognised token degrade to the honest generic "On record" rather
// than leaking a raw source value. A pure string→string map — safe in both
// client and server components. Needs a different case somewhere? Use CSS
// text-transform, not a divergent copy of this function.
export function heritageSourceLabel(source: string): string {
  switch (source) {
    case "wikipedia":
      return "Wikipedia";
    case "wikidata":
      return "Wikidata";
    case "osm":
      return "OpenStreetMap";
    case "nhle":
      return "Historic England";
    case "web":
      return "Web";
    case "seed":
    default:
      return "On record";
  }
}

// The citation for a pub's hook. Prefer the sourceRef of the first fact whose
// text *is* the hook (the hook is lifted verbatim from a cited fact); fall back
// to the first wikipedia fact with a ref, then to any fact with a ref. Returns
// null when nothing in the record carries a link — never a fabricated URL.
export function citationHref(pub: HistoricPub): string | null {
  const exact = pub.facts.find((f) => f.fact === pub.hook && f.sourceRef);
  if (exact?.sourceRef) return exact.sourceRef;
  const wiki = pub.facts.find((f) => f.source === "wikipedia" && f.sourceRef);
  if (wiki?.sourceRef) return wiki.sourceRef;
  const any = pub.facts.find((f) => f.sourceRef);
  return any?.sourceRef ?? null;
}

// A short, honest label for a citation link, derived from its host rather than
// assumed — most refs are Wikipedia, but some point at Wikidata/CAMRA/WhatPub,
// and we name what we actually link to.
export function citationLabel(href: string): string {
  let host = "";
  try {
    host = new URL(href).host.replace(/^www\./, "");
  } catch {
    return "Source";
  }
  if (host.includes("wikipedia.org")) return "Wikipedia";
  if (host.includes("wikidata.org")) return "Wikidata";
  if (host.includes("camra.org.uk")) return "CAMRA";
  if (host.includes("whatpub.com")) return "WhatPub";
  return host;
}

// Filter, then order. Pure: returns a new array, never mutates the input.
// Ordering always breaks ties by name (A–Z) so the result is deterministic.
export function filterAndSortHistoric(
  pubs: HistoricPub[],
  filters: HistoricFilters,
): HistoricPub[] {
  const filtered = pubs.filter((pub) => {
    if (filters.borough && pub.borough !== filters.borough) return false;
    if (filters.listedOnly && !pub.listed) return false;
    if (filters.hasDate && !pub.era) return false;
    return true;
  });

  const sorted = filtered.slice();
  switch (filters.sort) {
    case "az":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "borough":
      sorted.sort((a, b) => {
        // Undated-borough pubs (null borough) sink to the bottom.
        if (!a.borough && b.borough) return 1;
        if (a.borough && !b.borough) return -1;
        const byBorough = (a.borough ?? "").localeCompare(b.borough ?? "");
        if (byBorough !== 0) return byBorough;
        return a.name.localeCompare(b.name);
      });
      break;
    case "oldest":
    default: {
      sorted.sort((a, b) => {
        const ya = eraStartYear(a.era);
        const yb = eraStartYear(b.era);
        if (ya !== yb) return ya - yb;
        return a.name.localeCompare(b.name);
      });
      break;
    }
  }
  return sorted;
}
