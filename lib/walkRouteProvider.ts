// OpenRouteService foot-walking provider — the keyed half of the road-route
// chain. Given two stop coordinates it returns the real pavement geometry ORS
// draws between them, or null so the caller draws the straight segment instead.
//
// KEYS: ORS_API_KEY, SERVER-SIDE ONLY. Absent ⇒ this returns null WITHOUT any
// network call (the documented keyless fail-soft default the test doctrine
// exercises — see lib/weatherProvider.ts for the same keyless-fetcher shape).
// Because the fetch is server-side, the key never ships to the browser and no
// CSP connect-src edit is needed (api.openrouteservice.org is reached from our
// own server, not the client).
//
// EVERY failure is soft: a missing key, a non-200, a malformed payload, a
// network error or an abort all resolve to null. A leg that cannot be routed
// falls back to its straight segment; the map never breaks.

import { isValidLngLat, type LngLat } from "@/lib/walkRoute";

/** The GeoJSON directions endpoint — returns a LineString FeatureCollection. */
export const ORS_FOOT_WALKING_URL =
  "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";

// Per-call ORS deadline. Without it a hung foot-walking request rides the
// platform timeout — one slow leg stalling the whole route while the client
// waits on the map. When it fires the fetch aborts, the catch below degrades
// the leg to null, and the caller draws its straight segment. 4s is comfortably
// above ORS's usual sub-second reply while still bounding a stall. Injectable
// (opts.timeoutMs) so tests prove the deadline path without a real wait.
export const WALK_LEG_TIMEOUT_MS = 4000;

// Bound a fetch to `timeoutMs`, honouring any caller signal too, without
// depending on AbortSignal.any/timeout being present. The returned signal
// aborts when either the deadline elapses or the caller's signal fires; `clear`
// releases the timer so a fast reply never leaves it pending.
function deadlineSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("walk-route ORS timeout", "TimeoutError"));
  }, timeoutMs);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener("abort", () => controller.abort(callerSignal.reason), { once: true });
  }
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** Trimmed ORS_API_KEY, or null when unset/blank (the keyless default). */
export function orsApiKey(): string | null {
  const key = process.env.ORS_API_KEY?.trim();
  return key ? key : null;
}

/** Injectable fetch so route/provider tests stay hermetic (no live network). */
export type WalkRouteFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: WalkRouteFetch = (url, init) => fetch(url, init);

export type RoutedWalkLeg = {
  coordinates: LngLat[];
  /** ORS summary.duration in seconds when present. */
  durationSeconds: number | null;
};

// Pull the LineString coordinates and optional summary duration out of an ORS
// GeoJSON directions response. ORS coordinates are [lng, lat] (optionally with
// an elevation third element — we take the first two).
function parseOrsRoute(body: unknown): RoutedWalkLeg | null {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const feature = features[0] as {
    geometry?: { type?: unknown; coordinates?: unknown };
    properties?: { summary?: { duration?: unknown } };
  } | null;
  const geometry = feature?.geometry;
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const coords: LngLat[] = [];
  for (const point of geometry.coordinates) {
    if (!Array.isArray(point)) continue;
    const candidate: [number, number] = [Number(point[0]), Number(point[1])];
    if (isValidLngLat(candidate)) coords.push(candidate);
  }
  if (coords.length < 2) return null;
  const duration = Number(feature?.properties?.summary?.duration);
  return {
    coordinates: coords,
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
  };
}

export type FetchWalkLegOptions = {
  /** Explicit key (tests). Omit to read ORS_API_KEY; null forces the keyless path. */
  apiKey?: string | null;
  doFetch?: WalkRouteFetch;
  signal?: AbortSignal;
  /** Per-call deadline in ms; defaults to WALK_LEG_TIMEOUT_MS. Injectable for tests. */
  timeoutMs?: number;
};

// Fetch the routed pavement geometry and metadata for ONE leg (two ordered
// stops). Resolves to the ORS path on success, or null on any soft failure (no
// key, non-200, malformed payload, network error, abort, or the per-call
// timeout) so the caller draws the straight segment for that leg.
export async function fetchWalkLegRoute(
  from: LngLat,
  to: LngLat,
  opts: FetchWalkLegOptions = {},
): Promise<RoutedWalkLeg | null> {
  const apiKey = opts.apiKey === undefined ? orsApiKey() : opts.apiKey;
  if (!apiKey) return null;
  const doFetch = opts.doFetch ?? defaultFetch;
  const { signal, clear } = deadlineSignal(opts.signal, opts.timeoutMs ?? WALK_LEG_TIMEOUT_MS);
  try {
    const response = await doFetch(ORS_FOOT_WALKING_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [
          [from[0], from[1]],
          [to[0], to[1]],
        ],
      }),
      signal,
    });
    if (!response.ok) return null;
    return parseOrsRoute(await response.json());
  } catch {
    // Network error, abort, timeout, or a JSON parse throw — all degrade to straight.
    return null;
  } finally {
    clear();
  }
}

// Back-compatible geometry-only API used by /api/walk-route (Fable T7).
export async function fetchWalkLeg(
  from: LngLat,
  to: LngLat,
  opts: FetchWalkLegOptions = {},
): Promise<LngLat[] | null> {
  return (await fetchWalkLegRoute(from, to, opts))?.coordinates ?? null;
}
