import "server-only";

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

/** Analytics beacon: a per-IP budget generous enough for one real browsing
 *  session (dozens of taps/screens a minute) but flood-hostile for a script
 *  hammering the endpoint to blow up the log drain. */
export const EVENTS_RATE_LIMIT = 120;
export const EVENTS_RATE_WINDOW_MS = 60_000;

/**
 * Rate-limit an events POST. Keyed on the hashed client IP ONLY — never the
 * event name/props — so the budget is per-source, not per-event-type, and one
 * hot event can't starve another's share of the same visitor's budget. The IP
 * itself is never stored or logged, only its sha256 (hashIp): it exists for
 * the lifetime of this check and the in-memory/durable counter, same as every
 * other IP-keyed limiter in this codebase (lib/lastRideRateLimit.ts,
 * lib/ogCardRateLimit.ts).
 */
export async function isEventsRateLimited(request: Request): Promise<boolean> {
  const key = `events:${hashIp(clientIp(request))}`;
  return isLimited(key, key, EVENTS_RATE_LIMIT, EVENTS_RATE_WINDOW_MS);
}
