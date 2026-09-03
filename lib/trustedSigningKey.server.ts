import "server-only";

import { randomBytes } from "node:crypto";

import { isDeployedProduction } from "@/lib/deploymentEnv";
import { isSupabaseConfigured } from "@/lib/supabase";

export const MIN_TRUSTED_SIGNING_SECRET_BYTES = 32;

// This key exists only for the lifetime of one keyless demo process. Tokens and
// proofs minted with it intentionally stop verifying after a restart, matching
// the semantics of the in-memory stores they accompany.
const ephemeralKeylessSigningKey = randomBytes(MIN_TRUSTED_SIGNING_SECRET_BYTES);

export class TrustedSigningKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustedSigningKeyUnavailableError";
  }
}

function configuredSecret(name: "PLAN_IDEMPOTENCY_SECRET" | "RATE_LIMIT_SALT"): Buffer | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (Buffer.byteLength(value, "utf8") < MIN_TRUSTED_SIGNING_SECRET_BYTES) {
    throw new TrustedSigningKeyUnavailableError(
      `${name} must contain at least ${MIN_TRUSTED_SIGNING_SECRET_BYTES} bytes of random secret material for trusted signing.`,
    );
  }
  return Buffer.from(value, "utf8");
}

/**
 * Resolve the HMAC root for server-minted claims.
 *
 * Durable or deployed modes may only trust an operator-configured secret.
 * True keyless demos get a random process-local key—never a public constant—so
 * their ephemeral responses remain usable in-process without becoming
 * forgeable across machines or restarts.
 */
export function trustedSigningKey(): Buffer {
  const dedicated = configuredSecret("PLAN_IDEMPOTENCY_SECRET");
  if (dedicated) return dedicated;
  const shared = configuredSecret("RATE_LIMIT_SALT");
  if (shared) return shared;

  // Trusted signing is deliberately stricter than the storage backend policy.
  // PUBMAX_E2E_KEYLESS may select in-memory stores for local production-style
  // QA, but it can never authorize an ephemeral signing key in production.
  if (process.env.NODE_ENV === "production" || isDeployedProduction() || isSupabaseConfigured()) {
    throw new TrustedSigningKeyUnavailableError(
      "Trusted signing secret is unavailable. Configure PLAN_IDEMPOTENCY_SECRET or RATE_LIMIT_SALT with at least 32 bytes and retry.",
    );
  }
  return ephemeralKeylessSigningKey;
}

export function isTrustedSigningKeyUnavailableError(error: unknown): error is TrustedSigningKeyUnavailableError {
  return error instanceof TrustedSigningKeyUnavailableError;
}
