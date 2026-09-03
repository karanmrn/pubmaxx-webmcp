// Per-identity + per-IP rate limiting for the /api/check-ins write surface.
//
// A "we're out" check-in is a lightweight social write, so its abuse budget is
// keyed by the acting handle sub-divided by hashed IP (via the shared
// makeIpRateLimiter `scope` segment: `check-in:<handle>:<ipHash>`). Using the
// shared factory keeps the in-memory and durable limiter on the SAME key — the
// previous inline call keyed the in-memory axis by handle alone while the
// durable axis used handle:hashIp, so the two budgets never agreed.
//
// Budget: 8/min (the shared write-surface default) per handle+IP.

import { makeIpRateLimiter } from "@/lib/ipRateLimit";

/** 8/min per handle+IP across the /api/check-ins surface. Pass the acting handle as `scope`. */
export const isCheckInLimited = makeIpRateLimiter("check-in", 8);
