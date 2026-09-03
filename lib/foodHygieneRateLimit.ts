// Per-IP rate limiting for the /api/hygiene proxy surface.
//
// Every uncached /api/hygiene request forwards to the third-party FSA FHRS
// upstream. The `name`/`postcode` params are attacker-varied and routinely miss
// the per-instance TTL cache in lib/foodHygiene.ts, so without a floor here an
// unauthenticated caller could drive unbounded outbound fan-out against a public
// service. ONE shared budget covers the whole surface per IP.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** Shared ~60/min-per-IP budget across the /api/hygiene surface. */
export const isHygieneLimited = makeIpRateLimiter("hygiene");
