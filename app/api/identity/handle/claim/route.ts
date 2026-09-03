import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { isHandleClaimLimited } from "@/lib/identityHandleClaimRateLimit";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to claim a PUBMAXX handle.", "UNAUTHENTICATED", 401);
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
  if (await isHandleClaimLimited(request, ownerId)) {
    return publicApiError("Too many handle attempts. Try again shortly.", "RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const assessed = validateHandleForStore(body?.handle);
  if (!assessed.ok) {
    return publicApiError(assessed.error, "INVALID_REQUEST", 400, {
      compatibilityFields: { reason: assessed.reason },
    });
  }
  const result = await identityHandleStore().claim(ownerId, assessed.handle);
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.code === "storage" ? 503 : 409);
  }
  return jsonNoStore(result, { status: 201 });
}
