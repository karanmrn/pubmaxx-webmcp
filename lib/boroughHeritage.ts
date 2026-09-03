// Borough heritage rollup — the pure, React-free aggregation behind the
// per-borough "Historic Pubs" panel and the borough index. It groups the
// cited Historic Pubs records (lib/historic) by borough and derives a small,
// deterministic summary: how many sit in the borough, how many carry a listed
// grade, the single oldest one, and a short "notable" shortlist.
//
// Provenance contract mirrors lib/historic / lib/historicFilter: this module
// only ever reads, groups, and reorders the loaded records — it never
// fabricates a field. `count`, `listedCount`, `oldest`, and `notable` are all
// derived purely from the data. Borough → URL slug reuses slugifyBorough from
// lib/boroughs, and the "oldest first" comparison reuses eraStartYear from
// lib/historicFilter, so the ordering rules live in exactly one place.

import { loadHistoricPubs, type HistoricPub } from "@/lib/historic";
import { slugifyBorough } from "@/lib/boroughs";
import { eraStartYear } from "@/lib/historicFilter";

export type BoroughHeritage = {
  borough: string; // display name (from the pubs' borough field)
  slug: string; // slugifyBorough(borough)
  count: number; // historic pubs in this borough
  listedCount: number; // how many have a listed grade
  oldest: HistoricPub | null; // earliest-era pub; null if none in-borough has an era
  notable: HistoricPub[]; // up to 6, ordered below
};

// Up to this many pubs surface in the notable shortlist.
export const NOTABLE_CAP = 6;

// Rank a listed grade by architectural importance so the shortlist can prefer
// the more significant buildings: Grade I → II* → II. Anything ungraded (null)
// or unrecognised sorts last. The current dataset only carries II*/II, but the
// grade field's type allows I, so we rank it explicitly rather than assume.
function listedRank(listed: string | null): number {
  switch (listed) {
    case "I":
      return 0;
    case "II*":
      return 1;
    case "II":
      return 2;
    default:
      return 3;
  }
}

// Which shortlist tier a pub falls into: dated pubs lead (0), then undated but
// listed pubs (1), then everything else (2). Deterministic — depends only on
// the record's own era/listed fields.
function notableTier(pub: HistoricPub): number {
  if (pub.era) return 0;
  if (pub.listed) return 1;
  return 2;
}

// Build the notable shortlist for an already-in-borough set. Ordering:
//   1. pubs with an era, earliest-first (eraStartYear ascending)
//   2. then undated pubs that carry a listed grade, best grade first (I→II*→II)
//   3. then the rest
// Ties inside every tier break on name (A–Z) so the result is deterministic,
// then it is capped at NOTABLE_CAP. Pure: returns a new array.
function pickNotable(pubs: HistoricPub[]): HistoricPub[] {
  return pubs
    .slice()
    .sort((a, b) => {
      const ta = notableTier(a);
      const tb = notableTier(b);
      if (ta !== tb) return ta - tb;
      if (ta === 0) {
        const ya = eraStartYear(a.era);
        const yb = eraStartYear(b.era);
        if (ya !== yb) return ya - yb;
      } else if (ta === 1) {
        const ra = listedRank(a.listed);
        const rb = listedRank(b.listed);
        if (ra !== rb) return ra - rb;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, NOTABLE_CAP);
}

// The single earliest-era pub in a set, by eraStartYear ascending (name
// tiebreak). Only pubs carrying a non-null era are eligible; a set with no
// dated pub yields null. Pure: never mutates the input.
function pickOldest(pubs: HistoricPub[]): HistoricPub | null {
  const dated = pubs.filter((pub) => pub.era);
  if (dated.length === 0) return null;
  return dated.slice().sort((a, b) => {
    const ya = eraStartYear(a.era);
    const yb = eraStartYear(b.era);
    if (ya !== yb) return ya - yb;
    return a.name.localeCompare(b.name);
  })[0];
}

// The heritage rollup for one borough slug, computed over a HistoricPub[]. A pub
// belongs to the borough when slugifyBorough(pub.borough) === slug; pubs with a
// null borough are skipped. Returns null when no historic pub matches the slug,
// so the caller can render notFound()/an empty state rather than an empty card.
export function boroughHeritageForSlug(
  slug: string,
  pubs: HistoricPub[],
): BoroughHeritage | null {
  const target = slugifyBorough(slug);
  if (!target) return null;

  const inBorough = pubs.filter(
    (pub) => pub.borough != null && slugifyBorough(pub.borough) === target,
  );
  if (inBorough.length === 0) return null;

  // Display name taken from the first matched pub (input order) — every match
  // shares the slug, so this is a deterministic representative spelling.
  const borough = inBorough[0].borough as string;

  return {
    borough,
    slug: target,
    count: inBorough.length,
    listedCount: inBorough.filter((pub) => pub.listed).length,
    oldest: pickOldest(inBorough),
    notable: pickNotable(inBorough),
  };
}

// Convenience server loader: read the shared Historic Pubs dataset, then roll
// up the requested borough. Inherits lib/historic's defensive read (a missing
// or malformed file yields [] → null here) so it can never take a page down.
export async function loadBoroughHeritage(
  slug: string,
): Promise<BoroughHeritage | null> {
  const pubs = await loadHistoricPubs();
  return boroughHeritageForSlug(slug, pubs);
}

// One row per borough that actually has historic pubs, for the borough index:
// its slug, a representative display name, and how many historic pubs it holds.
// Pubs with a null borough are dropped. Ordered by count descending (the
// richest heritage areas lead), ties broken on borough name (A–Z) so the order
// is deterministic across renders.
export function allBoroughHeritageCounts(
  pubs: HistoricPub[],
): { slug: string; borough: string; count: number }[] {
  const byKey = new Map<string, { borough: string; count: number }>();

  for (const pub of pubs) {
    if (pub.borough == null) continue;
    const slug = slugifyBorough(pub.borough);
    if (!slug) continue;
    const entry = byKey.get(slug) ?? { borough: pub.borough, count: 0 };
    entry.count += 1;
    byKey.set(slug, entry);
  }

  return Array.from(byKey.entries())
    .map(([slug, entry]) => ({ slug, borough: entry.borough, count: entry.count }))
    .sort((a, b) => b.count - a.count || a.borough.localeCompare(b.borough));
}
