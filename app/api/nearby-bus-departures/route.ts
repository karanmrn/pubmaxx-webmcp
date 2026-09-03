// GET /api/nearby-bus-departures?lat=..&lng=..
//
// Pub-centred live bus departures using the same guarded TfL client as Last
// Pint. Stops stay within a walkable 500 m straight-line radius, and STOP_CAP
// keeps the keyless TfL fan-out and payload bounded: TfL's Arrivals endpoint
// answers for ONE stop point (a comma-joined id list is a 404, not a batch), so
// the capped stops are asked concurrently inside a single arrivals deadline.

import { publicApiError } from "@/lib/apiError";
import { CITIES, pointInCityBounds } from "@/lib/cities";
import { isLastRideLimited } from "@/lib/lastRideRateLimit";
import {
  BUS_ARRIVALS_TIMEOUT_MS,
  BUS_MIN_ATTEMPT_MS,
  BUS_STOP_LOOKUP_TIMEOUT_MS,
  busUpstreamTimeoutMs,
  freshBusPredictions,
  type NearbyBusDeparturesResult,
  type NearbyBusStop,
  type TflBusPrediction,
} from "@/lib/nearbyBusDepartures";
import { tflFetch, type TflOutcome } from "@/lib/tflClient.server";

export const runtime = "nodejs";
// Seconds, and a literal because Next extracts route segment config by static
// analysis: an expression is dropped and the platform default silently applies.
// BUS_ROUTE_BUDGET_MS is the same figure in milliseconds and every upstream
// deadline is drawn from it, so the route always reaches its own unavailable
// answer instead of being killed mid-call.
export const maxDuration = 15;

const STOP_RADIUS_M = 500;
const STOP_CAP = 4;
const DEPARTURES_PER_STOP = 3;
const STOP_TYPES = "NaptanPublicBusCoachTram";

type TflBusStop = {
  id?: string;
  naptanId?: string;
  commonName?: string;
  indicator?: string;
  towards?: string;
  distance?: number;
};

type TflBusStopResponse = {
  stopPoints?: TflBusStop[];
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function unavailable(now: Date): NearbyBusDeparturesResult {
  return {
    status: "unavailable",
    stops: [],
    generatedAt: now.toISOString(),
  };
}

function stopId(stop: TflBusStop): string {
  return (stop.naptanId ?? stop.id ?? "").trim();
}

function nearbyStops(response: TflBusStopResponse | null): TflBusStop[] {
  if (!Array.isArray(response?.stopPoints)) return [];
  return response.stopPoints
    .filter((stop) => {
      const distance = stop.distance;
      return (
        Boolean(stopId(stop)) &&
        typeof distance === "number" &&
        Number.isFinite(distance) &&
        distance >= 0 &&
        distance <= STOP_RADIUS_M
      );
    })
    .sort((a, b) => (a.distance as number) - (b.distance as number))
    .slice(0, STOP_CAP);
}

function stopResult(
  stop: TflBusStop,
  predictions: ReturnType<typeof freshBusPredictions>,
): NearbyBusStop | null {
  const id = stopId(stop);
  const departures = predictions
    .filter((prediction) => prediction.naptanId === id)
    .slice(0, DEPARTURES_PER_STOP)
    .map((prediction) => ({
      lineName: prediction.lineName,
      destinationName: prediction.destinationName,
      direction: prediction.direction,
      expectedArrival: prediction.expectedArrival,
    }));
  if (departures.length === 0) return null;

  return {
    id,
    name: stop.commonName?.trim() || "Bus stop",
    indicator: stop.indicator?.trim() || null,
    towards: stop.towards?.trim() || null,
    distanceM: Math.round(stop.distance as number),
    departures,
  };
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lng = Number.parseFloat(params.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return publicApiError("Add valid lat and lng coordinates.", "INVALID_REQUEST", 400);
  }

  const now = new Date();
  if (!pointInCityBounds(lat, lng, CITIES.london)) {
    return json(unavailable(now));
  }
  if (await isLastRideLimited(request, "bus-departures")) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const stopPath =
    `/StopPoint?lat=${lat}&lon=${lng}` +
    `&stopTypes=${STOP_TYPES}&radius=${STOP_RADIUS_M}&modes=bus`;
  // The arrivals call is held out of the stop lookup's deadline so a retried
  // lookup can never spend the whole budget and leave nothing to ask with.
  const stopLookup = (): Promise<TflOutcome<TflBusStopResponse>> => {
    const timeoutMs = busUpstreamTimeoutMs(
      BUS_STOP_LOOKUP_TIMEOUT_MS,
      elapsed(),
      BUS_MIN_ATTEMPT_MS,
    );
    if (timeoutMs < BUS_MIN_ATTEMPT_MS) {
      return Promise.resolve({ ok: false, retryable: false });
    }
    return tflFetch<TflBusStopResponse>(stopPath, { timeoutMs });
  };

  let lookup = await stopLookup();
  if (!lookup.ok && lookup.retryable) lookup = await stopLookup();
  const stops = nearbyStops(lookup.ok ? lookup.data : null);
  if (stops.length === 0) return json(unavailable(now));

  const arrivalsTimeoutMs = busUpstreamTimeoutMs(
    BUS_ARRIVALS_TIMEOUT_MS,
    elapsed(),
  );
  if (arrivalsTimeoutMs < BUS_MIN_ATTEMPT_MS) return json(unavailable(now));

  const arrivals = await Promise.all(
    stops.map((stop) =>
      tflFetch<TflBusPrediction[]>(
        `/StopPoint/${encodeURIComponent(stopId(stop))}/Arrivals`,
        { timeoutMs: arrivalsTimeoutMs },
      ),
    ),
  );

  // The clock the predictions are judged against is read HERE, not at the top
  // of the request: the lookups above can spend most of the route's budget, and
  // measuring a TfL stamp against a timestamp from before those calls turns our
  // own latency into what looks like a source clock running ahead.
  const observedAt = new Date();
  const stopResults = stops
    .map((stop, index) => {
      const outcome = arrivals[index];
      // A stop we could not ask is dropped rather than shown empty: silence
      // from TfL is never evidence that no bus is coming.
      if (!outcome.ok || !Array.isArray(outcome.data)) return null;
      return stopResult(stop, freshBusPredictions(outcome.data, observedAt));
    })
    .filter((stop): stop is NearbyBusStop => stop !== null);
  if (stopResults.length === 0) return json(unavailable(observedAt));

  const result: NearbyBusDeparturesResult = {
    status: "ready",
    stops: stopResults,
    generatedAt: observedAt.toISOString(),
  };
  return json(result);
}
