// The fresh-facts layer (Cycle 15 Lane A). One committed, sourced, dated dataset
// of London pub news — openings, closures, refurbs, awards, threats, buzz — plus
// honest "gap" markers for areas nobody covers yet. Every surface that reads it
// (the borough chapter page, the map area context, the venue award badge) does
// so through the pure helpers below, so the join rules live in exactly one place.
//
// Provenance contract (owner's anti-slop rule): nothing here is invented. Each
// entry carries a real sourceUrl + observedAt copied from the research sweeps
// under docs/research/. Social-sourced price sightings are flagged
// confidence:"social" and are news-layer texture only — they must NEVER feed an
// authoritative price surface (the Pint Index). venueMatch is attached only by
// the conservative name+proximity matcher (scripts/lib/areaNewsMatch.mjs); when
// in doubt, no match, because a wrong badge is worse than a missing one.
//
// The dataset loader lives in areaNews.server.ts. This module is imported by
// client components, so it must remain free of Node built-ins.

import { LONDON_BOROUGHS, slugifyBorough } from "@/lib/boroughs";
import type { NightAreaSlug } from "@/lib/nightAreas";

export const AREA_NEWS_KINDS = [
  "opening",
  "closure",
  "refurb",
  "award",
  "threat",
  "buzz",
  "gap",
] as const;
export type AreaNewsKind = (typeof AREA_NEWS_KINDS)[number];

export type AreaNewsVenueMatch = {
  venueId: string;
  confidence: "high" | "medium";
};

export type AreaNewsEntry = {
  id: string;
  area: string;
  kind: AreaNewsKind;
  title: string;
  detail: string;
  sourceUrl: string;
  sourceName: string;
  observedAt: string; // ISO date (YYYY-MM-DD)
  // Present only on self-reported social sightings. News-layer context; never a
  // Pint Index input.
  confidence?: "social";
  venueMatch?: AreaNewsVenueMatch;
};

export type AreaNewsDataset = {
  version: number;
  generatedAt: string;
  entries: AreaNewsEntry[];
};

// Max items in a "New round here" block — kept small so it reads as a glance,
// not a feed.
export const NEW_ROUND_HERE_CAP = 3;

/** A dated fact may only support the "New round here" claim for 21 days. */
export const AREA_NEWS_MAX_AGE_DAYS = 21;

// Short, dry labels for each kind. No exclamation, no hype — the fact carries
// the weight.
export const KIND_LABEL: Record<AreaNewsKind, string> = {
  opening: "Opening",
  closure: "Closing",
  refurb: "Refurb",
  award: "Award",
  threat: "At risk",
  buzz: "Buzz",
  gap: "Gap",
};

const AREA_NEWS_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "16 July 2026" from an ISO date, or the raw string if it can't be parsed.
 *  Pure and client-safe. */
export function formatAreaNewsDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? iso : AREA_NEWS_DATE.format(parsed);
}

// Real Greater London borough slugs, mapped to their display names. A dataset
// entry whose `area` is one of these needs no further lookup — it IS a borough.
const BOROUGH_SLUG_TO_NAME = new Map<string, string>(
  LONDON_BOROUGHS.map((name) => [slugifyBorough(name), name]),
);

type AreaMeta = {
  /** The real London borough this neighbourhood sits in (borough slug). */
  borough: string;
  /** The Night Area this neighbourhood maps onto, when one exists. */
  nightArea?: NightAreaSlug;
  /** Human-readable label for the "New round here" heading. */
  label: string;
};

