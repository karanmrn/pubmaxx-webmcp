// Per-IP rate limiting for /api/night-calm.
//
// The route fans out to the keyless data.police.uk upstream on a cache miss with
// an attacker-varied `area` param. The per-area/per-month cache absorbs repeats,
// but a floor here stops an unauthenticated caller cycling areas to drive
// unbounded outbound fetches. Same idiom as lib/citymcpRateLimit.ts.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** ~60/min-per-IP budget for the night-calm surface. */
export const isNightCalmLimited = makeIpRateLimiter("night-calm");
