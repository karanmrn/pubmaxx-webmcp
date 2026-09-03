// Async city story catalogs — one city pack per dynamic import so a London cold
// open does not parse every other city's crawls, landmarks and story bands.

import type { CityId } from "@/lib/cities";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import type { Landmark } from "@/lib/landmarks";
import type { StoryBand } from "@/lib/storyBands";

function resolveCityId(cityId: CityId | string | null | undefined): CityId {
  return parseCityId(cityId) ?? DEFAULT_CITY_ID;
}

export async function curatedCrawlsForCityAsync(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): Promise<CuratedCrawl[]> {
  const id = resolveCityId(cityId);
  switch (id) {
    case "manchester":
      return (await import("@/lib/cities/manchester/curatedCrawls")).manchesterCuratedCrawls;
    case "glasgow":
      return (await import("@/lib/cities/glasgow/curatedCrawls")).glasgowCuratedCrawls;
    case "oxford":
      return (await import("@/lib/cities/oxford/curatedCrawls")).oxfordCuratedCrawls;
    case "liverpool":
      return (await import("@/lib/cities/liverpool/curatedCrawls")).liverpoolCuratedCrawls;
    case "cambridge":
      return (await import("@/lib/cities/cambridge/curatedCrawls")).cambridgeCuratedCrawls;
    case "durham":
      return (await import("@/lib/cities/durham/curatedCrawls")).durhamCuratedCrawls;
    case "bristol":
      return (await import("@/lib/cities/bristol/curatedCrawls")).bristolCuratedCrawls;
    case "bath":
    case "llandudno":
      return [];
    case "london":
      return (await import("@/lib/curatedCrawls")).curatedCrawls;
    default:
      return [];
  }
}

export async function landmarksForCityAsync(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): Promise<Landmark[]> {
  const id = resolveCityId(cityId);
  switch (id) {
    case "manchester":
      return (await import("@/lib/cities/manchester/landmarks")).manchesterLandmarks;
    case "glasgow":
      return (await import("@/lib/cities/glasgow/landmarks")).glasgowLandmarks;
    case "oxford":
      return (await import("@/lib/cities/oxford/landmarks")).oxfordLandmarks;
    case "liverpool":
      return (await import("@/lib/cities/liverpool/landmarks")).liverpoolLandmarks;
    case "cambridge":
      return (await import("@/lib/cities/cambridge/landmarks")).cambridgeLandmarks;
    case "durham":
      return (await import("@/lib/cities/durham/landmarks")).durhamLandmarks;
    case "bristol":
      return (await import("@/lib/cities/bristol/landmarks")).bristolLandmarks;
    case "bath":
    case "llandudno":
      return [];
    case "london":
      return (await import("@/lib/landmarks")).landmarks;
    default:
      return [];
  }
}

export async function storyBandsForCityAsync(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): Promise<StoryBand[]> {
  const id = resolveCityId(cityId);
  switch (id) {
    case "manchester":
      return (await import("@/lib/cities/manchester/storyBands")).manchesterStoryBands;
    case "glasgow":
      return (await import("@/lib/cities/glasgow/storyBands")).glasgowStoryBands;
    case "oxford":
      return (await import("@/lib/cities/oxford/storyBands")).oxfordStoryBands;
    case "liverpool":
      return (await import("@/lib/cities/liverpool/storyBands")).liverpoolStoryBands;
    case "cambridge":
      return (await import("@/lib/cities/cambridge/storyBands")).cambridgeStoryBands;
    case "durham":
      return (await import("@/lib/cities/durham/storyBands")).durhamStoryBands;
    case "bristol":
      return (await import("@/lib/cities/bristol/storyBands")).bristolStoryBands;
    case "bath":
    case "llandudno":
      return [];
    case "london":
      return (await import("@/lib/storyBands")).STORY_BANDS;
    default:
      return [];
  }
}

export async function bandByIdForCityAsync(
  cityId: CityId | string | null | undefined,
  bandId: string | null | undefined,
): Promise<StoryBand | undefined> {
  if (!bandId) return undefined;
  const id = resolveCityId(cityId);
  if (id === "london") {
    const { bandById } = await import("@/lib/storyBands");
    return bandById(bandId);
  }
  const bands = await storyBandsForCityAsync(id);
  return bands.find((band) => band.id === bandId);
}
