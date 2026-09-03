"use client";

// Bridge tonight's drink-weather verdict to a DrinkCategory for the persona
// lens's "fits tonight" sort. Reads the SAME /api/tonight-conditions surface the
// Conditions strip uses (no new weather rules, no duplicated evaluation) and
// maps the verdict's drinkSuggestion phrase to a category via lib/personaDrinks.
// Also exposes a garden/weather cue string for the W1 Tonight lane.
// Fail-soft + React 19 deferred setState, matching useTonightOpportunities.

import { useEffect, useState } from "react";

import type { DrinkCategory } from "@/lib/drinks";
import { drinkCategoryForSuggestion } from "@/lib/personaTonightCategories";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

type ConditionsResponse = {
  summary?: {
    drinkSuggestion?: string;
    drinkLine?: string;
    venueClaim?: string | null;
    weatherLabel?: string;
  } | null;
};

export type TonightLaneCue = {
  category: DrinkCategory | null;
  /** Short garden/weather line for the Tonight lane, or null when not relevant. */
  gardenCue: string | null;
};

function gardenCueFromSummary(
  summary: ConditionsResponse["summary"],
): string | null {
  if (!summary) return null;
  const drinkLine = typeof summary.drinkLine === "string" ? summary.drinkLine.trim() : "";
  if (drinkLine && /garden/i.test(drinkLine)) return drinkLine;
  const claim = typeof summary.venueClaim === "string" ? summary.venueClaim.trim() : "";
  if (claim && /garden/i.test(claim)) return claim;
  return null;
}

/**
 * Persona category + optional garden cue from one tonight-conditions fetch.
 * `enabled` gates the fetch (conditions is London-only today).
 */
export function useTonightLaneCue(enabled: boolean): TonightLaneCue {
  const [cue, setCue] = useState<TonightLaneCue>({ category: null, gardenCue: null });

  useEffect(() => {
    if (!enabled) {
      Promise.resolve().then(() => setCue({ category: null, gardenCue: null }));
      return;
    }
    const controller = new AbortController();
    void loadSurfaceJson<ConditionsResponse>(
      "/api/tonight-conditions",
      {
        signal: controller.signal,
        init: { headers: { accept: "application/json" } },
        validate: (body) => Boolean(body && "summary" in body),
      },
      (body) => {
        const next: TonightLaneCue = {
          category: drinkCategoryForSuggestion(body.summary?.drinkSuggestion),
          gardenCue: gardenCueFromSummary(body.summary),
        };
        Promise.resolve().then(() => {
          if (!controller.signal.aborted) setCue(next);
        });
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) {
        setCue({ category: null, gardenCue: null });
      }
    });
    return () => controller.abort();
  }, [enabled]);

  return cue;
}

/**
 * The DrinkCategory that fits tonight, or null when there is no verdict / the
 * request fails. `enabled` gates the fetch (conditions is London-only today).
 */
export function usePersonaTonightCategory(enabled: boolean): DrinkCategory | null {
  return useTonightLaneCue(enabled).category;
}
