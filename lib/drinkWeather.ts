// Drink-weather rules — pure, no fetch, no React, no clock of its own.
//
// Maps tonight's cached conditions (temperature, chance of rain, month) to a
// venue lens, a drink to reach for, and one calm sensibility line. British
// sensibility, dry voice: state the weather and the obvious pint, never oversell
// it. Deterministic first-match-wins table; when nothing fits (a grey, in-between
// evening) it returns null and the caller renders no strip. We never invent a
// verdict to fill the space.
//
// The lens feeds an existing amenity/curation filter downstream:
//   beer-garden -> venue.amenities.beerGarden
//   riverside   -> venue.nearWater (curation)
//   fireplace   -> no amenity in the vocabulary, so no venue claim is made
//   any         -> no venue filter; the weather line stands alone

import type { DaySlot } from "@/lib/daySlot";

export type VenueLens = "beer-garden" | "fireplace" | "riverside" | "any";

export type DrinkWeatherRuleId =
  | "hard-rain"
  | "cold"
  | "summer-garden"
  | "warm-dry"
  | "winter-porter"
  | "mild-riverside"
  | "crisp-autumn"
  | "cool-spring"
  | "cool-default";

export type DrinkWeatherInput = {
  /** Feels-like temperature in Celsius. */
  tempC: number;
  /** Chance of rain, 0-100. */
  precipitationProbabilityPct: number;
  /** Calendar month, 1 (January) to 12 (December). */
  month: number;
  /**
   * Which part of the London day the verdict is being read in. Optional, and
   * omitting it keeps the evening wording this table was written in, so
   * /tonight is unchanged. A caller that shows the line beside a greeting
   * passes its own band (lib/daySlot.ts) or the two contradict each other.
   */
  dayPart?: DaySlot;
};

export type DrinkWeatherVerdict = {
  /** Stable identifier for the rule that fired (tests, analytics). */
  ruleId: DrinkWeatherRuleId;
  venueLens: VenueLens;
  /** The pint to reach for, lower-case noun phrase: "a cold lager or cider". */
  drinkSuggestion: string;
  /** One calm sentence for the strip: "Warm and dry. Beer garden weather." */
  line: string;
};

type DrinkWeatherRule = DrinkWeatherVerdict & {
  /** Fires when true; rules are evaluated top to bottom, first match wins. */
  when: (input: DrinkWeatherInput) => boolean;
  /**
   * Wording for the day bands where `line` would name the wrong one.
   *
   * `line` stays the EVENING sentence, because that is where this table was
   * written and where /tonight reads it, so nothing on that surface moves.
   * Only the four rules that name a time of day carry entries here: a reader
   * greeted "Good morning" on /today met "Crisp autumn evening. Amber ale
   * weather." underneath it, and the card and the greeting were describing two
   * different parts of the same day.
   */
  dayPartLine?: Partial<Record<DaySlot, string>>;
};

const RAINING_HARD_PCT = 60;
const COLD_C = 8;
const MILD_FLOOR_C = 14;
const WARM_C = 18;
const DRY_PCT = 30;
const CALM_PCT = 40;
const UNSETTLED_PCT = 50;

const SUMMER_MONTHS = new Set([6, 7, 8]);
const AUTUMN_MONTHS = new Set([9, 10, 11]);
const SPRING_MONTHS = new Set([3, 4, 5]);
const WINTER_MONTHS = new Set([12, 1, 2]);

