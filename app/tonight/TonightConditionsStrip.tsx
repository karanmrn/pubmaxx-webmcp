"use client";

// Tonight Conditions strip — one calm line under the header: today's date, the
// cached weather, the drink it calls for, and (once location is shared) a nearby
// venue claim. "Saturday 19 Jul, 18C light cloud. Beer garden weather. Lager or
// cider. 4 gardens near you with a pint under 6 quid."
//
// Mirrors TonightGetHomeStrip's idiom exactly: fetch fires in an effect, state
// only settles inside the async resolution/catch, an AbortController cancels on
// unmount or origin change, and the strip renders NOTHING while loading, on
// error, or when the server has nothing worth saying. No spinner, no empty card.
//
// Server does all the data work (weather snapshot + venue index) behind
// /api/tonight-conditions; this component only renders the strings it returns.
// Location is optional: with it, we send a rounded point for the "near you"
// claim; without it, the strip still shows the date, weather and drink line.

import { useEffect, useState } from "react";
import { CloudSun } from "lucide-react";

import { coarsenViewerPoint } from "@/lib/geo";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { TonightConditionsSummary } from "@/lib/tonightConditions";

import "./tonightConditions.css";

type Props = {
  origin?: { lat: number; lng: number } | null;
};

type ConditionsResponse = { summary: TonightConditionsSummary | null };

export default function TonightConditionsStrip({ origin }: Props) {
  const [summary, setSummary] = useState<TonightConditionsSummary | null>(null);

  const egressPoint = origin ? coarsenViewerPoint(origin) : null;
  const lat = egressPoint?.lat ?? null;
  const lng = egressPoint?.lng ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const query = lat !== null && lng !== null ? `?lat=${lat}&lng=${lng}` : "";
    void loadSurfaceJson<ConditionsResponse>(
      `/api/tonight-conditions${query}`,
      {
        signal: controller.signal,
        validate: (body) => Boolean(body && "summary" in body),
      },
      (body) => setSummary(body.summary ?? null),
    );
    return () => controller.abort();
  }, [lat, lng]);

  if (!summary) return null;

  return (
    <div className="tonightConditions" data-testid="tonight-conditions">
      <CloudSun size={16} aria-hidden="true" className="tonightConditionsIcon" />
      <p className="tonightConditionsCopy">
        <span className="tonightConditionsLead">
          {summary.dateLabel}, {summary.weatherLabel}.
        </span>{" "}
        <span>{summary.drinkLine}</span>
        {summary.venueClaim ? (
          <>
            {" "}
            <span className="tonightConditionsVenues">{summary.venueClaim}.</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
