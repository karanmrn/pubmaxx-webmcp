// Per-IP rate limiting for the request-time events surface (/api/events/tonight).
//
// That route fans out to a third-party API (Eventbrite) on an uncached miss,
// so — exactly like the CityMCP proxy surface (lib/citymcpRateLimit.ts) — an
// unauthenticated caller must not be able to drive unbounded outbound fan-out.
// It gets its OWN key/budget so it never shares (and prematurely exhausts) the
// CityMCP or whats-on budgets.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** ~60/min-per-IP budget for the request-time /api/events/tonight surface. */
export const isEventsLiveLimited = makeIpRateLimiter("events-live");