// Neighbourhood → borough (+ Night Area) join table. Keys are the finer-grain
// slugs used by the dataset when a fact is neighbourhood-specific; anything not
// here must already be a valid borough slug (identity-resolved below). Night
// Area slugs reuse lib/nightAreas vocabulary so the map's area context can light
// up without a second mapping.
const AREA_INDEX: Record<string, AreaMeta> = {
  // Central + West
  soho: { borough: "westminster", nightArea: "piccadilly-soho", label: "Soho" },
  fitzrovia: { borough: "westminster", label: "Fitzrovia" },
  marylebone: { borough: "westminster", nightArea: "marylebone", label: "Marylebone" },
  mayfair: { borough: "westminster", label: "Mayfair" },
  "covent-garden": { borough: "westminster", label: "Covent Garden" },
  bloomsbury: { borough: "camden", label: "Bloomsbury" },
  holborn: { borough: "camden", label: "Holborn" },
  "notting-hill": { borough: "kensington-and-chelsea", label: "Notting Hill" },
  hammersmith: { borough: "hammersmith-and-fulham", nightArea: "hammersmith", label: "Hammersmith" },
  fulham: { borough: "hammersmith-and-fulham", label: "Fulham" },
  chiswick: { borough: "hounslow", nightArea: "chiswick", label: "Chiswick" },
  isleworth: { borough: "hounslow", label: "Isleworth" },
  richmond: { borough: "richmond-upon-thames", nightArea: "richmond", label: "Richmond" },
  teddington: { borough: "richmond-upon-thames", label: "Teddington" },
  hampton: { borough: "richmond-upon-thames", label: "Hampton" },
  twickenham: { borough: "richmond-upon-thames", label: "Twickenham" },
  kingston: { borough: "kingston-upon-thames", label: "Kingston" },

  // East
  shoreditch: { borough: "hackney", nightArea: "shoreditch", label: "Shoreditch" },
  "hackney-wick": { borough: "hackney", label: "Hackney Wick" },
  dalston: { borough: "hackney", nightArea: "dalston", label: "Dalston" },
  "stoke-newington": { borough: "hackney", label: "Stoke Newington" },
  "bethnal-green": { borough: "tower-hamlets", label: "Bethnal Green" },
  bow: { borough: "tower-hamlets", label: "Bow" },
  whitechapel: { borough: "tower-hamlets", label: "Whitechapel" },
  limehouse: { borough: "tower-hamlets", label: "Limehouse" },
  "canary-wharf": { borough: "tower-hamlets", nightArea: "canary-wharf", label: "Canary Wharf" },
  walthamstow: { borough: "waltham-forest", label: "Walthamstow" },
  leyton: { borough: "waltham-forest", label: "Leyton" },
  stratford: { borough: "newham", label: "Stratford" },
  dagenham: { borough: "barking-and-dagenham", label: "Dagenham" },
  romford: { borough: "havering", label: "Romford" },
  ilford: { borough: "redbridge", label: "Ilford" },

  // South
  clapham: { borough: "lambeth", nightArea: "clapham", label: "Clapham" },
  "clapham-junction": { borough: "wandsworth", label: "Clapham Junction" },
  battersea: { borough: "wandsworth", label: "Battersea" },
  brixton: { borough: "lambeth", nightArea: "brixton", label: "Brixton" },
  streatham: { borough: "lambeth", label: "Streatham" },
  peckham: { borough: "southwark", nightArea: "peckham", label: "Peckham" },
  camberwell: { borough: "southwark", label: "Camberwell" },
  dulwich: { borough: "southwark", label: "Dulwich" },
  "tulse-hill": { borough: "lambeth", label: "Tulse Hill" },
  tooting: { borough: "wandsworth", label: "Tooting" },
  putney: { borough: "wandsworth", nightArea: "putney", label: "Putney" },
  wimbledon: { borough: "merton", label: "Wimbledon" },
  deptford: { borough: "lewisham", label: "Deptford" },
  "new-cross": { borough: "lewisham", label: "New Cross" },
  catford: { borough: "lewisham", label: "Catford" },
  "grove-park": { borough: "lewisham", label: "Grove Park" },
  "forest-hill": { borough: "lewisham", label: "Forest Hill" },
  "crystal-palace": { borough: "croydon", label: "Crystal Palace" },
  penge: { borough: "bromley", label: "Penge" },
  purley: { borough: "croydon", label: "Purley" },

  // North
  camden: { borough: "camden", nightArea: "camden", label: "Camden" },
  "kentish-town": { borough: "camden", label: "Kentish Town" },
  islington: { borough: "islington", nightArea: "islington", label: "Islington" },
  highbury: { borough: "islington", label: "Highbury" },
  holloway: { borough: "islington", label: "Holloway" },
  archway: { borough: "islington", label: "Archway" },
  highgate: { borough: "haringey", label: "Highgate" },
  hampstead: { borough: "camden", label: "Hampstead" },
  "west-hampstead": { borough: "camden", label: "West Hampstead" },
  "crouch-end": { borough: "haringey", label: "Crouch End" },
  "muswell-hill": { borough: "haringey", label: "Muswell Hill" },
  "wood-green": { borough: "haringey", label: "Wood Green" },
  tottenham: { borough: "haringey", label: "Tottenham" },
  harringay: { borough: "haringey", label: "Harringay" },
  "kings-cross": { borough: "camden", nightArea: "kings-cross", label: "King's Cross" },
  euston: { borough: "camden", label: "Euston" },
  greenwich: { borough: "greenwich", nightArea: "greenwich", label: "Greenwich" },
  finchley: { borough: "barnet", label: "Finchley" },
  "palmers-green": { borough: "enfield", label: "Palmers Green" },
  wembley: { borough: "brent", label: "Wembley" },
  pinner: { borough: "harrow", label: "Pinner" },
  kilburn: { borough: "brent", label: "Kilburn" },
  willesden: { borough: "brent", label: "Willesden" },
};

