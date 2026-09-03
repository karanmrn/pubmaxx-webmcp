import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const rateKey = `handle-availability:${hashIp(clientIp(request))}`;
  if (await isLimited(rateKey, rateKey, 40)) {
    return publicApiError("Too many handle checks. Try again shortly.", "RATE_LIMITED", 429, { retryable: true });
  }
  const assessed = validateHandleForStore(new URL(request.url).searchParams.get("handle"));
  if (!assessed.ok) {
    return publicApiError(assessed.error, "INVALID_REQUEST", 400, {
      compatibilityFields: { available: false, reason: assessed.reason },
    });
  }
  try {
    const ownerId = await callerUserId(request);
    if (ownerId) {
      const owned = await identityHandleStore().ownedHandle(ownerId, [
        assessed.handle,
      ]);
      if (owned) {
        return jsonNoStore({ handle: assessed.handle, available: true });
      }
    }
    return jsonNoStore(await identityHandleStore().availability(assessed.handle));
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}
