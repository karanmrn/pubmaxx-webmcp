// Reading a venue's OWN what's-on page into What's-On rows. PURE: markdown in,
// rows and drop reasons out.
//
// events_london.json has been empty since it shipped, because every discovery
// API that covers pub-scale London is partner-gated or non-commercial (see
// docs/EVENT_SOURCES_RESEARCH_2026-07-18.md). The one source that is neither is
// the venue itself, so this reads operators' own listings.
//
// THREE THINGS AN EVENT MUST STATE, or it is not a row:
//
//   A KIND we already have. Our four kinds are sport, quiz, deal and music, and
//   only an unambiguous word maps ("quiz night" -> quiz, "live music" -> music).
//   A comedy night or a supper club is DROPPED rather than filed under the
//   nearest kind, which is the same refusal eventsRefresh.mjs makes for a
//   Ticketmaster segment it cannot map.
//
//   A DATE. A listing may write the year down or leave it out. Left out, the
//   year is not guessed from "probably this one": the page's own WEEKDAY has to
//   pick it. "Friday 12 September" is only resolved when exactly one September
//   the 12th inside the forward horizon actually falls on a Friday - two
//   candidates, or a weekday that matches none, is `ambiguous-date` and no row.
//   A bare "12 September" with no weekday resolves to the next one, because a
//   what's-on page lists what is coming rather than what has been.
//
//   A TIME. Tonight is a window, so a row with no clock cannot honestly be put
//   inside or outside it. No start time, no row.
//
// The row itself is built by the caller, which owns venue identity; this module
// never invents a venueId and never reaches for a venue list.

import { WEEKDAY_NAMES } from "@/lib/harvest/chainDeals";
import type { WhatsOnKind } from "@/lib/whatsOn";

/** How far ahead a dateless-year listing may be resolved. */
export const EVENT_FORWARD_HORIZON_DAYS = 400;

/**
 * Words that name one of our kinds without ambiguity. Order matters: the first
 * match on a line wins, so "live music quiz" reads as the quiz it leads with.
 */
const KIND_WORDS: ReadonlyArray<{ pattern: RegExp; kind: WhatsOnKind }> = [
  { pattern: /\b(pub\s+)?quiz(\s+night)?\b/i, kind: "quiz" },
  { pattern: /\bbingo\b/i, kind: "quiz" },
  { pattern: /\blive\s+music\b/i, kind: "music" },
  { pattern: /\bopen\s+mic\b/i, kind: "music" },
  { pattern: /\b(dj|djs)\b/i, kind: "music" },
  { pattern: /\blive\s+band\b/i, kind: "music" },
  { pattern: /\bgig\b/i, kind: "music" },
  { pattern: /\bkaraoke\b/i, kind: "music" },
  { pattern: /\blive\s+(sport|football|rugby|racing)\b/i, kind: "sport" },
  { pattern: /\b(six nations|premier league|champions league)\b/i, kind: "sport" },
  { pattern: /\bmatch\s*day\b/i, kind: "sport" },
];

