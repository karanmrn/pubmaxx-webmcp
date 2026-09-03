import { jsonCached } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import {
  getLateFoodForArea,
  LATE_FOOD_AREAS,
  MAX_LATE_FOOD_HANDOFFS,
  normalizeLateFoodArea,
  shortlistFoodHandoffs,
  type LateFoodApiSuccessResponse,
} from "@/lib/lateFood";

function parseLimit(raw: string | null): number {
  if (!raw) return MAX_LATE_FOOD_HANDOFFS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return MAX_LATE_FOOD_HANDOFFS;
  return Math.min(value, MAX_LATE_FOOD_HANDOFFS);
}

function parseTags(raw: string | null): string[] {
  return (
    raw
      ?.split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8) ?? []
  );
}

function coordinate(
  raw: string | null,
  min: number,
  max: number,
): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

// GET /api/late-food?near=clapham&at=late_night&tags=kebab,halal&limit=3
//
// Keyless curated crawl endings. These are food terminals rather than PUBMAXX
// Venue Dataset rows, so they are never fed into pint-price route generation.
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const area = normalizeLateFoodArea(params.get("near") ?? params.get("area"));
  const tags = parseTags(params.get("tags"));
  if (!area) {
    return publicApiError(
      `near must be one of ${LATE_FOOD_AREAS.join(", ")}.`,
      "LATE_FOOD_AREA_UNKNOWN",
      400,
      { details: { terminals: [] }, compatibilityFields: { terminals: [] } },
    );
  }

  const rawAt = params.get("at");
  const requestedAt =
    rawAt && Number.isFinite(Date.parse(rawAt))
      ? new Date(rawAt).toISOString()
      : null;
  if (rawAt && !requestedAt) {
    return publicApiError(
      "at must be an ISO date and time.",
      "LATE_FOOD_TIME_INVALID",
      400,
      { details: { terminals: [] }, compatibilityFields: { terminals: [] } },
    );
  }
  const rawLat = params.get("fromLat");
  const rawLng = params.get("fromLng");
  const lat = coordinate(rawLat, -90, 90);
  const lng = coordinate(rawLng, -180, 180);
  if ((rawLat !== null || rawLng !== null) && (lat === null || lng === null)) {
    return publicApiError(
      "fromLat and fromLng must be valid coordinates.",
      "LATE_FOOD_ORIGIN_INVALID",
      400,
      { details: { terminals: [] }, compatibilityFields: { terminals: [] } },
    );
  }

  const terminals = shortlistFoodHandoffs(
    getLateFoodForArea(area, tags, {
      at: requestedAt,
      from: lat === null || lng === null ? null : { lat, lng },
    }),
    parseLimit(params.get("limit")),
  );

  const body: LateFoodApiSuccessResponse = {
    area,
    requestedAt,
    terminals,
    rankingSignals: [
      "official_operator_evidence",
      ...(requestedAt ? ["open_at_requested_time"] : []),
      ...(lat === null ? [] : ["distance_from_actual_final_stop"]),
      "category_or_evidenced_dietary_tags",
    ],
    missingEvidence: [
      "live_opening_confirmation",
      "hygiene_rating",
      ...(requestedAt ? [] : ["requested_time"]),
      ...(lat === null ? ["final_stop_origin"] : ["walking_route_distance"]),
      ...(terminals.length === 0 ? ["eligible_late_food_options"] : []),
    ],
  };
  // Curated late-food terminals are bundled static data; the body is a pure
  // function of the query (area/tags/at/from) and the deploy, so the CDN can
  // hold each variant. Was no-store, which hit a function on every request.
  return jsonCached(body);
}
