// The personal line at the top of the morning brief. Pure: no fetch, no React,
// no clock of its own (the caller passes `now`), so the whole thing is unit
// testable with fixed dates.
//
// It says two things and nothing more: what time of day it is for the viewer,
// and what the sky is actually doing. The weather half reads the SAME verdict
// the Drink weather card renders (lib/drinkWeather.ts, via the WeatherBrief the
// route already composes) rather than re-deriving one, so the greeting can
// never disagree with the card beneath it.
//
// Honesty rules, matching the rest of the app:
//   - no snapshot, or a grey evening the rules table has no verdict for, and
//     the greeting falls back to a weather-free line. It never invents a sky.
//   - a stale-but-real observation keeps its headline (it is the last real read)
//     but the supporting line says so instead of asserting current conditions.
//   - the viewer's claimed handle is optional decoration; absent, the salutation
//     simply stands alone.
//
// No em dashes or en dashes anywhere (product-copy rule).

import { daySlot, type DaySlot } from "@/lib/daySlot";
import type { DrinkWeatherRuleId, VenueLens } from "@/lib/drinkWeather";
import type { WeatherBrief } from "@/lib/todayBrief";

// Re-exported so the surfaces that already read the day band from here keep
// their import. The boundaries themselves live in lib/daySlot.ts, which the
// drink-weather verdict reads too.
export { daySlot };
export type { DaySlot };

/** The four bands the copy is written for, in Europe/London wall-clock time. */

export type DayGreeting = {
  slot: DaySlot;
  /** "Good evening" or "Good evening, karan". */
  salutation: string;
  /** The hero line: time of day crossed with tonight's drink-weather lens. */
  headline: string;
  /** One supporting sentence: the date, plus the sky when we honestly have it. */
  support: string;
  /** True when the headline is carrying a real weather verdict. */
  weatherAware: boolean;
};


const SALUTATION: Record<DaySlot, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  // "Good evening" reads wrong at 2am, and "good night" reads like a goodbye.
  night: "Still up",
};

// Headline per venue lens per slot. The lens is the drink-weather verdict's own
// classification, so "beer garden" here always means the rules table said so.
const HEADLINE: Record<VenueLens, Record<DaySlot, string>> = {
  "beer-garden": {
    morning: "Garden weather today.",
    afternoon: "Proper garden weather out there.",
    evening: "Golden evening for a beer garden.",
    night: "Warm enough for the garden still.",
  },
  fireplace: {
    morning: "One for somewhere indoors today.",
    afternoon: "One for somewhere indoors.",
    evening: "An evening for somewhere indoors.",
    night: "Find somewhere indoors.",
  },
  riverside: {
    morning: "Mild enough for the river later.",
    afternoon: "Calm one. Riverside weather.",
    evening: "A calm evening by the water.",
    night: "Still calm out by the river.",
  },
  any: {
    morning: "A steady day for a pint.",
    afternoon: "An easy afternoon for a pint.",
    evening: "A settled evening for a pint.",
    night: "A quiet last one, then.",
  },
};

type FireplaceRuleId = Extract<DrinkWeatherRuleId, "hard-rain" | "cold" | "winter-porter">;

const FIREPLACE_HEADLINE: Record<FireplaceRuleId, Record<DaySlot, string>> = {
  "hard-rain": {
    morning: "Rain on the cards. One for somewhere under cover.",
    afternoon: "Rain on the cards. Find somewhere under cover.",
    evening: "Wet evening on the cards. Find somewhere under cover.",
    night: "Rain on the cards. Find somewhere under cover.",
  },
  cold: {
    morning: "One for a fireplace today.",
    afternoon: "Cold out. Fireplace weather.",
    evening: "An evening for a fire and a dark pint.",
    night: "Cold out. Find somewhere with a fire.",
  },
  "winter-porter": {
    morning: "Winter day. One for somewhere warm.",
    afternoon: "Winter out. Find somewhere cosy.",
    evening: "Winter evening. Find somewhere with a fire.",
    night: "Winter night. Find somewhere with a fire.",
  },
};