/** Every area slug the dataset is allowed to use: the neighbourhood keys plus
 *  every real borough slug (a borough-level fact uses the borough slug direct). */
export function isKnownAreaSlug(area: string): boolean {
  return area in AREA_INDEX || BOROUGH_SLUG_TO_NAME.has(area);
}

/** The borough slug an area belongs to, or null when the slug is unknown. */
export function resolveAreaBorough(area: string): string | null {
  const meta = AREA_INDEX[area];
  if (meta) return meta.borough;
  return BOROUGH_SLUG_TO_NAME.has(area) ? area : null;
}

/** The Night Area an area maps onto, or null. Borough-level slugs that are not
 *  themselves a Night Area resolve to null (the map context simply stays quiet). */
export function resolveAreaNightArea(area: string): NightAreaSlug | null {
  return AREA_INDEX[area]?.nightArea ?? null;
}

/** Display label for a "New round here" heading. */
export function areaLabel(area: string): string {
  const meta = AREA_INDEX[area];
  if (meta) return meta.label;
  return BOROUGH_SLUG_TO_NAME.get(area) ?? area;
}

/** A neighbourhood or borough word from the area join table, as a reader would type it. */
export function isAreaNewsPlaceLabel(value: string): boolean {
  const needle = value.trim().toLowerCase();
  if (!needle) return false;
  if (needle in AREA_INDEX) return true;
  if (BOROUGH_SLUG_TO_NAME.has(needle) || BOROUGH_SLUG_TO_NAME.has(slugifyBorough(needle))) {
    return true;
  }
  return Object.values(AREA_INDEX).some((meta) => meta.label.toLowerCase() === needle);
}

