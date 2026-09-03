import { callerUserId } from "@/lib/authServer";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { confirmPalMemoryResult, listPalMemoriesResult } from "@/lib/pubPalStore";

export async function GET(request: Request) { const owner = await callerUserId(request); if (!owner) return publicApiError("Sign in to read Pal memory.", "AUTH_REQUIRED", 401); const result = await listPalMemoriesResult(owner); if (result.ok) return jsonNoStore({ memories: result.value }); return result.error === "error" ? publicApiError("Pal memory is temporarily unavailable.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true }) : jsonNoStore({ memories: [] }); }
export async function POST(request: Request) {
  const limiterKey = `pub-pal-memories:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
 const owner = await callerUserId(request); if (!owner) return publicApiError("Sign in to confirm Pal memory.", "AUTH_REQUIRED", 401); let body: unknown; try { body = await request.json(); } catch { return publicApiError("Malformed request body.", "INVALID_JSON", 400); } const result = await confirmPalMemoryResult(owner, body); if (result.ok) return jsonNoStore({ memory: result.value }, { status: 201 }); return result.error === "error" ? publicApiError("Pal memory could not be saved.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true }) : publicApiError("Choose a valid memory type and value.", "INVALID_PAL_MEMORY", 400); }
