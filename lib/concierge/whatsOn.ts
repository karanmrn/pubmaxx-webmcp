// Concierge What's-On intents (Task W5 / B7). Pure detection + grounding for
// natural-language "what's on" questions ("quiz tonight near me", "what's on in
// Soho", "where's showing the football", "curry club deals"). The concierge is
// GROUNDED: it answers only from real What's-On store rows (each carrying
// {source, observedAt}) and refuses honestly — "no verified listings for X" —
// when nothing matches. It never invents a listing.
//
// This module holds ONLY pure logic (detection, area/day filtering, DTO
// shaping). The route feeds it rows loaded from lib/whatsOnStore so this stays
// cheap and testable with no server imports.

import {
  WHATS_ON_KINDS,
  whatsOnBarePriceGbp,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

// A parsed What's-On concierge request. `window` is time-awareness: "tonight"
// clamps to this evening's London window; a named weekday clamps to that day;
// undefined means "any upcoming listing of this kind".
export type WhatsOnQuery = {
  kind?: WhatsOnKind;
  window?: "tonight" | "weekday";
  weekday?: number; // 0=Sun..6=Sat, only when window === "weekday"
  area?: string;
};

// Per-kind natural-language triggers. Order matters only for the human label;
// detection ORs across all of them. Kept deliberately tight — a false positive
// steals a query from the venue-ranking concierge.
const KIND_TERMS: Record<WhatsOnKind, RegExp> = {
  quiz: /\b(?:quiz|quizzes|trivia|pub quiz)\b/i,
  sport: /\b(?:sport|sports|football|footy|rugby|boxing|cricket|the match|the game|premier league|champions league|world cup|six nations|showing the)\b/i,
  deal: /\b(?:deal|deals|offer|offers|curry club|steak club|burger club|wing(?:s)? night|happy hour|2 for 1|two for one)\b/i,
  music: /\b(?:live music|gig|gigs|band|bands|dj set|karaoke|open mic|jam night)\b/i,
  event: /\b(?:comedy|stand-?up|theatre|theater|club night|playhouse)\b/i,
};

// A generic "what's on" phrasing carries a What's-On intent even without a kind.
const WHATS_ON_PHRASE = /\b(?:what'?s on|whats on|anything on|on tonight|things to do|what is on)\b/i;

// Words that follow "near"/"in"/"around" but are NOT areas.
const NON_AREA =
  /^(?:me|here|us|mine|my area|there|now|tonight|today|the\s+\S+|a\s+\S+|an\s+\S+)$/i;

function detectKind(text: string): WhatsOnKind | undefined {
  return WHATS_ON_KINDS.find((kind) => KIND_TERMS[kind].test(text));
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function detectArea(text: string): string | undefined {
  const match = text.match(
    /\b(?:near|around|in|at)\s+([\p{L}][\p{L}' .-]*?)(?=\s+(?:tonight|today|tomorrow|this|for|on|at|under|with)\b|\s*,|[.!?]|$)/iu,
  );
  const area = match?.[1]?.trim().replace(/\s+/g, " ");
  if (!area || NON_AREA.test(area)) return undefined;
  return area;
}

/**
 * Detect a What's-On intent in free text. Returns null when the query carries no
 * What's-On signal (so the route falls back to venue ranking). A query counts as
 * What's-On when it names a kind (quiz/sport/deal/music) or uses a "what's on"
 * phrasing.
 */
export function detectWhatsOnIntent(text: string): WhatsOnQuery | null {
  const kind = detectKind(text);
  const hasPhrase = WHATS_ON_PHRASE.test(text);
  if (!kind && !hasPhrase) return null;

  const query: WhatsOnQuery = {};
  if (kind) query.kind = kind;

  if (/\b(?:tonight|this evening|on tonight|right now|later tonight)\b/i.test(text)) {
    query.window = "tonight";
  } else {
    const dayMatch = text.match(
      /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    );
    if (dayMatch) {
      query.window = "weekday";
      query.weekday = WEEKDAYS[dayMatch[1].toLowerCase()];
    }
  }

  const area = detectArea(text);
  if (area) query.area = area;

  return query;
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

/**
 * Filter rows to those whose place text mentions the requested area. Rows carry
 * a placeName (often "Venue, Neighbourhood") and an optional detail (often a
 * postcode/area) — both are matched so "in Chelsea" finds "Sporting Page,
 * Chelsea". This is a factual string match, never a fuzzy relocation.
 */
export function filterRowsByArea(rows: WhatsOnRow[], area: string): WhatsOnRow[] {
  const needle = normalise(area);
  if (!needle) return rows;
  return rows.filter((row) => {
    const hay = normalise(`${row.placeName} ${row.detail ?? ""}`);
    return hay.includes(needle);
  });
}

// London weekday (0=Sun..6=Sat) of an ISO instant.
export function londonWeekday(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
  }).format(new Date(ms));
  const n = WEEKDAYS[label.toLowerCase()];
  return n === undefined ? null : n;
}

/** Filter rows whose London startsAt falls on the given weekday (0=Sun..6=Sat). */
export function filterRowsByWeekday(rows: WhatsOnRow[], weekday: number): WhatsOnRow[] {
  return rows.filter((row) => londonWeekday(row.startsAt) === weekday);
}

// Grounded, provenance-carrying listing DTO returned to the client. Mirrors the
// row's honest fields; never adds anything the row did not attest.
export type WhatsOnListingDto = {
  id: string;
  kind: WhatsOnKind;
  title: string;
  venue: string;
  venueId?: string;
  startsAt?: string;
  endsAt?: string;
  timeEvidence?: string;
  detail?: string;
  priceGbp?: number;
  confidence: WhatsOnRow["confidence"];
  source: { label: string; url: string };
};

export type WhatsOnAnswer = {
  mode: "whats-on";
  kind: WhatsOnKind | null;
  window: "tonight" | "weekday" | null;
  area: string | null;
  count: number;
  listings: WhatsOnListingDto[];
  message: string;
};

function toDto(row: WhatsOnRow): WhatsOnListingDto {
  const dto: WhatsOnListingDto = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    venue: row.placeName,
    confidence: row.confidence,
    source: { label: row.source.label, url: row.source.url },
  };
  if (row.startsAt) dto.startsAt = row.startsAt;
  if (row.venueId) dto.venueId = row.venueId;
  if (row.endsAt) dto.endsAt = row.endsAt;
  if (row.timeEvidence) dto.timeEvidence = row.timeEvidence;
  if (row.detail) dto.detail = row.detail;
  const barePrice = whatsOnBarePriceGbp(row);
  if (barePrice !== null) dto.priceGbp = barePrice;
  return dto;
}

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function kindNoun(kind: WhatsOnKind | undefined, plural: boolean): string {
  const map: Record<WhatsOnKind, [string, string]> = {
    quiz: ["quiz night", "quiz nights"],
    sport: ["live-sport screening", "live-sport screenings"],
    deal: ["deal", "deals"],
    music: ["live-music night", "live-music nights"],
    event: ["listed night", "listed nights"],
  };
  if (!kind) return plural ? "listings" : "listing";
  return map[kind][plural ? 1 : 0];
}

function whenPhrase(query: WhatsOnQuery): string {
  if (query.window === "tonight") return " tonight";
  if (query.window === "weekday" && query.weekday !== undefined) {
    return ` on ${WEEKDAY_LABELS[query.weekday]}`;
  }
  return "";
}

/**
 * Shape a grounded answer from already-filtered rows. When `rows` is empty the
 * message is an honest refusal that never invents a listing.
 */
export function buildWhatsOnAnswer(
  query: WhatsOnQuery,
  rows: WhatsOnRow[],
  limit = 6,
): WhatsOnAnswer {
  const listings = rows.slice(0, Math.max(1, limit)).map(toDto);
  const kind = query.kind ?? null;
  const area = query.area?.trim() || null;
  const where = area ? ` in ${area}` : "";
  const when = whenPhrase(query);

  let message: string;
  if (listings.length === 0) {
    // Honest refusal — no verified rows, so state that plainly and stop.
    message = `No sourced ${kindNoun(query.kind, true)}${where}${when} in the listings I can check.`;
  } else {
    const noun = kindNoun(query.kind, listings.length !== 1);
    message = `Found ${listings.length} sourced ${noun}${where}${when}.`;
  }

  return {
    mode: "whats-on",
    kind,
    window: query.window ?? null,
    area,
    count: listings.length,
    listings,
    message,
  };
}
