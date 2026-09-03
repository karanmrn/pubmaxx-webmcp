// Pub Pal V0.1 concierge tool policy (ADR 0014 registry, wave R-015).
//
// Pure and browser-safe: what each of the five new tools may CLAIM, the words
// it says, and the shapes it hands back. The server handlers live beside this
// in `lib/ask/conciergeTools.server.ts`; keeping the policy here is what makes
// the honesty rules unit-testable without a data file or a clock.
//
// Three laws ride with the whole set:
//   1. A tool answers from a lane that already exists. It never derives a
//      figure, never invents a venue, and never widens a trust gate.
//   2. A read that could not run is NOT an empty city. Every empty line below
//      separates "nobody has logged this" from "we could not look".
//   3. A write is a proposal (ADR 0006). `report_occupancy` proposes a crowd
//      report and writes nothing until the reader confirms.

import { isAreaNewsPlaceLabel } from "@/lib/areaNews";
import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { drivesMap, paintsMap, type CommunityPrice } from "@/lib/communityPrice";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { isMapLensDrinkCategory } from "@/lib/drinks";
import type { DrinkCategory } from "@/lib/drinks";
import {
  OCCUPANCY_LEVEL_LABELS,
  OCCUPANCY_LEVELS,
  parseOccupancyLevel,
  type OccupancyLevel,
} from "@/lib/occupancy";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { rowEffectiveEnd } from "@/lib/whatsOn";

export {
  OCCUPANCY_LEVEL_LABELS,
  OCCUPANCY_LEVELS,
  parseOccupancyLevel,
};
export type { OccupancyLevel };

// ---------------------------------------------------------------------------
// cheapest_pint_near
// ---------------------------------------------------------------------------

/**
 * How the anchor for a "cheapest pint near X" ask was found.
 *
 * There is deliberately no `viewer` member. The tool takes a listed pub or an
 * area name and nothing else: a viewer point would cross the one egress seam
 * (`lib/geo.ts`) for an answer an area name already gives.
 */
export type CheapestNearAnchor =
  | { kind: "venue"; venueId: string; name: string; area: string }
  | { kind: "area"; area: string };

export function cheapestNearHeadline(
  anchor: CheapestNearAnchor,
  scope: "walkable" | "widened" | "none",
): string {
  if (anchor.kind === "area") return `Cheapest listed pints in ${anchor.area}`;
  if (scope === "widened") return `Nearest listed pints to ${anchor.name}`;
  return `Cheapest listed pints near ${anchor.name}`;
}

/** The line when the anchor itself could not be resolved. */
export const CHEAPEST_NEAR_NO_ANCHOR =
  "Name a listed pub or a London area and I'll find the cheapest pints round it.";

/**
 * Words that mean "where I am". They may never resolve to an anchor.
 *
 * "cheapest pint near me" arrives here as the area word "me", and a pub-name
 * match would happily land on any pub whose name holds those letters. The tool
 * refuses the reader's own position by design, so a word that only names it
 * must be refused too rather than guessed at.
 */
const DEICTIC_PLACE_WORDS: readonly string[] = [
  "me",
  "us",
  "myself",
  "ourselves",
  "mine",
  "ours",
  "here",
  "over here",
  "round here",
  "around here",
  "this area",
  "this place",
  "where i am",
  "where we are",
  "where im at",
  "current location",
  "my location",
  "my position",
];

export function isDeicticPlaceWord(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const needle = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!needle) return false;
  if (DEICTIC_PLACE_WORDS.includes(needle)) return true;
  // "my area", "my place", "my end", "my local": first person, no named place.
  return /^my\s+\S/.test(needle);
}

function nightAreaPlaceWords(): string[] {
  const words: string[] = [];
  for (const area of NIGHT_AREAS) {
    words.push(area.name, ...area.aliases);
    for (const part of area.name.split(/\s*[&,]\s*/)) {
      if (part.trim()) words.push(part);
    }
  }
  return words;
}

