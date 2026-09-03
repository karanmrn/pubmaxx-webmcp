// Comment moderation queue for the admin console (story 37).
//   GET  ?status=hidden|pending   → { comments: ModeratorCommentDTO[] }
//   POST { action, id }           → { ok: true }   action ∈ restore | keep_hidden
//
// Same review-action shape as the Pint Drop queue (restore → visible, keep_hidden
// → hidden). Reuses the admin gate (x-admin-token header OR httpOnly session
// cookie; see lib/adminAuth.ts). A comment's actor_hash is NEVER exposed — the moderator DTO
// carries only { id, pintDropId, handle, body, status, createdAt }.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { commentsStore } from "@/lib/commentsStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-comments:${ipKey}`, `admin-comments:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const status = new URL(request.url).searchParams.get("status");
  const queue = status === "pending" ? "pending" : "hidden";
  // listForReview is fail-soft (returns [] on any store error).
  const comments = await commentsStore().listForReview(queue);
  return jsonNoStore({ comments }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const id = readString(body.id);
  if (!id) return publicApiError("Missing comment id.", "INVALID_REQUEST", 400);

  const action = readString(body.action);
  if (action !== "restore" && action !== "keep_hidden") {
    return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
  }

  const status = action === "restore" ? "visible" : "hidden";
  try {
    const ok = await commentsStore().moderate(id, status);
    if (!ok) return publicApiError("Comment not found.", "NOT_FOUND", 404);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Comment moderation is unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
}
