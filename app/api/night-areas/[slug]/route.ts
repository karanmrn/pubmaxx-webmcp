import { jsonCached } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { getNightArea } from "@/lib/nightAreas";
import { isNightAreaSlug } from "@/lib/nightPlanning";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  if (!isNightAreaSlug(slug)) return publicApiError("We don't cover that area.", "NIGHT_AREA_NOT_FOUND", 404);
  const area = getNightArea(slug);
  return jsonCached(area);
}
