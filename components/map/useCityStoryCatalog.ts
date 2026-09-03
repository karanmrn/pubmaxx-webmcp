"use client";

import { useEffect, useState } from "react";

import type { CityId } from "@/lib/cities";
import {
  curatedCrawlsForCityAsync,
  landmarksForCityAsync,
  storyBandsForCityAsync,
} from "@/lib/cityStoryCatalog.async";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import type { Landmark } from "@/lib/landmarks";
import type { StoryBand } from "@/lib/storyBands";

export type CityStoryCatalog = {
  cityId: CityId | null;
  curatedCrawls: CuratedCrawl[];
  landmarks: Landmark[];
  storyBands: StoryBand[];
  ready: boolean;
  degraded: boolean;
};

function emptyCatalog(cityId: CityId | null = null): CityStoryCatalog {
  return {
    cityId,
    curatedCrawls: [],
    landmarks: [],
    storyBands: [],
    ready: false,
    degraded: false,
  };
}

/** Loads crawls, landmarks and story bands on demand per city. */
export function useCityStoryCatalog(
  cityId: CityId,
  enabled = true,
): CityStoryCatalog {
  const [catalog, setCatalog] = useState<CityStoryCatalog>(() => emptyCatalog(cityId));

  useEffect(() => {
    if (!enabled) return;
    const requestedCity = cityId;
    let cancelled = false;
    void Promise.allSettled([
      curatedCrawlsForCityAsync(requestedCity),
      landmarksForCityAsync(requestedCity),
      storyBandsForCityAsync(requestedCity),
    ]).then((results) => {
      if (cancelled) return;
      const curatedCrawls =
        results[0].status === "fulfilled" ? results[0].value : [];
      const landmarks =
        results[1].status === "fulfilled" ? results[1].value : [];
      const storyBands =
        results[2].status === "fulfilled" ? results[2].value : [];
      const degraded = results.some((result) => result.status === "rejected");
      setCatalog({
        cityId: requestedCity,
        curatedCrawls,
        landmarks,
        storyBands,
        ready: true,
        degraded,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [cityId, enabled]);

  if (!enabled || catalog.cityId !== cityId) {
    return emptyCatalog(cityId);
  }
  return catalog;
}
