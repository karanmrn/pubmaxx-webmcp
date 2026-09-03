import { callerUserId } from "@/lib/authServer";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { createPubPalResult, deletePubPalResult, getPubPalResult, updatePubPalResult } from "@/lib/pubPalStore";

async function owner(request: Request): Promise<string | Response> {
  return await callerUserId(request)
    ?? publicApiError("Sign in to own a Pub Pal.", "AUTH_REQUIRED", 401);
}

export async function GET(request: Request): Promise<Response> {
  const id = await owner(request);
  if (typeof id !== "string") return id;
  const result = await getPubPalResult(id);
  return result.ok
    ? jsonNoStore({ pal: result.value })
    : publicApiError("Pub Pal is temporarily unavailable.", "PUB_PAL_STORE_UNAVAILABLE", 503, { retryable: true });
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-write:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const id = await owner(request);
  if (typeof id !== "string") return id;
  let body: unknown;
  try { body = await request.json(); }
  catch { return publicApiError("Malformed request body.", "INVALID_JSON", 400); }
  const result = await createPubPalResult(id, body);
  if (result.ok) return jsonNoStore({ pal: result.value }, { status: 201 });
  return result.error === "error"
    ? publicApiError("Pub Pal could not be created right now.", "PUB_PAL_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("Fill in every Pal field and confirm you are 18+.", "INVALID_PUB_PAL", 400);
}

export async function PATCH(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-write:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const id = await owner(request);
  if (typeof id !== "string") return id;
  let body: unknown;
  try { body = await request.json(); }
  catch { return publicApiError("Malformed request body.", "INVALID_JSON", 400); }
  const result = await updatePubPalResult(id, body);
  if (result.ok) return jsonNoStore({ pal: result.value });
  return result.error === "error"
    ? publicApiError("Pub Pal controls are temporarily unavailable.", "PUB_PAL_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("Pub Pal not found.", "PUB_PAL_NOT_FOUND", 404);
}

export async function DELETE(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-write:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const id = await owner(request);
  if (typeof id !== "string") return id;
  const result = await deletePubPalResult(id);
  if (result.ok) return jsonNoStore({ deleted: true });
  return result.error === "error"
    ? publicApiError("Pub Pal could not be deleted.", "PUB_PAL_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("Pub Pal not found.", "PUB_PAL_NOT_FOUND", 404);
}
