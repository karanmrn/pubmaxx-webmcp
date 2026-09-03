/**
 * Map "Open now" filter with honest unknown handling.
 *
 * Hours come from the first-party Wetherspoon directory match only (name +
 * distance). Pubs we cannot evaluate stay visible; only known-closed pubs drop.
 * No CityMCP bulk calls. No invented hours.
 */

import {
  evaluateOpenState,
  type WeeklyOpeningHours,
} from "@/lib/busyness";
import { DAY_MS } from "@/lib/dayMs";
import { OPENING_EVIDENCE_FRESH_DAYS } from "@/lib/planRouteEvidence";
import type { WetherspoonsPub } from "@/lib/wetherspoonsDirectory";
import {
  matchWetherspoonsDirectoryPub,
  normalizeWetherspoonsMatchName,
  type WetherspoonsMatchVenue,
} from "@/lib/wetherspoonsMatch";

export type OpenNowState = boolean | "unknown";

/** Caption when the Open now filter is on. */
export const OPEN_NOW_FILTER_CAPTION =
  "Showing pubs we know are open. Pubs without hours stay visible.";

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Convert directory regular opening rows into the busyness weekly shape. */
export function weeklyHoursFromWetherspoons(
  rows: WetherspoonsPub["regularOpeningTimes"] | null | undefined,
): WeeklyOpeningHours | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const hours: WeeklyOpeningHours = {};
  let any = false;
  for (const row of rows) {
    if (
      typeof row.day_of_the_week !== "string"
      || typeof row.opening_time !== "string"
      || typeof row.closing_time !== "string"
    ) continue;
    const day = WEEKDAY_INDEX[row.day_of_the_week.trim().toLowerCase()];
    if (day === undefined) continue;
    const opens = row.opening_time.trim();
    const closes = row.closing_time.trim();
    if (!opens || !closes) continue;
    const list = hours[day] ?? [];
    list.push({ opens, closes });
    hours[day] = list;
    any = true;
  }
  return any ? hours : undefined;
}

function directoryHoursAreFresh(pub: WetherspoonsPub, nowMs: number): boolean {
  if (typeof pub.observedAt !== "string") return false;
  const observed = Date.parse(pub.observedAt);
  if (!Number.isFinite(observed)) return false;
  const ageDays = (nowMs - observed) / DAY_MS;
  return ageDays >= 0 && ageDays <= OPENING_EVIDENCE_FRESH_DAYS;
}

function venueListedOpen(pub: WetherspoonsPub): boolean {
  return !Array.isArray(pub.statuses)
    || pub.statuses.length === 0
    || pub.statuses.includes("Open");
}

/**
 * Open state for one directory row at `now`. Stale, unlisted, or hour-less
 * rows stay `"unknown"` so a map filter never invents a closure.
 */
export function openStateForWetherspoonsPub(
  pub: WetherspoonsPub | null | undefined,
  now: Date = new Date(),
  timeZone = "Europe/London",
): OpenNowState {
  if (!pub) return "unknown";
  if (!directoryHoursAreFresh(pub, now.getTime())) return "unknown";
  if (!venueListedOpen(pub)) return false;
  const openingHours = weeklyHoursFromWetherspoons(pub.regularOpeningTimes);
  if (!openingHours) return "unknown";
  return evaluateOpenState({ now, timeZone, openingHours });
}

/** Open state for a curated venue via directory match. Unmatched = unknown. */
export function openStateForVenue(
  venue: Omit<WetherspoonsMatchVenue, "id">,
  pubs: readonly WetherspoonsPub[],
  now: Date = new Date(),
  timeZone = "Europe/London",
): OpenNowState {
  return openStateForWetherspoonsPub(
    matchWetherspoonsDirectoryPub(venue, pubs),
    now,
    timeZone,
  );
}

/**
 * Per-venue open-state map for the filter pipeline. Venues without a trusted
 * match stay `"unknown"`.
 */
export function openNowStatesForVenues(
  venues: readonly WetherspoonsMatchVenue[],
  pubs: readonly WetherspoonsPub[],
  now: Date = new Date(),
  timeZone = "Europe/London",
): ReadonlyMap<string, OpenNowState> {
  const byName = new Map<string, WetherspoonsPub[]>();
  for (const pub of pubs) {
    const key = normalizeWetherspoonsMatchName(pub.name);
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(pub);
    else byName.set(key, [pub]);
  }

  const states = new Map<string, OpenNowState>();
  for (const venue of venues) {
    const key = normalizeWetherspoonsMatchName(venue.name);
    const candidates = key ? byName.get(key) : undefined;
    const match = candidates
      ? matchWetherspoonsDirectoryPub(venue, candidates)
      : null;
    states.set(venue.id, openStateForWetherspoonsPub(match, now, timeZone));
  }
  return states;
}

/**
 * Filter predicate: when Open now is on, drop only known-closed pubs.
 * Known-open and unknown both stay.
 */
export function matchesOpenNowFilter(
  openNow: boolean,
  state: OpenNowState,
): boolean {
  if (!openNow) return true;
  return state !== false;
}
