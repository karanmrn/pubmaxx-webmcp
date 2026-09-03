import { jsonCached } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { parseCityId } from "@/lib/cities";
import { getNightAreasForCity } from "@/lib/nightAreas";

export async function GET(request: Request): Promise<Response> {
  const cityId = parseCityId(new URL(request.url).searchParams.get("city"));
  if (!cityId) return publicApiError("Choose a valid city.", "CITY_INVALID", 400);
  const areas = getNightAreasForCity(cityId);
  if (areas.length === 0) return publicApiError("No areas mapped for this city yet.", "NIGHT_AREAS_NOT_FOUND", 404);
  return jsonCached({ cityId, areas });
}
