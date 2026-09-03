// Messaging model — the shared vocabulary + PURE helpers for 1:1 messages between
// handles (PRD E4). Types + validation live here (no store import) so a route can
// import the model without pulling a storage backend into scope until it's used.
// Everything here is pure and `now`-injected so it unit-tests without a DOM, a
// network, a clock, or a database.
//
// ─────────────────────────────────────────────────────────────────────────────
// COURTESY-CURTAIN, NOT PRIVACY. Identity is a self-asserted `handle` (no auth
// yet — same trust boundary as the rest of the social layer). A "private" message
// is only as private as the honesty of whoever claims a handle; the server route
// mediates every read with a participant check, but that check trusts the handle.
// Keep content low-sensitivity by design. See supabase/migrations/0019_messages.sql.
// ─────────────────────────────────────────────────────────────────────────────

import type { MessageAttachment } from "@/lib/messageAttachments";
import { normalizeHandle } from "@/lib/profiles";
import { cleanText } from "@/lib/textClean";

// Message bodies are capped here AND by the messages_body_len_chk constraint in
// migration 0019. Keep the two in lockstep.
export const MAX_MESSAGE_BODY = 1000;

// A normalised, ordered handle pair. handleA < handleB (lexicographic) so an
// unordered pair maps to exactly one conversation regardless of who opened it —
// mirrors the conversations unique (handle_a, handle_b) + order check.
export type HandlePair = { handleA: string; handleB: string };

/**
 * Normalise two untrusted handles into an ordered pair, or null when the pair is
 * invalid: a missing/blank handle either side, or a self-pair (you can't DM
 * yourself — rejected here so no store/route needs to special-case it). Both
 * handles run through normalizeHandle (lowercase, strip leading @, handle
 * alphabet), then sorted so handleA < handleB.
 */
export function normalizePair(a: string, b: string): HandlePair | null {
  const ha = normalizeHandle(a);
  const hb = normalizeHandle(b);
  if (!ha || !hb) return null;
  if (ha === hb) return null; // no self-conversations
  return ha < hb ? { handleA: ha, handleB: hb } : { handleA: hb, handleB: ha };
}

/**
 * True when `handle` is one of the pair — the courtesy participant check the read
 * side leans on. Both sides are normalised so "@Ken" matches a stored "ken".
 */
export function isParticipant(pair: HandlePair, handle: string): boolean {
  const h = normalizeHandle(handle);
  if (!h) return false;
  return h === pair.handleA || h === pair.handleB;
}

/**
 * Clean + validate an untrusted message body. Reuses the cleanText trust boundary
 * (strip angle brackets / control chars, collapse whitespace, trim, cap). Returns
 * the cleaned body, or null when nothing survives (empty / whitespace-only) — a
 * route turns null into a 400 so a blank message never reaches the store.
 */
export function cleanBody(input: unknown): string | null {
  const cleaned = cleanText(input, MAX_MESSAGE_BODY);
  return cleaned ? cleaned : null;
}

/**
 * The same cleaning for a body that rides WITH an attachment, where empty is a
 * real answer rather than a reject: a photo sent without a caption is a message,
 * and refusing it would make the words the point of a picture. Returns "" when
 * nothing survives, never null — the caller has already decided there is
 * something else in the message.
 */
export function cleanAttachedBody(input: unknown): string {
  return cleanText(input, MAX_MESSAGE_BODY);
}

// The public message DTO the thread renders. `mine` is resolved per-viewer at the
// store/route boundary (not stored) so bubbles align left/right. `flagged` is the
// abuse-report marker — surfaced so a reporter sees their own report landed.
//
// `attachment` is at most one photo or one pub (lib/messageAttachments.ts). It is
// absent on a FLAGGED message by design: a report is the only lane that takes a
// message photo down, and in a conversation of two people the person who
// objected is the whole audience. The row and its provenance stay; the picture
// stops travelling.
export type MessageDTO = {
  id: string;
  conversationId: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  read: boolean;
  flagged: boolean;
  attachment?: MessageAttachment;
};

// The inbox row: one per conversation, with the OTHER participant + a preview of
// the last message + how many are unread FOR THE VIEWER.
export type ConversationDTO = {
  id: string;
  otherHandle: string;
  lastBody?: string;
  lastAt: string;
  lastFromMe: boolean;
  unread: number;
};

/**
 * Count messages unread BY `viewer`: a message is unread-for-viewer when it has
 * no read_at AND the viewer did not send it (you never have unread messages from
 * yourself). Pure over a list of {senderHandle, read} rows.
 */
export function unreadForViewer(
  rows: ReadonlyArray<{ senderHandle: string; read: boolean }>,
  viewer: string,
): number {
  const v = normalizeHandle(viewer);
  if (!v) return 0;
  let n = 0;
  for (const r of rows) {
    if (r.read) continue;
    if (normalizeHandle(r.senderHandle) === v) continue; // your own message
    n += 1;
  }
  return n;
}

// ── @-mention linkify (light) ────────────────────────────────────────────────
// A message body segment: either plain text or an @handle mention. The render
// side maps a mention to a <Link href="/u/handle">. Pure + tested; NO
// notification is emitted for a mention in v1 — that's the documented seam (a
// future emitNotification({kind:"mention"}) hooks in at the send path).

export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "mention"; handle: string; raw: string };

// Match @handle where handle is the profile alphabet [a-z0-9_], case-insensitive
// so "@Ken" linkifies. A leading boundary (start or non-word char) keeps
// "email@host" from matching the "@host" fragment. The captured group is the
// handle sans "@"; we re-normalise it for the href so the link target is canonical.
const MENTION_RE = /(^|[^a-zA-Z0-9_@])@([a-zA-Z0-9_]{1,30})/g;

/**
 * Split a message body into text + mention segments for rendering. Pure: the
 * caller decides how to render each segment (text as-is, mention as a link to
 * /u/<normalised handle>). A mention whose handle normalises to empty is left as
 * plain text (never a broken link). Order + all characters are preserved so
 * concatenating the segment text reproduces the input.
 */
export function linkifyMentions(body: string): MessageSegment[] {
  if (typeof body !== "string" || body === "") return [];
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(body)) !== null) {
    const [full, boundary, rawHandle] = match;
    const handle = normalizeHandle(rawHandle);
    // Emit the text BEFORE the mention, including the boundary char the regex ate.
    const start = match.index;
    const prefix = body.slice(lastIndex, start) + boundary;
    if (prefix) segments.push({ type: "text", text: prefix });
    if (handle) {
      segments.push({ type: "mention", handle, raw: `@${rawHandle}` });
    } else {
      // Un-normalisable → keep the literal "@rawHandle" as text, never a link.
      segments.push({ type: "text", text: `@${rawHandle}` });
    }
    lastIndex = start + full.length;
  }
  const tail = body.slice(lastIndex);
  if (tail) segments.push({ type: "text", text: tail });
  return segments;
}