// Newest first; a stable id tiebreak keeps the order deterministic when two
// facts share a date.
function byRecency(a: AreaNewsEntry, b: AreaNewsEntry): number {
  if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Keep only dated facts that are current enough to support a fresh-facts claim. */
export function freshAreaNews(
  entries: AreaNewsEntry[],
  opts: { now?: number; maxAgeDays?: number } = {},
): AreaNewsEntry[] {
  const now = opts.now ?? Date.now();
  const maxAgeDays = Math.min(opts.maxAgeDays ?? AREA_NEWS_MAX_AGE_DAYS, AREA_NEWS_MAX_AGE_DAYS);
  const nowDay = new Date(now);
  nowDay.setUTCHours(0, 0, 0, 0);
  const oldestAllowed = nowDay.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return entries
    .filter((entry) => {
      if (validateAreaNewsEntry(entry).length > 0) return false;
      const observedAt = Date.parse(`${entry.observedAt}T00:00:00Z`);
      return Number.isFinite(observedAt) && observedAt >= oldestAllowed && observedAt <= nowDay.getTime();
    })
    .sort(byRecency);
}

/** All entries that belong to a borough (via each entry's area → borough),
 *  newest first. Pure. */
export function entriesForBorough(
  boroughSlug: string,
  entries: AreaNewsEntry[],
): AreaNewsEntry[] {
  const target = slugifyBorough(boroughSlug);
  if (!target) return [];
  return entries
    .filter((entry) => resolveAreaBorough(entry.area) === target)
    .sort(byRecency);
}

/** All entries pinned to a Night Area (area maps to it, or is it), newest first.
 *  Pure. */
export function entriesForNightArea(
  nightAreaSlug: string,
  entries: AreaNewsEntry[],
): AreaNewsEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.area === nightAreaSlug || resolveAreaNightArea(entry.area) === nightAreaSlug,
    )
    .sort(byRecency);
}

/** The award fact venue-matched to a given venue, or null. Only kind:"award"
 *  with a venueMatch to this exact id qualifies — the brass-plaque badge never
 *  fires on a name coincidence. Pure. */
export function awardForVenue(
  venueId: string,
  entries: AreaNewsEntry[],
): AreaNewsEntry | null {
  if (!venueId) return null;
  return (
    entries.find(
      (entry) => entry.kind === "award" && entry.venueMatch?.venueId === venueId,
    ) ?? null
  );
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EM_DASH_RE = /[—–]/; // em dash and en dash both banned from titles

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** Validate one entry against the schema + house rules. Returns a list of
 *  human-readable problems (empty means valid). Shared by the dataset shape
 *  test so the rules live in one place. */
export function validateAreaNewsEntry(entry: AreaNewsEntry): string[] {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return ["(invalid row): entry must be an object"];
  }
  const problems: string[] = [];
  const id = entry?.id ?? "(no id)";
  if (typeof entry.id !== "string" || !entry.id.trim()) problems.push(`${id}: missing id`);
  if (!AREA_NEWS_KINDS.includes(entry.kind)) problems.push(`${id}: bad kind "${entry.kind}"`);
  if (typeof entry.area !== "string" || !isKnownAreaSlug(entry.area)) {
    problems.push(`${id}: unknown area "${entry.area}"`);
  }
  if (typeof entry.title !== "string" || !entry.title.trim()) problems.push(`${id}: missing title`);
  else if (EM_DASH_RE.test(entry.title)) problems.push(`${id}: em/en dash in title`);
  if (typeof entry.detail !== "string" || !entry.detail.trim()) problems.push(`${id}: missing detail`);
  else if (EM_DASH_RE.test(entry.detail)) problems.push(`${id}: em/en dash in detail`);
  if (typeof entry.sourceName !== "string" || !entry.sourceName.trim()) {
    problems.push(`${id}: missing sourceName`);
  }
  if (!isValidHttpsUrl(entry.sourceUrl)) {
    problems.push(`${id}: sourceUrl must be an https URL`);
  }
  if (!isValidIsoDate(entry.observedAt)) {
    problems.push(`${id}: observedAt must be an ISO date`);
  }
  if (entry.confidence !== undefined && entry.confidence !== "social") {
    problems.push(`${id}: confidence, if present, must be "social"`);
  }
  if (entry.venueMatch !== undefined) {
    const vm = entry.venueMatch;
    if (!vm || typeof vm !== "object" || Array.isArray(vm)) {
      problems.push(`${id}: venueMatch must be an object`);
    } else {
      if (typeof vm.venueId !== "string" || !/^venue-/.test(vm.venueId)) {
        problems.push(`${id}: venueMatch.venueId must be a venue- id`);
      }
      if (vm.confidence !== "high" && vm.confidence !== "medium") {
        problems.push(`${id}: venueMatch.confidence must be high|medium`);
      }
    }
  }
  return problems;
}