/**
 * A word that names a London place the pack already knows: a night area, a
 * borough, or a neighbourhood from the area join table. A leading "the"
 * means they named a pub, not a place.
 */
export function isPlaceShapedWord(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  if (!text || /^the\s+/.test(text)) return false;
  if (isDeicticPlaceWord(text)) return true;
  if (isAreaNewsPlaceLabel(text)) return true;
  if (LONDON_BOROUGHS.some((borough) => borough.toLowerCase() === text)) return true;
  return nightAreaPlaceWords().some((word) => word.toLowerCase() === text);
}

/**
 * The empty line, split three ways. A read that failed may never be worded as
 * an area with no prices in it.
 */
export function cheapestNearEmptyLine(
  anchor: CheapestNearAnchor,
  read: "ready" | "unavailable",
): string {
  if (read === "unavailable") {
    return "I couldn't read the listed prices just now, so I won't guess at the cheapest.";
  }
  const place = anchor.kind === "area" ? anchor.area : anchor.name;
  return `No listed pint prices round ${place} yet.`;
}

/**
 * One row's note: the figure is the card's, this says how far.
 *
 * The card's own place line already names the row's area, so the note may not
 * repeat it: doing so printed "Camden" twice on every card, place line and
 * note side by side.
 */
export function cheapestNearRowNote(input: {
  walkMinutes?: number | null;
}): string {
  return typeof input.walkMinutes === "number" &&
    Number.isFinite(input.walkMinutes)
    ? `${input.walkMinutes} min walk`
    : "";
}

// ---------------------------------------------------------------------------
// tonight_now
// ---------------------------------------------------------------------------

export type TonightNowSplit = {
  /** Rows whose own window is running at `now`. */
  onNow: WhatsOnRow[];
  /** Rows tonight that have not started yet. */
  later: WhatsOnRow[];
  /**
   * Rows whose listing states a DAY and no clock time. They are on tonight, but
   * nothing may say whether they have started: the source did not publish it.
   */
  dateOnly: WhatsOnRow[];
};

/**
 * Split tonight's sourced rows into what is running and what is still to come.
 *
 * "On now" is read off the row's OWN window - its stated start and the same
 * effective end `isOnTonight` uses - so nothing here invents a duration. A row
 * with no parseable start is DATE-ONLY: its listing published a day and no clock
 * time, so it can be neither running nor still to start, and calling it either
 * would be a claim about a time the source withheld.
 */
export function splitTonightRowsByNow(
  rows: readonly WhatsOnRow[],
  now: number,
): TonightNowSplit {
  const onNow: WhatsOnRow[] = [];
  const later: WhatsOnRow[] = [];
  const dateOnly: WhatsOnRow[] = [];
  for (const row of rows) {
    const startsAt = row.startsAt ? Date.parse(row.startsAt) : Number.NaN;
    if (!Number.isFinite(startsAt)) {
      dateOnly.push(row);
      continue;
    }
    const endsAt = rowEffectiveEnd(row);
    if (Number.isFinite(endsAt) && startsAt <= now && endsAt >= now) {
      onNow.push(row);
    } else {
      later.push(row);
    }
  }
  return { onNow, later, dateOnly };
}

/**
 * What we hold about how busy a pub is right now: nothing live.
 *
 * A live crowd reading is master plan R-011's, and it is not built. What people
 * do log is a Visit Report, dated the day of the visit and good for up to
 * `MAX_VISIT_AGE_DAYS`, so it can never answer "how busy is it this minute".
 * Named once here so the tool, the docs and the test all say the same thing.
 */
export const CROWD_READING_NOT_LIVE =
  "No live crowd reading yet, so what people log is a visit report, dated the day they went.";