export function eventKindFrom(text: string): WhatsOnKind | null {
  for (const { pattern, kind } of KIND_WORDS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_INDEX = new Map<string, number>();
for (const [index, month] of MONTHS.entries()) {
  MONTH_INDEX.set(month, index);
  MONTH_INDEX.set(month.slice(0, 3), index);
}

const WEEKDAY_LOOKUP = new Map<string, number>();
for (const [index, name] of WEEKDAY_NAMES.entries()) {
  WEEKDAY_LOOKUP.set(name.toLowerCase(), index);
  WEEKDAY_LOOKUP.set(name.slice(0, 3).toLowerCase(), index);
}

export type ResolvedEventDate = {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
};

export type EventDateResolution =
  | { ok: true; date: ResolvedEventDate }
  | { ok: false; reason: "no-date" | "ambiguous-date" };

const DATE_LINE =
  /(?:(sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat)[a-z]*\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?/i;

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Read a date out of a listing line. With a stated year the answer is the page's
 * own; without one, the weekday decides, and an unresolvable or two-way answer
 * is refused rather than picked.
 */
export function resolveEventDate(line: string, nowMs: number): EventDateResolution {
  const match = DATE_LINE.exec(line);
  if (!match) return { ok: false, reason: "no-date" };

  const [, weekdayWord, dayText, monthText, yearText] = match;
  const month = MONTH_INDEX.get(monthText.toLowerCase().slice(0, monthText.length > 3 ? undefined : 3));
  const monthIndex = month ?? MONTH_INDEX.get(monthText.toLowerCase().slice(0, 3));
  if (monthIndex === undefined) return { ok: false, reason: "no-date" };
  const day = Number(dayText);
  if (!Number.isFinite(day) || day < 1 || day > 31) return { ok: false, reason: "no-date" };

  if (yearText) {
    const year = Number(yearText);
    if (!isRealDate(year, monthIndex + 1, day)) return { ok: false, reason: "ambiguous-date" };
    return { ok: true, date: { year, month: monthIndex + 1, day } };
  }

  const today = new Date(nowMs);
  const horizonMs = nowMs + EVENT_FORWARD_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const startYear = today.getUTCFullYear();
  const wanted = weekdayWord ? WEEKDAY_LOOKUP.get(weekdayWord.toLowerCase().slice(0, 3)) : undefined;

  const candidates: ResolvedEventDate[] = [];
  for (let year = startYear; year <= startYear + 2; year += 1) {
    if (!isRealDate(year, monthIndex + 1, day)) continue;
    const instant = Date.UTC(year, monthIndex, day);
    // Today counts; yesterday does not. A what's-on page lists what is coming.
    if (instant + 24 * 60 * 60 * 1000 <= nowMs || instant > horizonMs) continue;
    if (wanted !== undefined && new Date(instant).getUTCDay() !== wanted) continue;
    candidates.push({ year, month: monthIndex + 1, day });
  }

  if (candidates.length === 0) return { ok: false, reason: "ambiguous-date" };
  if (candidates.length > 1 && wanted === undefined) {
    // No weekday to choose between them: take the soonest, which is what an
    // upcoming-events list means by a bare day and month.
    return { ok: true, date: candidates[0] };
  }
  if (candidates.length > 1) return { ok: false, reason: "ambiguous-date" };
  return { ok: true, date: candidates[0] };
}

const TIME_IN_LINE = /(?:doors?|from|starts?|kick[- ]?off)?\s*\b(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm))\b|\b(\d{1,2}:\d{2})\b/i;

export function resolveEventClock(line: string): string | null {
  const match = TIME_IN_LINE.exec(line);
  if (!match) return null;
  const raw = (match[1] ?? match[2] ?? "").trim();
  if (raw.length === 0) return null;
  const cleaned = raw.toLowerCase().replace(/\s+/g, "");
  const parts = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(cleaned);
  if (!parts) return null;
  let hour = Number(parts[1]);
  const minute = parts[2] ? Number(parts[2]) : 0;
  const meridiem = parts[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export type VenueEventDropReason = "no-kind" | "no-date" | "ambiguous-date" | "no-time";

export type HarvestedVenueEvent = {
  title: string;
  kind: WhatsOnKind;
  date: ResolvedEventDate;
  /** 24-hour "HH:MM" in London wall-clock, as stated. */
  startClock: string;
  detail: string | null;
};

export type VenueEventParse = {
  events: HarvestedVenueEvent[];
  drops: { title: string; reason: VenueEventDropReason }[];
};

function isStructural(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("![") || /^[-*_]{3,}$/.test(trimmed);
}

function stripMarkdown(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many lines after a listing heading may still describe it. */
const LISTING_LOOKAHEAD_LINES = 5;

/**
 * Read a venue's own what's-on page. A listing is a heading plus the lines under
 * it; a heading whose lines do not state kind, date and time is dropped with the
 * reason, so the run report can say what the page was missing.
 */
export function parseVenueEventListings(markdown: string, nowMs: number): VenueEventParse {
  const events: HarvestedVenueEvent[] = [];
  const drops: { title: string; reason: VenueEventDropReason }[] = [];

  const lines = markdown.split(/\r?\n/);
  let title: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (!title) {
      body = [];
      return;
    }
    const content = body.filter((line) => !isStructural(line)).slice(0, LISTING_LOOKAHEAD_LINES);
    const haystack = [title, ...content].map(stripMarkdown);
    const joined = haystack.join(" | ");

    const kind = eventKindFrom(joined);
    if (!kind) {
      title = null;
      body = [];
      return; // not an event listing at all, so not a drop worth reporting
    }

    const dated = haystack.map((line) => resolveEventDate(line, nowMs)).find((r) => r.ok !== false || r.reason !== "no-date");
    if (!dated || dated.ok === false) {
      drops.push({ title: stripMarkdown(title), reason: dated?.ok === false ? dated.reason : "no-date" });
      title = null;
      body = [];
      return;
    }

    const startClock = haystack.map(resolveEventClock).find((clock) => clock !== null) ?? null;
    if (!startClock) {
      drops.push({ title: stripMarkdown(title), reason: "no-time" });
      title = null;
      body = [];
      return;
    }

    const detail = content.map(stripMarkdown).find((line) => line.length > 20) ?? null;
    events.push({ title: stripMarkdown(title), kind, date: dated.date, startClock, detail });
    title = null;
    body = [];
  };

  for (const raw of lines) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      flush();
      title = heading[1].trim();
      continue;
    }
    if (title) body.push(raw);
  }
  flush();

  return { events, drops };
}

/** Same-host links whose text or path offers a what's-on page. */
const EVENTS_PATH = /(what'?s[-_ ]?on|events?|gigs?|listings?|live[-_ ]music)/i;

/**
 * Find the venue's own what's-on page from its home page's links, so the
 * harvest follows a link the site published rather than guessing a path.
 */
export function findEventsPageUrl(markdown: string, siteUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(siteUrl);
  } catch {
    return null;
  }
  const links = markdown.matchAll(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g);
  for (const [, text, href] of links) {
    let candidate: URL;
    try {
      candidate = new URL(href, base);
    } catch {
      continue;
    }
    if (candidate.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    if (!EVENTS_PATH.test(candidate.pathname) && !EVENTS_PATH.test(text)) continue;
    if (!EVENTS_PATH.test(candidate.pathname)) continue; // the PATH has to agree, not just the label
    candidate.hash = "";
    return candidate.toString();
  }
  return null;
}
