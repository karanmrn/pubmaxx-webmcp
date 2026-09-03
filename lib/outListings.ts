// Out L1 listing policy. The page composes existing What's-On rows into
// Tonight / Tomorrow / Weekend chips. No new API.

import {
  WHATS_ON_KINDS,
  filterTonight,
  type WhatsOnKind,
  type WhatsOnKindObservedAt,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export const OUT_DAY_WINDOWS = ["tonight", "tomorrow", "weekend"] as const;
export type OutDayWindow = (typeof OUT_DAY_WINDOWS)[number];

/**
 * What /out lists: everything the What's-On vocabulary holds EXCEPT deals.
 *
 * Stated as the one exclusion rather than as a list of three, so a kind added
 * to the shared taxonomy later - the L2 events lane is the next one - reaches
 * this page the day it lands instead of being silently dropped by an allow-list
 * nobody remembered to widen. A deal is not an event: it has its own honesty
 * lane (lib/dealsHonesty.ts) and stays on Tonight.
 */
export const OUT_EXCLUDED_LISTING_KIND: WhatsOnKind = "deal";

export const OUT_LISTING_KINDS: readonly WhatsOnKind[] = WHATS_ON_KINDS.filter(
  (kind) => kind !== OUT_EXCLUDED_LISTING_KIND,
);

/**
 * How many cards one chip prints.
 *
 * The cap is spent on rows this page WOULD show, so it is applied after the kind
 * and window filters, never before them. Handing the cap to the What's-On read
 * instead sliced the raw dataset in its own order - deals first, music last -
 * and printed "no listings" over a city whose gigs our own truncation had
 * dropped.
 */
export const OUT_LISTING_LIMIT = 60;

/**
 * The day ONE card may print.
 *
 * A card is one row, so it dates itself from that row's own `observedAt`. The
 * per-kind map beside it is a MAXIMUM across every row of its kind, which is a
 * LANE stamp: printed on a card it would date a July artifact with whatever the
 * freshest row of the same kind was observed at. It is only the fallback, for a
 * row that carries no usable day of its own, and when it cannot answer either
 * the card says so rather than borrowing somebody else's day.
 *
 * Preferring the ROW is only honest while /out is baseline-only. A LIVE row's
 * `observedAt` falls back to the request instant when the provider states none
 * (lib/whatsOnStore.ts, "a LIVE row's is not"), and the live lane maps
 * gig/nightlife onto `music`, which this page lists. What keeps that off the
 * card is `app/out/page.tsx` passing a `fetchLive` that returns an empty array.
 * Re-enable the live layer here and this preference has to be gated on the row
 * not being one of its rows.
 */
export function outCardObservedAt(
  row: { kind: WhatsOnKind; observedAt?: string | null },
  kindObservedAt: WhatsOnKindObservedAt,
): string | null {
  if (typeof row.observedAt === "string" && Number.isFinite(Date.parse(row.observedAt))) {
    return row.observedAt;
  }
  return kindObservedAt[row.kind] ?? null;
}

/**
 * Open plans copy on /out.
 *
 * L3 hides the whole section until at least three sendable plans exist
 * (lib/outDesktopGrouping.ts). These strings stay beside the listings copy so
 * the foot link and any future placeholder reuse one named line rather than
 * hunting a sentence typed into a component.
 */
export const OUT_OPEN_PLANS_PLACEHOLDER_LINE = "Open plans arrive here.";
export const OUT_OPEN_PLANS_WAY_LABEL = "Start a plan";

/** A read that could not answer is not an empty city. */
export type OutListingsReadStatus = "ready" | "degraded";

const WINDOW_NOUN: Record<OutDayWindow, string> = {
  tonight: "tonight",
  tomorrow: "tomorrow",
  weekend: "the weekend",
};

/**
 * The window as a sentence names it. One table feeds the heading, the empty
 * line and the unmatched notice, so no two lines on /out can disagree about
 * which night the reader asked for.
 */
export function outWindowNoun(window: OutDayWindow): string {
  return WINDOW_NOUN[window];
}

/**
 * The heading above the listing cards on /out.
 *
 * It covers the WHOLE list, which is every What's-On kind except deals
 * (OUT_LISTING_KINDS), so it may not be named for one of them: a pub quiz and a
 * televised match are listings, and neither is a live event. It may not be
 * named for a vendor either - Ticketmaster and Skiddle supply rows, they do not
 * define the lane.
 *
 * It names the window it is listing, off the SAME noun table the empty line
 * uses, so the heading and the sentence under it can never disagree about which
 * night the reader asked for.
 */
export function outListingsSectionTitle(window: OutDayWindow): string {
  return `What's on ${WINDOW_NOUN[window]}`;
}

/**
 * The one sentence an empty chip prints.
 *
 * Two findings, two sentences: a window nobody has listed anything for is
 * quiet, and a read that could not run says so instead. The window names ITSELF,
 * because "nothing listed for tonight" over the Weekend chip is a claim about
 * the wrong day. Ways onward are the caller's, and they ride under both.
 */
export function outListingsEmptyLine(
  status: OutListingsReadStatus,
  window: OutDayWindow = "tonight",
): string {
  return status === "degraded"
    ? "We could not check the listings just now. Refresh to try again."
    : `Nothing listed for ${WINDOW_NOUN[window]} yet.`;
}

export function isOutDayWindow(value: unknown): value is OutDayWindow {
  return (OUT_DAY_WINDOWS as readonly string[]).includes(value as string);
}

export function parseOutDayWindow(value: string | null | undefined): OutDayWindow {
  return isOutDayWindow(value) ? value : "tonight";
}

/** The Out API names tonight as `today`. */
export function outWindowToApiDay(window: OutDayWindow): "today" | "tomorrow" | "weekend" {
  return window === "tonight" ? "today" : window;
}

function londonYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function londonWeekdayMon0(ms: number): number {
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Europe/London",
  }).format(new Date(ms));
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(label);
}

