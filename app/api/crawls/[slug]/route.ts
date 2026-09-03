// Author-gated edit/delete for a durable Crawl Story (story 35).
//   PATCH  { handle, title?, summary?, visibility? }  → { story }   (author only)
//   DELETE { handle }                                  → { ok: true } (author only)
//
// AUTHORSHIP ENFORCEMENT SEAM. Identity is a self-asserted device handle (no auth
// yet), so the gate is `author_handle` equality (isAuthor in lib/crawlStoryStore).
// This is HONEST but WEAK — anyone can claim any handle until auth ownership
// merges. When it does, isAuthor hardens to auth.uid() ownership and this route is
// unchanged. A non-author (or a missing/blank handle) gets 403; an unknown slug
// or an anonymous story (no author to match) also 403s — you can never edit a
// story you don't own.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  deleteCrawlStory,
  getStoryAuthor,
  isAuthor,
  updateCrawlStory,
} from "@/lib/crawlStoryStore";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

const MAX_TITLE = 120;
const MAX_SUMMARY = 280;

// A blank/mismatched handle can never edit — 403 (not 401: there is no auth realm
// to challenge, this is a self-asserted ownership gate).
function forbidden(): Response {
  return publicApiError("You can only edit a crawl you authored.", "FORBIDDEN", 403);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // JWT-linked handle wins over a self-asserted body.handle when signed in.
  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) return forbidden();

  // Linked-handle ownership: a claimed handle cannot be forged via body.handle.
  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // Rate-limit edits per handle + hashed IP so the edit path can't be hammered.
  const key = `crawl-edit:${ownership.handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Author gate — use the normalized handle from gateHandleAction; for linked
  // authors, isAuthor also verifies the JWT owner matches the profile link.
  if (!(await isAuthor(slug, ownership.handle, ownership.callerUserId))) return forbidden();

  const patch: { title?: string; summary?: string; visibility?: unknown } = {};
  if ("title" in body) patch.title = readString(body.title)?.slice(0, MAX_TITLE) ?? "";
  if ("summary" in body) patch.summary = readString(body.summary)?.slice(0, MAX_SUMMARY) ?? "";
  if ("visibility" in body) patch.visibility = body.visibility;

  const story = await updateCrawlStory(slug, ownership.handle, patch as never, ownership.callerUserId);
  if (!story) {
    return publicApiError("Could not update this crawl.", "INVALID_REQUEST", 400);
  }
  return jsonNoStore({ story }, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // A DELETE may carry no body; the handle can still arrive via a query param.
  }
  // JWT-linked handle wins over a self-asserted body/query handle when signed in.
  const handle = await resolveMessageHandle(
    request,
    readString(body.handle) ?? readString(new URL(request.url).searchParams.get("handle")),
  );
  if (!handle) return forbidden();

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const key = `crawl-del:${ownership.handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many deletes, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  if (!(await isAuthor(slug, ownership.handle, ownership.callerUserId))) return forbidden();

  const ok = await deleteCrawlStory(slug, ownership.handle, ownership.callerUserId);
  if (!ok) return publicApiError("Could not delete this crawl.", "INVALID_REQUEST", 400);
  return jsonNoStore({ ok: true }, { status: 200 });
}

// GET-author convenience (used by the story page's owner-aware controls if it ever
// needs a client check). Public info — author_handle is already rendered on the
// page — so no gate. Never 500s: an unknown slug yields { author: null }.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return jsonNoStore({ author: await getStoryAuthor(slug) }, { status: 200 });
}