function weatherHeadline(weather: WeatherBrief, slot: DaySlot): string {
  if (weather.venueLens !== "fireplace") return HEADLINE[weather.venueLens][slot];
  if (
    weather.ruleId === "hard-rain" ||
    weather.ruleId === "cold" ||
    weather.ruleId === "winter-porter"
  ) {
    return FIREPLACE_HEADLINE[weather.ruleId][slot];
  }
  return HEADLINE.fireplace[slot];
}

// Used when there is no honest verdict to lean on. Says what the page is for
// instead of guessing at the sky.
const HEADLINE_NO_WEATHER: Record<DaySlot, string> = {
  morning: "Your day out, sorted.",
  afternoon: "Your evening, sorted.",
  evening: "Your night out, sorted.",
  night: "Still time for one.",
};

const SUPPORT_NO_WEATHER = "Tonight's best, how you'll get home, and one to remember.";

// ── Time-band copy used by the cards under the greeting ───────────────────
// These live here, next to `daySlot`, because they are the same vocabulary: a
// line that names a time of day has to name the viewer's, not the one the copy
// happened to be written in. Keeping them beside the greeting means the "no em
// dash" and honesty tests cover them too.

/** Tail for "The Tube …". Night says "right now": at 2am neither "tonight" nor
 *  "this morning" is what the viewer would call the hour they are in. */
export const TUBE_WHEN_LABEL: Record<DaySlot, string> = {
  morning: "this morning",
  afternoon: "this afternoon",
  evening: "tonight",
  night: "right now",
};

/**
 * Today's card only speaks for the list it renders. After the Out merge lands
 * on /today, an empty list is an honest quiet night, not a pointer to /tonight.
 */
export const PICKS_EMPTY_LINE: Record<DaySlot, string> = {
  morning: "Nothing on tonight's list yet.",
  afternoon: "Nothing on tonight's list yet.",
  evening: "Nothing on tonight's list yet.",
  night: "Nothing on tonight's list yet.",
};

/** A read that could not answer is not an empty night. */
export const PICKS_DEGRADED_LINE =
  "We could not check tonight's list just now. Try again in a moment.";

export type PicksListReadStatus = "ready" | "degraded";
export type PicksCardStatus = "ready" | "degraded" | "empty";

export function picksListLine(
  status: PicksListReadStatus,
  slot: DaySlot,
): string {
  return status === "degraded" ? PICKS_DEGRADED_LINE : PICKS_EMPTY_LINE[slot];
}

/**
 * What the Today picks card may claim.
 *
 * Cards, or listings the viewer filtered out, mean the read answered.
 * A failed read is never an empty night. Empty is only a ready answer
 * with nothing left to show.
 */
export function picksCardStatus(
  status: PicksListReadStatus,
  pickCount: number,
  filteredPickCount: number = 0,
): PicksCardStatus {
  if (pickCount > 0 || filteredPickCount > 0) return "ready";
  return status === "degraded" ? "degraded" : "empty";
}

/** Handles are stored lower-case; render them as typed, trimmed, never padded. */
function displayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  // A handle long enough to wrap the salutation onto three lines is decoration
  // that has stopped decorating. Drop it rather than break the header rhythm.
  return trimmed.length <= 20 ? trimmed : "";
}

export function buildDayGreeting(input: {
  now: Date;
  /** The composed weather brief, or null when there is nothing honest to show. */
  weather: WeatherBrief | null;
  /** "Saturday 25 Jul" (London), already formatted by the route. */
  dateLabel: string;
  /** The viewer's claimed device handle, when they have one. */
  name?: string | null;
}): DayGreeting {
  const slot = daySlot(input.now);
  const who = displayName(input.name);
  const salutation = who ? `${SALUTATION[slot]}, ${who}` : SALUTATION[slot];
  const weather = input.weather;

  if (!weather) {
    return {
      slot,
      salutation,
      headline: HEADLINE_NO_WEATHER[slot],
      support: `${input.dateLabel}. ${SUPPORT_NO_WEATHER}`,
      weatherAware: false,
    };
  }

  const support = weather.stale
    ? `${input.dateLabel}. Last read of the sky: ${weather.tempLabel} and ${weather.conditionLabel}.`
    : `${input.dateLabel}, ${weather.tempLabel} and ${weather.conditionLabel} in London.`;

  return {
    slot,
    salutation,
    headline: weatherHeadline(weather, slot),
    support,
    weatherAware: true,
  };
}
