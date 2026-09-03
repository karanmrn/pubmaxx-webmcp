// Heritage crawls — themed walking routes generated deterministically from the
// cited historic-pub data (lib/historic + public/data/historic_pubs.json).
//
// Provenance contract: these routes are assembled ONLY from real venues that
// carry a stable venueId and real coordinates, and every date/listing shown is
// cited from the Wikipedia-sourced heritage facts — nothing is invented. The
// build is pure and deterministic (no Math.random / Date.now), so the same
// historic-pub input always yields byte-identical crawls.
//
// The emitted objects are shape-compatible with CuratedCrawl (lib/curatedCrawls)
// so they reuse the SAME rendering and map deep-link helpers (curatedCrawlMapHref)
// as the hand-curated crawls — no parallel map-link format.

import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { loadHistoricPubs, type HistoricPub } from "@/lib/historic";
// One shared era→year parser for every heritage surface. eraStartYear maps a
// year to itself, "Nth century" to its opening year ((N-1)*100), and null /
// unparseable eras to +Infinity (so undated pubs sort last) — see lib/historicFilter.
import { eraStartYear } from "@/lib/historicFilter";

// A stop only qualifies if it can actually be routed: it needs a real venueId
// AND real coordinates. Narrow to that shape once, up front.
type RoutablePub = HistoricPub & { venueId: string; lat: number; lng: number };

function isRoutable(pub: HistoricPub): pub is RoutablePub {
  return (
    typeof pub.venueId === "string" &&
    pub.venueId.length > 0 &&
    typeof pub.lat === "number" &&
    Number.isFinite(pub.lat) &&
    typeof pub.lng === "number" &&
    Number.isFinite(pub.lng)
  );
}

// Skip a theme unless it has at least this many qualifying stops.
const MIN_STOPS = 3;
// Keep each themed route to a walkable, scannable length (~6-8 stops).
const MAX_STOPS = 8;

// Keywords that mark a pub as a riverside / waterside tavern. Matched
// case-insensitively against the hook and every cited fact.
const RIVERSIDE_RE = /\b(river|thames|riverside|wharf|quay|wapping|waterside)/i;

function mentionsRiverside(pub: RoutablePub): boolean {
  if (RIVERSIDE_RE.test(pub.hook)) return true;
  return pub.facts.some((fact) => RIVERSIDE_RE.test(fact.fact));
}

// Grades that count as "highly listed" for the Grade-Listed theme, with a rank
// for ordering (Grade I is rarer/higher than II*).
const GRADE_RANK: Record<string, number> = { I: 0, "II*": 1 };

// Deterministic tiebreak on slug (stable, lowercase) so ordering never depends
// on input order or locale.
function bySlug(a: RoutablePub, b: RoutablePub): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

const PROVENANCE = "cited from Wikipedia.";

function makeCrawl(
  id: string,
  name: string,
  blurb: string,
  stops: RoutablePub[],
): CuratedCrawl | null {
  if (stops.length < MIN_STOPS) return null;
  return {
    id,
    name,
    blurb,
    // "heritage" is the crawlStyle the hand-curated history routes already use.
    crawlStyle: "heritage",
    venueIds: stops.slice(0, MAX_STOPS).map((pub) => pub.venueId),
    // No startLandmarkId / altStyle / placeStoryBandId: these are generated
    // city-wide themed sets, not tied to one landmark or Place-story corridor —
    // and the CuratedCrawl type marks all three optional.
  };
}

/**
 * Build the themed heritage crawls from the historic-pub data. Deterministic:
 * pure function of `pubs`, no clock/random. A theme with fewer than MIN_STOPS
 * qualifying (routable) stops is skipped entirely.
 */
export function buildHeritageCrawls(pubs: HistoricPub[]): CuratedCrawl[] {
  const routable = pubs.filter(isRoutable);
  const crawls: CuratedCrawl[] = [];

  // 1) London's Oldest Pubs — parseable era, earliest first.
  const oldest = routable
    .map((pub) => ({ pub, year: eraStartYear(pub.era) }))
    .filter((entry): entry is { pub: RoutablePub; year: number } => Number.isFinite(entry.year))
    .sort((a, b) => a.year - b.year || bySlug(a.pub, b.pub))
    .map((entry) => entry.pub);
  const oldestCrawl = makeCrawl(
    "heritage-oldest-pubs",
    "London's Oldest Pubs",
    `The city's oldest surviving pubs, earliest first. Every date is ${PROVENANCE}`,
    oldest,
  );
  if (oldestCrawl) crawls.push(oldestCrawl);

  // 2) Historic Riverside Taverns — river/waterside pubs, walked west→east
  //    (ascending longitude) along the Thames.
  const riverside = routable
    .filter(mentionsRiverside)
    .sort((a, b) => a.lng - b.lng || bySlug(a, b));
  const riversideCrawl = makeCrawl(
    "heritage-riverside-taverns",
    "Historic Riverside Taverns",
    `Thames-side taverns walked west to east along the river, wharf to wharf. Every stop is ${PROVENANCE}`,
    riverside,
  );
  if (riversideCrawl) crawls.push(riversideCrawl);

  // 3) Grade-Listed Classics — Grade I / II* listed pubs, by grade then era.
  const listed = routable
    .filter((pub) => pub.listed === "I" || pub.listed === "II*")
    .sort((a, b) => {
      const gradeDelta = GRADE_RANK[a.listed as string] - GRADE_RANK[b.listed as string];
      if (gradeDelta !== 0) return gradeDelta;
      const ay = eraStartYear(a.era);
      const by = eraStartYear(b.era);
      // eraStartYear returns +Infinity for an undated pub, so "dated" is the
      // finite case. Both dated → oldest first; a dated pub sorts before undated.
      const aDated = Number.isFinite(ay);
      const bDated = Number.isFinite(by);
      if (aDated && bDated && ay !== by) return ay - by;
      if (aDated && !bDated) return -1;
      if (!aDated && bDated) return 1;
      return bySlug(a, b);
    });
  const listedCrawl = makeCrawl(
    "heritage-grade-listed",
    "Grade-Listed Classics",
    `The map's most highly listed pubs. Grade II* and above, protected historic interiors. Every listing is ${PROVENANCE}`,
    listed,
  );
  if (listedCrawl) crawls.push(listedCrawl);

  return crawls;
}

/** Load the historic-pub data and build the heritage crawls from it. */
export async function loadHeritageCrawls(): Promise<CuratedCrawl[]> {
  return buildHeritageCrawls(await loadHistoricPubs());
}
