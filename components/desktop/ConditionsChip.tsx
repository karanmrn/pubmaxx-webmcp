"use client";

// Compact Tonight Conditions chip for the desktop map toolbar. The owner wants
// the weather verdict ALWAYS visible; the map page cannot host the full right
// rail (the venue drawer owns the right edge), so the map carries this chip in
// the toolbar row instead: "19C, cloudy. Beer garden weather."
//
// Same idiom as every fail-soft strip: fetch in an effect, AbortController on
// unmount, renders NOTHING while loading, on error, or when the server has no
// verdict for the current weather. The full drink line rides the title/aria
// text so the chip stays one quiet phrase.

import { useEffect, useState } from "react";
import { CloudSun } from "lucide-react";

import type { TonightConditionsSummary } from "@/lib/tonightConditions";
import { shortDrinkVerdict } from "@/lib/conditionsFormat";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./conditionsChip.css";

type ConditionsResponse = { summary: TonightConditionsSummary | null };

export default function ConditionsChip() {
  const [summary, setSummary] = useState<TonightConditionsSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadSurfaceJson<ConditionsResponse>(
      "/api/tonight-conditions",
      {
        signal: controller.signal,
        validate: (body) => Boolean(body && "summary" in body),
      },
      (body) => setSummary(body.summary ?? null),
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) setSummary(null);
    });
    return () => controller.abort();
  }, []);

  if (!summary) return null;

  const verdict = shortDrinkVerdict(summary.drinkLine);
  const full = `${summary.dateLabel}, ${summary.weatherLabel}. ${summary.drinkLine}`;

  return (
    <span className="conditionsChip" title={full} aria-label={full}>
      <CloudSun size={14} aria-hidden="true" />
      <span className="conditionsChipWeather">{summary.weatherLabel}.</span>
      {verdict ? <span className="conditionsChipVerdict">{verdict}</span> : null}
    </span>
  );
}
