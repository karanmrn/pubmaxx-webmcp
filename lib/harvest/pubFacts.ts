// Filling a curated venue's missing website and hours from the operator's own
// page. PURE: markdown and search results in, stated facts out.
//
// ONLY WHAT THE PAGE SAYS. A day with no line on the page gets no entry, not an
// assumed "same as yesterday": lib/busyness.ts already reads a missing day as
// unknown and an EMPTY day list as evidence of a closed day, so inventing a
// window would turn silence into a claim the venue never made. Most operator
// pages state only today's hours inline and hide the week behind a link, which
// is why `statedDays` comes back beside the hours - one stated day is honest
// partial coverage, and the caller records it as such.
//
// AN OPERATOR PAGE IS THE VENUE'S OWN PAGE. A directory listing describes the
// venue; it does not speak for it. `pickOperatorUrl` refuses the aggregators
// outright, because a hours block lifted from a review site is somebody's
// observation of the pub rather than the pub's own statement, and this lane
// promises the second thing.

import type { OpeningWindow, WeeklyOpeningHours } from "@/lib/busyness";
import { WEEKDAY_NAMES, parseStatedClock, type WeekdayName } from "@/lib/harvest/chainDeals";

/** Hosts that describe venues rather than speak for them. */
export const NON_OPERATOR_HOSTS = [
  "tripadvisor.co.uk",
  "tripadvisor.com",
  "yelp.co.uk",
  "yelp.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "google.com",
  "goo.gl",
  "opentable.co.uk",
  "opentable.com",
  "designmynight.com",
  "timeout.com",
  "pubsgalore.co.uk",
  "whatpub.com",
  "beerintheevening.com",
  "wikipedia.org",
  "foursquare.com",
  "bookatable.co.uk",
  "quandoo.co.uk",
  "thefork.co.uk",
  "resy.com",
  "sevenrooms.com",
  "linktr.ee",
  "justeat.co.uk",
  "deliveroo.co.uk",
  "ubereats.com",
] as const;

const NON_OPERATOR = new Set<string>(NON_OPERATOR_HOSTS);

function hostOf(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isOperatorHost(value: string): boolean {
  const host = hostOf(value);
  if (!host) return false;
  return ![...NON_OPERATOR].some((deny) => host === deny || host.endsWith(`.${deny}`));
}

/**
 * Words in a venue name that say nothing about which site is its own. Generic
 * trade words belong here: "club" let ciuclub.co.uk pass for a Finchley club it
 * has nothing to do with.
 */
const NAME_STOPWORDS = new Set([
  "the",
  "and",
  "pub",
  "bar",
  "inn",
  "tavern",
  "arms",
  "house",
  "london",
  "club",
  "ltd",
  "limited",
  "company",
]);

export function venueNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 2 && !NAME_STOPWORDS.has(token));
}

export type OperatorSearchResult = { url: string; title?: string; description?: string };

/**
 * Compound public suffixes we meet. Enough for a UK-and-com harvest; the point
 * is only to find the label somebody REGISTERED, not to be a suffix database.
 */
