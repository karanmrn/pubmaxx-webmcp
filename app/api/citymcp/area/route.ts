// GET /api/citymcp/area?borough=<name>
//
// Thin CityMCP London `get_area` proxy, scoped to the borough pint-price
// card on /borough/[slug]. Fail-soft: any upstream failure (or a missing
// `borough` param) surfaces as a 200 with nulls — never a hard 500 — so the
// card can quietly not render rather than break the page.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { fetchCityArea } from "@/lib/citymcp/area";
import { CityMcpError } from "@/lib/citymcp/client";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_BOROUGH_LEN = 60;

export const GET = withRouteTiming("citymcp/area", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      compatibilityFields: { borough: null, averagePintGbp: null, asOf: null },
    });
  }

  const params = new URL(request.url).searchParams;
  const borough = params.get("borough")?.trim();

  if (!borough || borough.length > MAX_BOROUGH_LEN) {
    return jsonNoStore({
      borough: null,
      averagePintGbp: null,
      asOf: null,
      error: "Add a borough.",
    });
  }

  try {
    const area = await fetchCityArea(borough);
    return jsonNoStore(area);
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonNoStore({
      borough,
      averagePintGbp: null,
      asOf: null,
      error: message,
    });
  }
}
