// Venue weather Recommendations.
//
// POST stores one Pubmaxxer's short, attributed opinion that a venue suits a
// closed weather condition. GET surfaces matching opinions when the existing
// Open-Meteo snapshot can be checked. If weather is unavailable, it returns the
// authored rows unconditionally and says so through `weatherStatus`.
//
// Weather never authors, scores, or verifies a Recommendation. It only matches
// human-authored rows. No aggregate count or venue rank leaves this route.

import { publicApiError } from "@/lib/apiError";
import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import { isLimited } from "@/lib/pintDrops";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import {
  conditionsForWeather,
  matchingWeatherRecommendations,
  validateWeatherRecommendation,
  WEATHER_RECOMMENDATION_RESPONSE_BUDGET_BYTES,
  type WeatherRecommendation,
  type WeatherRecommendationCondition,
} from "@/lib/weatherRecommendations";
import {
  readWeatherRecommendations,
  submitWeatherRecommendation,
  weatherRecommendationStore,
} from "@/lib/weatherRecommendationStore";
import {
  planningWeatherForArea,
} from "@/lib/weatherSnapshots";
import { cachedWeatherRecommendationSnapshot } from "@/lib/weatherRecommendationSnapshotMemo.server";
import { readString } from "@/lib/textClean";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTOR_WRITE_LIMIT = 30;
const VENUE_WRITE_LIMIT = 5;
const WRITE_WINDOW_MS = 3_600_000;

type VenueRecommendationPayload = {
  weatherStatus: "available" | "unavailable";
  matchingConditions: WeatherRecommendationCondition[];
  recommendations: WeatherRecommendation[];
  degraded: boolean;
  truncated: boolean;
};

async function parseBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function payloadBytes(payload: VenueRecommendationPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

function fitPayloadBudget(
  payload: Omit<VenueRecommendationPayload, "truncated">,
): VenueRecommendationPayload {
  const recommendations = [...payload.recommendations];
  let result: VenueRecommendationPayload = {
    ...payload,
    recommendations,
    truncated: false,
  };
  while (
    recommendations.length > 0 &&
    payloadBytes(result) > WEATHER_RECOMMENDATION_RESPONSE_BUDGET_BYTES
  ) {
    recommendations.pop();
    result = { ...result, recommendations, truncated: true };
  }
  return result;
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request);
  if (!body) {
    return publicApiError(
      "Malformed request body.",
      "MALFORMED_REQUEST",
      400,
    );
  }

  const action = readString(body.action);
  if (action === "hide" || action === "restore") {
    if (!isModerator(request)) {
      return publicApiError("Not authorised.", "FORBIDDEN", 403);
    }
    const id = readString(body.id);
    if (!id) {
      return publicApiError(
        "Recommendation not found.",
        "NOT_FOUND",
        404,
      );
    }
    try {
      const changed = await weatherRecommendationStore().moderate(
        id,
        action === "hide" ? "hidden" : "visible",
        readString(body.note),
      );
      return changed
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError(
            "Recommendation not found.",
            "NOT_FOUND",
            404,
          );
    } catch {
      return publicApiError(
        "Could not update that recommendation right now.",
        "STORE_UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
  }

  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }

  const validation = validateWeatherRecommendation({
    ...body,
    contributorHandle: contributor.handle,
  });
  if (!validation.ok) {
    return publicApiError(
      validation.error,
      "INVALID_RECOMMENDATION",
      400,
    );
  }

  const venueLookup = await lookupCanonicalVenue(validation.value.venueId);
  if (venueLookup.status === "unavailable") {
    return publicApiError(
      "Venue list is unavailable right now. Try again shortly.",
      "VENUE_LIST_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (venueLookup.status !== "found") {
    return publicApiError(
      "Pick a venue from the map.",
      "UNKNOWN_VENUE",
      400,
    );
  }

  const actorKey = contributor.actor;
  const actorLimitKey = `weather-recommendation-actor:${actorKey}`;
  if (
    await isLimited(
      actorLimitKey,
      actorLimitKey,
      ACTOR_WRITE_LIMIT,
      WRITE_WINDOW_MS,
    )
  ) {
    return publicApiError(
      "Too many recommendations, slow down.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }
  const venueLimitKey =
    `weather-recommendation:${actorKey}:${venueLookup.canonicalId}`;
  if (
    await isLimited(
      venueLimitKey,
      venueLimitKey,
      VENUE_WRITE_LIMIT,
      WRITE_WINDOW_MS,
    )
  ) {
    return publicApiError(
      "Too many recommendations for this pub, slow down.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  try {
    const recommendation = await submitWeatherRecommendation({
      ...validation.value,
      venueId: venueLookup.canonicalId,
      contributorHandle: contributor.handle,
      actorHash: contributor.actor,
    });
    return jsonNoStore({ recommendation }, { status: 201 });
  } catch (error) {
    console.error(
      "[weather-recommendations] durable write failed:",
      error instanceof Error ? error.message : String(error),
    );
    return publicApiError(
      "Could not save that recommendation right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const venueId = new URL(request.url).searchParams.get("venueId")?.trim() ?? "";
  if (!venueId) {
    return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  }

  const venueLookup = await lookupCanonicalVenue(venueId);
  if (venueLookup.status === "unavailable") {
    return publicApiError(
      "Venue list is unavailable right now. Try again shortly.",
      "VENUE_LIST_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (venueLookup.status !== "found") {
    return publicApiError(
      "Pick a venue from the map.",
      "UNKNOWN_VENUE",
      400,
    );
  }

  const read = await readWeatherRecommendations(venueLookup.canonicalId);
  const now = new Date();
  const cityId =
    cityIdFromVenueId(venueLookup.canonicalId) ?? DEFAULT_CITY_ID;
  const area = nearestNightAreaForViewport(cityId, [
    venueLookup.venue.lng,
    venueLookup.venue.lat,
  ]);
  const snapshot = area
    ? await cachedWeatherRecommendationSnapshot(now.getTime())
    : null;
  const weather =
    area && snapshot
      ? planningWeatherForArea(snapshot, area.slug, now.getTime())
      : null;
  const matchingConditions = weather
    ? conditionsForWeather({
        condition: weather.condition,
        feelsLikeC: weather.feelsLikeC,
        precipitationProbabilityPct: weather.precipitationProbabilityPct,
        windKph: weather.windKph,
      })
    : [];
  const recommendations = weather
    ? matchingWeatherRecommendations(
        read.recommendations,
        matchingConditions,
      )
    : read.recommendations;

  return jsonNoStore(
    fitPayloadBudget({
      weatherStatus: weather ? "available" : "unavailable",
      matchingConditions,
      recommendations,
      degraded: read.status === "degraded",
    }),
  );
}
