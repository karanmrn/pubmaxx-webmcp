// Tonight drink-category bridge for persona surfaces — no persona JSON.
//
// usePersonaTonight and other cold-map hooks need drinkCategoryForSuggestion
// without pulling data/persona_drinks.json into the eager map shell chunk.

import {
  DRINK_WEATHER_RULES,
  type DrinkWeatherVerdict,
} from "@/lib/drinkWeather";
import type { DrinkCategory } from "@/lib/drinks";

const VERDICT_CATEGORY_BY_RULE: Record<string, DrinkCategory> = {
  "hard-rain": "beer",
  cold: "beer",
  "summer-garden": "beer",
  "warm-dry": "beer",
  "winter-porter": "beer",
  "mild-riverside": "beer",
  "crisp-autumn": "beer",
  "cool-spring": "beer",
  "cool-default": "beer",
};

/** The DrinkCategory tonight's verdict points at, or null when unmapped. */
export function drinkCategoryForVerdict(
  verdict: DrinkWeatherVerdict | null | undefined,
): DrinkCategory | null {
  if (!verdict) return null;
  return VERDICT_CATEGORY_BY_RULE[verdict.ruleId] ?? null;
}

const SUGGESTION_CATEGORY: Record<string, DrinkCategory> = Object.fromEntries(
  DRINK_WEATHER_RULES.map((rule) => [
    rule.drinkSuggestion,
    VERDICT_CATEGORY_BY_RULE[rule.ruleId],
  ]).filter((pair): pair is [string, DrinkCategory] => Boolean(pair[1])),
);

/** The DrinkCategory a verdict's `drinkSuggestion` phrase points at, or null. */
export function drinkCategoryForSuggestion(
  suggestion: string | null | undefined,
): DrinkCategory | null {
  if (!suggestion) return null;
  return SUGGESTION_CATEGORY[suggestion.trim()] ?? null;
}
