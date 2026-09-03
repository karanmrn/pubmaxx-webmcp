import "server-only";

// Shared per-IP rate-limiter factory for the outbound-proxy API surfaces.
//
// Every proxy route (hygiene, night-calm, events, CityMCP, last-ride) forwards
// to a third-party upstream on an uncached miss, so each needs a per-IP floor to
// stop an unauthenticated caller driving unbounded outbound fan-out. The wrapper
// was identical every time (clientIp + hashIp for keying, isLimited from
// lib/pintDrops for the durable-via-Supabase / in-memory-fallback verdict), so
// it lives here once instead of being copied per surface.
//
// Per-surface budget ISOLATION lives entirely in the `prefix`: each surface
// passes its own prefix, so its budget can never be shared (and prematurely
// exhausted) by traffic to another surface. An optional per-call `scope` adds a
// second key segment (`prefix:scope:hash`) for surfaces that sub-divide their
// budget by mode (e.g. last-ride keys by tram/train/subway).

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

/**
 * Build a per-IP rate limiter for one proxy surface. The returned function
 * resolves `true` when the caller is over budget. Budget isolation comes from
 * `prefix`; pass a `scope` at call time to sub-divide the budget by mode.
 */
export function makeIpRateLimiter(prefix: string, limit = 60, windowMs = 60_000) {
  return async function isIpLimited(request: Request, scope?: string): Promise<boolean> {
    const ip = hashIp(clientIp(request));
    const key = scope ? `${prefix}:${scope}:${ip}` : `${prefix}:${ip}`;
    return isLimited(key, key, limit, windowMs);
  };
}
