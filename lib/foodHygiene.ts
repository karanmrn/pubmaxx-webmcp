// Food Standards Agency (FSA) Food Hygiene Rating Scheme (FHRS) integration.
//
// PROVENANCE IS THE FEATURE: the badge on the venue sheet shows the FSA's own
// published rating, matched to a PUBMAXX venue by postcode + fuzzy name. It is
// never a PUBMAXX opinion — the source is the public FHRS open API
// (https://api.ratings.food.gov.uk, keyless, requires `x-api-version: 2`).
//
// This module is server-only glue: it NEVER runs in the browser (the route
// app/api/hygiene proxies it so the keyless-but-rate-limited upstream is only
// ever hit server-side). It owns three things:
//   1. Postcode extraction + name normalisation (pure, tested).
//   2. Fuzzy matching a venue to one FHRS establishment in its postcode.
//   3. A per-instance TTL cache keyed by (postcode, name) so a re-open of the
//      same sheet is cheap and an unmatched pub is not re-queried each time.
//      The resolved FHRSID rides in the cached value — the same cheap-re-fetch
//      idiom the CityMCP proxies use (short in-process TTLs, ADR 0007 seam).

import { DAY_MS } from "@/lib/dayMs";

const FHRS_ENDPOINT = "https://api.ratings.food.gov.uk/Establishments";
const FHRS_API_VERSION = "2";

// FHRS ratings change rarely (an establishment is re-inspected on a multi-month
// cadence). A day-long per-instance TTL keeps a warm lambda from re-hitting the
// upstream while never outliving a deploy. Negative matches are cached too, so
// the ~658 unmatched pubs cost one upstream call per instance, not one per open.
const CACHE_TTL_MS = DAY_MS;

// Only the numeric England/Wales/NI scheme (FHRS 0–5) renders a badge. Scotland
// (FHIS: "Pass"/"Improvement Required") and the non-numeric statuses
// ("AwaitingInspection", "Exempt", …) are honestly shown as no badge.
const FHRS_SCHEME = "FHRS";
const MATCH_THRESHOLD = 0.6;

export type HygieneRating = {
  /** FSA establishment id — stable key, stored so re-fetches are cheap. */
  fhrsid: number;
  /** FHRS rating 0–5 (5 = very good). Only the numeric FHRS scheme is surfaced. */
  ratingValue: number;
  /** ISO date the rating was awarded (from the FSA inspection). */
  ratingDate: string | null;
  /** FSA business name that matched — shown so the match is auditable. */
  businessName: string;
  /** Local authority that carried out the inspection. */
  localAuthority: string | null;
};

type FhrsEstablishment = {
  FHRSID?: number;
  BusinessName?: string;
  BusinessType?: string;
  PostCode?: string;
  RatingValue?: string;
  RatingDate?: string | null;
  SchemeType?: string;
  LocalAuthorityName?: string;
};

// UK postcode: outward code (e.g. "N11", "SW18", "EC1A") + inward code (digit +
// two letters). Tolerant of the missing/extra space seen in free-text addresses.
const POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;

/** Pull a normalised "OUTWARD INWARD" UK postcode out of a free-text address. */
export function extractPostcode(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.toUpperCase().match(POSTCODE_RE);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

/** Two postcodes are the same when their normalised forms are equal. */
export function postcodesMatch(a: string | null, b: string | null): boolean {
  const na = extractPostcode(a);
  const nb = extractPostcode(b);
  return na !== null && na === nb;
}

// Words that carry no matching signal for a pub name. Dropped before scoring so
// "The Ship Inn" and "Ship" still match, but never so aggressively that two
// different pubs collapse together (the distinctive tokens are kept).
const NOISE_WORDS = new Set([
  "the",
  "ltd",
  "limited",
  "plc",
  "co",
  "company",
  "pub",
  "public",
  "house",
  "bar",
  "and",
]);

/** Lowercase, de-punctuate, expand `&`, drop noise words, collapse whitespace. */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !NOISE_WORDS.has(token))
    .join(" ")
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  const compact = value.replace(/\s+/g, "");
  for (let i = 0; i < compact.length - 1; i += 1) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/**
 * Sørensen–Dice similarity over character bigrams of the two NORMALISED names,
 * in [0, 1]. Chosen over Levenshtein because it is order-tolerant and forgiving
 * of the "Arms"/"Tavern" tail differences typical of pub vs. FSA naming, while
 * still separating genuinely different pubs. An identical normalised name is 1.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0;
  for (const [gram, count] of ga) {
    const other = gb.get(gram);
    if (other) overlap += Math.min(count, other);
  }
  let total = 0;
  for (const count of ga.values()) total += count;
  for (const count of gb.values()) total += count;
  return (2 * overlap) / total;
}

function parseRatingValue(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^[0-5]$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}

/**
 * Choose the best FHRS establishment for a venue among the candidates returned
 * for its postcode. Returns null when nothing clears the fuzzy-name threshold —
 * an unmatched pub gets no badge and no error (requirement 2).
 */
