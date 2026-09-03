import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to rename your PUBMAXX handle.", "UNAUTHENTICATED", 401);
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
  const rateKey = `handle-rename:${ownerId}:${hashIp(clientIp(request))}`;
  if (await isLimited(rateKey, rateKey, 12)) {
    return publicApiError("Too many rename attempts. Try again shortly.", "RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const requested = normalizeHandle(
    typeof body.handle === "string" ? body.handle : "",
  );
  if (requested) {
    const current = await profileStore().getByUserId(ownerId);
    if (current && normalizeHandle(current.handle) === requested) {
      return jsonNoStore({
        profileId: current.id,
        previousHandle: current.handle,
        handle: current.handle,
      });
    }
  }
  const assessed = validateHandleForStore(body?.handle);
  if (!assessed.ok) {
    return publicApiError(assessed.error, "INVALID_REQUEST", 400, {
      compatibilityFields: { reason: assessed.reason },
    });
  }
  const result = await identityHandleStore().rename(ownerId, assessed.handle);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "storage" ? 503 : result.code === "cooldown" ? 429 : 409;
    return publicApiError(result.error, result.code, status, {
      retryable: status === 429 || status >= 500,
      compatibilityFields: { ...(result.retryAt ? { retryAt: result.retryAt } : {}) },
    });
  }
  return jsonNoStore(result);
}
