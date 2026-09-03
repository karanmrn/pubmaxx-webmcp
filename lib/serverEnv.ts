import "server-only";

// Prod startup fail-fast for server env configuration.
//
// The write path (Pint Drops, reactions, comments, …) silently degrades to a
// process-memory store when Supabase env keys are absent — the correct, useful
// behaviour for local dev and the demo. In *production* that same degradation is
// a data-loss trap: every write lives only in one serverless instance's memory
// and vanishes on the next cold start, with no error surfaced to anyone.
//
// assertServerEnv() closes that gap. Called once at server-module load
// (app/api/pint-drops/route.ts), it turns a misconfigured prod deploy into an
// immediate, loud FATAL at import time — the route never comes up half-broken —
// while staying a no-op in dev/test so the memory store keeps working.
//
// Vercel caveat: Preview and Production both set NODE_ENV=production. Preview
// often lacks Production-scoped secrets (SUPABASE_*, ADMIN_TOKEN, …). Guarding
// on NODE_ENV alone therefore kills every Preview build during
// "Collecting page data". We key off VERCEL_ENV when present so only the
// Production target enforces durable-store + secret requirements.

import { isSupabaseConfigured } from "@/lib/supabase";
import { isDeployedProduction } from "@/lib/deploymentEnv";

export { isDeployedProduction } from "@/lib/deploymentEnv";

/** Dev default for RATE_LIMIT_SALT — must not be used in production. */
export const DEV_RATE_LIMIT_SALT = "pubmax-rate-limit";
const MIN_PRODUCTION_SECRET_BYTES = 32;

const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Next evaluates route modules while compiling a production build, before a
 * server exists to receive requests. Environment assertions at that point
 * would make a keyless build impossible even though runtime handlers remain
 * guarded.
 *
 * PUBMAX_E2E_KEYLESS=1 is a deliberately exact, test-only escape hatch for
 * Playwright's local `next start` server. It must never be configured on a
 * deployed application: doing so opts that process into ephemeral stores.
 * It does not relax trusted signing; Playwright supplies a fresh dedicated key.
 * On a real Vercel Production deploy (`VERCEL_ENV=production`) it is
 * therefore ignored — production always runs the full assertions.
 */
function shouldSkipProductionEnvAssertions(): boolean {
  if (process.env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE) return true;
  return (
    process.env.PUBMAX_E2E_KEYLESS === "1" &&
    process.env.VERCEL_ENV !== "production"
  );
}

/**
 * True when this process must refuse the in-memory store / missing secrets.
 * On Vercel, only `VERCEL_ENV=production` counts — Preview builds share
 * NODE_ENV=production but typically omit Production-only env vars.
 */
/**
 * In production, throw a clear FATAL error when moderation or rate-limit
 * secrets are missing or still at dev defaults. Safe to call more than once.
 */
export function assertProductionSecrets(): void {
  if (!isDeployedProduction()) return;
  if (shouldSkipProductionEnvAssertions()) return;

  const adminToken = process.env.ADMIN_TOKEN?.trim();
  if (!adminToken) {
    throw new Error(
      "FATAL: ADMIN_TOKEN is not set in production. " +
        "Moderation endpoints would be unreachable or misconfigured. " +
        "Set a strong ADMIN_TOKEN and redeploy.",
    );
  }

  const rateLimitSalt = process.env.RATE_LIMIT_SALT?.trim();
  if (!rateLimitSalt || rateLimitSalt === DEV_RATE_LIMIT_SALT
    || Buffer.byteLength(rateLimitSalt, "utf8") < MIN_PRODUCTION_SECRET_BYTES) {
    throw new Error(
      `FATAL: RATE_LIMIT_SALT is unset, still the dev default, or shorter than ${MIN_PRODUCTION_SECRET_BYTES} bytes in production. ` +
        "IP/actor hashes would be computable from public code. " +
        "Set a high-entropy RATE_LIMIT_SALT and redeploy.",
    );
  }
  const planSigningSecret = process.env.PLAN_IDEMPOTENCY_SECRET?.trim();
  if (planSigningSecret && Buffer.byteLength(planSigningSecret, "utf8") < MIN_PRODUCTION_SECRET_BYTES) {
    throw new Error(
      `FATAL: PLAN_IDEMPOTENCY_SECRET must contain at least ${MIN_PRODUCTION_SECRET_BYTES} bytes in production. ` +
        "Set a high-entropy secret or remove it to use RATE_LIMIT_SALT, then redeploy.",
    );
  }
}

/**
 * In production, throw a clear FATAL error unless Supabase is configured;
 * elsewhere, do nothing. Reuses isSupabaseConfigured() (lib/supabase.ts) so the
 * definition of "configured" (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) stays in
 * exactly one place. Safe to call more than once — it only ever reads env.
 */
export function assertServerEnv(): void {
  if (!isDeployedProduction()) return;
  if (shouldSkipProductionEnvAssertions()) return;
  if (isSupabaseConfigured()) {
    assertProductionSecrets();
    return;
  }
  throw new Error(
    "FATAL: Supabase is not configured in production " +
      "(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required). " +
      "Refusing to start on the in-memory store — every write would be lost on the " +
      "next cold start. Set the Supabase env vars and redeploy.",
  );
}
