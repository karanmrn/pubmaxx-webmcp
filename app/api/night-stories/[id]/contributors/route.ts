import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { acceptStoryContributionResult, declineStoryContributionResult, upsertStoryContributor } from "@/lib/nightMemoryStore";
import { profileStore } from "@/lib/profileStore";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-story-contributors:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to invite a contributor.", "UNAUTHENTICATED", 401);
  let body: unknown;
  try { body = await request.json(); } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const { id } = await context.params;
  const contributor = await upsertStoryContributor(actorId, id, body);
  const handle = body && typeof body === "object" && typeof (body as { handle?: unknown }).handle === "string"
    ? (body as { handle: string }).handle.toLocaleLowerCase()
    : "";
  return contributor
    ? jsonNoStore({ contributor: { storyId: contributor.storyId, handle, role: contributor.role, status: contributor.status, joinedAt: contributor.joinedAt } }, { status: 201 })
    : publicApiError("Only a host or editor can invite contributors.", "FORBIDDEN", 403);
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-story-contributors:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to accept this invitation.", "UNAUTHENTICATED", 401);
  const { id } = await context.params;
  const result = await acceptStoryContributionResult(actorId, id);
  if (!result.ok) return result.error === "error"
    ? publicApiError("The Story invitation store is temporarily unavailable.", "STORY_INVITATION_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("No active Story invitation was found.", "STORY_INVITATION_NOT_FOUND", 404);
  const profile = await profileStore().getByUserId(actorId);
  const contributor = result.value;
  return jsonNoStore({ contributor: { storyId: contributor.storyId, handle: profile?.handle ?? null, role: contributor.role, status: contributor.status, joinedAt: contributor.joinedAt } });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-story-contributors:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to decline this invitation.", "UNAUTHENTICATED", 401);
  const { id } = await context.params;
  const result = await declineStoryContributionResult(actorId, id);
  if (result.ok) return jsonNoStore({ declined: true });
  return result.error === "error"
    ? publicApiError("The Story invitation store is temporarily unavailable.", "STORY_INVITATION_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("No active Story invitation was found.", "STORY_INVITATION_NOT_FOUND", 404);
}
