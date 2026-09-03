// City-keyed landmark selector. London keeps its curated set in lib/landmarks.ts;
// Manchester / Glasgow / Oxford / Liverpool / Cambridge / Durham / Bristol ship
// under lib/cities/{id}/landmarks.ts.

import { parseCityId, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { landmarks, landmarkById as londonLandmarkById, type Landmark } from "@/lib/landmarks";
import { manchesterLandmarks } from "@/lib/cities/manchester/landmarks";
import { glasgowLandmarks } from "@/lib/cities/glasgow/landmarks";
import { oxfordLandmarks } from "@/lib/cities/oxford/landmarks";
import { liverpoolLandmarks } from "@/lib/cities/liverpool/landmarks";
import { cambridgeLandmarks } from "@/lib/cities/cambridge/landmarks";
import { durhamLandmarks } from "@/lib/cities/durham/landmarks";
import { bristolLandmarks } from "@/lib/cities/bristol/landmarks";

function resolveCityId(cityId: CityId | string | null | undefined): CityId {
  return parseCityId(cityId) ?? DEFAULT_CITY_ID;
}

export function landmarksForCity(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): Landmark[] {
  switch (resolveCityId(cityId)) {
    case "manchester":
      return manchesterLandmarks;
    case "glasgow":
      return glasgowLandmarks;
    case "oxford":
      return oxfordLandmarks;
    case "liverpool":
      return liverpoolLandmarks;
    case "cambridge":
      return cambridgeLandmarks;
    case "durham":
      return durhamLandmarks;
    case "bristol":
      return bristolLandmarks;
    case "bath":
    case "llandudno":
      return [];
    case "london":
      return landmarks;
    default:
      return [];
  }
}

/** Look up a landmark within a city's catalog (shareable chapter pages, deep links). */
export function landmarkByIdForCity(
  cityId: CityId | string | null | undefined,
  landmarkId: string | null | undefined,
): Landmark | undefined {
  if (!landmarkId) return undefined;
  const id = resolveCityId(cityId);
  if (id === "london") return londonLandmarkById(landmarkId);
  return landmarksForCity(id).find((lm) => lm.id === landmarkId);
}