// Order matters. Extremes first (rain and cold drive you indoors regardless of
// the calendar), then the warm-dry garden window, then winter (which claims its
// own months indoors before the riverside rule can offer a January towpath),
// then the remaining shoulder-season bands. Copy is honest: each line describes
// weather that genuinely earns the pint named. No em dashes anywhere.
export const DRINK_WEATHER_RULES: readonly DrinkWeatherRule[] = [
  {
    ruleId: "hard-rain",
    when: ({ precipitationProbabilityPct }) => precipitationProbabilityPct >= RAINING_HARD_PCT,
    venueLens: "fireplace",
    drinkSuggestion: "a stout",
    line: "Rain's set in. Stout by the fire weather.",
  },
  {
    ruleId: "cold",
    when: ({ tempC }) => tempC < COLD_C,
    venueLens: "fireplace",
    drinkSuggestion: "a stout or a dark ale",
    line: "Cold one tonight. Stout weather.",
    dayPartLine: {
      morning: "Cold one today. Stout weather.",
      afternoon: "Cold out. Stout weather.",
    },
  },
  {
    ruleId: "summer-garden",
    when: ({ tempC, precipitationProbabilityPct, month }) =>
      tempC >= WARM_C && precipitationProbabilityPct < DRY_PCT && SUMMER_MONTHS.has(month),
    venueLens: "beer-garden",
    drinkSuggestion: "a cold lager or cider",
    line: "Beer garden weather. Lager or cider.",
  },
  {
    ruleId: "warm-dry",
    when: ({ tempC, precipitationProbabilityPct }) =>
      tempC >= WARM_C && precipitationProbabilityPct < DRY_PCT,
    venueLens: "beer-garden",
    drinkSuggestion: "a cold lager or cider",
    line: "Warm and dry. Beer garden weather.",
  },
  {
    // Winter owns its whole non-freezing, non-garden band before the riverside
    // rule can claim a January evening. London winters run dark by teatime and
    // the demand is indoors, so an 8-18C December-to-February night reads as a
    // porter regardless of how still the air is. No precipitation guard: a damp
    // winter evening still earns this verdict rather than falling through to
    // null, which is the winter gap the summer-tuned table left open. The
    // fireplace lens is the indoor signal only; it makes no venue claim, because
    // no fireplace amenity exists in the vocabulary to back one (see header).
    // "Dark early" leans on the month, not a clock: December-to-February London
    // is genuinely dark by late afternoon, so the line stays honest without
    // inventing a per-evening sunset the snapshot does not carry.
    ruleId: "winter-porter",
    when: ({ tempC, month }) => tempC >= COLD_C && tempC < WARM_C && WINTER_MONTHS.has(month),
    venueLens: "fireplace",
    drinkSuggestion: "a porter",
    line: "Winter evening, dark early. Porter weather.",
    dayPartLine: {
      morning: "Winter day, dark early. Porter weather.",
      afternoon: "Winter afternoon, dark early. Porter weather.",
      night: "Winter night. Porter weather.",
    },
  },
  {
    ruleId: "mild-riverside",
    when: ({ tempC, precipitationProbabilityPct }) =>
      tempC >= MILD_FLOOR_C && tempC < WARM_C && precipitationProbabilityPct < CALM_PCT,
    venueLens: "riverside",
    drinkSuggestion: "a pale ale",
    line: "Mild and calm. Riverside pint weather.",
  },
  {
    ruleId: "crisp-autumn",
    when: ({ tempC, month }) => tempC >= COLD_C && tempC < MILD_FLOOR_C && AUTUMN_MONTHS.has(month),
    venueLens: "any",
    drinkSuggestion: "an amber ale",
    line: "Crisp autumn evening. Amber ale weather.",
    dayPartLine: {
      morning: "Crisp autumn morning. Amber ale weather.",
      afternoon: "Crisp autumn afternoon. Amber ale weather.",
      night: "Crisp autumn night. Amber ale weather.",
    },
  },
  {
    ruleId: "cool-spring",
    when: ({ tempC, month }) => tempC >= COLD_C && tempC < MILD_FLOOR_C && SPRING_MONTHS.has(month),
    venueLens: "any",
    drinkSuggestion: "a best bitter",
    line: "Cool spring evening. Bitter weather.",
    dayPartLine: {
      morning: "Cool spring morning. Bitter weather.",
      afternoon: "Cool spring afternoon. Bitter weather.",
      night: "Cool spring night. Bitter weather.",
    },
  },
  {
    ruleId: "cool-default",
    when: ({ tempC, precipitationProbabilityPct }) =>
      tempC >= COLD_C && tempC < MILD_FLOOR_C && precipitationProbabilityPct < UNSETTLED_PCT,
    venueLens: "any",
    drinkSuggestion: "a session bitter",
    line: "Cool and settled. Bitter weather.",
  },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Resolve tonight's conditions to a single verdict, or null when nothing in the
 * table fits (the caller then shows no strip). Guards its own inputs so a
 * malformed cached observation degrades to null rather than a bad suggestion.
 */
export function evaluateDrinkWeather(input: DrinkWeatherInput): DrinkWeatherVerdict | null {
  if (!isFiniteNumber(input.tempC)) return null;
  if (!isFiniteNumber(input.precipitationProbabilityPct)) return null;
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) return null;
  const match = DRINK_WEATHER_RULES.find((rule) => rule.when(input));
  if (!match) return null;
  const { when: _when, dayPartLine, ...verdict } = match;
  void _when;
  const dayPart = input.dayPart;
  const line = (dayPart && dayPartLine?.[dayPart]) || verdict.line;
  return { ...verdict, line };
}
