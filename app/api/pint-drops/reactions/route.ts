// Durable pub-native reactions on pint drops.
//   GET  ?ids=a,b,c&actor=<anonId>  → { summaries: { [dropId]: {counts, mine} } }
//   POST { id, actor, reaction }     → { summary: {counts, mine} }  (toggles)
//
// The actor is the viewer's opaque device id (lib/anonId.ts); we hash it here
// (hashActor) so the raw id never lands in a table. A reaction on a drop that
// isn't persisted (a demo seed) answers 404 (UnknownDropError) — the client
// keeps its local-only toggle for sample cards. Store choice is the usual seam:
// Supabase when configured, process-memory otherwise (reactions are non-critical,
// so there is no 503 — an unconfigured prod just gets per-instance counts).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { dropOwnerHandle, emitNotification } from "@/lib/notificationsStore";
import { filterPubliclyReadableDropIds } from "@/lib/pintDropLookup";
import { isLimited } from "@/lib/pintDrops";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  isReactionKey,
  reactionsStore,
  UnknownDropError,
} from "@/lib/reactionsStore";
import { hashActor } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

// Cap how many drops one feed page can summarise in a single request.
const MAX_IDS = 100;

// Reactions are lightweight toggles, so the flood guard is deliberately
// generous: many per feed page is normal, only a hammering actor should trip it.
const REACTION_LIMIT = 40;
const REACTION_WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const ids = (params.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);
  if (ids.length === 0) return jsonNoStore({ summaries: {} }, { status: 200 });

  const actorHash = hashActor(params.get("actor"));
  try {
    // F3: parent-drop visibility gate. Hidden (moderated) and non-public
    // (friends/legacy) drops are filtered OUT of the batch before summarising
    // — ONE batched lookup for all requested ids, never per-id — so their
    // reaction counts never leave the server. Gated ids are simply absent from
    // the summaries map (the same shape as an id nobody requested), matching
    // how the feed silently omits these drops; never a 404 existence oracle.
    // The batched-summary contract for the surviving ids is unchanged.
    // A visibility-lookup outage (`null`) is fail-soft on the read path: the
    // feed keeps rendering with empty summaries rather than a 503 that would
    // break the host page. POST distinguishes outage from gated (see below).
    const readable = await filterPubliclyReadableDropIds(ids);
    if (!readable || readable.length === 0) {
      return jsonNoStore({ summaries: {} }, { status: 200 });
    }
    return jsonNoStore(
      { summaries: await reactionsStore().summarize(readable, actorHash) },
      { status: 200 },
    );
  } catch {
    // Reactions are best-effort — an empty map keeps the feed rendering.
    return jsonNoStore({ summaries: {} }, { status: 200 });
  }
}

export async function POST(request: Request): Promise<Response> {
  // Solo-operator emergency freeze (U15): reacting is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const id = readString(body.id);
  const reaction = body.reaction;
  if (!id) return publicApiError("Missing pint drop id.", "INVALID_REQUEST", 400);
  if (!isReactionKey(reaction)) {
    return publicApiError("Unknown reaction.", "INVALID_REQUEST", 400);
  }

  // F3 write gate: mirror GET — reject toggles on hidden/friends/legacy parents.
  // 404 matches UnknownDropError so gated ids are not an existence oracle. A
  // visibility LOOKUP failure (`null`) is a distinct dependency outage → 503,
  // so a Supabase blip / misconfig is not silently reported as "not found"
  // (which would look like every drop was moderated to the client).
  const readable = await filterPubliclyReadableDropIds([id]);
  if (readable === null) {
    return publicApiError("Reactions are unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
  if (readable.length === 0) {
    return publicApiError("Pint drop not found.", "NOT_FOUND", 404);
  }

  const actorHash = hashActor(readString(body.actor));

  // Flood guard per hashed actor. Mirrors comments/saved-pubs, but with a
  // generous budget (reactions are cheap toggles — a normal feed page fires
  // several). 429 only once one actor blows past REACTION_LIMIT in the window.
  if (
    await isLimited(`reaction:${actorHash}`, `reaction:${actorHash}`, REACTION_LIMIT, REACTION_WINDOW_MS)
  ) {
    return publicApiError("Too many reactions, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const summary = await reactionsStore().toggle(id, actorHash, reaction);
    // Emit seam (best-effort, additive): when the client supplies its handle AND
    // this toggle turned the reaction ON (mine now includes it), notify the drop's
    // author. A reaction is otherwise attributed only to an opaque actor_hash, so
    // with no handle there is no one to name — we just skip the notification.
    // Never awaited for correctness — a notification failure must not fail the
    // reaction toggle.
    // JWT-linked handle wins over a self-asserted body.handle when signed in.
    const actorHandle = await resolveMessageHandle(request, readString(body.handle));
    if (actorHandle && summary.mine.includes(reaction)) {
      const ownership = await gateHandleAction(request, actorHandle);
      if (ownership.allowed) {
        void dropOwnerHandle(id)
          .then((owner) => {
            if (!owner) return;
            return emitNotification({
              recipientHandle: owner,
              actorHandle: ownership.handle,
              kind: "reaction",
              subjectRef: id,
              subjectLabel: reaction,
            });
          })
          .catch(() => {});
      }
    }
    return jsonNoStore({ summary }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownDropError) {
      // A demo/sample drop isn't persisted — tell the client to keep it local.
      return publicApiError("Pint drop not found.", "NOT_FOUND", 404);
    }
    console.error("[reactions] POST failed:", err instanceof Error ? err.stack || err.message : err);
    return publicApiError("Reactions are unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
}
