// A single conversation's thread (PRD E4 / Wave I2).
//   GET  ?handle=<handle>                              → { messages: MessageDTO[] }
//   POST { action:"send",   handle, body, venueId? }   → { message }
//   POST multipart { post: <send json>, photo: <file> }→ { message }
//   POST { action:"report", handle, messageId }        → { flagged: boolean }
//
// Wave I2: requires a signed-in linked actor (401 without JWT). Linked-handle
// ownership still collapses 403 → 404 so the endpoint never confirms a private
// thread exists to an outsider.
//
// A message may carry ONE attachment (`lib/messageAttachments.ts`): a photo or
// a pub. The photo takes the whole owned-image journey - staging, EXIF strip,
// advisory scan, Blob write, write-side proof - through
// `lib/messagePhotoMedia.server.ts`, so refused bytes never reach a serving key
// and a mangled write is refused while the sender is still here to be told. The
// pub stores an id and nothing else; its name, area and any figure it is allowed
// to print are resolved on the READ path, because a price frozen into a message
// is an undated claim nobody can correct.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData } from "@/lib/boundedRequest.server";
import { log } from "@/lib/log";
import {
  isMessageVenueId,
  MESSAGE_PHOTO_REFUSED_LINE,
  type MessageAttachmentWrite,
} from "@/lib/messageAttachments";
import { requireLinkedActor } from "@/lib/messageAuth";
import {
  discardStagedMessagePhoto,
  MESSAGE_PHOTO_MAX_BYTES,
  MessagePhotoError,
  prepareMessagePhoto,
  promoteStagedMessagePhoto,
  signMessagePhotoObject,
  stagePreparedMessagePhoto,
  type StagedMessagePhoto,
} from "@/lib/messagePhotoMedia.server";
import { messagePhotoRouteDeps } from "@/lib/messagePhotoRoute.server";
import { attachMessageVenueCards } from "@/lib/messageVenueCards.server";
import { messagesStore } from "@/lib/messagesStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";

assertServerEnv();

const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

/** A photo costs a safety scan, which is a paid call anyone with a thread can
 *  spend. So the photo budget is its own, it is tighter than the text budget,
 *  and it fails CLOSED: a limiter we cannot reach refuses rather than handing
 *  the provider bill to whoever asks. */
const PHOTO_LIMIT = 12;
const PHOTO_WINDOW_MS = 60 * 60 * 1000;

type Ctx = { params: Promise<{ id: string }> };

