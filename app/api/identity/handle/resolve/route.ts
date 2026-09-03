import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { identityHandleStore, validateHandleForStore } from "@/lib/identityHandleStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const assessed = validateHandleForStore(new URL(request.url).searchParams.get("handle"));
  if (!assessed.ok) return publicApiError("Profile not found.", "NOT_FOUND", 404);
  try {
    const resolved = await identityHandleStore().resolve(assessed.handle);
    if (!resolved) {
      return publicApiError("Profile not found.", "NOT_FOUND", 404);
    }
    // Tombstone: handle remains reserved; public surface answers gone, not live.
    if (resolved.status === "gone") {
      return jsonNoStore({
        status: "gone",
        handle: resolved.requestedHandle,
        profileId: resolved.profileId,
      });
    }
    return jsonNoStore(resolved);
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}
