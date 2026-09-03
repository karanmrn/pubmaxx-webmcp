import "server-only";

// Server-side Wanted paste resolve: curated venue index + national UK base
// search. Never fetches Instagram/TikTok. Ambiguous matches stay as candidates
// for the drinker to confirm — never auto-confirm a priced pin.

import { searchCuratedVenues } from "@/lib/curatedVenueSearch.server";
import { searchUkNationalPubs } from "@/lib/ukNationalPubSearch.server";
import {
  splitWantedPaste,
  type WantedResolveCandidate,
  type WantedResolveResult,
} from "@/lib/wanted";

export type { WantedResolveCandidate, WantedResolveResult };

// The matcher itself is `lib/curatedVenueSearch.server.ts`, shared with the pub
// a drinker attaches to a message: two surfaces asking "which pub did you mean"
// must answer the same, and a copied matcher is how they stop.
async function searchCuratedPubs(
  rawQuery: string,
  limit: number,
): Promise<WantedResolveCandidate[]> {
  const hits = await searchCuratedVenues(rawQuery, limit);
  return hits.map((hit) => ({
    venueId: hit.id,
    venueName: hit.name,
    venueKind: "curated" as const,
    address: "",
    contextLabel: hit.area,
  }));
}

/**
 * Resolve a Wanted paste into confirmable candidates.
 * Curated hits lead; national UK-base hits follow, deduped by id.
 */
export async function resolveWantedPaste(
  raw: string,
  limit = 8,
): Promise<WantedResolveResult> {
  const split = splitWantedPaste(raw);
  if (!split.query && !split.sourceUrl) {
    return {
      query: "",
      sourceUrl: "",
      sourcePlatform: "none",
      rawPaste: "",
      status: "empty_query",
      candidates: [],
    };
  }
  if (!split.query) {
    // Bare URL: honest pending path — no server-side scrape for a name.
    return {
      query: "",
      sourceUrl: split.sourceUrl,
      sourcePlatform: split.sourcePlatform,
      rawPaste: split.rawPaste,
      status: "ready",
      candidates: [],
    };
  }

  const curatedLimit = Math.max(1, Math.ceil(limit / 2));
  const nationalLimit = Math.max(1, limit);
  const [curated, national] = await Promise.all([
    searchCuratedPubs(split.query, curatedLimit),
    Promise.resolve(searchUkNationalPubs(split.query, nationalLimit)),
  ]);

  const seen = new Set(curated.map((c) => c.venueId));
  const baseHits: WantedResolveCandidate[] = [];
  for (const hit of national.hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    baseHits.push({
      venueId: hit.id,
      venueName: hit.name,
      venueKind: "uk_base",
      address: hit.address,
      contextLabel: hit.address,
    });
  }

  const candidates = [...curated, ...baseHits].slice(0, limit);
  const status =
    national.status === "degraded" && curated.length === 0 ? "degraded" : "ready";

  return {
    query: split.query,
    sourceUrl: split.sourceUrl,
    sourcePlatform: split.sourcePlatform,
    rawPaste: split.rawPaste,
    status,
    candidates,
  };
}
