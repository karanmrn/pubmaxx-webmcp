import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { deletePalMemoryResult, updatePalMemoryResult } from "@/lib/pubPalStore";

type Context = { params: Promise<{ memoryId: string }> };

function unauthenticated(): Response {
  return publicApiError("Sign in to manage Pal memory.", "AUTH_REQUIRED", 401);
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const limiterKey = `pub-pal-memories:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const ownerId = await callerUserId(request);
  if (!ownerId) return unauthenticated();
  let body: unknown;
  try { body = await request.json(); }
  catch { return publicApiError("Malformed request body.", "INVALID_JSON", 400); }
  const { memoryId } = await context.params;
  const result = await updatePalMemoryResult(ownerId, memoryId, body);
  if (result.ok) return jsonNoStore({ memory: result.value });
  return result.error === "error"
    ? publicApiError("Pal memory could not be updated.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("Pal memory was not found or the correction is empty.", "PAL_MEMORY_NOT_FOUND", 404);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `pub-pal-memories:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const ownerId = await callerUserId(request);
  if (!ownerId) return unauthenticated();
  const { memoryId } = await context.params;
  const result = await deletePalMemoryResult(ownerId, memoryId);
  if (result.ok) return jsonNoStore({ deleted: true });
  return result.error === "error"
    ? publicApiError("Pal memory could not be deleted.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("Pal memory not found.", "PAL_MEMORY_NOT_FOUND", 404);
}