export function tonightNowLine(input: {
  area?: string | null;
  onNow: number;
  later: number;
  /** Rows listed for tonight whose source published no start time. */
  dateOnly?: number;
  read: "ready" | "unavailable";
}): string {
  if (input.read === "unavailable") {
    return "I couldn't read tonight's listings just now.";
  }
  const where = input.area ? ` in ${input.area}` : "";
  const dateOnly = input.dateOnly ?? 0;
  if (input.onNow === 0 && input.later === 0 && dateOnly === 0) {
    return `Nothing sourced${where} for tonight.`;
  }
  // A date-only listing is counted on its own, because it can be neither
  // running nor still to start.
  if (input.onNow === 0 && input.later === 0) {
    return `${dateOnly} listed${where} tonight with no start time.`;
  }
  const running =
    input.onNow > 0
      ? `${input.onNow} on right now${where}`
      : `Nothing running${where} this minute`;
  // With date-only rows still to name, "nothing else listed tonight" would
  // contradict the sentence after it. Nothing else has a STATED START; the
  // listings without one are counted in their own clause.
  const ahead =
    input.later > 0
      ? `${input.later} still to start tonight`
      : dateOnly > 0
        ? "nothing else with a stated start"
        : "nothing else listed tonight";
  const undated =
    dateOnly > 0 ? ` ${dateOnly} more listed tonight with no start time.` : "";
  return `${running}, ${ahead}.${undated}`;
}

// ---------------------------------------------------------------------------
// venue_drinks
// ---------------------------------------------------------------------------

/**
 * The one sentence for a people-logged read that could not run.
 *
 * Both paths say it: the pub with nothing else to print, and the pub whose
 * listed pint is still on record. A listed figure is real, and it may never
 * stand in for the read that failed.
 */
export function venueDrinksUnavailableLine(venueName: string): string {
  return `I couldn't read what people have logged at ${venueName}.`;
}

export function venueDrinksEmptyLine(
  venueName: string,
  read: "ready" | "unavailable",
): string {
  if (read === "unavailable") {
    return venueDrinksUnavailableLine(venueName);
  }
  return `No drink prices logged at ${venueName} yet. Log one at the bar and it shows on that pub's page straight away.`;
}

/** What the reader is told once the cards are counted. */
export function venueDrinksAnswerLine(input: {
  venueName: string;
  figures: number;
  read: "ready" | "unavailable";
}): string {
  if (input.figures === 0) {
    return venueDrinksEmptyLine(input.venueName, input.read);
  }
  const counted = `${input.venueName}: ${input.figures} drink ${
    input.figures === 1 ? "figure" : "figures"
  } on record.`;
  return input.read === "unavailable"
    ? `${venueDrinksUnavailableLine(input.venueName)} ${counted}`
    : counted;
}

/**
 * Whether THIS figure is the one the map would paint.
 *
 * The decision is `paintsMap`'s, not a copy of it: that predicate already knows
 * the row must BE the map candidate, that the candidate must pass both trust
 * gates, and that a newer Pint Drop outranks it on the pin. The lens-category
 * gate rides on top, because "other" never paints whatever agrees with it.
 *
 * `pintDropAt` is REQUIRED and tri-state. `undefined` means the caller could
 * not read the Pint Drop lane, and a claim we cannot check is one we do not
 * make, so it answers false rather than guessing the pin.
 */
export function venueDrinkRowReachesMap(input: {
  category: DrinkCategory;
  price: CommunityPrice;
  pintDropAt: number | null | undefined;
  now: number;
}): boolean {
  if (!isMapLensDrinkCategory(input.category)) return false;
  if (input.pintDropAt === undefined) return false;
  return paintsMap(input.price, input.pintDropAt, input.now);
}

/**
 * One drink row's note: its own tag, its own day, and what it counts toward.
 *
 * Corroboration and map reach are two questions, so the note answers them
 * separately. Only a figure we have CHECKED against the pin claims the pin; a
 * corroborated figure we cannot check says that people agree and stops there,
 * and a category the map has no lens for says plainly where it stays.
 */
