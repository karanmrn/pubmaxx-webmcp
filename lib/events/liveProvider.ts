// The ONE request-time listing-provider lane.
//
// Ticketmaster and Skiddle differ only in their env var, the URL they build and
// the normaliser that reads the answer. Everything else - reading the key at
// call time (never at import, never logged), the 8s timeout, the per
// (city x window) memo, draining a non-2xx body before throwing - is identical,
// and two copies of it drift. Anything a caller may vary is a field on the
// descriptor; anything that is policy lives here.

import {
  EVENT_DROP_REASONS,
  cityGeo,
  type EventDropCounts,
} from "@/lib/whatson/eventNormalise.mjs";
import type { EventsProvider, EventsProviderContext } from "@/lib/events/provider";
import { log } from "@/lib/log";
import { londonServiceDayBounds, type WhatsOnRow } from "@/lib/whatsOn";

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type LiveProviderWindow = { startIso: string; endIso: string };

export type LiveProviderGeo = { lat: number; lng: number; radiusMiles: number };

export type { EventDropCounts };

export type LiveProviderDescriptor = {
  /** Attribution / report name. Also the log tag. */
  name: string;
  /** Env var holding this provider's key. Read at CALL time, never logged. */
  envVar: string;
  /**
   * A lane can be off for a reason that has nothing to do with its key - an
   * undischarged licence obligation, say. Absent means "the key decides".
   */
  available?: () => boolean;
  /** Human label for the thrown error on a non-2xx answer. */
  upstreamLabel: string;
  buildUrl(input: { key: string; geo: LiveProviderGeo; window: LiveProviderWindow }): URL;
  normalise(
    payload: unknown,
    opts: { observedAt: string },
  ): { rows: WhatsOnRow[]; dropped?: EventDropCounts };
};

type CacheEntry = { at: number; key: string; rows: WhatsOnRow[] };

export type LiveEventsProvider = EventsProvider & {
  /** Drop the memo. Tests and a key change both need this. */
  reset(): void;
};

function readKey(envVar: string): string | undefined {
  const value = process.env[envVar];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * The window a request asks for, as instants. A caller that already resolved
 * the window it will keep (a day chip on /out) hands it in, so an upstream call
 * is never spent on rows the caller would then discard.
 */
export function providerWindow(ctx: EventsProviderContext): LiveProviderWindow {
  if (ctx.window && Number.isFinite(ctx.window.startMs) && Number.isFinite(ctx.window.endMs)) {
    return {
      startIso: new Date(ctx.window.startMs).toISOString(),
      endIso: new Date(ctx.window.endMs).toISOString(),
    };
  }
  const { start, end } = londonServiceDayBounds(ctx.now);
  return { startIso: start, endIso: end };
}

export function createLiveEventsProvider(
  descriptor: LiveProviderDescriptor,
): LiveEventsProvider {
  let cache: CacheEntry | null = null;

  async function fetchTonight(ctx: EventsProviderContext): Promise<WhatsOnRow[]> {
    const key = readKey(descriptor.envVar);
    if (!key) return [];

    const city = ctx.city ?? "london";
    const window = providerWindow(ctx);
    const cacheKey = `${city}|${window.startIso}|${window.endIso}`;
    if (
      ctx.cache !== "bypass" &&
      cache &&
      cache.key === cacheKey &&
      ctx.now - cache.at < CACHE_TTL_MS
    ) {
      return cache.rows;
    }

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const url = descriptor.buildUrl({ key, geo: cityGeo(city), window });
    const res = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "PUBMAXX-out/1" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Drain before throwing: an unread body leaves the request open.
      await res.arrayBuffer();
      throw new Error(`${descriptor.upstreamLabel} returned ${res.status}`);
    }
    const payload = await res.json();
    const { rows, dropped } = descriptor.normalise(payload, {
      observedAt: new Date(ctx.now).toISOString(),
    });
    // A row the mapper cannot name is DROPPED, and a drop is never silent - the
    // build-time lane already says so in its own log, and this is the lane that
    // actually serves readers.
    if (dropped && dropped.total > 0) {
      const byReason: Record<string, number> = {};
      for (const reason of EVENT_DROP_REASONS) byReason[reason] = dropped[reason] ?? 0;
      log("warn", "out.provider_drops", {
        provider: descriptor.name,
        city,
        total: dropped.total,
        ...byReason,
      });
    }
    cache = { at: ctx.now, key: cacheKey, rows };
    return rows;
  }

  return {
    name: descriptor.name,
    isConfigured: () =>
      (descriptor.available ? descriptor.available() : true) &&
      readKey(descriptor.envVar) !== undefined,
    fetchTonight,
    reset: () => {
      cache = null;
    },
  };
}
