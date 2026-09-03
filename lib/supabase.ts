import "server-only";

import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isDeployedProduction } from "@/lib/deploymentEnv";
import { resolveSupabaseConfig } from "@/lib/supabaseConfig";

// Server-only Supabase admin client. Returns null when env is absent so every
// caller degrades to the in-memory store / static cache instead of crashing.
// No client-side client — all writes route through server handlers.
let cached: SupabaseClient | null | undefined;

function resolveServerSupabaseConfig() {
  const isVercelProduction = process.env.VERCEL_ENV === "production";
  return resolveSupabaseConfig(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      requireHttps: isVercelProduction,
      expectedKeyRole: "secret",
      allowUnknownKeyRole: !isVercelProduction,
    },
  );
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached) return cached;
  const config = resolveServerSupabaseConfig();
  if (!config) return null;
  cached = createClient(config.url, config.key, { auth: { persistSession: false } });
  return cached;
}

/**
 * Shared admin client for store implementations. Throws when Supabase is not
 * configured so a mis-selected durable backend fails loudly instead of NPE-ing
 * on a null client. Prefer this over each store's private `admin()` helper.
 */
export function requireSupabaseAdmin(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured.");
  return client;
}

export function isSupabaseConfigured(): boolean {
  return resolveServerSupabaseConfig() !== null;
}

export function requiresSupabaseStore(): boolean {
  // Keep the runtime store guard aligned with lib/serverEnv's startup guard:
  // Playwright's production-style keyless server deliberately runs with
  // PUBMAX_E2E_KEYLESS=1 so local/mobile QA can exercise real write paths
  // against the in-memory stores. A real Vercel Production deploy ignores the
  // escape hatch — setting it there must not opt production into ephemeral
  // stores. This helper controls storage only; trusted signing has an
  // independent fail-closed production policy.
  if (process.env.VERCEL_ENV === "production") return true;
  if (process.env.PUBMAX_E2E_KEYLESS === "1") return false;
  return isDeployedProduction();
}

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "pint-drops";

// ── Durable rate limiting ────────────────────────────────────────────────────
// Backed by the rate_limits table + check_rate_limit RPC (migration 0003):
// one atomic round trip that prunes the window, records the hit, and returns
// the verdict. Limits mirror lib/pintDrops.ts so both limiters agree.

export const RATE_LIMIT_MAX = 8;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** sha256(salt:ip) — raw IPs never reach the database or logs. */
export function hashIp(ip: string): string {
  // Default salt keeps dev working without env; set RATE_LIMIT_SALT in
  // production so hashes aren't computable from public code alone.
  const salt = process.env.RATE_LIMIT_SALT ?? "pubmax-rate-limit";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * sha256(salt:actorId) — the stable, unauthenticated actor identity stored as
 * `actor_hash` on reactions/comments/reports. The client sends an opaque random
 * id it minted once (lib/anonId.ts); we hash it here so the raw id never lands
 * in a table an attacker could scrape to correlate a device across drops. Uses
 * the SAME salt family as hashIp so a single ACTOR_HASH_SALT / RATE_LIMIT_SALT
 * rotation invalidates both. A blank/absent id hashes a stable "anon" sentinel
 * so a missing client id can never collapse every actor onto one empty hash by
 * accident — callers that need per-actor uniqueness should reject empties first.
 */
export function hashActor(actorId: string | null | undefined): string {
  const salt = process.env.ACTOR_HASH_SALT ?? process.env.RATE_LIMIT_SALT ?? "pubmax-actor";
  const id = typeof actorId === "string" && actorId.trim() ? actorId.trim() : "anon";
  return createHash("sha256").update(`${salt}:${id}`).digest("hex");
}

export type RateLimitDurableReason = "missing-rpc" | "error" | "no-client";

export type RateLimitDurableDetailed = {
  verdict: boolean | null;
  reason?: RateLimitDurableReason;
};

/** PostgREST / Postgres signals that `check_rate_limit` is not deployed yet. */
function isMissingRateLimitRpc(error: {
  message?: string;
  code?: string;
}): boolean {
  const code = error.code ?? "";
  // PGRST202 = function not in schema cache; 42883 = undefined_function.
  if (code === "PGRST202" || code === "42883") return true;
  const message = error.message ?? "";
  return /check_rate_limit/i.test(message) && /does not exist|Could not find the function|schema cache/i.test(message);
}

/**
 * Atomic check-and-increment against Supabase with a structured outcome so
 * callers can distinguish "no client" / "RPC missing" / generic error from a
 * real boolean verdict. `verdict` is true/false when the RPC answered, or null
 * when it could not — never silent: console.error is the observable signal.
 */
export async function checkRateLimitDurableDetailed(
  key: string,
  limit = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
  signal?: AbortSignal,
): Promise<RateLimitDurableDetailed> {
  const admin = getSupabaseAdmin();
  if (!admin) return { verdict: null, reason: "no-client" };
  try {
    const request = admin.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error) {
      const reason: RateLimitDurableReason = isMissingRateLimitRpc(error)
        ? "missing-rpc"
        : "error";
      console.error(
        `[rate-limit] durable limiter unavailable (${reason}) — failing open to in-memory:`,
        error.message,
      );
      return { verdict: null, reason };
    }
    return { verdict: data === true };
  } catch (err) {
    console.error(
      "[rate-limit] durable limiter unavailable (error) — failing open to in-memory:",
      err instanceof Error ? err.message : err,
    );
    return { verdict: null, reason: "error" };
  }
}

/**
 * Atomic check-and-increment against Supabase. Returns true/false when the
 * RPC answered, or null when it could not (no client, RPC error, network) —
 * callers fall back to the in-memory limiter on null so a limiter outage can
 * never take down the write path.
 *
 * H3: that downgrade is FAIL-OPEN by design — writes must not 503 on a
 * limiter outage — but never silent: on Vercel each cold-start instance gets
 * a fresh in-memory budget, so the durable limiter is near-useless exactly
 * when it errors. Prefer `checkRateLimitDurableDetailed` when the caller needs
 * the failure reason (hybrid degraded path in `isLimited`).
 */
export async function checkRateLimitDurable(
  key: string,
  limit = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
): Promise<boolean | null> {
  const { verdict } = await checkRateLimitDurableDetailed(key, limit, windowMs);
  return verdict;
}

/**
 * Client IP for request-boundary use. Most callers immediately sha256-hash it
 * with hashIp for rate limits, so raw IPs are never stored or logged. The
 * consent-gated analytics route is the narrow exception: it validates the
 * address and forwards it to PostHog without writing it to PUBMAXX storage.
 *
 * M1 trust boundary: `x-forwarded-for` is client-suppliable. On Vercel the
 * edge normalises it (left-most entry = real client), which this deployment
 * relies on; a self-hosted deployment must front this with a trusted proxy
 * that overwrites the header. The IP is a SECONDARY limiter signal - write
 * keys pair it with an account or contributor identity - so a spoofed header
 * only widens one actor's own budget.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
