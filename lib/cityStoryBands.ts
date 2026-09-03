// City-keyed Place-story corridor selector. London bands stay in lib/storyBands.ts;
// Manchester / Glasgow / Oxford / Liverpool / Cambridge / Durham / Bristol
// corridors live under lib/cities/{id}/storyBands.ts.

import { parseCityId, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { landmarksForCity } from "@/lib/cityLandmarks";
import {
  STORY_BANDS,
  bandById as londonBandById,
  type StoryBand,
} from "@/lib/storyBands";
import { manchesterStoryBands } from "@/lib/cities/manchester/storyBands";
import { glasgowStoryBands } from "@/lib/cities/glasgow/storyBands";
import { oxfordStoryBands } from "@/lib/cities/oxford/storyBands";
import { liverpoolStoryBands } from "@/lib/cities/liverpool/storyBands";
import { cambridgeStoryBands } from "@/lib/cities/cambridge/storyBands";
import { durhamStoryBands } from "@/lib/cities/durham/storyBands";
import { bristolStoryBands } from "@/lib/cities/bristol/storyBands";
import type { Landmark } from "@/lib/landmarks";

function resolveCityId(cityId: CityId | string | null | undefined): CityId {
  return parseCityId(cityId) ?? DEFAULT_CITY_ID;
}

export function storyBandsForCity(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): StoryBand[] {
  switch (resolveCityId(cityId)) {
    case "manchester":
      return manchesterStoryBands;
    case "glasgow":
      return glasgowStoryBands;
    case "oxford":
      return oxfordStoryBands;
    case "liverpool":
      return liverpoolStoryBands;
    case "cambridge":
      return cambridgeStoryBands;
    case "durham":
      return durhamStoryBands;
    case "bristol":
      return bristolStoryBands;
    case "bath":
    case "llandudno":
      return [];
    case "london":
      return STORY_BANDS;
    default:
      return [];
  }
}

/** Landmark catalog that resolves a city's story-band anchors. */
export function storyBandLandmarkCatalog(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): readonly Landmark[] {
  return landmarksForCity(cityId);
}

export function bandByIdForCity(
  cityId: CityId | string | null | undefined,
  bandId: string | null | undefined,
): StoryBand | undefined {
  if (!bandId) return undefined;
  const id = resolveCityId(cityId);
  if (id === "london") return londonBandById(bandId);
  return storyBandsForCity(id).find((band) => band.id === bandId);
}
