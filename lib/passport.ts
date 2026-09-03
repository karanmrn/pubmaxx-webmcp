// Pint Passport aggregation — pure, backend-free (user story 29).
//
// The passport is the collectible "field-guide" view of a handle's activity:
// the numbers that make a night into identity. This module turns the raw inputs
// the profile page already has (a handle's drops + its follow/story counts) into
// a single flat PassportData shape the card renders. Everything here is pure and
// deterministic so it unit-tests with no DOM, no network, no database — the same
// stance as lib/profiles.ts, which it composes (profileStats + computeBadges).

import {
  computeBadges,
  profileStats,
  type Badge,
  type ProfileDrop,
} from "@/lib/profiles";
import { slugifyBorough } from "@/lib/boroughs";
import {
  computeBadgeEventProgress,
  type BadgeEventProgress,
  type BadgeEventProgressOptions,
} from "@/lib/badgeEvents";

// The distinct-drink signal. Drops carry an optional free-text `drink`
// ("Guinness", "Neck Oil"…); we count DISTINCT non-empty drinks, case- and
// whitespace-insensitive, so "Guinness" and " guinness " are one beer. A drop
// with no drink named contributes nothing (it is not an anonymous "unknown"
// beer). Kept loose — `drink` isn't on the base ProfileDrop, so read defensively.
function distinctBeers(drops: readonly ProfileDrop[]): number {
  const seen = new Set<string>();
  for (const d of drops) {
    const raw = (d as { drink?: unknown }).drink;
    if (typeof raw === "string") {
      const key = raw.trim().toLowerCase();
      if (key) seen.add(key);
    }
  }
  return seen.size;
}

// The passport's flat, render-ready shape. Every field is a finite number, a
// null (for "none yet"), or a string list — no optionals the card must guard, so
// the empty/first-run passport renders the same component with zeros.
export type PassportData = {
  /** Distinct pubs visited — venueId is the pub identity (drops carry it). */
  pubs: number;
  /** Distinct boroughs, when drops name one; [] when none do (never undefined). */
  boroughs: string[];
  /** Distinct named drinks ("beers"), case-insensitive. */
  beers: number;
  /** Crawls this handle has posted (passed in — no crawl-authorship on drops).
   *  TRI-STATE: null is a count the read could not answer, never "none". */
  crawls: number | null;
  /** Total pints logged (drop count). */
  pints: number;
  /** Cheapest priced pint in GBP, or null when no priced drop exists. */
  cheapestPintGbp: number | null;
  /** Story posts authored (passed in from the crawl-story count). TRI-STATE
   *  the same way `crawls` is. */
  storyPosts: number | null;
  /** EARNED badges only — the passport shows what you've done. */
  badges: Badge[];
  /** Active opted-in seasonal quest progress, hidden when legacy mode is on. */
  badgeEvents: BadgeEventProgress[];
  /** True when the handle has no activity at all — drives the first-run copy. */
  isEmpty: boolean;
};

// Optional counts the profile page resolves from other stores (follows / crawl
// stories). An OMITTED count is a clean zero: the caller claimed nothing, and
// the passport still renders rather than showing NaN/undefined. An EXPLICIT
// null is the other answer entirely - a read that could not run - and it is
// carried through to the face rather than flattened, because a zero there is a
// claim about somebody's own record that nobody measured.
export type PassportCounts = {
  crawls?: number | null;
  storyPosts?: number | null;
  badgeEvents?: BadgeEventProgressOptions;
};

function nonNegInt(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function countOrUnknown(value: number | null | undefined): number | null {
  return value === null ? null : nonNegInt(value);
}

// Distinct pubs = distinct non-empty venueIds across the handle's drops. A drop
// with no venueId (shouldn't happen for a real drop, but the DTO is loose)
// contributes nothing rather than collapsing onto an empty-string pub.
function distinctPubs(drops: readonly ProfileDrop[]): number {
  const seen = new Set<string>();
  for (const d of drops) {
    const id = typeof d.venueId === "string" ? d.venueId.trim() : "";
    if (id) seen.add(id);
  }
  return seen.size;
}

/** Keep drops whose venue sits in a borough chapter (by drop.borough or venueId). */
export function filterDropsInBorough(
  drops: readonly ProfileDrop[] | null | undefined,
  boroughName: string,
  venueIdsInBorough: readonly string[],
): ProfileDrop[] {
  const list = Array.isArray(drops) ? drops : [];
  const target = slugifyBorough(boroughName);
  if (!target) return [];
  const venueSet = new Set(
    venueIdsInBorough.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean),
  );
  return list.filter((drop) => {
    const borough = typeof drop.borough === "string" ? drop.borough.trim() : "";
    if (borough && slugifyBorough(borough) === target) return true;
    const venueId = typeof drop.venueId === "string" ? drop.venueId.trim() : "";
    return venueId ? venueSet.has(venueId) : false;
  });
}

/**
 * Borough-scoped passport slice — same shape as the profile passport, filtered
 * to one London borough chapter (user story 29 / endgame roadmap P1).
 */
export function buildBoroughPassport(
  drops: readonly ProfileDrop[] | null | undefined,
  boroughName: string,
  venueIdsInBorough: readonly string[],
  counts: PassportCounts = {},
): PassportData {
  return buildPassport(filterDropsInBorough(drops, boroughName, venueIdsInBorough), counts);
}

/**
 * Aggregate a handle's drops (+ optional external counts) into the flat
 * PassportData the card renders. Null/empty-safe: no drops yields a fully-zeroed
 * passport with `isEmpty: true` and the full unearned-badge set filtered to none.
 */
export function buildPassport(
  drops: readonly ProfileDrop[] | null | undefined,
  counts: PassportCounts = {},
): PassportData {
  const list = Array.isArray(drops) ? drops : [];
  const crawls = countOrUnknown(counts.crawls);
  // Badges are EARNED, so an unmeasured count contributes nothing towards one
  // rather than a guess: a crawl badge must not appear because a read failed.
  const stats = profileStats(list, crawls ?? 0);
  const earnedBadges = computeBadges(list, stats).filter((b) => b.earned);
  const badgeEvents = counts.badgeEvents
    ? computeBadgeEventProgress(list, counts.badgeEvents)
    : [];
  const earnedEventBadges = badgeEvents
    .filter((progress) => progress.earned)
    .map((progress) => progress.badge);
  const storyPosts = countOrUnknown(counts.storyPosts);

  return {
    pubs: distinctPubs(list),
    boroughs: stats.boroughs ?? [],
    beers: distinctBeers(list),
    crawls,
    pints: stats.pintsLogged,
    cheapestPintGbp: stats.cheapestPintGbp,
    storyPosts,
    badges: [...earnedBadges, ...earnedEventBadges],
    badgeEvents,
    // "Empty" is the honest first-run signal: nothing logged, no crawls, no
    // stories. Follower/following counts don't count as activity here — a
    // passport is about what YOU did, so a fresh handle reads as empty. An
    // UNMEASURED count is not a zero, so it holds the blank-passport copy back
    // rather than telling an author with twelve crawls to start collecting.
    isEmpty: list.length === 0 && crawls === 0 && storyPosts === 0,
  };
}
