// Shared authentication for the Vercel cron freshness plane (app/api/cron/*).
//
// Vercel invokes a scheduled route with `Authorization: Bearer ${CRON_SECRET}`
// when the CRON_SECRET env var is set (its own dispatcher also enforces it and
// 401s a bad secret). We re-check inside every cron handler as defence in depth,
// because the route path is otherwise directly hittable by anyone who guesses it
// — the header check is the ONLY thing standing between the public internet and
// a mutating scheduled job.
//
// Posture when CRON_SECRET is UNSET:
//   • production            → DENY (503-style 401). An unprotected mutating cron
//     is never exposed; the owner must set CRON_SECRET (see the runbook).
//   • development / test     → ALLOW. Local runs and the hermetic suite need to
//     drive these handlers without a secret configured.
// This mirrors lib/adminAuth.ts's "unset denies in prod, opens in dev/test".

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { publicApiError } from "@/lib/apiError";

// Constant-time compare: sha256 both sides so lengths always match, then
// timingSafeEqual — a plain === leaks match length/prefix via timing.
function safeSecretEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Gate a cron route. Returns `null` when the caller is authorised (the handler
 * should proceed), or a ready-to-return 401 Response when it is not. Never
 * throws. The 401 body is the flat public-error envelope with `no-store`.
 */
export function assertCronRequest(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      return null;
    }
    // Loud-but-soft: the job cannot authenticate itself, so it refuses to run
    // rather than exposing a mutating endpoint unprotected.
    console.error("[cron-auth] CRON_SECRET is not configured — refusing to run scheduled job.");
    return publicApiError(
      "Scheduled job authentication is not configured.",
      "CRON_NOT_CONFIGURED",
      401,
    );
  }

  const token = bearerToken(request);
  if (!token || !safeSecretEqual(token, expected)) {
    return publicApiError("Invalid or missing cron credential.", "CRON_UNAUTHORIZED", 401);
  }

  return null;
}