export function matchEstablishment(
  venueName: string,
  candidates: readonly FhrsEstablishment[],
): HygieneRating | null {
  let best: { rating: HygieneRating; score: number; isPub: boolean } | null = null;
  for (const candidate of candidates) {
    if (candidate.SchemeType !== FHRS_SCHEME) continue;
    if (typeof candidate.FHRSID !== "number") continue;
    if (!candidate.BusinessName) continue;
    const ratingValue = parseRatingValue(candidate.RatingValue);
    if (ratingValue === null) continue;
    const score = nameSimilarity(venueName, candidate.BusinessName);
    if (score < MATCH_THRESHOLD) continue;
    const isPub = /pub|bar|nightclub/i.test(candidate.BusinessType ?? "");
    // Higher name score wins; on a near-tie a pub/bar beats a cafe next door.
    const better =
      best === null ||
      score > best.score + 0.05 ||
      (Math.abs(score - best.score) <= 0.05 && isPub && !best.isPub);
    if (!better) continue;
    best = {
      score,
      isPub,
      rating: {
        fhrsid: candidate.FHRSID,
        ratingValue,
        ratingDate:
          typeof candidate.RatingDate === "string" && candidate.RatingDate
            ? candidate.RatingDate
            : null,
        businessName: candidate.BusinessName,
        localAuthority: candidate.LocalAuthorityName ?? null,
      },
    };
  }
  return best?.rating ?? null;
}

/** Fetch every FHRS establishment sharing a postcode (one keyed upstream call). */
export async function fetchEstablishmentsByPostcode(
  postcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FhrsEstablishment[]> {
  const url = `${FHRS_ENDPOINT}?address=${encodeURIComponent(postcode)}&pageSize=50`;
  const response = await fetchImpl(url, {
    headers: {
      "x-api-version": FHRS_API_VERSION,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`FHRS upstream ${response.status}`);
  }
  const body = (await response.json()) as { establishments?: FhrsEstablishment[] };
  return Array.isArray(body.establishments) ? body.establishments : [];
}

type CacheEntry = { value: HygieneRating | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/** Test seam: drop the per-instance cache so cases don't leak into each other. */
export function resetHygieneCache(): void {
  cache.clear();
}

/**
 * Resolve the FSA hygiene rating for a venue by name + postcode. Returns null
 * for an unmatched pub, an unparseable postcode, or an upstream failure — the
 * caller renders no badge in every one of those cases (fail-soft by contract;
 * this never throws). The result (including the matched FHRSID) is cached per
 * instance so re-opening the same sheet is free.
 */
export async function resolveHygieneRating(
  venueName: string,
  postcodeOrAddress: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<HygieneRating | null> {
  const postcode = extractPostcode(postcodeOrAddress);
  if (!postcode || !venueName.trim()) return null;
  const now = options.now ?? Date.now();
  const key = `${postcode}|${normaliseName(venueName)}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  try {
    const establishments = await fetchEstablishmentsByPostcode(
      postcode,
      options.fetchImpl ?? fetch,
    );
    const value = matchEstablishment(venueName, establishments);
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch {
    // Fail-soft: don't cache an outage as a permanent "no rating".
    return null;
  }
}
