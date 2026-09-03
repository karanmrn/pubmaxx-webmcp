// Per-IP rate limiting for the public Out listing surface (/api/out).
//
// That route fans out to Ticketmaster / Skiddle on an uncached miss, and each
// request also issues a Postgres RPC for open plans. An unauthenticated caller
// must not drive unbounded outbound fan-out. It gets its OWN key/budget:
// /api/events/tonight (lib/eventsLiveRateLimit.ts) is a different surface
// talking to a different upstream, and sharing a budget means one hammered
// surface exhausts the other for the same IP.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** ~60/min-per-IP budget for the public /api/out surface. */
export const isOutLimited = makeIpRateLimiter("out-listings");