export function venueDrinkRowNote(input: {
  label: string;
  day: string;
  category: DrinkCategory;
  price: CommunityPrice;
  pintDropAt: number | null | undefined;
  now: number;
}): string {
  const corroborated = drivesMap(input.price, input.now);
  const standing = !corroborated
    ? "one report so far, so it stays on this pub's page"
    : venueDrinkRowReachesMap({
          category: input.category,
          price: input.price,
          pintDropAt: input.pintDropAt,
          now: input.now,
        })
      ? "two people agree, so it reaches the map"
      : isMapLensDrinkCategory(input.category)
        ? "two people agree on this figure"
        : "two people agree, and it stays on this pub's page";
  return `${input.label} · logged ${input.day} · ${standing}`;
}

export const VENUE_DRINKS_NO_VENUE =
  "Name a listed pub and I'll read back what people have logged there.";

// ---------------------------------------------------------------------------
// find_desk
// ---------------------------------------------------------------------------

/**
 * The kinds a work-friendly answer may come from.
 *
 * These are the widened venue kinds the UK extraction lane lands. They are
 * matched as plain strings on purpose: `VenueKind` does not carry them yet, and
 * a tool that hard-fails until a type widens is a tool that ships broken. A pub
 * is deliberately NOT here - a pub row carries no seating or wifi fact, so
 * offering one as a desk would be a recommendation we cannot back.
 */
export const WORK_FRIENDLY_VENUE_KINDS = [
  "cafe",
  "coworking",
  "library",
] as const;

export type WorkFriendlyVenueKind = (typeof WORK_FRIENDLY_VENUE_KINDS)[number];

export function isWorkFriendlyVenueKind(
  kind: unknown,
): kind is WorkFriendlyVenueKind {
  return (
    typeof kind === "string" &&
    (WORK_FRIENDLY_VENUE_KINDS as readonly string[]).includes(kind)
  );
}

/**
 * The honest empty answer, and the one this wave actually ships.
 *
 * Nothing in the London pack carries a seat, a plug or a wifi fact today, so
 * the tool says so rather than handing back a pub and calling it a desk.
 */
export const FIND_DESK_NO_SEAT_DATA =
  "No seat data yet. Nobody has logged a desk-friendly seat, a plug or wifi anywhere, so I won't point you at one.";

/**
 * Why a desk answer came back with nothing, kept as three separate findings.
 *
 * `unknown-area` is the one that earns its own sentence: the places list files
 * a row under the area the pack names, so a word it does not carry (a district
 * rather than its borough) is a place we never looked in. Saying "no seat data,
 * and that goes for Angel too" there would be a claim about a place we cannot
 * place at all.
 */
export type FindDeskEmptyReason = "unavailable" | "none-anywhere" | "unknown-area";

export function findDeskEmptyLine(input: {
  area: string | null;
  reason: FindDeskEmptyReason;
}): string {
  if (input.reason === "unavailable") {
    return "I couldn't read the places list just now, so I won't guess at a seat.";
  }
  if (input.reason === "unknown-area" && input.area) {
    return `I don't know an area called ${input.area}, so I haven't looked there. Name a London borough and I'll try again.`;
  }
  return FIND_DESK_NO_SEAT_DATA;
}

/** A found row's note. Says what is on record and, plainly, what is not. */
export function findDeskRowNote(input: {
  area: string;
  kind: WorkFriendlyVenueKind;
}): string {
  const noun =
    input.kind === "coworking"
      ? "co-working space"
      : input.kind === "library"
        ? "library"
        : "cafe";
  return `${noun} in ${input.area} · no seat or wifi report on record`;
}

// ---------------------------------------------------------------------------
// report_occupancy
// ---------------------------------------------------------------------------

/**
 * Whether a crowd report has anywhere to land.
 *
 * `"ready"` is the R-011 store. `"unbuilt"` remains so a rollback of the
 * store can still refuse a confirm button rather than look like it logged
 * something.
 */
