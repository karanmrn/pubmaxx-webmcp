import "server-only";

// Reading ONE message photo, byte-for-byte out of the private bucket.
//
// This is the one place in the tree where owned-image bytes are NOT public. A
// wall photo is a pub's; a profile photo is a face somebody chose to show; a
// message photo was sent to one person. So the gate is the courtesy check the
// thread read already makes - the signed-in linked actor, then the participant
// pair - and there is no public lane beside it to reach for by mistake.
//
// Every refusal answers the reader the same `Photo not found.`, which makes six
// gates one indistinguishable finding, so the bytes are never cached anywhere
// but the reader's own browser and nothing about the refusal says which gate
// it was. The write half is `lib/messagePhotoMedia.server.ts`; the reader is
// the SAME `downloadUploadedImageObject` the avatar, the cover and a pub wall
// photo use, so "what counts as unreadable" cannot drift between them.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { requireLinkedActor } from "@/lib/messageAuth";
import {
  downloadMessagePhotoObject,
  type DownloadedMessagePhoto,
} from "@/lib/messagePhotoMedia.server";
import { messagesStore } from "@/lib/messagesStore";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { clientIp, hashIp } from "@/lib/supabase";

/** A DM photo is one person's, so nothing shared may hold a copy of it. */
export const MESSAGE_PHOTO_SERVE_CACHE_CONTROL = "private, no-store";

const SERVE_LIMIT = 240;
const SERVE_WINDOW_MS = 60_000;

export type MessagePhotoServeDeps = {
  photoObjectKey: (
    conversationId: string,
    messageId: string,
    handle: string,
  ) => Promise<string | null>;
  downloadObject: (objectKey: string) => Promise<DownloadedMessagePhoto | null>;
};

export const defaultMessagePhotoServeDeps: MessagePhotoServeDeps = {
  photoObjectKey: (conversationId, messageId, handle) =>
    messagesStore().photoObjectKey(conversationId, messageId, handle),
  downloadObject: (objectKey) => downloadMessagePhotoObject(objectKey),
};

function notFound(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, {
    headers: { "Cache-Control": MESSAGE_PHOTO_SERVE_CACHE_CONTROL },
  });
}

export async function handleMessagePhotoServe(
  request: Request,
  params: { id: string; messageId: string },
  deps: MessagePhotoServeDeps = defaultMessagePhotoServeDeps,
): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  const key = `message-photo-serve:${ipHash}`;
  if (await isLimited(key, key, SERVE_LIMIT, SERVE_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: { "Cache-Control": MESSAGE_PHOTO_SERVE_CACHE_CONTROL },
    });
  }

  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const actor = await requireLinkedActor(request, asserted);
  if (!actor.ok) {
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return notFound();

  // The same ownership gate the thread takes, collapsing 403 to the shared
  // refusal so the endpoint never confirms a private photo exists to an
  // outsider.
  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    if (ownership.status === 403) return notFound();
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const conversationId = decodeURIComponent(params.id).trim();
  const messageId = decodeURIComponent(params.messageId).trim();
  if (!conversationId || !messageId) return notFound();

  const objectKey = await deps.photoObjectKey(conversationId, messageId, handle);
  if (!objectKey) return notFound();

  const downloaded = await deps.downloadObject(objectKey);
  if (!downloaded) return notFound();

  return new Response(new Uint8Array(downloaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": downloaded.contentType,
      "Cache-Control": MESSAGE_PHOTO_SERVE_CACHE_CONTROL,
    },
  });
}
