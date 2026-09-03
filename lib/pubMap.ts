// Pure helpers extracted from components/PubMap.tsx (F1 decomposition).
//
// Server-safe: NO "use client", no window/DOM reads, no React. These live off
// PubMap's complexity budget and are unit-tested in __tests__/pubMap.test.ts.
// seedCrawlState is imported from the pure @/lib/crawlUrl (NOT the client
// @/components/map/useCrawlUrl re-export) so this module never pulls a client
// boundary in.

import { venueGroupingKey, type Filters, type Venue } from "@/lib/venues";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { seedCrawlState } from "@/lib/crawlUrl";
import { isDrinkShapeArrival } from "@/lib/mapArrival";
import {
  eagerCuratedCrawlAltStyle,
  eagerCuratedCrawlAltStyleForBuiltIds,
} from "@/lib/curatedCrawlHints";
export { mapSeedNeedsCuratedCrawlLookup } from "@/lib/mapSeedCrawlPolicy";

// §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
// link)? If any are present the arrival is intentional and we never onboard.
// Module-level (pure) so the branch lives off PubMap's complexity budget.
// `drink=` counts (landing drink-shape taps) but is NOT a planner-open signal.
export function hasCrawlArrivalParams(search: string): boolean {
  // Intentional deep links (landmark/band/food/log/etc.) must also suppress
  // curated onboarding — not only crawl planner params (#79 follow-up).
  return /[?&](pubs|sel|style|mode|q|drink|cocktails|landmark|band|food|max|alt|log|crawl|experience|mapNotice)=/.test(
    search,
  );
}

// Issue #15: normalise a landmark's nearest-pub ids into crawl stops — drop
// blanks, cap at three. Module-level (pure) so the branch lives outside the
// PubMap component body and off its complexity budget.
export function crawlStopsFromPubIds(ids: string[]): string[] {
  return ids.filter(Boolean).slice(0, 3);
}

// Issue #31: fold a curated crawl's style choices onto the current filters. A
// mocktail crawl composes with the non-alcoholic filter — the honest, minimal
// way an alt style touches the actual route. Module-level (pure) so the branch
// lives off PubMap's complexity budget.
export function filtersForCuratedCrawl(current: Filters, crawl: CuratedCrawl): Filters {
  return {
    ...filtersForCuratedCrawlHint(current, crawl.altStyle),
    crawlStyle: crawl.crawlStyle,
  };
}

export function filtersForCuratedCrawlHint(
  current: Filters,
  altStyle: CuratedCrawl["altStyle"],
): Filters {
  return {
    ...current,
    requireNonAlcoholic: altStyle === "mocktail" ? true : current.requireNonAlcoholic,
  };
}

export type MapSeed = ReturnType<typeof seedCrawlState> & {
  activeCrawl: CuratedCrawl | null;
  routeMapped: boolean;
};

/**
 * One-shot eager map-shell seed from the shareable URL only. No curated crawl
 * catalog is loaded here; crawl-shaped arrivals hydrate via
 * @/lib/mapSeedCrawl after the catalog chunk loads. Do NOT resurrect a previous
 * hand-built crawl from localStorage on a clean /map tab click - that bloated
 * the address bar with stale ?pubs=… (PR #79).
 */
export function buildMapSeed(search: string, _cityId: CityId = DEFAULT_CITY_ID): MapSeed {
  void _cityId;
  const seeded = seedCrawlState(search);
  if (isDrinkShapeArrival(search)) {
    return { ...seeded, activeCrawl: null, routeMapped: false };
  }
  const hintedAltStyle =
    eagerCuratedCrawlAltStyle(seeded.crawlId) ??
    eagerCuratedCrawlAltStyleForBuiltIds(seeded.builtIds);
  return {
    ...seeded,
    filters: filtersForCuratedCrawlHint(seeded.filters, hintedAltStyle),
    altStyle: hintedAltStyle ?? seeded.altStyle,
    activeCrawl: null,
    routeMapped: seeded.builtIds.length >= 2,
  };
}

export type VenueDetailStatus = "idle" | "loading" | "ready" | "missing" | "unavailable";

export function detailStatusFor(
  selectedVenueId: string,
  detailById: Map<string, Venue>,
  detailStatusById: Map<string, VenueDetailStatus>,
): VenueDetailStatus {
  if (!selectedVenueId) return "idle";
  if (detailById.has(selectedVenueId)) return "ready";
  return detailStatusById.get(selectedVenueId) ?? "loading";
}

export type MapSelectionNotice = "unknown" | "lookup-failed";

export const MAP_SELECTION_NOTICE_PARAM = "mapNotice";

export function mapSelectionNoticeFromSearch(search: string): MapSelectionNotice | null {
  const value = new URLSearchParams(search).get(MAP_SELECTION_NOTICE_PARAM);
  return value === "unknown" || value === "lookup-failed" ? value : null;
}

export function mapSelectionNotice(input: {
  loaded: boolean;
  selectedVenueId: string;
  resolvable: boolean;
  ukBase: boolean;
  detailStatus: VenueDetailStatus;
}): MapSelectionNotice | null {
  if (!input.loaded || !input.selectedVenueId || input.ukBase || input.resolvable) return null;
  if (input.detailStatus === "missing") return "unknown";
  if (input.detailStatus === "unavailable") return "lookup-failed";
  return null;
}

/** Visible copy for an unknown `?sel=` - empty-state voice, no plumbing. */
export const UNKNOWN_MAP_SELECTION_NOTE = "That pub is not one we know.";
export const MAP_SELECTION_LOOKUP_FAILED_NOTE = "We could not check that pub right now.";

export function venueUpdateKey(venue: Venue): string {
  const firstPrice = venue.prices[0];
  return firstPrice ? venueGroupingKey(firstPrice) : venue.id;
}

export function normaliseTonightVenueLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
