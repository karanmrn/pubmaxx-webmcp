// Shared-secret gate for the Pub Pal Custom LLM bridge (ElevenLabs → /api/pub-pal/llm).
// Fail closed in production when the secret is unset; callers must present the same
// value via Authorization Bearer or the dedicated header.

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { publicApiError } from "@/lib/apiError";

export const PUB_PAL_LLM_SECRET_HEADER = "x-elevenlabs-llm-secret";

function safeSecretEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

function headerToken(request: Request): string | null {
  const token = request.headers.get(PUB_PAL_LLM_SECRET_HEADER)?.trim();
  return token && token.length > 0 ? token : null;
}

export function readPubPalLlmSharedSecret(): string | null {
  const secret = process.env.ELEVENLABS_LLM_SHARED_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

/** Returns 503 when the Custom LLM bridge is not configured on this deployment. */
export function assertPubPalLlmConfigured(): Response | null {
  if (readPubPalLlmSharedSecret()) return null;
  return publicApiError(
    "Pub Pal Custom LLM is not configured yet.",
    "UNAVAILABLE",
    503,
    { retryable: true },
  );
}

/**
 * Gate the Custom LLM route. Returns `null` when authorised, or a ready Response
 * when the caller should be turned away.
 */
export function assertPubPalLlmAuth(request: Request): Response | null {
  const expected = readPubPalLlmSharedSecret();
  if (!expected) {
    return publicApiError(
      "Pub Pal Custom LLM is not configured yet.",
      "UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  const provided = bearerToken(request) ?? headerToken(request);
  if (!provided || !safeSecretEqual(provided, expected)) {
    return publicApiError(
      "Invalid or missing Custom LLM credential.",
      "UNAUTHENTICATED",
      401,
    );
  }

  return null;
}
