import "server-only";

import { publicApiError } from "@/lib/apiError";
import { promises as fs } from "fs";
import path from "path";

import { haversineKm } from "@/lib/haversine";
import { isLastRideLimited } from "@/lib/lastRideRateLimit";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import type { NearestPub } from "@/lib/tfl";

const NEAREST_PUB_COUNT = 3;

type SlimVenueRow = {
  id?: string;
  name?: string;
  lat?: number;
  lng?: number;
  cheapestPrice?: number | null;
};

type LastRideStation = { id?: string; lat: number; lng: number } | null;

export type LastRideRouteConfig<TResult extends Record<string, unknown>> = {
  request: Request;
  rateLimitKey: string;
  cityPackSegment: string;
  nearestStation: (lat: number, lng: number) => LastRideStation;
  computeLastRide: (input: {
    lat: number;
    lng: number;
    nearestPubs: NearestPub[];
  }) => TResult;
  provenance: unknown;
  provider: string;
  modeLabel: string;
  stationErrorFallback: string;
  catchErrorMessage: string;
};

const slimCache = new Map<string, SlimVenueRow[] | null>();

async function citySlimVenues(cityPackSegment: string): Promise<SlimVenueRow[]> {
  const cached = slimCache.get(cityPackSegment);
  if (cached) return cached;
  try {
    const file = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "public",
      "data",
      "cities",
      cityPackSegment,
      "venues_slim.json",
    );
    const payload = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ file, "utf8"),
    ) as unknown;
    const next = (rowsFromSlimPayload(payload) ?? []) as SlimVenueRow[];
    slimCache.set(cityPackSegment, next);
    return next;
  } catch {
    return [];
  }
}

async function nearestPubsToStation(
  cityPackSegment: string,
  stationLat: number,
  stationLng: number,
): Promise<NearestPub[]> {
  const venues = await citySlimVenues(cityPackSegment);
  const withDistance = venues
    .filter(
      (v) =>
        typeof v.id === "string" &&
        typeof v.name === "string" &&
        Number.isFinite(v.lat) &&
        Number.isFinite(v.lng),
    )
    .map((v) => ({
      v,
      km: haversineKm([stationLng, stationLat], [v.lng as number, v.lat as number]),
    }));
  withDistance.sort((a, b) => a.km - b.km);
  return withDistance.slice(0, NEAREST_PUB_COUNT).map(({ v }) => ({
    id: v.id as string,
    name: v.name as string,
    price: typeof v.cheapestPrice === "number" ? v.cheapestPrice : null,
  }));
}

function json(body: unknown, opts: { status?: number; cache?: boolean } = {}): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? "public, s-maxage=300, stale-while-revalidate=3600"
        : "no-store",
    },
  });
}

export async function runLastRideRoute<TResult extends Record<string, unknown>>({
  request,
  rateLimitKey,
  cityPackSegment,
  nearestStation,
  computeLastRide,
  provenance,
  provider,
  modeLabel,
  stationErrorFallback,
  catchErrorMessage,
}: LastRideRouteConfig<TResult>): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const lat = Number.parseFloat(params.get("lat") ?? "");
    const lng = Number.parseFloat(params.get("lng") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return publicApiError("Add valid lat and lng coordinates.", "INVALID_REQUEST", 400);
    }
    if (await isLastRideLimited(request, rateLimitKey)) {
      return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
        retryable: true,
      });
    }

    const nearest = nearestStation(lat, lng);
    const nearestPubs = nearest
      ? await nearestPubsToStation(cityPackSegment, nearest.lat, nearest.lng).catch(
          () => [] as NearestPub[],
        )
      : [];

    const result = computeLastRide({
      lat,
      lng,
      nearestPubs,
    });

    if (!result.station || !(result.station as { id?: string }).id) {
      return json(
        {
          ...result,
          station: null,
          error: (result.error as string | undefined) ?? stationErrorFallback,
          provenance: (result.provenance as unknown) ?? provenance,
        },
        { cache: false },
      );
    }

    const body = {
      ...result,
      decision: result.decision
        ? {
            ...(result.decision as Record<string, unknown>),
            destinationLabel: null,
          }
        : result.decision,
    };

    const trains = body.trains as unknown[] | undefined;
    return json(body, { cache: (trains?.length ?? 0) > 0 });
  } catch {
    return json(
      {
        error: catchErrorMessage,
        station: null,
        trains: [],
        departures: [],
        nearestPubs: [],
        generatedAt: new Date().toISOString(),
        provider,
        modeLabel,
        provenance,
        staticFallback: true,
      },
      { cache: false },
    );
  }
}