function photoError(error: unknown): Response {
  if (error instanceof MessagePhotoError) {
    const status =
      error.code === "TOO_LARGE" ? 413 : error.code === "STORAGE_UNAVAILABLE" ? 503 : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  return publicApiError("Photo could not be processed.", "PROCESSING_FAILED", 400);
}

/** The multipart body a composer sends: one JSON part and one file. */
async function parsePhotoUpload(
  request: Request,
): Promise<{ input: Record<string, unknown>; photo: File } | null> {
  try {
    const form = await boundedFormData(request, MESSAGE_PHOTO_MAX_BYTES + 64 * 1024);
    if ([...form.keys()].some((key) => key !== "post" && key !== "photo")) return null;
    const postParts = form.getAll("post");
    const photoParts = form.getAll("photo");
    if (postParts.length !== 1 || typeof postParts[0] !== "string") return null;
    if (photoParts.length !== 1 || !(photoParts[0] instanceof File)) return null;
    const parsed: unknown = JSON.parse(postParts[0]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { input: parsed as Record<string, unknown>, photo: photoParts[0] };
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const actor = await requireLinkedActor(request, asserted);
  if (!actor.ok) {
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return publicApiError("Add your handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    if (ownership.status === 403) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const messages = await messagesStore().listMessages(id, handle);
  if (messages === null) {
    return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  }
  return jsonNoStore({ messages: await attachMessageVenueCards(messages) }, { status: 200 });
}

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  const multipart = contentType.startsWith("multipart/form-data");

  let body: Record<string, unknown>;
  let photo: File | null = null;
  if (multipart) {
    const submitted = await parsePhotoUpload(request);
    if (!submitted) {
      return publicApiError("Attach one photo and its message.", "INVALID_REQUEST", 400);
    }
    body = submitted.input;
    photo = submitted.photo;
  } else {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
    }
  }

  const action = readString(body.action);
  const actor = await requireLinkedActor(request, readString(body.handle) ?? "");
  if (!actor.ok) {
    return publicApiErrorFromStatus(actor.error, actor.status);
  }
  const handle = actor.handle;
  if (!handle) return publicApiError("Add your handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    if (ownership.status === 403) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const store = messagesStore();

  if (!multipart && action === "report") {
    const messageId = readString(body.messageId);
    if (!messageId) return publicApiError("Missing message id.", "INVALID_REQUEST", 400);
    const thread = await store.listMessages(id, handle);
    if (thread === null) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    const flagged = await store.report(id, messageId, handle);
    return jsonNoStore({ flagged }, { status: 200 });
  }

  if (action !== "send") {
    return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
  }

  // Solo-operator emergency freeze (U15): sending is a social write. The
  // `report` branch above returns first, so reporting a message stays OPEN.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const key = `msg-send:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, SEND_LIMIT, SEND_WINDOW_MS)) {
    return publicApiError("Too many messages, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const messageBody = readString(body.body) ?? "";

  if (photo) {
    return sendPhoto(request, { conversationId: id, handle, messageBody, photo, store });
  }

  // A pub shared into a message stores its id and nothing else. No coordinate
  // of any kind rides here: the viewer-coordinate egress law is untouched.
  let attachment: MessageAttachmentWrite | undefined;
  const venueId = readString(body.venueId);
  if (venueId) {
    if (!isMessageVenueId(venueId)) {
      return publicApiError("Choose a pub.", "INVALID_REQUEST", 400);
    }
    attachment = { kind: "venue", venueId };
  }

  if (!messageBody && !attachment) {
    return publicApiError("Write a message.", "INVALID_REQUEST", 400);
  }

  const message = await store.send(id, handle, messageBody, attachment);
  if (!message) {
    return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  }
  return jsonNoStore(
    { message: (await attachMessageVenueCards([message]))[0] },
    { status: 201 },
  );
}

async function sendPhoto(
  request: Request,
  input: {
    conversationId: string;
    handle: string;
    messageBody: string;
    photo: File;
    store: ReturnType<typeof messagesStore>;
  },
): Promise<Response> {
  const { conversationId, handle, messageBody, photo, store } = input;

  const budgetKey = `msg-photo:${handle}:${hashIp(clientIp(request))}`;
  if (
    await isLimited(budgetKey, budgetKey, PHOTO_LIMIT, PHOTO_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many photos, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  // Nothing is prepared, staged or scanned before the courtesy check has said
  // this is the sender's own conversation: a stranger must not be able to spend
  // a scan on an id they guessed.
  const thread = await store.listMessages(conversationId, handle);
  if (thread === null) {
    return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  }

  const messageId = crypto.randomUUID();
  const { storage, moderation } = messagePhotoRouteDeps();
  let staged: StagedMessagePhoto | null = null;
  try {
    const prepared = await prepareMessagePhoto(photo);
    staged = await stagePreparedMessagePhoto(conversationId, messageId, prepared, storage);

    const signedUrl = await signMessagePhotoObject(staged.stagingKey, storage);
    const scan = await scanUploadedImage({
      surface: "message-photo",
      signedUrl,
      adapter: moderation,
    });

    if (scan.verdict === "refused") {
      // Refused bytes never reach the serving key, so nothing was ever one
      // request away from being readable.
      await discardStagedMessagePhoto(staged, storage);
      staged = null;
      return publicApiError(MESSAGE_PHOTO_REFUSED_LINE, "PHOTO_REFUSED", 400);
    }

    const promoted = await promoteStagedMessagePhoto(staged, storage);
    staged = null;

    const message = await store.send(conversationId, handle, messageBody, {
      kind: "photo",
      messageId,
      objectKey: promoted.objectKey,
      width: promoted.width,
      height: promoted.height,
    });
    if (!message) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    return jsonNoStore({ message }, { status: 201 });
  } catch (error) {
    if (staged) {
      try {
        await discardStagedMessagePhoto(staged, storage);
      } catch {
        // Swallow cleanup errors so the original failure is what is reported.
      }
    }
    if (error instanceof MessagePhotoError) return photoError(error);
    log("error", "message_photo.send_failed", {
      route: "POST /api/messages/[id]",
      error: error instanceof Error ? error.message : String(error),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