function weekendYmds(now: number): Set<string> {
  const today = londonYmd(now);
  const dow = londonWeekdayMon0(now);
  const friday =
    dow <= 4
      ? addCalendarDays(today, 4 - dow)
      : addCalendarDays(today, dow === 5 ? -1 : -2);
  return new Set([friday, addCalendarDays(friday, 1), addCalendarDays(friday, 2)]);
}

function listingKinds(rows: readonly WhatsOnRow[]): WhatsOnRow[] {
  return rows.filter((row) => OUT_LISTING_KINDS.includes(row.kind));
}

/** Rows that belong on the Out chip. Untimed rows only qualify for Tonight. */
export function filterOutListings(
  rows: readonly WhatsOnRow[],
  window: OutDayWindow,
  now: number = Date.now(),
): WhatsOnRow[] {
  const listed = listingKinds(rows);
  if (window === "tonight") return filterTonight(listed, now);
  if (window === "tomorrow") {
    const tomorrow = addCalendarDays(londonYmd(now), 1);
    return listed.filter((row) => row.startsAt && londonYmd(Date.parse(row.startsAt)) === tomorrow);
  }
  const days = weekendYmds(now);
  return listed.filter((row) => row.startsAt && days.has(londonYmd(Date.parse(row.startsAt))));
}

/**
 * The rows one chip prints: filtered to the kinds and the window FIRST, then
 * capped. The order matters - the What's-On dataset is concatenated by family
 * rather than by time, so a cap spent before the filter is spent on rows this
 * page discards and leaves the page saying the city has nothing on.
 */
export function selectOutListings(
  rows: readonly WhatsOnRow[],
  window: OutDayWindow,
  now: number = Date.now(),
  limit: number = OUT_LISTING_LIMIT,
): WhatsOnRow[] {
  return filterOutListings(rows, window, now).slice(0, limit);
}
