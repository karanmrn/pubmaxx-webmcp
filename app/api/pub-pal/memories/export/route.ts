import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { getPubPalResult, listPalMemoriesResult } from "@/lib/pubPalStore";

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-export:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 10)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to export Pal memory.", "AUTH_REQUIRED", 401);
  const palResult = await getPubPalResult(ownerId);
  if (!palResult.ok) return publicApiError("Pal memory export is temporarily unavailable.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true });
  const pal = palResult.value;
  if (!pal) return publicApiError("Pub Pal not found.", "PUB_PAL_NOT_FOUND", 404);
  const result = await listPalMemoriesResult(ownerId);
  if (!result.ok) return result.error === "error"
    ? publicApiError("Pal memory export is temporarily unavailable.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("Pub Pal not found.", "PUB_PAL_NOT_FOUND", 404);
  const memories = result.value;
  return jsonNoStore({
    version: 1,
    exportedAt: new Date().toISOString(),
    pal: { name: pal.name, species: pal.appearance.species },
    proposalPreferences: pal.proposalPreferences,
    memories: memories.map(({ id, kind, value, provenance, createdAt, updatedAt }) => ({ id, kind, value, provenance, createdAt, updatedAt })),
  }, {
    headers: { "content-disposition": `attachment; filename="pubmaxx-pal-memory-${pal.id}.json"` },
  });
}
