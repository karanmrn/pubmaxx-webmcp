// Area-demand capture route — backs the demand ask on the honest unsupported-
// area preview (components/coverage/UnsupportedAreaPreview). When PUBMAXX cannot
// serve an area, the user can register that they want it; the alternative is
// always shown first (value before the ask — taste doctrine), so this endpoint
// only ever receives a deliberate "I want [area]" signal.
//
//   POST { area, source?, matchedPatchId?, email? } → { ok: true, status }
//
// Email is OPTIONAL by construction: demand is captured WITHOUT it, and an
// address is stored only when the user offers one for a heads-up. It is never
// required and never surfaced back to the browser.
//
// Abuse boundary (write-surface certification): PUBLIC keyless contribution
// path, so it fails soft like Pint Drops / email capture — durable per-IP AND
// global rate limits in production, a tightened degraded budget on transient
// limiter failure, and the in-memory limiter for keyless dev. A durable STORE
// write failure answers 503 (house rule: degraded dependency, never fake
// success). No auth: demand is anonymous by design and a row carries no identity
// beyond an optional self-offered email.

import { publicApiError } from "@/lib/apiError";
import { parseAreaDemandInput } from "@/lib/areaDemand";
import { areaDemandStore } from "@/lib/areaDemandStore";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

// Per-IP capture budget: a genuine user registers demand for a handful of areas;
// more from one origin in a minute is abuse.
const PER_IP_LIMIT = 8;
// Global circuit breaker across ALL origins — a cheap ceiling so a distributed
// flood can't fill the table even from many IPs.
const GLOBAL_LIMIT = 200;
const WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // Validate BEFORE the limiter so an obviously-bad body 400s cheaply. Area is
  // required; email is optional but, when offered, must be valid.
  const parsed = parseAreaDemandInput(body);
  if (!parsed.ok) {
    return publicApiError(parsed.error, parsed.code, 400);
  }

  // Two durable axes: per-IP (abuse from one origin) AND global (distributed
  // flood). Either tripping is a 429. Public contribution posture — NOT
  // fail-closed: a transient limiter outage degrades to a tighter budget rather
  // than refusing genuine signals (see lib/pintDrops.isLimited).
  const ipHash = hashIp(clientIp(request));
  const perIpKey = `area-demand:ip:${ipHash}`;
  const globalKey = "area-demand:global";
  if (
    (await isLimited(perIpKey, perIpKey, PER_IP_LIMIT, WINDOW_MS)) ||
    (await isLimited(globalKey, globalKey, GLOBAL_LIMIT, WINDOW_MS))
  ) {
    return publicApiError(
      "Too many requests right now, try again shortly.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  const outcome = await areaDemandStore().record(parsed.value);
  if (outcome.failed) {
    return publicApiError(
      "Could not save that area. Try again.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  return jsonNoStore({ ok: true, status: outcome.status }, { status: 200 });
}
