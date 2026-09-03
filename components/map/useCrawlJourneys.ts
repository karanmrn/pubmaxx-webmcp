"use client";

// London-only: fetch CityMCP TfL journeys for consecutive crawl stops.
// Fail-soft — empty map on any error. Debounces on route identity; aborts
// in-flight work on unmount / route change. React 19: deferred setState.

import { useEffect, useMemo, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { formatJourneySummary } from "@/lib/formatJourney";
import type { Venue } from "@/lib/venues";

export type CrawlJourneyLegSummary = {
  fromId: string;
  toId: string;
  summary: string;
  durationMinutes?: number;
  modes: string[];
};

type JourneyApiResponse = {
  journeys?: Array<{
    durationMinutes?: number;
    legs?: Array<{ mode?: string; summary?: string; durationMinutes?: number }>;
  }>;
  error?: string;
};

const EMPTY: CrawlJourneyLegSummary[] = [];

function routeKey(route: readonly Venue[]): string {
  return route.map((v) => `${v.id}:${v.latitude.toFixed(4)},${v.longitude.toFixed(4)}`).join("|");
}

async function fetchLeg(
  from: Venue,
  to: Venue,
  signal: AbortSignal,
): Promise<CrawlJourneyLegSummary | null> {
  const params = new URLSearchParams({
    fromLat: String(from.latitude),
    fromLng: String(from.longitude),
    toLat: String(to.latitude),
    toLng: String(to.longitude),
    limit: "1",
  });
  const res = await fetch(`/api/citymcp/journey?${params}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    discardBody(res);
    return null;
  }
  const body = (await res.json()) as JourneyApiResponse;
  const best = body.journeys?.[0];
  if (!best?.legs?.length) return null;
  const modes = best.legs
    .map((leg) => String(leg.mode ?? "").trim())
    .filter(Boolean);
  return {
    fromId: from.id,
    toId: to.id,
    summary: formatJourneySummary({
      durationMinutes: best.durationMinutes,
      legs: modes.map((mode) => ({ mode })),
    }),
    durationMinutes:
      typeof best.durationMinutes === "number" ? best.durationMinutes : undefined,
    modes,
  };
}

/**
 * Fetch TfL journey summaries for each consecutive pair in `route`.
 * Only runs when `enabled` (London) and route has ≥2 stops.
 */
export function useCrawlJourneys(
  route: readonly Venue[],
  enabled: boolean,
): {
  byToIndex: Map<number, CrawlJourneyLegSummary>;
  loading: boolean;
  totalMinutes: number | null;
} {
  const key = useMemo(() => routeKey(route), [route]);
  const [legs, setLegs] = useState<CrawlJourneyLegSummary[]>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || route.length < 2) {
      Promise.resolve().then(() => {
        setLegs(EMPTY);
        setLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    Promise.resolve().then(() => setLoading(true));

    (async () => {
      const pairs: Array<{ from: Venue; to: Venue; toIndex: number }> = [];
      for (let i = 0; i < route.length - 1; i += 1) {
        const from = route[i];
        const to = route[i + 1];
        if (from && to) pairs.push({ from, to, toIndex: i + 1 });
      }

      // Small concurrency so a 6-stop crawl doesn't stampede CityMCP.
      const results: CrawlJourneyLegSummary[] = [];
      const CONCURRENCY = 2;
      for (let i = 0; i < pairs.length; i += CONCURRENCY) {
        if (controller.signal.aborted) return;
        const batch = pairs.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(
          batch.map(async (pair) => {
            try {
              return await fetchLeg(pair.from, pair.to, controller.signal);
            } catch {
              return null;
            }
          }),
        );
        for (const leg of settled) {
          if (leg) results.push(leg);
        }
      }

      if (controller.signal.aborted) return;
      Promise.resolve().then(() => {
        setLegs(results);
        setLoading(false);
      });
    })().catch(() => {
      if (controller.signal.aborted) return;
      Promise.resolve().then(() => {
        setLegs(EMPTY);
        setLoading(false);
      });
    });

    return () => controller.abort();
    // key captures route identity; route array is read inside for coords.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable identity
  }, [enabled, key]);

  const byToIndex = useMemo(() => {
    const map = new Map<number, CrawlJourneyLegSummary>();
    for (let i = 0; i < route.length - 1; i += 1) {
      const to = route[i + 1];
      if (!to) continue;
      const found = legs.find((leg) => leg.toId === to.id && leg.fromId === route[i]?.id);
      if (found) map.set(i + 1, found);
    }
    return map;
  }, [legs, route]);

  const totalMinutes = useMemo(() => {
    if (legs.length === 0) return null;
    let sum = 0;
    let n = 0;
    for (const leg of legs) {
      if (typeof leg.durationMinutes === "number") {
        sum += leg.durationMinutes;
        n += 1;
      }
    }
    return n > 0 ? sum : null;
  }, [legs]);

  return { byToIndex, loading, totalMinutes };
}
