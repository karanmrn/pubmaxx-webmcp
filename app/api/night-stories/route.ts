import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { createNightStory, listNightStoryInbox } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to view Night Stories.", "UNAUTHENTICATED", 401);
  const result = await listNightStoryInbox(ownerId);
  return result.ok
    ? jsonNoStore({ stories: result.value })
    : publicApiError("The Story inbox is temporarily unavailable.", "STORY_INBOX_UNAVAILABLE", 503, { retryable: true });
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `night-story-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Solo-operator emergency freeze (U15): creating a Night Story is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to create a Night Story.", "UNAUTHENTICATED", 401);
  let body: unknown;
  try { body = await request.json(); } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const story = await createNightStory(ownerId, body);
  return story
    ? jsonNoStore({ story }, { status: 201 })
    : publicApiError("Choose one of your Night Memories and add a title.", "INVALID_REQUEST", 400);
}
