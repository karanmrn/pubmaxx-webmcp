// Push-token registration for the Capacitor shell and installed web app
// (lib/nativePush.ts / lib/webPush.ts).
//
//   POST   { token, platform }  →  { ok: true }
//   DELETE { token }            →  { ok: true }  (withdraw / unsubscribe)
//
// The shell registers pre-auth; the web seam is explicitly invoked after
// browser permission. Neither payload carries identity, only delivery material.
// Abuse boundary is DUAL: a
// per-IP durable rate limit (a device registers once per boot, so 10/hour is
// generous) plus a global route-wide backstop, because the per-IP key is
// derived from spoofable forwarding headers. Errors use the flat public envelope
// (lib/apiError.ts). Validation and storage live in lib/pushTokenStore.ts
// (memory + Supabase dual backend); server-side push SENDING is a later wave
// and needs an APNs key (docs/CAPACITOR_WRAP.md).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

const RATE_LIMIT_MAX = 10;
// Global backstop across ALL callers: clientIp() trusts forwarding headers,
// which an attacker can rotate per-request wherever the edge doesn't overwrite
// them — fresh per-IP keys every time. The route-wide ceiling makes rotation
// pointless: total writes stay bounded regardless of key churn. 300/hour is
// generous for a launch-day burst of real devices (each registers once per
// boot) while capping abuse at ~7k rows/day worst case.
const GLOBAL_RATE_LIMIT_MAX = 300;
const GLOBAL_LIMITER_KEY = "push-tokens:global";
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const validation = validatePushToken(body);
  if (!validation.ok) {
    return publicApiError(validation.error, "INVALID_REQUEST", 400);
  }

  // Per-IP durable limit, same key derivation as the other public write paths
  // (plan-generate) — the raw IP is hashed before it becomes a limiter key.
  const limiterKey = `push-tokens:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return publicApiError("Too many registrations, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  // Second boundary: the global ceiling (see GLOBAL_RATE_LIMIT_MAX above).
  // Checked after the per-IP budget so one noisy client trips its own limit
  // before it can eat into everyone else's.
  if (await isLimited(GLOBAL_LIMITER_KEY, GLOBAL_LIMITER_KEY, GLOBAL_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return publicApiError("Too many registrations, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    await pushTokenStore().save(validation.input);
  } catch {
    // Registration is best-effort on the client; a storage hiccup should read
    // as retry-later, not a broken app boot.
    return publicApiError("Could not save the token. Try again.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return jsonNoStore({ ok: true }, { status: 200 });
}

/** Remove a stored subscription the browser has withdrawn. Idempotent. */
export async function DELETE(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return publicApiError("Device token is missing.", "INVALID_REQUEST", 400);
  }

  const limiterKey = `push-tokens:delete:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return publicApiError("Too many registrations, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    await pushTokenStore().delete(token);
  } catch {
    return publicApiError("Could not remove the token. Try again.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return jsonNoStore({ ok: true }, { status: 200 });
}
