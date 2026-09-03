// Shared per-IP rate limiting for the CityMCP proxy surface (S2 security fix).
//
// Every /api/citymcp/* route forwards to the third-party CityMCP upstream
// (lib/citymcp/client.ts) on an uncached miss. Params are attacker-varied
// (free-text `q`, arbitrary lat/lng, area strings), which routinely bypass
// the small in-process TTL caches each route keeps — so without a floor here
// an unauthenticated caller can drive unbounded outbound fan-out against a
// paid third party (cost + abuse-vector risk). ONE shared budget covers the
// WHOLE proxy surface per IP (not one budget per route) so spreading requests
// across area/buzz/journey/place/places/status/things-to-do can't dodge it.
//
// whats-on gets its OWN key/budget: it's largely served from bundled data
// (only partly CityMCP-backed) and documents a "never 500" fail-soft
// contract — a 429 here is an allowed degraded response, but it must not
// share (and prematurely exhaust) the CityMCP budget proper.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** Shared ~60/min-per-IP budget across the entire /api/citymcp/* surface. */
export const isCityMcpLimited = makeIpRateLimiter("citymcp");

/** Separate ~60/min-per-IP budget for /api/whats-on, which is partly bundled data. */
export const isWhatsOnLimited = makeIpRateLimiter("whats-on");
