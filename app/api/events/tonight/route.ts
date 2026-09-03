// GET /api/events/tonight
//
// Request-time events for the Tonight surface, served through the runtime
// events-provider seam (lib/events/provider.ts). Today the only wired provider
// is Eventbrite, which — because Eventbrite removed public event search in 2019
// — can legally surface ONLY the authenticated account's own live events (zero
// today, since the account owns no organizations). See lib/events/eventbrite.ts
// for the full capability finding.
//
// Server-side only: the EVENTBRITE_API_TOKEN never leaves this process. Read-
// only and fail-soft: any provider failure degrades to that provider
// contributing zero rows, so this route returns 200 + { rows: [], ... } rather
// than 500. Flat error contract: an error is always { error, rows: [] }.

import { publicApiError } from "@/lib/apiError";
import { aggregateTonightEvents } from "@/lib/events/provider";
import { createEventbriteProvider } from "@/lib/events/eventbrite";
import { isEventsLiveLimited } from "@/lib/eventsLiveRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const CACHE_MAX_AGE_S = 300;
const CACHE_STALE_WHILE_REVALIDATE_S = 900;

function jsonResponse(
  body: unknown,
  opts: { status?: number; cache?: boolean } = {},
): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`
        : "no-store",
    },
  });
}

export const GET = withRouteTiming("events/tonight", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isEventsLiveLimited(request)) {
    // Flat { error, rows: [] } contract preserved: `rows` rides along as a
    // compatibility sibling of publicApiError's canonical { error, code, retryable }.
    return publicApiError("Too many requests, slow down.", "rate_limited", 429, {
      retryable: true,
      compatibilityFields: { rows: [] },
    });
  }

  const now = Date.now();
  try {
    const { rows, providers } = await aggregateTonightEvents(
      [createEventbriteProvider()],
      { now },
    );
    return jsonResponse(
      { rows, asOf: new Date(now).toISOString(), providers },
      // The aggregator is already fail-soft; a normal answer is edge-cacheable.
      { cache: true },
    );
  } catch (err) {
    // Defence in depth — aggregateTonightEvents should never throw, but the
    // route still honours the flat { error, rows: [] } contract if it does.
    // Fail-soft stays 200; `rows`/`asOf` ride along as compatibility siblings.
    const message = err instanceof Error ? err.message : "events request failed";
    return publicApiError(message, "events_unavailable", 200, {
      retryable: true,
      compatibilityFields: { rows: [], asOf: new Date(now).toISOString() },
    });
  }
}
