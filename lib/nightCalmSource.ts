// Night calm source — the ONLY I/O half of the night-calm feature: it fetches
// data.police.uk street-level crime for a Night Area's centre and caches the
// aggregated band per area PER MONTH. Kept apart from lib/nightCalm.ts (pure
// maths) so the aggregation stays trivially testable and this stays the single
// place that touches the network.
//
// Caching posture: the police dataset changes at most once a month, so a hit is
// held for a long TTL and keyed `${slug}:${month}`. A new published month mints
// a new key, so a month rollover self-invalidates without any purge. This is the
// process-memory tier of the storeBackend seam idiom (lib/storeBackend.ts): a
// single Vercel-region cache in front of a keyless upstream, sufficient because
// the value is a pure function of (area, month) and safe to recompute anywhere.

import { getNightArea } from "@/lib/nightAreas";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { errorMessage } from "@/lib/storeBackend";
import {
  aggregateNightCalm,
  crimeMonthFromLastUpdated,
  isCrimeMonth,
  parsePoliceCrimes,
  publicNightCalm,
  targetCrimeMonth,
  type NightCalmContext,
} from "@/lib/nightCalm";

const POLICE_API_BASE = "https://data.police.uk/api";
const SOURCE_URL = "https://data.police.uk/docs/method/crimes-street/";
const SOURCE_PUBLISHER = "data.police.uk";
const USER_AGENT = "PUBMAXX-night-calm/1";
/** A hit is a whole calendar month stable; 12h keeps a warm region cache honest. */
const CACHE_TTL_MS = 12 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;

export type NightCalmResult = {
  area: NightAreaSlug;
  /** The published month the band reflects, or null when unavailable. */
  month: string | null;
  /** True when we have a real band to show; false means the UI shows nothing. */
  available: boolean;
  calm: NightCalmContext;
  source: { publisher: string; sourceUrl: string };
};

type CacheEntry = { expiresAt: number; result: NightCalmResult };
const cache = new Map<string, CacheEntry>();

/** Test-only: drop the in-process month cache. */
export function resetNightCalmCache(): void {
  cache.clear();
}

function unavailable(area: NightAreaSlug, month: string | null): NightCalmResult {
  return {
    area,
    month,
    available: false,
    calm: { band: null, label: null, calmScore: null },
    source: { publisher: SOURCE_PUBLISHER, sourceUrl: SOURCE_URL },
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`data.police.uk returned ${response.status}`);
  return response.json();
}

/**
 * The authoritative latest published month from the police API, falling back to
 * the ~2-month-lag estimate when the endpoint is unreachable. This is how we
 * "handle the lag" without hard-coding a month that silently goes stale.
 */
export async function resolveCrimeMonth(now: Date = new Date()): Promise<string> {
  try {
    const month = crimeMonthFromLastUpdated(await fetchJson(`${POLICE_API_BASE}/crime-last-updated`));
    if (month) return month;
  } catch {
    // fall through to the offline estimate
  }
  return targetCrimeMonth(now);
}

/**
 * Load the calm band for one Night Area, cached per area per month. Any upstream
 * failure resolves to an `available: false` result (never throws) so the calling
 * route can stay a quiet, fail-soft hint rather than an error surface.
 */
export async function loadNightCalmForArea(
  area: NightAreaSlug,
  options: { now?: Date } = {},
): Promise<NightCalmResult> {
  const now = options.now ?? new Date();
  const month = await resolveCrimeMonth(now);
  if (!isCrimeMonth(month)) return unavailable(area, null);

  const key = `${area}:${month}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  const { centre } = getNightArea(area);
  const url = new URL(`${POLICE_API_BASE}/crimes-street/all-crime`);
  url.search = new URLSearchParams({
    lat: String(centre.lat),
    lng: String(centre.lng),
    date: month,
  }).toString();

  let result: NightCalmResult;
  try {
    const crimes = parsePoliceCrimes(await fetchJson(url.toString()));
    if (crimes === null) {
      result = unavailable(area, month);
    } else {
      const calm = publicNightCalm(aggregateNightCalm(crimes));
      result = {
        area,
        month,
        available: calm.band !== null,
        calm,
        source: { publisher: SOURCE_PUBLISHER, sourceUrl: SOURCE_URL },
      };
    }
  } catch (err) {
    console.warn(`[night-calm] ${area} ${month} fetch failed:`, errorMessage(err));
    result = unavailable(area, month);
  }

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}