const COMPOUND_SUFFIXES = ["co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "ac.uk", "gov.uk", "com.au"];

/**
 * The label somebody registered: "thebohemia" out of "www.thebohemia.co.uk".
 * A SUBDOMAIN does not count, because a directory hands every venue one -
 * bexleyheath-working-mens-club.wheree.com is wheree.com's page about a club,
 * not the club's own site, and matching anywhere in the host said otherwise.
 */
export function registrableLabel(host: string): string | null {
  const suffix = COMPOUND_SUFFIXES.find((candidate) => host.endsWith(`.${candidate}`));
  const withoutSuffix = suffix ? host.slice(0, -(suffix.length + 1)) : host.replace(/\.[a-z]+$/, "");
  const labels = withoutSuffix.split(".").filter(Boolean);
  return labels.length > 0 ? labels[labels.length - 1] : null;
}

/**
 * Choose the venue's OWN site from search results, or null when nothing in them
 * plainly is. A result qualifies only when its host is not a directory AND the
 * registered domain carries a distinctive word from the venue's name - a search
 * result that merely mentions the pub is not the pub's website.
 */
export function pickOperatorUrl(
  results: readonly OperatorSearchResult[],
  venueName: string,
): string | null {
  const tokens = venueNameTokens(venueName);
  if (tokens.length === 0) return null;
  for (const result of results) {
    if (!isOperatorHost(result.url)) continue;
    const host = hostOf(result.url);
    if (!host) continue;
    const label = registrableLabel(host);
    if (!label) continue;
    const flattened = label.replace(/[^a-z0-9]/g, "");
    if (tokens.some((token) => flattened.includes(token))) return result.url;
  }
  return null;
}

const WEEKDAY_LOOKUP = new Map<string, number>();
for (const [index, name] of WEEKDAY_NAMES.entries()) {
  WEEKDAY_LOOKUP.set(name.toLowerCase(), index);
  WEEKDAY_LOOKUP.set(name.slice(0, 3).toLowerCase(), index);
}

// A page writes a weekday half a dozen ways ("Tues", "Thurs", "Wednes"), and the
// capture keeps whatever it matched. Three letters identify the day on their
// own, so fall back to those rather than growing a table of spellings.
function weekdayIndexOf(word: string): number | undefined {
  const lower = word.toLowerCase();
  return WEEKDAY_LOOKUP.get(lower) ?? WEEKDAY_LOOKUP.get(lower.slice(0, 3));
}

const DAY_WORD = "(sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat)(?:day)?";
const CLOCK = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?`;

// "Monday 12pm to 11pm", "Mon - Thu: 11am - 11pm", "Sunday12pm to 11pm".
const HOURS_LINE = new RegExp(
  String.raw`^${DAY_WORD}(?:\s*-\s*${DAY_WORD})?\s*:?\s*(${CLOCK})\s*(?:to|-|until|–)\s*(${CLOCK})\s*$`,
  "i",
);
const CLOSED_LINE = new RegExp(String.raw`^${DAY_WORD}(?:\s*-\s*${DAY_WORD})?\s*:?\s*closed\s*$`, "i");

function daySpan(from: string, to: string | undefined): number[] | null {
  const start = weekdayIndexOf(from);
  if (start === undefined) return null;
  if (!to) return [start];
  const end = weekdayIndexOf(to);
  if (end === undefined) return null;
  const days: number[] = [];
  for (let step = 0; step < 7; step += 1) {
    const index = (start + step) % 7;
    days.push(index);
    if (index === end) return days;
  }
  return null;
}

export type StatedOpeningHours = {
  hours: WeeklyOpeningHours;
  /** The days the page actually spoke about, in week order. */
  statedDays: WeekdayName[];
};

/**
 * Read a venue page's stated opening hours. An explicit "closed" day yields an
 * empty window list, which lib/busyness.ts already reads as closed; a day the
 * page never mentions is simply absent.
 */
export function parseStatedOpeningHours(markdown: string): StatedOpeningHours {
  const hours: WeeklyOpeningHours = {};
  const stated = new Set<number>();

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.replace(/[‐-―]/g, "-").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    if (line.length === 0 || line.length > 48) continue;

    const closed = CLOSED_LINE.exec(line);
    if (closed) {
      const days = daySpan(closed[1], closed[2]);
      if (!days) continue;
      for (const day of days) {
        if (!stated.has(day)) hours[day] = [];
        stated.add(day);
      }
      continue;
    }

    const match = HOURS_LINE.exec(line);
    if (!match) continue;
    const days = daySpan(match[1], match[2]);
    if (!days) continue;
    const opens = parseStatedClock(match[3]);
    const closes = parseStatedClock(match[4]);
    if (!opens || !closes) continue;
    const window: OpeningWindow = { opens, closes };
    for (const day of days) {
      const existing = hours[day];
      // A page may state two windows for one day (lunch and evening). Keep both,
      // and never repeat an identical one.
      if (existing && existing.length > 0) {
        if (!existing.some((w) => w.opens === window.opens && w.closes === window.closes)) {
          existing.push(window);
        }
      } else {
        hours[day] = [window];
      }
      stated.add(day);
    }
  }

  const statedDays = [...stated].sort((a, b) => a - b).map((index) => WEEKDAY_NAMES[index]);
  return { hours, statedDays };
}

export type HarvestedPubFacts = {
  venueId: string;
  placeName: string;
  /** The operator page these facts were read off. */
  website: string;
  openingHours: WeeklyOpeningHours;
  statedDays: WeekdayName[];
  source: { label: string; url: string };
  observedAt: string;
};

/**
 * Assemble the enrichment record for one venue, or null when the page stated
 * nothing new. A page that yields no hours still yields the WEBSITE, which was
 * the other half of what was missing - but only if the venue had none.
 */
export function buildPubFacts(input: {
  venueId: string;
  placeName: string;
  operatorUrl: string;
  markdown: string;
  hadWebsite: boolean;
  observedAt: string;
  sourceLabel?: string;
}): HarvestedPubFacts | null {
  const { hours, statedDays } = parseStatedOpeningHours(input.markdown);
  const addsWebsite = !input.hadWebsite;
  if (statedDays.length === 0 && !addsWebsite) return null;
  return {
    venueId: input.venueId,
    placeName: input.placeName,
    website: input.operatorUrl,
    openingHours: hours,
    statedDays,
    source: {
      label: input.sourceLabel ?? `${input.placeName} - official site`,
      url: input.operatorUrl,
    },
    observedAt: input.observedAt,
  };
}
