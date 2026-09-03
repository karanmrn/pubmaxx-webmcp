import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { getNightStoryWorkspaceResult } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to review this Story.", "AUTH_REQUIRED", 401);
  const { id } = await context.params;
  const result = await getNightStoryWorkspaceResult(actorId, id);
  if (result.ok) return jsonNoStore(result.value);
  if (result.error === "error") return publicApiError("The Story workspace is temporarily unavailable.", "STORY_WORKSPACE_UNAVAILABLE", 503, { retryable: true });
  if (result.error === "not_found") return publicApiError("That Story was not found.", "STORY_NOT_FOUND", 404);
  return publicApiError("That private Story workspace is not available to this account.", "STORY_WORKSPACE_FORBIDDEN", 403);
}