export type OccupancyStoreState = "unbuilt" | "ready";

export function occupancyStoreState(): OccupancyStoreState {
  return "ready";
}

export type OccupancyReportOutcome =
  | {
      status: "no-venue";
      line: string;
    }
  | {
      status: "no-level";
      line: string;
    }
  | {
      /** Parsed and valid, but there is nowhere to write it yet. */
      status: "store-unbuilt";
      venueId: string;
      venueName: string;
      level: OccupancyLevel;
      line: string;
    }
  | {
      /** Parsed and valid; the client must confirm before anything is written. */
      status: "proposed";
      venueId: string;
      venueName: string;
      level: OccupancyLevel;
      line: string;
    };

/**
 * What a crowd report may do, given a pub, a level and the store's state.
 *
 * It never writes. With a store it hands back a proposal for the reader to
 * confirm (ADR 0006); without one it says plainly that the report has nowhere
 * to go, so a button that looked like it logged something can never exist.
 */
export function occupancyReportOutcome(input: {
  venueId: string;
  venueName: string;
  level: unknown;
  store: OccupancyStoreState;
}): OccupancyReportOutcome {
  if (!input.venueId || !input.venueName) {
    return {
      status: "no-venue",
      line: "Name the pub you're standing in and I'll take the crowd report.",
    };
  }
  const level = parseOccupancyLevel(input.level);
  if (!level) {
    return {
      status: "no-level",
      line: `Is ${input.venueName} empty, some seats, or full?`,
    };
  }
  if (input.store === "unbuilt") {
    return {
      status: "store-unbuilt",
      venueId: input.venueId,
      venueName: input.venueName,
      level,
      line: `${OCCUPANCY_LEVEL_LABELS[level]} at ${input.venueName}, got it. Crowd reports have nowhere to land yet, so I haven't saved it and nobody else will see it.`,
    };
  }
  return {
    status: "proposed",
    venueId: input.venueId,
    venueName: input.venueName,
    level,
    line: `Log ${input.venueName} as ${OCCUPANCY_LEVEL_LABELS[level].toLowerCase()}? Nothing is saved until you confirm.`,
  };
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

/**
 * OpenAI/OpenRouter schemas for the five V0.1 tools. Spread into the one
 * registry list in `lib/ask/tools.ts` so the allowlist stays a single place.
 *
 * `cheapest_pint_near` carries no lat/lng by design.
 */
export const CONCIERGE_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "cheapest_pint_near" as const,
      description:
        "Cheapest listed pints around a named pub or a London area. Never takes the reader's own position, refuses a word that only means where they are, and never invents a figure.",
      parameters: {
        type: "object",
        properties: {
          venueId: { type: "string" },
          venueName: { type: "string" },
          area: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "tonight_now" as const,
      description:
        "Sourced listings running right now versus later tonight. There is no live crowd reading, and what people log is a visit report dated the day they went, so never say how busy a pub is now.",
      parameters: {
        type: "object",
        properties: { area: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "venue_drinks" as const,
      description:
        "Every drink people have logged at one listed pub, each with its own tag, figure and day, plus the listed pint when that pub carries one. A corroborated price reaches the map only where the map has a lens for that drink.",
      parameters: {
        type: "object",
        properties: {
          venueId: { type: "string" },
          venueName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_desk" as const,
      description:
        "Places to sit and work. Answers only from cafe, co-working and library rows, and says so when there is no seat data.",
      parameters: {
        type: "object",
        properties: {
          area: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "report_occupancy" as const,
      description:
        "Take a crowd report for a pub (empty, some seats, full). Writes nothing until the reader confirms.",
      parameters: {
        type: "object",
        properties: {
          venueId: { type: "string" },
          venueName: { type: "string" },
          level: { type: "string" },
        },
      },
    },
  },
];
