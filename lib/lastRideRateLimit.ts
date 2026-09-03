// Per-IP rate limiting for the last-ride surfaces (last-train / -tram / -subway /
// -merseyrail) and nearby buses. Each forwards to a transit upstream on an
// uncached miss, so a per-IP floor stops an unauthenticated caller driving
// unbounded outbound fan-out. The per-call `scope` sub-divides one tighter
// ~20/min budget by mode (last-ride:<scope>:<ip>) so a burst against one
// transport surface can't exhaust the others' allowance.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

export const isLastRideLimited = makeIpRateLimiter("last-ride", 20);
